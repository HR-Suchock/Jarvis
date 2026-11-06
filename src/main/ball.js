'use strict';
// PC floating ball (main-process side): a small always-on-top window that can be dragged, snaps to the screen edge, opens into a
// panel (chat, quick buttons, live PC stats, drop-to-phone). Everything the page may ask for is a fixed id; free text only goes to
// the main Jarvis window's normal command pipeline.
const path = require('path');
const os = require('os');

const SIZE = 68, PANEL_W = 340, PANEL_H = 556, MARGIN = 6;

// ---------------------------------------------------------------- pure helpers (unit-tested)
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
/** Snap a collapsed ball to the nearest left/right edge of the work area and keep it on screen. */
function snapPosition(x, y, wa, size) {
  size = size || SIZE;
  const left = (x + size / 2) < (wa.x + wa.width / 2);
  return { x: left ? wa.x + MARGIN : wa.x + wa.width - size - MARGIN, y: clamp(Math.round(y), wa.y + MARGIN, wa.y + wa.height - size - MARGIN), side: left ? 'left' : 'right' };
}
/** Window bounds of the opened panel for a ball at (x,y); the ball stays at its corner, the panel grows towards the screen centre. */
function expandBounds(x, y, wa, w, h) {
  w = Math.min(w || PANEL_W, wa.width - 2 * MARGIN); h = Math.min(h || PANEL_H, wa.height - 2 * MARGIN);
  const side = (x + SIZE / 2) < (wa.x + wa.width / 2) ? 'left' : 'right';
  const bx = side === 'left' ? x : x + SIZE - w;
  return { x: clamp(bx, wa.x + MARGIN, wa.x + wa.width - w - MARGIN), y: clamp(y, wa.y + MARGIN, wa.y + wa.height - h - MARGIN), width: w, height: h, side };
}
function level(cpu, ram, disk) { return (ram >= 92 || cpu >= 95 || disk >= 97) ? 'bad' : (ram >= 80 || cpu >= 85 || disk >= 92) ? 'warn' : 'ok'; }
/** What a dropped / copied string is: a web link (opens on the phone) or plain text (shown as a phone notification). */
function classifyDrop(text) {
  const t = String(text || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))[0] || '';
  if (!t) return null;
  const m = t.match(/^https?:\/\/[^\s<>"]{3,1900}$/i);
  return m ? { kind: 'url', value: m[0] } : { kind: 'text', value: String(text).trim().slice(0, 4000) };
}
// buttons that run a local PC action (everything else on the panel is a fixed special id handled by the controller)
const TILE_ACTIONS = { dl: ['openfolder', 'downloads'] };

const HN = 60;                                   // samples kept for the graphs (3 s apart = 3 minutes)
/** a circle of diameter d as 1-pixel-high rectangles (what Electron's setShape takes) */
function circleRects(d) {
  const r = d / 2, out = [];
  for (let y = 0; y < d; y++) { const dy = y + 0.5 - r, half = Math.sqrt(Math.max(0, r * r - dy * dy)); const x0 = Math.round(r - half), x1 = Math.round(r + half); if (x1 > x0) out.push({ x: x0, y, width: x1 - x0, height: 1 }); }
  return out;
}
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
/** % per minute the series is rising (+) or falling (-): mean of the last third against the first third. */
function slope(arr, stepSec) {
  const a = arr.slice(-20); if (a.length < 9) return 0;
  const t = Math.floor(a.length / 3);
  return (mean(a.slice(-t)) - mean(a.slice(0, t))) / (((a.length - t) * stepSec) / 60);
}
/** The "intelligence" of the panel: one health score, a verdict, and the most useful sentence about the PC right now. */
function insight(hist, s) {
  const cpu = mean(hist.cpu.slice(-4)) || s.cpu || 0, ram = s.ram || 0, disk = s.disk >= 0 ? s.disk : 0, b = s.batt;
  const pen = clamp((cpu - 30) * 0.5, 0, 35) + clamp((ram - 60) * 1.1, 0, 40) + clamp(disk - 80, 0, 20) + (b && !b.charging && b.pct < 30 ? clamp((30 - b.pct) * 0.5, 0, 15) : 0);
  const score = clamp(Math.round(100 - pen), 0, 100);
  const verdict = score >= 85 ? 'ALL SYSTEMS NOMINAL' : score >= 65 ? 'RUNNING WARM' : score >= 40 ? 'UNDER PRESSURE' : 'CRITICAL LOAD';
  const rate = slope(hist.ram, 3);
  let note = 'Everything is steady.';
  if (rate >= 1 && ram < 97) { const eta = Math.round((100 - ram) / rate); note = 'Memory is rising ' + rate.toFixed(1) + '%/min' + (eta <= 90 ? ' — full in about ' + Math.max(1, eta) + ' min.' : '.'); }
  else if (ram >= 85) note = 'Memory is tight — tap SCAN to see what is using it.';
  else if (cpu >= 85) note = 'The processor is busy — something heavy is running.';
  else if (disk >= 90) note = 'The system drive is ' + disk + '% full.';
  else if (b && !b.charging && b.pct <= 20) note = 'Battery is at ' + b.pct + '% — plug in soon.';
  else if (rate <= -2) note = 'Memory is being freed — load is dropping.';
  return { score, verdict, note, tone: score >= 85 ? 'ok' : score >= 55 ? 'warn' : 'bad' };
}
/** Context suggestions: only things that make sense right now (never a fixed row of common buttons). */
function chips(s, clip) {
  const out = [];
  if (clip) out.push({ id: 'clip', label: clip.kind === 'url' ? 'SEND COPIED LINK TO PHONE' : 'SEND COPIED TEXT TO PHONE' });
  if (s.ram >= 80 || s.cpu >= 85) out.push({ id: 'scan', label: 'FIND WHAT IS SLOWING THE PC' });
  if (s.disk >= 90) out.push({ id: 'dl', label: 'OPEN DOWNLOADS — DRIVE ' + s.disk + '% FULL' });
  return out.slice(0, 3);
}
/** `tasklist /FO CSV /NH` output -> biggest memory users, grouped by program. */
function parseTasklist(csv) {
  const m = new Map();
  for (const line of String(csv || '').split(/\r?\n/)) {
    const c = line.match(/^"([^"]+)","[^"]*","[^"]*","[^"]*","([\d.,\s]+)\s*K"/i);
    if (!c) continue;
    const name = c[1].replace(/\.exe$/i, ''), kb = parseInt(c[2].replace(/[^\d]/g, ''), 10);
    if (!kb || /^system idle process$/i.test(name)) continue;
    m.set(name, (m.get(name) || 0) + kb / 1024);
  }
  return [...m].map(([name, mb]) => ({ name, mb: Math.round(mb) })).filter((x) => x.mb > 0).sort((x, y) => y.mb - x.mb);
}
const fmtMem = (mb) => mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB';

// ---------------------------------------------------------------- controller
function createBall(ctx) {
  const { BrowserWindow, screen, ipcMain } = ctx.electron;
  let w = null, expanded = false, pos = null, side = 'right', drag = null, statTimer = null, prevCpu = null, hot = 0, lastRamNote = 0, lastDiskNote = 0, enabled = false, focusEnd = 0, focusTimer = null, ringing = false, ringTimer = null, themeName = 'cyan';
  const hist = { cpu: [], ram: [] };
  const wa = () => screen.getDisplayNearestPoint({ x: (pos ? pos.x : 0) + SIZE / 2, y: (pos ? pos.y : 0) + SIZE / 2 }).workArea;
  const alive = () => w && !w.isDestroyed();
  const send = (ev, d) => { try { if (alive()) w.webContents.send('ball:ev', ev, d || {}); } catch (e) { /* closing */ } };
  const trustedBall = (e) => { try { return !!e.senderFrame && e.senderFrame.url.startsWith('jarvis://ball/') && alive() && e.sender === w.webContents; } catch (x) { return false; } };
  const onB = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (trustedBall(e)) fn(...a); });
  const handleB = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!trustedBall(e)) throw new Error('untrusted'); return fn(...a); });

  function loadPos() {
    try { const p = JSON.parse(ctx.store.get('sys.ball') || 'null'); if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p; } catch (e) { /* default */ }
    return null;
  }
  function savePos() { try { ctx.store.set('sys.ball', JSON.stringify({ x: pos.x, y: pos.y })); } catch (e) { /* ignore */ } }

  function cpuNow() {
    const snap = os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 });
    let pct = 0;
    if (prevCpu && snap.total > prevCpu.total) pct = Math.round((1 - (snap.idle - prevCpu.idle) / (snap.total - prevCpu.total)) * 100);
    prevCpu = snap; return clamp(pct, 0, 100);
  }
  function tickStats() {
    if (!alive() || !w.isVisible()) return;
    const cpu = cpuNow(), ram = Math.round(100 - os.freemem() * 100 / os.totalmem());
    const d = ctx.getDisk && ctx.getDisk(), disk = d && d.total > 0 ? Math.round(100 - d.free * 100 / d.total) : -1;
    const lv = level(cpu, ram, disk), batt = ctx.getBattery ? ctx.getBattery() : null;
    hist.cpu.push(cpu); hist.ram.push(ram); if (hist.cpu.length > HN) { hist.cpu.shift(); hist.ram.shift(); }
    const st = { cpu, ram, disk, batt, level: lv };
    if (expanded) {                                  // the rich data is only built (and sent) while the panel is open
      let clip = null; try { clip = ctx.readClipboard ? classifyDrop(ctx.readClipboard()) : null; } catch (e) { /* none */ }
      st.hist = hist; st.ins = insight(hist, st); st.chips = chips(st, clip); st.me = ctx.getSelf ? ctx.getSelf() : null;
    }
    send('stats', st);
    const now = Date.now();
    if (ram >= 92) { hot++; if (hot >= 3 && now - lastRamNote > 30 * 60000) { lastRamNote = now; ctx.notify('Jarvis — memory is almost full', 'RAM is at ' + ram + '%. Closing a few apps will make the PC faster.'); } } else hot = 0;
    if (disk >= 95 && now - lastDiskNote > 24 * 3600000) { lastDiskNote = now; ctx.notify('Jarvis — disk is almost full', 'The system drive is ' + disk + '% full.'); }
  }
  // a collapsed ball only needs its colour now and then; the open panel updates a little faster
  function startStats() { if (!statTimer) { statTimer = setInterval(tickStats, expanded ? 3000 : 6000); tickStats(); } }
  function restartStats() { if (statTimer) { stopStats(); startStats(); } }
  function stopStats() { if (statTimer) { clearInterval(statTimer); statTimer = null; } }

  function applyBounds() {
    if (!alive()) return;
    const area = wa();
    if (expanded) {
      const b = expandBounds(pos.x, pos.y, area); side = b.side;
      w.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }, false);
      reshape();                                     // grow first, then open the click area
    } else {
      const s = snapPosition(pos.x, pos.y, area); pos.x = s.x; pos.y = s.y; side = s.side;
      reshape();                                     // shrink the click area to the circle first, so no square ever flashes
      w.setBounds({ x: pos.x, y: pos.y, width: SIZE, height: SIZE }, false);
    }
    send('init', { side, expanded });
  }
  // the window is only as big as the orb and its clickable area is an exact circle (no invisible square around it)
  function reshape() {
    if (!alive() || !w.setShape) return;
    try {
      if (expanded) { const e = expandBounds(pos.x, pos.y, wa()); w.setShape([{ x: 0, y: 0, width: e.width, height: e.height }]); return; }
      w.setShape(circleRects(SIZE));
    } catch (e) { /* not supported on this system: the transparent window is used as it is */ }
  }
  function setExpanded(on) {
    if (!alive() || expanded === on) return; expanded = on;
    if (on) { w.setFocusable(true); }
    applyBounds(); restartStats();
    if (on) { w.focus(); send('inputfocus'); setTimeout(() => { try { if (expanded) tickStats(); } catch (e) { /* ignore */ } }, 90); }   // the panel appears first, the numbers follow
  }

  function create() {
    if (alive()) return;
    const area = screen.getPrimaryDisplay().workArea;
    pos = loadPos() || { x: area.x + area.width - SIZE - MARGIN, y: area.y + Math.round(area.height * 0.55) };
    const s = snapPosition(pos.x, pos.y, area); pos = { x: s.x, y: s.y }; side = s.side; expanded = false;
    w = new BrowserWindow({
      width: SIZE, height: SIZE, x: pos.x, y: pos.y, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, alwaysOnTop: true, hasShadow: false, thickFrame: false, roundedCorners: false, show: false, focusable: true, title: 'Jarvis ball', backgroundColor: '#00000000',
      webPreferences: { preload: path.join(__dirname, 'ball-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: true },
    });
    w.setAlwaysOnTop(true, 'floating');
    w.setMenuBarVisibility(false);
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.once('did-finish-load', () => { send('init', { side, expanded }); send('focus', { end: focusEnd }); send('theme', { name: themeName }); if (w.isVisible()) startStats(); });
    w.webContents.on('render-process-gone', () => { const was = enabled; destroy(); if (was && enabled) setTimeout(() => { try { create(); } catch (e) { /* ignore */ } }, 800); });
    w.once('ready-to-show', () => { if (enabled) { w.showInactive(); startStats(); } });
    w.on('closed', () => { stopStats(); w = null; expanded = false; });
    w.on('blur', () => { /* stays open until the user closes it */ });
    w.loadURL('jarvis://ball/ball.html');
  }
  function destroy() { stopStats(); clearTimeout(focusTimer); clearTimeout(ringTimer); ringing = false; focusEnd = 0; if (alive()) w.destroy(); w = null; expanded = false; }

  // ---- IPC from the ball page
  onB('ball:drag-start', (sx, sy) => { if (!alive()) return; const b = w.getBounds(); drag = { sx: +sx || 0, sy: +sy || 0, x: b.x, y: b.y }; });
  onB('ball:drag-move', (sx, sy) => { if (!alive() || !drag) return; w.setPosition(Math.round(drag.x + (+sx - drag.sx)), Math.round(drag.y + (+sy - drag.sy))); });
  onB('ball:drag-end', (moved) => {
    if (!alive() || !drag) { drag = null; return; }
    drag = null; if (!moved) return;
    const b = w.getBounds();
    // when the panel is open the ball sits at its top corner
    pos = { x: expanded ? (side === 'left' ? b.x : b.x + b.width - SIZE) : b.x, y: b.y };
    applyBounds(); savePos();
  });
  onB('ball:toggle', (open) => setExpanded(!!open));
  onB('ball:ask', (text) => { const t = String(text || '').slice(0, 400).trim(); if (t) ctx.ask(t); });
  onB('ball:listen', () => ctx.listen());
  onB('ball:menu', () => { if (ctx.menu) ctx.menu(); });
  onB('ball:stoplisten', () => { if (ctx.stopListen) ctx.stopListen(); });
  handleB('ball:tile', async (id) => {
    id = String(id || '');
    try {
      if (id === 'jarvis') { ctx.showMain(); return { ok: true, msg: 'opened' }; }
      if (id === 'clip') { const c = classifyDrop(ctx.readClipboard()); if (!c) return { ok: false, msg: 'clipboard is empty' }; return await ctx.toPhone(c); }
      if (id === 'find') {                           // tap to start, tap again to stop
        if (ringing) {
          const r = await ctx.sendPhone('stopring', '');
          if (r && r.ok) { ringing = false; clearTimeout(ringTimer); send('ring', { on: false }); }
          return { ok: !!(r && r.ok), msg: r && r.ok ? 'phone stopped ringing' : (r && r.msg) || 'no answer' };
        }
        const r = await ctx.sendPhone('findphone', '');
        if (r && r.ok) { ringing = true; send('ring', { on: true }); clearTimeout(ringTimer); ringTimer = setTimeout(() => { ringing = false; send('ring', { on: false }); }, 60000); if (ringTimer.unref) ringTimer.unref(); }
        return { ok: !!(r && r.ok), msg: r && r.ok ? 'phone is ringing — tap again to stop' : (r && r.msg) || 'no answer' };
      }
      if (id === 'scan') {
        const list = ctx.scanProcs ? await ctx.scanProcs() : [];
        if (!list || !list.length) return { ok: false, msg: 'could not read the process list' };
        return { ok: true, msg: 'scan complete', text: 'Biggest memory users right now: ' + list.slice(0, 5).map((p) => p.name + ' ' + fmtMem(p.mb)).join(' · ') + '.' };
      }
      if (id === 'focus') {
        if (focusEnd) { clearTimeout(focusTimer); focusEnd = 0; send('focus', { end: 0 }); return { ok: true, msg: 'focus session cancelled' }; }
        focusEnd = Date.now() + 25 * 60000;
        focusTimer = setTimeout(() => { focusEnd = 0; send('focus', { end: 0 }); try { ctx.notify('Jarvis — focus session complete', '25 minutes done. Take a short break.'); } catch (e) { /* ignore */ } }, 25 * 60000);
        if (focusTimer.unref) focusTimer.unref();
        send('focus', { end: focusEnd }); return { ok: true, msg: 'focus started — 25 minutes' };
      }
      const a = TILE_ACTIONS[id]; if (!a) return { ok: false, msg: 'unknown button' };
      const r = await ctx.runAction(a[0], a[1], ''); return { ok: !!(r && r.ok), msg: String((r && r.msg) || (r && r.ok ? 'done' : 'failed')).slice(0, 80) };
    } catch (e) { return { ok: false, msg: 'failed' }; }
  });
  handleB('ball:dropfile', async (name, mime, data) => {
    const buf = data && data.byteLength !== undefined ? Buffer.from(data) : null;
    if (!buf || !buf.length) return { ok: false, msg: 'that file is empty' };
    if (buf.length > 12 * 1000 * 1000) return { ok: false, msg: 'too big — the limit is 3 MB' };
    if (!ctx.fileToPhone) return { ok: false, msg: 'files are not available' };
    return await ctx.fileToPhone({ name: String(name || 'file').slice(0, 120), mime: String(mime || ''), data: buf });
  });
  handleB('ball:drop', async (text) => { const c = classifyDrop(text); if (!c) return { ok: false, msg: 'nothing to send' }; return await ctx.toPhone(c); });

  function setTheme(n) { themeName = /^(cyan|amber|red|purple|mark|friday|green)$/.test(n) ? n : 'cyan'; send('theme', { name: themeName }); }
  return {
    setTheme, create, destroy,
    setEnabled(on) { enabled = !!on; if (enabled) { create(); if (alive() && !w.isVisible() && !w.webContents.isLoading()) { w.showInactive(); startStats(); } } else destroy(); },
    isEnabled: () => enabled,
    toggleVisible() { if (!alive()) return; if (w.isVisible()) { w.hide(); stopStats(); } else { w.showInactive(); startStats(); } },
    reply(text) { send('reply', { text: String(text || '').slice(0, 600) }); },
    state(s) { send('state', { state: String(s || 'idle') }); },
    status(t) { send('status', { text: String(t || '') }); },
    openPanel() { if (alive()) { if (!w.isVisible()) w.showInactive(); setExpanded(true); } },
    _win: () => w, _isExpanded: () => expanded,
  };
}

module.exports = { circleRects, createBall, snapPosition, expandBounds, classifyDrop, level, insight, chips, parseTasklist, slope, TILE_ACTIONS, SIZE, PANEL_W, PANEL_H };
