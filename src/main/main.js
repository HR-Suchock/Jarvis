'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, session, shell, clipboard, Notification, Tray, Menu, nativeImage, safeStorage, desktopCapturer, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

const { Store } = require('./store');
const llm = require('./llm');
const { transcribe } = require('./stt');
const { createActions, TIER } = require('./actions');
const { Relay } = require('./relay');
const proto = require('./link-protocol');
const { createBall } = require('./ball');
// a file from the phone: pictures go to Pictures\Jarvis, everything else to Downloads\Jarvis (never overwrites; never opened automatically)
function saveFromPhone(name, mime, data) {
  try {
    const img = /^image\//i.test(mime);
    const base = app.getPath(img ? 'pictures' : 'downloads');
    const dir = path.join(base, 'Jarvis'); fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(name), stem = path.basename(name, ext);
    let target = path.join(dir, name), k = 1;
    while (fs.existsSync(target) && k < 500) target = path.join(dir, stem + ' (' + (k++) + ')' + ext);
    fs.writeFileSync(target, data, { flag: 'wx' });
    notifyFile(path.basename(target), dir);
    return { ok: true, msg: 'Saved on the PC: ' + path.basename(target) + ' (' + (img ? 'Pictures' : 'Downloads') + '\\Jarvis).' };
  } catch (e) { return { ok: false, msg: 'Could not save the file on the PC.' }; }
}
function notifyFile(file, dir) { try { const n = new Notification({ title: 'Jarvis — file from your phone', body: file + ' was saved. Click to show it.', silent: false }); n.on('click', () => shell.openPath(dir)); n.show(); } catch (e) { /* ignore */ } }
const extra = require('./pc-extra-actions')({ clipboard, shell, saveFile: saveFromPhone, getPath: (n) => { try { return app.getPath(n); } catch (e) { return ''; } } });
const TIERS = Object.assign({}, TIER, extra.TIER);

const APP_URL = 'jarvis://app/';
const RENDERER = path.join(__dirname, '..', '..', 'renderer');
const BALL_DIR = path.join(__dirname, 'ball');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const VERSION = app.getVersion();

protocol.registerSchemesAsPrivileged([{ scheme: 'jarvis', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let ball = null;
let win = null, tray = null, quitting = false, store = null, actions = null, relay = null;
let battery = null;                // {pct, charging} reported by the page
let disk = null;                   // {total, free}

// ------------------------------------------------------------------------------------------------ helpers
const emit = (ev, data) => { try { if (win && !win.isDestroyed()) win.webContents.send('native', ev, data || {}); } catch (e) { /* window gone */ } };
const notify = (title, body) => { try { if (Notification.isSupported()) new Notification({ title, body: String(body || ''), icon: ICON }).show(); } catch (e) { /* ignore */ } };
const trusted = (e) => { try { return e.senderFrame && e.senderFrame.url.startsWith(APP_URL); } catch (e2) { return false; } };
const on = (ch, fn) => ipcMain.on(ch, (e, ...a) => { if (!trusted(e)) { e.returnValue = ''; return; } fn(e, ...a); });
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => { if (!trusted(e)) throw new Error('untrusted sender'); return fn(e, ...a); });
const getSettings = () => { try { return JSON.parse(store.get('pref.settings') || '{}'); } catch (e) { return {}; } };

// ------------------------------------------------------------------------------------------------ link config
const linkDefaults = { enabled: false, dbUrl: '', secret: '', ctl: true, input: false, danger: false, autostart: false };
const linkCfg = () => { try { return Object.assign({}, linkDefaults, JSON.parse(store.get('sys.link') || '{}')); } catch (e) { return Object.assign({}, linkDefaults); } };
const saveLink = (c) => store.set('sys.link', JSON.stringify(c));
function linkState() {
  const c = linkCfg();
  return { role: 'pc', enabled: !!c.enabled, paired: !!(c.dbUrl && c.secret), connected: !!(relay && relay.connected), dbUrl: c.dbUrl, ctl: !!c.ctl, input: !!c.input, danger: !!c.danger, autostart: !!c.autostart, peer: 'phone' };
}
function applyLink() {
  const c = linkCfg();
  try { app.setLoginItemSettings({ openAtLogin: !!(c.autostart && app.isPackaged), args: ['--hidden'] }); } catch (e) { /* not supported */ }
  if (c.enabled && c.dbUrl && c.secret) relay.start(); else relay.stop();
  makeTray();
  pushTiers();
}


// The page asks for actions synchronously (like the Android bridge), but the extra actions are asynchronous.
// For commands typed/spoken on this PC they run on a worker thread; this thread waits on a shared flag for the real reply.
let xWorker = null;
function getXWorker() {
  if (xWorker) return xWorker;
  const { Worker } = require('worker_threads');
  const paths = {};
  ['downloads', 'documents', 'desktop', 'pictures', 'music', 'videos'].forEach((n) => { try { paths[n] = app.getPath(n); } catch (e) { /* ignore */ } });
  // inside the packaged app the worker files live in app.asar.unpacked (see "asarUnpack" in package.json)
  const dir = __dirname.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  xWorker = new Worker(path.join(dir, 'extra-worker.js'), { workerData: { paths, userData: app.getPath('userData') } });
  xWorker.on('message', (m) => {
    if (!m || !m.rpc) return;
    if (m.rpc === 'run') {
      Promise.resolve().then(() => { const q = route(String(m.type), String(m.arg || ''), String(m.arg2 || '')); return extra.handles(q.type) ? runExtraAsync(q.type, q.arg, q.arg2) : actions.run(q.type, q.arg, q.arg2); }).catch(() => ({ ok: false, msg: 'That did not work.' }))
        .then((r) => { try { if (xWorker) xWorker.postMessage({ rpcRes: m.id, r: { ok: !!(r && r.ok), msg: String((r && r.msg) || '') } }); } catch (e) { /* worker gone */ } });
    } else if (m.rpc === 'openpath' || m.rpc === 'openext') {
      const reply = (ok) => { try { if (xWorker) xWorker.postMessage({ rpcRes: m.id, r: { ok, msg: '' } }); } catch (e) { /* worker gone */ } };
      try {
        if (m.rpc === 'openpath') {
          const p = String(m.p || '');
          // only real files/folders by absolute path, never programs or scripts
          if (!path.isAbsolute(p) || /\.(?:exe|bat|cmd|com|scr|ps1|psm1|vbs|vbe|js|jse|wsf|msi|msp|lnk|reg|hta|jar|dll|cpl)$/i.test(p)) { reply(false); return; }
          shell.openPath(p).then((err) => reply(!err), () => reply(false));
        } else {
          const u = String(m.u || '');
          if (!/^https?:\/\/[^\s]{3,2000}$/i.test(u) && !/^ms-settings:[a-z-]+$/i.test(u)) { reply(false); return; }
          shell.openExternal(u).then(() => reply(true), () => reply(false));
        }
      } catch (e) { reply(false); }
    } else if (m.rpc === 'notify') {
      try { if (linkCfg().enabled && relay) relay.send('notify', String(m.text || ''), '', 8000).catch(() => {}); } catch (e) { /* optional */ }
    }
  });
  xWorker.on('error', () => { xWorker = null; });
  xWorker.on('exit', () => { xWorker = null; });
  xWorker.unref();
  pushTiers();
  return xWorker;
}
const ballOn = () => store.get('pref.ballOn') !== '0';           // on by default
// a command from a ball button: same paths as a command from the phone, but the user is right here so no switches apply
async function runLocalAction(type, arg, arg2) {
  const q = route(type, arg, arg2);
  return WORKER_REMOTE[q.type] ? runExtraAsync(q.type, q.arg, q.arg2) : extra.handles(q.type) ? extra.run(q.type, q.arg, q.arg2) : actions.run(q.type, q.arg, q.arg2);
}
async function sendToPhone(type, arg) {
  const c = linkCfg();
  if (!c.enabled || !c.dbUrl || !c.secret || !relay) return { ok: false, msg: 'link to phone is not set up' };
  const r = await relay.send(type, arg, '', 15000);
  return { ok: !!(r && r.ok), msg: String((r && r.msg) || (r && r.ok ? 'done' : 'no answer')).slice(0, 80) };
}
// ---- files to the phone: cut into encrypted pieces, sent one by one; the phone saves them (pictures into Gallery, others into Downloads)
const FILE_MAX = 3000000;
async function sendFileToPhone(buf, name, mime) {
  const c = linkCfg();
  if (!c.enabled || !c.dbUrl || !c.secret || !relay) return { ok: false, msg: 'link to phone is not set up' };
  if (!Buffer.isBuffer(buf) || !buf.length) return { ok: false, msg: 'that file is empty' };
  if (buf.length > FILE_MAX) return { ok: false, msg: 'too big — the limit is 3 MB' };
  name = String(name || 'file').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(-80) || 'file';
  mime = /^[a-z]+\/[a-z0-9.+-]{1,60}$/i.test(mime || '') ? String(mime).toLowerCase() : 'application/octet-stream';
  const CH = 36000, n = Math.ceil(buf.length / CH), id = crypto.randomBytes(9).toString('base64url');
  let last = null;
  for (let i = 0; i < n; i++) {
    last = await relay.send('filepart', JSON.stringify({ id, i, n, size: buf.length, name, mime }), buf.subarray(i * CH, (i + 1) * CH).toString('base64'), 30000);
    if (!last || !last.ok) return { ok: false, msg: String((last && last.msg) || 'no answer').slice(0, 80) + (i === 0 ? ' — if this keeps failing, publish the new firebase-rules.json once (files need its 70000 limit)' : '') };
  }
  return { ok: true, msg: String((last && last.msg) || 'sent').slice(0, 80) };
}
// a ball drop: big pictures are shrunk to a JPEG that fits; anything else must fit as it is
async function ballFileToPhone(f) {
  let { name, mime, data } = f;
  if (/^image\//i.test(mime) && data.length > 2500000) {
    try {
      let img = nativeImage.createFromBuffer(data); const sz = img.getSize();
      if (sz.width > 2200) img = img.resize({ width: 2200 });
      data = img.toJPEG(80); mime = 'image/jpeg'; name = name.replace(/\.[^.]*$/, '') + '.jpg';
    } catch (e) { return { ok: false, msg: 'could not shrink that picture' }; }
  }
  const r = await sendFileToPhone(data, name, mime);
  return r.ok ? { ok: true, msg: 'sent — saved on your phone' } : r;
}
async function captureJpeg() {
  const disp = screen.getPrimaryDisplay();
  const w = Math.min(1600, disp.size.width), h = Math.round(w * disp.size.height / disp.size.width);
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
  if (!srcs.length) throw new Error('no screen found');
  return srcs[0].thumbnail.toJPEG(75);
}
async function shotToPhone() {
  try {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const r = await sendFileToPhone(await captureJpeg(), 'pc-screenshot-' + stamp + '.jpg', 'image/jpeg');
    if (!r.ok) notify('Jarvis — could not send the screenshot to your phone', r.msg);
  } catch (e) { notify('Jarvis — could not send the screenshot to your phone', String(e && e.message || e).slice(0, 120)); }
}
function pushTiers() {
  try { const c = linkCfg(); if (xWorker) xWorker.postMessage({ tiers: { ctl: c.ctl === true, input: c.input === true, danger: c.danger === true } }); } catch (e) { /* ignore */ }
}
// Phone commands that need the worker's saved state (scheduled jobs, backups) go through here.
const WORKER_REMOTE = { jobadd: 1, joblist: 1, jobdel: 1, backup: 1, cleantemp: 1 };
function runExtraAsync(type, arg, arg2) {
  return new Promise((resolve) => {
    try {
      const { MessageChannel } = require('worker_threads');
      const ch = new MessageChannel(); let done = false;
      const fin = (r) => { if (done) return; done = true; try { ch.port1.close(); } catch (e) { /* ignore */ } resolve(r); };
      ch.port1.once('message', (r) => fin(r && typeof r.msg === 'string' ? { ok: !!r.ok, msg: r.msg } : { ok: false, msg: 'That did not work.' }));
      setTimeout(() => fin({ ok: false, msg: 'That took too long.' }), 60000).unref();
      getXWorker().postMessage({ port: ch.port2, type, arg, arg2 }, [ch.port2]);
    } catch (e) { resolve({ ok: false, msg: 'That did not work.' }); }
  });
}
function runExtraSync(type, arg, arg2) {
  try {
    const { MessageChannel, receiveMessageOnPort } = require('worker_threads');
    const sab = new SharedArrayBuffer(4), flag = new Int32Array(sab), ch = new MessageChannel();
    getXWorker().postMessage({ port: ch.port2, sab, type, arg, arg2 }, [ch.port2]);
    const w = Atomics.wait(flag, 0, 0, 45000);
    const m = w === 'timed-out' ? null : receiveMessageOnPort(ch.port1);
    ch.port1.close();
    const o = m && m.message;
    return o && typeof o.msg === 'string' ? { ok: !!o.ok, msg: o.msg } : { ok: false, msg: 'That took too long. I may still be indexing your drives, so try again in a minute.' };
  } catch (e) { return { ok: false, msg: 'That did not work.' }; }
}

// volume / media-key commands are sent as real key presses (the PowerShell audio route failed silently on some PCs)
function route(type, arg, arg2) { const m = extra.remap ? extra.remap(type, arg) : null; return m || { type, arg, arg2 }; }

const recent = [], mouseRecent = [];
let lastMouseNote = 0;
const fileRecent = [];
async function onRemote(cmd) {
  const c = linkCfg();
  const now = Date.now();
  const isFile = cmd.type === 'filepart';
  const isMouse = cmd.type === 'mouse';             // touchpad moves arrive many times a second: own, higher limit
  if (isMouse) {
    while (mouseRecent.length && now - mouseRecent[0] > 1000) mouseRecent.shift();
    if (mouseRecent.length >= 120) return { ok: false, msg: 'Too fast.' };
    mouseRecent.push(now);
  } else if (isFile) {                               // pieces of a file: own limit (a 3 MB file is about 85 pieces)
    while (fileRecent.length && now - fileRecent[0] > 60000) fileRecent.shift();
    if (fileRecent.length >= 400) return { ok: false, msg: 'Too many file pieces — try again in a minute.' };
    fileRecent.push(now);
  } else {
    while (recent.length && now - recent[0] > 60000) recent.shift();
    if (recent.length >= 30) return { ok: false, msg: 'Too many commands in a minute — slow down.' };
    recent.push(now);
  }
  const tier = TIERS[cmd.type];
  if (!tier) return { ok: false, msg: 'I cannot do “' + cmd.type.slice(0, 30) + '” on the PC.' };
  if (!c.enabled) return { ok: false, msg: 'The device link is switched off on the PC.' };
  if (tier === 'ctl' && !c.ctl) return { ok: false, msg: 'Remote control is switched off on the PC. Turn it on in Settings → Device Link.' };
  if (tier === 'input' && !c.input) return { ok: false, msg: 'Typing and keyboard control from the phone is switched off on the PC. Turn it on in Settings → Device Link.' };
  if (tier === 'danger' && !c.danger) return { ok: false, msg: 'Power commands from the phone are switched off on the PC. Turn them on in Settings → Device Link.' };
  if (isMouse) { if (now - lastMouseNote > 60000) { lastMouseNote = now; notify('Jarvis — touchpad from your phone', 'The phone is controlling the mouse and keyboard.'); } }
  else if (tier !== 'ctl') notify('Jarvis — command from your phone', cmd.type + (cmd.arg ? ': ' + cmd.arg.slice(0, 80) : ''));
  const q = route(cmd.type, cmd.arg, cmd.arg2);
  let r = WORKER_REMOTE[q.type] ? await runExtraAsync(q.type, q.arg, q.arg2)
    : extra.handles(q.type) ? await extra.run(q.type, q.arg, q.arg2) : actions.run(q.type, q.arg, q.arg2);
  if (cmd.type === 'screenshot' && r.ok) { r = { ok: true, msg: 'Screenshot taken — sending it to your phone (Gallery → Jarvis).' }; shotToPhone(); }
  if (isFile) {                                      // a file arrives in ~85 pieces: never push each 48 KB piece (or a chat line per piece) to the window
    if (!r.ok || !/^Piece \d+ of \d+/.test(r.msg || '')) emit('linkIn', { type: 'filepart', arg: '', ok: r.ok, msg: r.msg });
    return r;
  }
  if (!isMouse) emit('linkIn', { type: cmd.type, arg: cmd.arg, ok: r.ok, msg: r.msg });
  return r;
}

// ------------------------------------------------------------------------------------------------ window
function loadBounds() {
  try {
    const b = JSON.parse(store.get('sys.bounds') || 'null');
    if (!b || !(b.width >= 420) || !(b.height >= 560)) return null;
    // only reuse a saved position if it is still on a connected screen
    if (typeof b.x === 'number' && typeof b.y === 'number') {
      const wa = screen.getDisplayMatching({ x: b.x, y: b.y, width: b.width, height: b.height }).workArea;
      if (b.x + 100 > wa.x + wa.width || b.y + 60 > wa.y + wa.height || b.x + b.width < wa.x + 100 || b.y < wa.y - 10) { delete b.x; delete b.y; }
    }
    return b;
  } catch (e) { return null; }
}
let boundsTimer = null;
function saveBounds() {
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    try {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      const max = win.isMaximized();
      const b = max ? (JSON.parse(store.get('sys.bounds') || '{}')) : win.getBounds();
      store.set('sys.bounds', JSON.stringify(Object.assign({}, b, { max })));
    } catch (e) { /* ignore */ }
  }, 400);
}

function createWindow(hidden) {
  const sb = loadBounds();
  const wa = screen.getPrimaryDisplay().workArea;
  const def = { width: Math.min(1180, wa.width - 60), height: Math.min(780, wa.height - 60) };
  win = new BrowserWindow({
    width: (sb && sb.width) || def.width, height: (sb && sb.height) || def.height,
    x: sb && typeof sb.x === 'number' ? sb.x : undefined, y: sb && typeof sb.y === 'number' ? sb.y : undefined,
    minWidth: 420, minHeight: 580, show: false, title: 'J.A.R.V.I.S', backgroundColor: '#02070d',
    icon: ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: true },
  });  let reloads = 0, hangTimer = null;
  win.webContents.on('render-process-gone', (e, d) => {                       // the page crashed: bring it back instead of leaving a blank window
    if (quitting || (d && d.reason === 'clean-exit') || reloads++ > 3) return;
    setTimeout(() => { try { if (win && !win.isDestroyed()) win.webContents.reload(); } catch (x) { /* ignore */ } }, 600);
  });
  win.on('unresponsive', () => { clearTimeout(hangTimer); hangTimer = setTimeout(() => { try { if (win && !win.isDestroyed() && reloads++ < 3) win.webContents.reload(); } catch (x) { /* ignore */ } }, 12000); });
  win.on('responsive', () => clearTimeout(hangTimer));

  if (sb && sb.max) win.maximize();
  win.on('resize', saveBounds); win.on('move', saveBounds); win.on('maximize', saveBounds); win.on('unmaximize', saveBounds);
  win.removeMenu();
  win.loadURL(APP_URL + 'index.html');
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
  win.on('closed', () => { if (!quitting && !linkCfg().enabled) app.quit(); });
  win.on('close', (e) => {
    if (!quitting && linkCfg().enabled) { e.preventDefault(); win.hide(); notifyOnce(); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(APP_URL)) e.preventDefault(); });
  win.webContents.on('before-input-event', (e, input) => { if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools(); });
}
let told = false;
function notifyOnce() { if (!told) { told = true; notify('Jarvis is still running', 'It stays in the tray so your phone can reach this PC. Right-click the tray icon to quit.'); } }
function showWin() { if (!win) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
function makeTray() {
  const need = linkCfg().enabled;
  if (!need) { if (tray) { tray.destroy(); tray = null; } return; }
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('J.A.R.V.I.S');
  refreshTray();
  tray.on('click', showWin);
}

// ------------------------------------------------------------------------------------------------ IPC
function wireIpc() {
  on('pref:get', (e, k) => { e.returnValue = typeof k === 'string' && k.length <= 64 ? store.get('pref.' + k) : ''; });
  on('pref:set', (e, k, v) => { if (typeof k === 'string' && k.length <= 64 && typeof v === 'string') store.set('pref.' + k, v); e.returnValue = ''; });
  on('wipe', (e) => { const keep = store.get('sys.link'); store.clear(); if (keep) store.set('sys.link', keep); e.returnValue = ''; });
  on('action', (e, t, a, b) => {
    t = String(t); a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    const q = route(t, a, b);
    e.returnValue = JSON.stringify(extra.handles(q.type) ? runExtraSync(q.type, q.arg, q.arg2) : actions.run(q.type, q.arg, q.arg2));
  });
  // non-blocking twin of 'action': the window keeps responding while a drive scan / PowerShell command runs
  handle('action:async', async (e, t, a, b) => {
    t = String(t); a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    try { const q = route(t, a, b); return extra.handles(q.type) ? await runExtraAsync(q.type, q.arg, q.arg2) : actions.run(q.type, q.arg, q.arg2); } catch (err) { return { ok: false, msg: 'That did not work.' }; }
  });
  // floating ball: switch + messages from the main window
  on('ball:get', (e) => { e.returnValue = ballOn() ? '1' : ''; });
  on('ball:set', (e, v) => { setBallOn(!!v); e.returnValue = 'ok'; });
  ipcMain.on('ball:theme', (e, n) => { if (trusted(e) && ball && typeof n === 'string') ball.setTheme(n); });
  ipcMain.on('ball:text', (e, t) => { if (trusted(e) && ball && typeof t === 'string') ball.reply(t); });
  ipcMain.on('ball:state', (e, st) => { if (trusted(e) && ball && typeof st === 'string') ball.state(st); });
  on('sysinfo', (e) => {
    const total = os.totalmem(), free = os.freemem();
    const o = { ramPct: Math.round(100 - free * 100 / total), ramUsedMB: Math.round((total - free) / 1048576), ramTotalMB: Math.round(total / 1048576), uptimeMin: Math.floor(os.uptime() / 60) };
    if (disk && disk.total > 0) { o.stoPct = Math.round(100 - disk.free * 100 / disk.total); o.stoFreeGB = Math.round(disk.free / 1.0737418e8) / 10; o.stoTotalGB = Math.round(disk.total / 1.0737418e8) / 10; }
    e.returnValue = JSON.stringify(o);
  });
  ipcMain.on('battery', (e, b) => { if (trusted(e) && b && typeof b.pct === 'number') battery = { pct: Math.round(b.pct), charging: !!b.charging }; });
  on('openurl', (e, u) => { if (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u)) shell.openExternal(u); e.returnValue = ''; });
  on('copy', (e, t) => { if (typeof t === 'string') clipboard.writeText(t.slice(0, 20000)); e.returnValue = ''; });
  on('minimize', (e) => { if (win) win.minimize(); e.returnValue = ''; });
  on('privacy', (e, v) => { try { if (win) win.setContentProtection(!!v); } catch (x) { /* ignore */ } e.returnValue = ''; });
  on('appinfo', (e) => { e.returnValue = JSON.stringify({ version: VERSION, sdk: 0, platform: process.platform }); });

  const done = (ev, id, p) => p.then((data) => emit(ev, { id, ok: true, data }), (err) => emit(ev, { id, ok: false, error: friendlyErr(err) }));
  ipcMain.on('chat', (e, p) => {
    if (!trusted(e) || !p) return;
    llm.chat(p.type, p.baseUrl, p.key, p.model, JSON.parse(p.messagesJson), p.system).then(
      (text) => emit('chat', { id: p.id, ok: true, text }), (err) => emit('chat', { id: p.id, ok: false, error: friendlyErr(err) }));
  });
  ipcMain.on('models', (e, p) => { if (trusted(e) && p) llm.listModels(p.type, p.baseUrl, p.key).then((models) => emit('models', { id: p.id, ok: true, models }), (err) => emit('models', { id: p.id, ok: false, error: friendlyErr(err) })); });
  ipcMain.on('search', (e, p) => { if (trusted(e) && p) done('tool', p.id, llm.googleSearch(p.key, p.cx, p.query)); });
  ipcMain.on('tavily', (e, p) => { if (trusted(e) && p) done('tool', p.id, llm.tavily(p.key, p.query)); });
  ipcMain.on('weather', (e, p) => { if (trusted(e) && p) done('tool', p.id, llm.weather(p.key, p.place, p.units)); });

  handle('stt', (e, wav, lang) => transcribe(getSettings(), Buffer.from(wav), lang));

  // ---- device link
  on('link:state', (e) => { e.returnValue = JSON.stringify(linkState()); });
  on('link:set', (e, o) => {
    const c = linkCfg();
    for (const k of ['enabled', 'ctl', 'input', 'danger', 'autostart']) if (o && typeof o[k] === 'boolean') c[k] = o[k];
    if (c.enabled && !(c.dbUrl && c.secret)) c.enabled = false;
    saveLink(c); applyLink(); e.returnValue = JSON.stringify(linkState());
  });
  on('link:create', (e, dbUrl) => {
    const u = proto.normalizeDbUrl(dbUrl);
    if (!u) { e.returnValue = JSON.stringify({ ok: false, msg: 'Paste your Firebase Realtime Database address, e.g. https://your-project-default-rtdb.firebaseio.com' }); return; }
    const c = linkCfg(); c.dbUrl = u; c.secret = proto.newSecret(); c.enabled = true; saveLink(c); applyLink();
    e.returnValue = JSON.stringify({ ok: true, code: proto.makeCode(c.dbUrl, c.secret), state: linkState() });
  });
  on('link:pair', (e, code) => {
    try {
      const p = proto.parseCode(code); const c = linkCfg();
      c.dbUrl = p.dbUrl; c.secret = p.secret; c.enabled = true; saveLink(c); applyLink();
      e.returnValue = JSON.stringify({ ok: true, state: linkState() });
    } catch (err) { e.returnValue = JSON.stringify({ ok: false, msg: err.message }); }
  });
  on('link:code', (e) => { const c = linkCfg(); e.returnValue = JSON.stringify(c.dbUrl && c.secret ? { ok: true, code: proto.makeCode(c.dbUrl, c.secret) } : { ok: false, msg: 'Not paired yet.' }); });
  on('link:unpair', (e) => { const c = linkCfg(); c.enabled = false; c.dbUrl = ''; c.secret = ''; saveLink(c); applyLink(); e.returnValue = JSON.stringify(linkState()); });
  let linkSeq = 0;
  on('link:send', (e, type, arg, arg2) => {
    const id = 'L' + (++linkSeq);
    relay.send(String(type), String(arg || ''), String(arg2 || '')).then((r) => emit('linkResult', { id, ok: r.ok, msg: r.msg }));
    e.returnValue = id;
  });
  on('link:ping', (e) => {
    const id = 'L' + (++linkSeq);
    relay.ping().then((r) => emit('linkResult', { id, ok: r.ok, msg: r.msg, ping: true }));
    e.returnValue = id;
  });
}
function friendlyErr(e) { const m = e && e.message ? e.message : String(e); return m; }

// ------------------------------------------------------------------------------------------------ boot
async function takeScreenshot(dir) {
  const disp = screen.getPrimaryDisplay();
  const size = { width: Math.round(disp.size.width * disp.scaleFactor), height: Math.round(disp.size.height * disp.scaleFactor) };
  const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  if (!srcs.length) throw new Error('no screen found');
  await fs.promises.mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(dir, 'screenshot-' + stamp + '.png');
  await fs.promises.writeFile(file, srcs[0].thumbnail.toPNG());
  return file;
}
function refreshDisk() {
  const p = process.platform === 'win32' ? (process.env.SystemDrive || 'C:') + '\\' : '/';
  fs.promises.statfs(p).then((s) => { disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; }).catch(() => {});
}

// ---- stability: nothing in the background may take the app down, and a PC whose graphics driver keeps crashing falls back to software drawing
const GPU_FLAG = path.join(app.getPath('userData'), 'no-gpu');
try { if (fs.existsSync(GPU_FLAG)) app.disableHardwareAcceleration(); } catch (e) { /* ignore */ }
let gpuCrashes = 0;
app.on('child-process-gone', (e, d) => {
  if (d && d.type === 'GPU' && d.reason !== 'clean-exit' && ++gpuCrashes >= 2) { try { fs.writeFileSync(GPU_FLAG, '1'); } catch (x) { /* ignore */ } }   // used from the next start
});
process.on('uncaughtException', (e) => { try { console.error('uncaught', e && e.message); } catch (x) { /* ignore */ } });
process.on('unhandledRejection', (e) => { try { console.error('unhandled', e && e.message); } catch (x) { /* ignore */ } });

for (const sw of ['disable-background-networking', 'disable-component-update', 'no-pings', 'disable-sync']) { try { app.commandLine.appendSwitch(sw); } catch (e) { /* ignore */ } }
try { app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints,Translate,AutofillServerCommunication'); } catch (e) { /* ignore */ }
// one switch for the floating ball: Settings, the tray menu and the ball's own right-click menu all use it
function setBallOn(v) {
  store.set('pref.ballOn', v ? '1' : '0');
  if (ball) ball.setEnabled(!!v);
  refreshTray();
  emit('ballSetting', { on: !!v });
}
function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Jarvis', click: showWin },
    { label: 'Floating ball', type: 'checkbox', checked: ballOn(), click: (i) => setBallOn(i.checked) },
    { label: 'Show / hide the ball (Ctrl+Alt+J)', enabled: ballOn(), click: () => { if (ball) ball.toggleVisible(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
}
app.whenReady().then(() => {
  app.setAppUserModelId('com.suchock.jarvis.pc');
  store = new Store(app.getPath('userData'), safeStorage);
  protocol.handle('jarvis', (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    const root = u.hostname === 'ball' ? BALL_DIR : RENDERER;           // jarvis://ball/ = the floating-ball page
    if (u.hostname === 'ball' && p === '/fonts.css') return net.fetch(pathToFileURL(path.join(RENDERER, 'css', 'fonts.css')).toString());   // same fonts as the app
    if (!p || p === '/') p = u.hostname === 'ball' ? '/ball.html' : '/index.html';
    const full = path.normalize(path.join(root, p));
    if (!full.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(full).toString());
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => {
    const okOrigin = details && details.requestingUrl && details.requestingUrl.startsWith(APP_URL);
    cb(!!(okOrigin && perm === 'media' && details.mediaTypes && details.mediaTypes.every((t) => t === 'audio')));
  });
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => perm === 'media' && String(origin).startsWith('jarvis://'));

  actions = createActions({
    shell, clipboard, app, notify, beep: () => shell.beep(), screenshot: takeScreenshot, getBattery: () => battery,
    onFire: (label) => { emit('reminderFired', { label }); },
  });
  relay = new Relay(linkCfg, onRemote);
  relay.on('status', (s) => emit('linkStatus', s));
  relay.on('error-soft', () => { /* retried automatically */ });
  wireIpc();
  refreshDisk(); setInterval(refreshDisk, 120000);
  createWindow(process.argv.includes('--hidden') && linkCfg().enabled);
  ball = createBall({
    electron: { BrowserWindow, screen, ipcMain }, store, notify,
    ask: (text) => emit('ballAsk', { text }), listen: () => emit('ballListen', {}), showMain: () => showWin(),
    readClipboard: () => { try { return clipboard.readText(); } catch (e) { return ''; } },
    runAction: runLocalAction,
    sendPhone: sendToPhone,
    toPhone: async (c) => { const r = c.kind === 'url' ? await sendToPhone('url', c.value) : await sendToPhone('setclip', c.value); return r.ok ? { ok: true, msg: c.kind === 'url' ? 'opened on your phone' : 'copied to your phone clipboard' } : r; },
    fileToPhone: ballFileToPhone, menu: () => Menu.buildFromTemplate([
      { label: 'Open Jarvis', click: () => showWin() },
      { label: 'Hide the ball (Ctrl+Alt+J brings it back)', click: () => ball && ball.toggleVisible() },
      { type: 'separator' },
      { label: 'Turn off the floating ball', click: () => setBallOn(false) },
    ]).popup(), stopListen: () => emit('ballStop', {}),
    getDisk: () => disk, getBattery: () => battery,
    getSelf: () => { try { const m = app.getAppMetrics(); return { cpu: +m.reduce((a, x) => a + (x.cpu.percentCPUUsage || 0), 0).toFixed(1), mb: Math.round(m.reduce((a, x) => a + (x.memory.workingSetSize || 0), 0) / 1024) }; } catch (e) { return null; } },
    scanProcs: () => new Promise((res) => {
      if (process.platform !== 'win32') return res([]);
      require('child_process').execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => res(err ? [] : require('./ball').parseTasklist(out).slice(0, 5)));
    }),
  });
  ball.setEnabled(ballOn());
  try { globalShortcut.register('Control+Alt+J', () => { if (ball) ball.toggleVisible(); }); } catch (e) { /* shortcut taken */ }
  try { globalShortcut.register('Control+Alt+Space', () => { emit('ballListen', {}); }); } catch (e) { /* shortcut taken */ }
  applyLink();
  try { getXWorker(); } catch (e) { /* scheduler is optional */ }
  setTimeout(() => { try { getXWorker().postMessage({ warm: true }); } catch (e) { /* optional */ } }, 4000);
});

app.on('second-instance', showWin);
app.on('before-quit', () => { quitting = true; try { globalShortcut.unregisterAll(); } catch (e) { /* ignore */ } if (store) store.flushSync(); if (relay) relay.stop(); if (actions) actions.dispose(); });
app.on('window-all-closed', () => { if (quitting || !linkCfg().enabled) app.quit(); });
