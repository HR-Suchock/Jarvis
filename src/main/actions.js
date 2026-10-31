'use strict';
/**
 * Everything Jarvis can physically do on the PC. Mirrors Actions.java: run(type, arg, arg2) -> {ok, msg}.
 * Windows is the target; a few actions also work elsewhere so the app can be developed on any OS.
 * Nothing user-supplied is ever pasted into a shell command line: PowerShell gets its input through an
 * environment variable, and app names are matched against a fixed table / the Start Menu before launching.
 */
const path = require('path');
const fs = require('fs');

const WIN = process.platform === 'win32';

// ---- apps -----------------------------------------------------------------------------------------------------
// name -> {exe} (launched with `start`, so App Paths registry entries work) | {uri} | {url}
const APPS = {
  chrome: { exe: 'chrome.exe' }, 'google chrome': { exe: 'chrome.exe' }, edge: { exe: 'msedge.exe' }, 'microsoft edge': { exe: 'msedge.exe' },
  firefox: { exe: 'firefox.exe' }, brave: { exe: 'brave.exe' }, opera: { exe: 'opera.exe' },
  notepad: { exe: 'notepad.exe' }, 'note pad': { exe: 'notepad.exe' }, calculator: { exe: 'calc.exe' }, calc: { exe: 'calc.exe' },
  paint: { exe: 'mspaint.exe' }, 'ms paint': { exe: 'mspaint.exe' }, wordpad: { exe: 'wordpad.exe' },
  word: { exe: 'winword.exe' }, 'microsoft word': { exe: 'winword.exe' }, excel: { exe: 'excel.exe' }, 'microsoft excel': { exe: 'excel.exe' },
  powerpoint: { exe: 'powerpnt.exe' }, 'power point': { exe: 'powerpnt.exe' }, outlook: { exe: 'outlook.exe' }, onenote: { exe: 'onenote.exe' },
  explorer: { exe: 'explorer.exe' }, 'file explorer': { exe: 'explorer.exe' }, files: { exe: 'explorer.exe' }, 'this pc': { exe: 'explorer.exe' },
  'task manager': { exe: 'taskmgr.exe' }, cmd: { exe: 'cmd.exe' }, 'command prompt': { exe: 'cmd.exe' }, powershell: { exe: 'powershell.exe' },
  terminal: { exe: 'wt.exe' }, 'windows terminal': { exe: 'wt.exe' }, 'control panel': { exe: 'control.exe' }, 'snipping tool': { exe: 'snippingtool.exe' },
  vscode: { exe: 'code.cmd' }, 'vs code': { exe: 'code.cmd' }, 'visual studio code': { exe: 'code.cmd' }, code: { exe: 'code.cmd' },
  spotify: { exe: 'spotify.exe' }, discord: { uri: 'discord:' }, telegram: { exe: 'telegram.exe' }, whatsapp: { uri: 'whatsapp:' }, steam: { uri: 'steam:' },
  vlc: { exe: 'vlc.exe' }, zoom: { exe: 'zoom.exe' }, teams: { uri: 'msteams:' }, skype: { uri: 'skype:' }, obs: { exe: 'obs64.exe' },
  settings: { uri: 'ms-settings:' }, 'windows settings': { uri: 'ms-settings:' }, store: { uri: 'ms-windows-store:' }, 'microsoft store': { uri: 'ms-windows-store:' },
  camera: { uri: 'microsoft.windows.camera:' }, photos: { uri: 'ms-photos:' }, clock: { uri: 'ms-clock:' }, calendar: { uri: 'outlookcal:' }, mail: { uri: 'outlookmail:' },
  maps: { url: 'https://www.google.com/maps' }, youtube: { url: 'https://www.youtube.com' }, 'you tube': { url: 'https://www.youtube.com' },
  gmail: { url: 'https://mail.google.com' }, google: { url: 'https://www.google.com' }, facebook: { url: 'https://www.facebook.com' },
  instagram: { url: 'https://www.instagram.com' }, twitter: { url: 'https://x.com' }, x: { url: 'https://x.com' }, github: { url: 'https://github.com' },
  chatgpt: { url: 'https://chatgpt.com' }, claude: { url: 'https://claude.ai' }, gemini: { url: 'https://gemini.google.com' }, netflix: { url: 'https://www.netflix.com' },
  downloads: { dir: 'downloads' }, documents: { dir: 'documents' }, pictures: { dir: 'pictures' }, music: { dir: 'music' }, videos: { dir: 'videos' }, desktop: { dir: 'desktop' },
};
// friendly name -> process image name (for "close X")
const PROCS = { chrome: 'chrome', 'google chrome': 'chrome', edge: 'msedge', 'microsoft edge': 'msedge', firefox: 'firefox', notepad: 'notepad', calculator: 'CalculatorApp',
  word: 'winword', excel: 'excel', powerpoint: 'powerpnt', spotify: 'spotify', discord: 'discord', vlc: 'vlc', zoom: 'zoom', telegram: 'telegram', paint: 'mspaint',
  explorer: 'explorer', 'task manager': 'taskmgr', vscode: 'code', 'vs code': 'code', 'visual studio code': 'code', brave: 'brave', opera: 'opera', steam: 'steam' };
const ALIASES = { yt: 'youtube', fb: 'facebook', insta: 'instagram', 'whats app': 'whatsapp', 'google maps': 'maps', 'file manager': 'explorer', 'my computer': 'this pc', 'note': 'notepad' };

const SETTINGS = { wifi: 'ms-settings:network-wifi', bluetooth: 'ms-settings:bluetooth', display: 'ms-settings:display', sound: 'ms-settings:sound', location: 'ms-settings:privacy-location',
  defaultapps: 'ms-settings:defaultapps', accessibility: 'ms-settings:easeofaccess', main: 'ms-settings:' };

// SendKeys notation (Windows only)
const KEYS = { enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}', esc: '{ESC}', space: ' ', delete: '{DEL}', backspace: '{BS}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
  back: '%{LEFT}', forward: '%{RIGHT}', clear: '^a{DEL}', copy: '^c', paste: '^v', cut: '^x', undo: '^z', redo: '^y', save: '^s', 'select all': '^a', selectall: '^a', find: '^f',
  refresh: '{F5}', reload: '{F5}', fullscreen: '{F11}', 'full screen': '{F11}', 'new tab': '^t', 'close tab': '^w', 'close window': '%{F4}', 'switch window': '%{TAB}',
  'next tab': '^{TAB}', 'previous tab': '^+{TAB}', home: '{HOME}', end: '{END}', 'page up': '{PGUP}', 'page down': '{PGDN}' };

const esc = (s) => String(s == null ? '' : s);
const res = (ok, msg) => ({ ok: !!ok, msg });
const safeName = (s) => esc(s).toLowerCase().replace(/[^a-z0-9 ._+-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);

// ---- PowerShell snippets ----------------------------------------------------------------------------------------
const PS_AUDIO = `
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, System.Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, System.Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref System.Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint); }
[ComImport, Guid("BCDE0395-E52F-46C6-AF63-FB8D5E2E8E7D")] class MMDeviceEnumeratorComObject { }
public class JarvisAudio {
  static IAudioEndpointVolume Vol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev = null;
    Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out dev));
    IAudioEndpointVolume epv = null;
    var epvid = typeof(IAudioEndpointVolume).GUID;
    Marshal.ThrowExceptionForHR(dev.Activate(ref epvid, 23, 0, out epv));
    return epv;
  }
  public static float Volume {
    get { float v = -1; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(value, System.Guid.Empty)); }
  }
  public static bool Mute {
    get { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
    set { Marshal.ThrowExceptionForHR(Vol().SetMute(value, System.Guid.Empty)); }
  }
}
'@
`;
const psVolume = (op) => PS_AUDIO + {
  up: '[JarvisAudio]::Mute = $false; [JarvisAudio]::Volume = [Math]::Min(1, [JarvisAudio]::Volume + 0.10)',
  down: '[JarvisAudio]::Volume = [Math]::Max(0, [JarvisAudio]::Volume - 0.10)',
  mute: '[JarvisAudio]::Mute = $true',
  unmute: '[JarvisAudio]::Mute = $false',
  max: '[JarvisAudio]::Mute = $false; [JarvisAudio]::Volume = 1',
  set: '[JarvisAudio]::Mute = $false; [JarvisAudio]::Volume = [Math]::Max(0, [Math]::Min(1, [double]$env:JARVIS_ARG / 100))',
}[op];
// virtual media keys via WScript.Shell (volume 173-175, media 176-179)
const psMediaKey = (code) => `(New-Object -ComObject WScript.Shell).SendKeys([char]${code})`;
const psSendKeys = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait($env:JARVIS_ARG)';

function createActions(deps) {
  const d = Object.assign({ platform: process.platform, spawn: require('child_process').spawn }, deps);
  const win = d.platform === 'win32';
  const startIndex = { map: null, building: false };
  const timers = new Map();
  let nextTimerId = 1;

  // ---- launching -----------------------------------------------------------------------------------------------
  function ps(script, arg) {
    if (!win) return false;
    try {
      const c = d.spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', script],
        { windowsHide: true, stdio: 'ignore', env: Object.assign({}, process.env, { JARVIS_ARG: esc(arg) }) });
      c.on('error', () => {}); c.unref && c.unref();
      return true;
    } catch (e) { return false; }
  }
  function startExe(exe) {
    // exe comes from our own table or a charset-checked name, never from free text
    if (!/^[A-Za-z0-9 ._+-]+$/.test(exe)) return false;
    const c = d.spawn('cmd.exe', ['/d', '/s', '/c', 'start "" "' + exe + '"'], { windowsHide: true, stdio: 'ignore', detached: true, windowsVerbatimArguments: true });
    c.on('error', () => {}); c.unref();
    return true;
  }
  function openUrl(u) {
    if (!/^https?:\/\//i.test(u)) return false;
    d.shell.openExternal(u).catch(() => {});
    return true;
  }
  function buildIndex() {
    if (!win || startIndex.building) return;
    startIndex.building = true;
    const roots = [path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')];
    const map = new Map();
    const walk = async (dir, depth) => {
      let ents = [];
      try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
        else if (e.isFile() && /\.lnk$/i.test(e.name)) {
          const n = e.name.replace(/\.lnk$/i, '').toLowerCase();
          if (!/uninstall|readme|help|website|documentation/.test(n) && !map.has(n)) map.set(n, p);
        }
      }
    };
    Promise.all(roots.filter(Boolean).map((r) => walk(r, 0))).then(() => { startIndex.map = map; startIndex.building = false; }).catch(() => { startIndex.building = false; });
  }
  function findShortcut(name) {
    const m = startIndex.map; if (!m) return null;
    if (m.has(name)) return m.get(name);
    let best = null;
    for (const [k, v] of m) if (k.startsWith(name) && (!best || k.length < best[0].length)) best = [k, v];
    if (!best) for (const [k, v] of m) if (k.includes(name) && (!best || k.length < best[0].length)) best = [k, v];
    return best ? best[1] : null;
  }

  function openApp(arg) {
    let n = safeName(arg).replace(/^(the|my)\s+/, '');
    if (!n) return res(false, 'Which app should I open?');
    n = ALIASES[n] || n;
    const a = APPS[n];
    if (a && a.url) return openUrl(a.url) ? res(true, 'Opening ' + n + '.') : res(false, 'I could not open that.');
    if (a && a.uri) { d.shell.openExternal(a.uri).catch(() => {}); return res(true, 'Opening ' + n + '.'); }
    if (a && a.dir) { const p = d.app.getPath(a.dir); d.shell.openPath(p).catch(() => {}); return res(true, 'Opening your ' + n + ' folder.'); }
    if (win) {
      const lnk = findShortcut(n);
      if (lnk) { d.shell.openPath(lnk).catch(() => {}); return res(true, 'Opening ' + n + '.'); }
      if (a && a.exe) return startExe(a.exe) ? res(true, 'Opening ' + n + '.') : res(false, 'I could not open that.');
      if (!startIndex.map) buildIndex();
      return res(false, "I couldn't find an app called " + n + ' on this PC.');
    }
    if (a && a.exe) return res(false, 'Opening apps by name works on Windows.');
    return res(false, "I couldn't find an app called " + n + '.');
  }

  function url(arg) {
    let u = esc(arg).trim();
    if (!u) return res(false, 'Which address?');
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
    return openUrl(u) ? res(true, 'Opening ' + esc(arg).trim() + '.') : res(false, 'I only open web addresses (http or https).');
  }
  const q = encodeURIComponent;
  function search(arg) { arg = esc(arg).trim(); return arg ? (openUrl('https://www.google.com/search?q=' + q(arg)), res(true, 'Searching for ' + arg + '.')) : res(false, 'What should I search for?'); }
  function youtube(arg, mode) {
    arg = esc(arg).trim();
    if (!arg) { openUrl('https://www.youtube.com'); return res(true, 'Opening YouTube.'); }
    openUrl('https://www.youtube.com/results?search_query=' + q(arg));
    return res(true, 'Showing YouTube results for ' + arg + (mode === 'play' ? '. Pick the video you want — I cannot auto-play on the PC.' : '.'));
  }
  function navigate(arg) { arg = esc(arg).trim(); return arg ? (openUrl('https://www.google.com/maps/dir/?api=1&destination=' + q(arg)), res(true, 'Showing directions to ' + arg + '.')) : res(false, 'Where to?'); }
  function map(arg) { arg = esc(arg).trim(); return arg ? (openUrl('https://www.google.com/maps/search/?api=1&query=' + q(arg)), res(true, 'Showing ' + arg + ' on the map.')) : res(false, 'Which place?'); }
  function settings(arg) {
    const w = esc(arg).toLowerCase().replace(/[^a-z]/g, '') || 'main';
    d.shell.openExternal(SETTINGS[w] || SETTINGS.main).catch(() => {});
    return res(true, 'Opening ' + (w === 'main' ? 'settings' : w + ' settings') + '.');
  }

  // ---- sound ---------------------------------------------------------------------------------------------------
  function volume(arg) {
    if (!win) return res(false, 'Volume control works on Windows.');
    const a = esc(arg).toLowerCase().trim();
    const num = /^\d{1,3}$/.test(a) ? Math.min(100, parseInt(a, 10)) : null;
    let op, msg;
    if (num !== null) { op = 'set'; msg = 'Volume set to ' + num + ' percent.'; }
    else if (a === 'up' || a === 'louder') { op = 'up'; msg = 'Volume up.'; }
    else if (a === 'down' || a === 'quieter') { op = 'down'; msg = 'Volume down.'; }
    else if (a === 'mute') { op = 'mute'; msg = 'Muted.'; }
    else if (a === 'unmute') { op = 'unmute'; msg = 'Unmuted.'; }
    else if (a === 'max') { op = 'max'; msg = 'Volume at maximum.'; }
    else return res(false, 'Say volume up, down, mute, or a number.');
    ps(psVolume(op), num !== null ? String(num) : '');
    return res(true, msg);
  }
  function media(arg) {
    if (!win) return res(false, 'Media keys work on Windows.');
    const a = esc(arg).toLowerCase().trim();
    const code = { play: 179, pause: 179, resume: 179, toggle: 179, next: 176, previous: 177, stop: 178 }[a];
    if (!code) return res(false, 'Say play, pause, next or previous.');
    ps(psMediaKey(code));
    return res(true, { play: 'Play / pause.', pause: 'Play / pause.', resume: 'Play / pause.', toggle: 'Play / pause.', next: 'Next track.', previous: 'Previous track.', stop: 'Stopped.' }[a]);
  }

  // ---- keyboard ------------------------------------------------------------------------------------------------
  function key(arg) {
    if (!win) return res(false, 'Keyboard control works on Windows.');
    const a = esc(arg).toLowerCase().trim();
    if (a === 'home') { ps("(New-Object -ComObject Shell.Application).ToggleDesktop()"); return res(true, 'Showing the desktop.'); }
    if (a === 'recents') { ps("(New-Object -ComObject Shell.Application).WindowSwitcher()"); return res(true, 'Showing open windows.'); }
    if (a === 'notifications' || a === 'quicksettings') return res(false, 'The notification panel needs the Windows key, which I cannot press. Use Win+N.');
    const k = KEYS[a];
    if (!k) return res(false, "I don't know the key " + a + '.');
    ps(psSendKeys, k);
    return res(true, 'Pressed ' + a + '.');
  }
  function scroll(arg, arg2) {
    const a = esc(arg).toLowerCase().trim();
    if (a === 'stop') return res(true, 'Okay.');
    if (!win) return res(false, 'Keyboard control works on Windows.');
    if (a === 'top' || a === 'bottom') { ps(psSendKeys, a === 'top' ? '^{HOME}' : '^{END}'); return res(true, 'Scrolled to the ' + a + '.'); }
    if (a !== 'up' && a !== 'down') return res(false, 'Say scroll up or scroll down.');
    const m = esc(arg2).toLowerCase().match(/^(?:(\d{1,2}),?)?(small|big)?$/);
    const n = Math.max(1, Math.min(10, m && m[1] ? parseInt(m[1], 10) : 1));
    const size = m && m[2];
    const unit = size === 'small' ? (a === 'up' ? '{UP}' : '{DOWN}').repeat(4) : (a === 'up' ? '{PGUP}' : '{PGDN}').repeat(size === 'big' ? 2 : 1);
    ps(psSendKeys, unit.repeat(n));
    return res(true, 'Scrolled ' + a + '.');
  }
  function typeText(text, app) {
    if (!win) return res(false, 'Typing into apps works on Windows.');
    text = esc(text);
    if (!text) return res(false, 'There is nothing to type.');
    if (text.length > 20000) return res(false, 'That is too long to type in one go.');
    let delay = 150;
    if (esc(app).trim()) { const r = openApp(app); if (!r.ok) return r; delay = 2200; }
    const old = d.clipboard.readText();
    setTimeout(() => {
      d.clipboard.writeText(text);
      ps(psSendKeys, '^v');
      setTimeout(() => { try { d.clipboard.writeText(old); } catch (e) { /* ignore */ } }, 1500);
    }, delay);
    return res(true, esc(app).trim() ? 'Typing it into ' + esc(app).trim() + '.' : 'Typing.');
  }

  // ---- power ---------------------------------------------------------------------------------------------------
  function power(kind) {
    if (!win) return res(false, 'Power commands work on Windows.');
    if (kind === 'lock') { d.spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); return res(true, 'Locking the PC.'); }
    if (kind === 'sleep') { d.spawn('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); return res(true, 'Putting the PC to sleep.'); }
    if (kind === 'shutdown' || kind === 'restart') {
      d.spawn('shutdown.exe', [kind === 'shutdown' ? '/s' : '/r', '/t', '20', '/c', 'Jarvis: ' + (kind === 'shutdown' ? 'shutting down' : 'restarting') + ' in 20 seconds. Say "cancel shutdown" to stop.'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
      return res(true, (kind === 'shutdown' ? 'Shutting down' : 'Restarting') + ' in 20 seconds. Say "cancel shutdown" to stop it.');
    }
    if (kind === 'cancel') { d.spawn('shutdown.exe', ['/a'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {}); return res(true, 'Shutdown cancelled.'); }
    return res(false, 'Unknown power command.');
  }
  function closeApp(arg) {
    if (!win) return res(false, 'Closing apps works on Windows.');
    let n = safeName(arg).replace(/^(the|my)\s+/, ''); n = ALIASES[n] || n;
    if (!n) return res(false, 'Which app should I close?');
    const image = PROCS[n] || n.replace(/\s+/g, '');
    if (/^(system|csrss|winlogon|lsass|services|svchost|wininit|smss|dwm|explorer)$/i.test(image)) return res(false, "I won't close a system process.");
    d.spawn('taskkill.exe', ['/IM', image + '.exe'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
    return res(true, 'Asking ' + n + ' to close.');
  }

  // ---- screenshots, timers, battery ------------------------------------------------------------------------------
  function screenshot() {
    if (!d.screenshot) return res(false, 'Screenshots are not available here.');
    const dir = path.join(d.app.getPath('pictures'), 'Jarvis');
    d.screenshot(dir).then((file) => d.notify('Screenshot saved', file), (e) => d.notify('Screenshot failed', String(e && e.message || e)));
    return res(true, 'Taking a screenshot — it will be saved in Pictures \\ Jarvis.');
  }
  function fire(label) {
    d.notify('Jarvis', label || 'Time is up.');
    if (d.beep) { d.beep(); setTimeout(d.beep, 700); setTimeout(d.beep, 1400); }
    if (d.onFire) d.onFire(label);
  }
  function timer(arg) {
    const p = esc(arg).split('|'); const secs = parseFloat(p[0]);
    if (!(secs > 0)) return res(false, 'How long?');
    if (secs > 86400 * 7) return res(false, 'That timer is too long.');
    const label = (p[1] || '').slice(0, 60) || 'Timer finished.';
    const id = nextTimerId++;
    timers.set(id, setTimeout(() => { timers.delete(id); fire(label); }, secs * 1000));
    return res(true, 'Timer set for ' + (secs >= 120 ? Math.round(secs / 60) + ' minutes' : Math.round(secs) + ' seconds') + '.');
  }
  function alarm(arg) {
    const p = esc(arg).split('|'); const tm = (p[0] || '').split(':');
    const hh = parseInt(tm[0], 10), mm = parseInt(tm[1] || '0', 10);
    if (isNaN(hh) || isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return res(false, 'I need a time like 07:30.');
    const days = (p[2] || '').split(',').map(Number).filter((x) => x >= 1 && x <= 7);
    const label = (p[1] || '').slice(0, 60) || 'Alarm';
    const schedule = () => {
      const now = new Date(); let t = new Date(now); t.setHours(hh, mm, 0, 0);
      for (let i = 0; i < 8; i++) { if (t.getTime() > now.getTime() && (!days.length || days.includes(t.getDay() + 1))) break; t.setDate(t.getDate() + 1); t.setHours(hh, mm, 0, 0); }
      const id = nextTimerId++;
      timers.set(id, setTimeout(() => { timers.delete(id); fire(label); if (days.length) schedule(); }, Math.min(t.getTime() - now.getTime(), 2147000000)));
    };
    schedule();
    return res(true, 'Alarm set for ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + (label !== 'Alarm' ? ' — ' + label : '') + '. It rings while Jarvis is running.');
  }
  function battery() {
    const b = d.getBattery && d.getBattery();
    if (!b) return res(true, 'This PC reports no battery, so it is probably a desktop on mains power.');
    return res(true, 'Battery is at ' + b.pct + ' percent' + (b.charging ? ' and charging.' : '.'));
  }

  const phoneOnly = (what) => res(false, "That's a phone action (" + what + "). Say “on my phone …” and I'll send it to your phone.");

  function run(type, arg, arg2) {
    try {
      switch (esc(type)) {
        case 'open': return openApp(arg);
        case 'url': return url(arg);
        case 'search': return search(arg);
        case 'youtube': return youtube(arg, arg2);
        case 'navigate': return navigate(arg);
        case 'map': return map(arg);
        case 'settings': return settings(arg);
        case 'volume': return volume(arg);
        case 'media': return media(arg);
        case 'key': return key(arg);
        case 'scroll': return scroll(arg, arg2);
        case 'type': return typeText(arg, arg2);
        case 'timer': return timer(arg);
        case 'alarm': return alarm(arg);
        case 'battery': return battery();
        case 'lock': return power('lock');
        case 'sleep': return power('sleep');
        case 'shutdown': return power('shutdown');
        case 'restart': return power('restart');
        case 'cancelshutdown': return power('cancel');
        case 'close': return closeApp(arg);
        case 'screenshot': return screenshot();
        case 'call': case 'callanswer': case 'callreject': case 'sms': case 'torch': case 'tap': case 'swipe': case 'align': case 'playnth':
          return phoneOnly(type);
        default: return res(false, "I don't know how to do “" + esc(type).slice(0, 30) + "” on the PC.");
      }
    } catch (e) {
      return res(false, 'That failed: ' + (e && e.message ? e.message : e));
    }
  }

  function dispose() { for (const t of timers.values()) clearTimeout(t); timers.clear(); }
  if (win) buildIndex();
  return { run, dispose, _internal: { APPS, safeName, findShortcut, buildIndex } };
}

// What a remote device may ask for, grouped by risk. The user switches each group on or off in Settings → Device Link.
const TIER = {
  open: 'ctl', url: 'ctl', search: 'ctl', youtube: 'ctl', navigate: 'ctl', map: 'ctl', settings: 'ctl', volume: 'ctl', media: 'ctl', battery: 'ctl',
  timer: 'ctl', alarm: 'ctl', lock: 'ctl', screenshot: 'ctl', cancelshutdown: 'ctl', scroll: 'ctl',
  type: 'input', key: 'input', close: 'input',
  shutdown: 'danger', restart: 'danger', sleep: 'danger',
};

module.exports = { createActions, TIER, APPS };
