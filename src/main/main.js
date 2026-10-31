'use strict';
const { app, BrowserWindow, ipcMain, protocol, net, session, shell, clipboard, Notification, Tray, Menu, nativeImage, safeStorage, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const { Store } = require('./store');
const llm = require('./llm');
const { transcribe } = require('./stt');
const { createActions, TIER } = require('./actions');
const { Relay } = require('./relay');
const proto = require('./link-protocol');
const extra = require('./pc-extra-actions')({ clipboard, shell });
const TIERS = Object.assign({}, TIER, extra.TIER);

const APP_URL = 'jarvis://app/';
const RENDERER = path.join(__dirname, '..', '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const VERSION = app.getVersion();

protocol.registerSchemesAsPrivileged([{ scheme: 'jarvis', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

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
}


// The page asks for actions synchronously (like the Android bridge), but the extra actions are asynchronous.
// For commands typed/spoken on this PC they run in a short-lived helper process that returns the real reply.
function runExtraSync(type, arg, arg2) {
  try {
    const code = "const m=require(process.env.JARVIS_MOD)({});m.run(process.env.JARVIS_T,process.env.JARVIS_A,process.env.JARVIS_B).then(r=>{process.stdout.write(JSON.stringify(r));process.exit(0)})";
    const r = require('child_process').spawnSync(process.execPath, ['-e', code], {
      env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', JARVIS_MOD: path.join(__dirname, 'pc-extra-actions.js'), JARVIS_T: type, JARVIS_A: arg, JARVIS_B: arg2 }),
      encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 1 << 20,
    });
    const o = JSON.parse(String(r.stdout || '').trim());
    return o && typeof o.msg === 'string' ? { ok: !!o.ok, msg: o.msg } : { ok: false, msg: 'That did not work.' };
  } catch (e) { return { ok: false, msg: 'That did not work.' }; }
}

const recent = [];
async function onRemote(cmd) {
  const c = linkCfg();
  const now = Date.now();
  while (recent.length && now - recent[0] > 60000) recent.shift();
  if (recent.length >= 30) return { ok: false, msg: 'Too many commands in a minute — slow down.' };
  recent.push(now);
  const tier = TIERS[cmd.type];
  if (!tier) return { ok: false, msg: 'I cannot do “' + cmd.type.slice(0, 30) + '” on the PC.' };
  if (!c.enabled) return { ok: false, msg: 'The device link is switched off on the PC.' };
  if (tier === 'ctl' && !c.ctl) return { ok: false, msg: 'Remote control is switched off on the PC. Turn it on in Settings → Device Link.' };
  if (tier === 'input' && !c.input) return { ok: false, msg: 'Typing and keyboard control from the phone is switched off on the PC. Turn it on in Settings → Device Link.' };
  if (tier === 'danger' && !c.danger) return { ok: false, msg: 'Power commands from the phone are switched off on the PC. Turn them on in Settings → Device Link.' };
  if (tier !== 'ctl') notify('Jarvis — command from your phone', cmd.type + (cmd.arg ? ': ' + cmd.arg.slice(0, 80) : ''));
  const r = extra.handles(cmd.type) ? await extra.run(cmd.type, cmd.arg, cmd.arg2) : actions.run(cmd.type, cmd.arg, cmd.arg2);
  emit('linkIn', { type: cmd.type, arg: cmd.arg, ok: r.ok, msg: r.msg });
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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
  });
  if (sb && sb.max) win.maximize();
  win.on('resize', saveBounds); win.on('move', saveBounds); win.on('maximize', saveBounds); win.on('unmaximize', saveBounds);
  win.removeMenu();
  win.loadURL(APP_URL + 'index.html');
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
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
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Jarvis', click: showWin }, { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
  tray.on('click', showWin);
}

// ------------------------------------------------------------------------------------------------ IPC
function wireIpc() {
  on('pref:get', (e, k) => { e.returnValue = typeof k === 'string' && k.length <= 64 ? store.get('pref.' + k) : ''; });
  on('pref:set', (e, k, v) => { if (typeof k === 'string' && k.length <= 64 && typeof v === 'string') store.set('pref.' + k, v); e.returnValue = ''; });
  on('wipe', (e) => { const keep = store.get('sys.link'); store.clear(); if (keep) store.set('sys.link', keep); e.returnValue = ''; });
  on('action', (e, t, a, b) => {
    t = String(t); a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    e.returnValue = JSON.stringify(extra.handles(t) ? runExtraSync(t, a, b) : actions.run(t, a, b));
  });
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

app.whenReady().then(() => {
  app.setAppUserModelId('com.suchock.jarvis.pc');
  store = new Store(app.getPath('userData'), safeStorage);
  protocol.handle('jarvis', (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (!p || p === '/') p = '/index.html';
    const full = path.normalize(path.join(RENDERER, p));
    if (!full.startsWith(RENDERER + path.sep)) return new Response('Forbidden', { status: 403 });
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
  applyLink();
});

app.on('second-instance', showWin);
app.on('before-quit', () => { quitting = true; if (store) store.flushSync(); if (relay) relay.stop(); if (actions) actions.dispose(); });
app.on('window-all-closed', () => { if (quitting || !linkCfg().enabled) app.quit(); });
