'use strict';
/**
 * Jarvis PC — extra remote/local actions (v1.20.0).
 *
 * Drop this file next to the other main-process files (e.g. pc/src/main/pc-extra-actions.js) and call it
 * from the place where the PC handles an action `type` (both for commands typed/spoken on the PC and for
 * commands that arrive from the phone over the encrypted link). See PC-INTEGRATION.md.
 *
 *   const extra = require('./pc-extra-actions')({ clipboard, shell });   // clipboard/shell from 'electron' (optional)
 *   if (extra.handles(type)) return extra.run(type, arg, arg2);          // -> Promise<{ ok, msg }>
 *
 * Link permission tier of each action (use extra.TIER[type] in the same place the other tiers are checked):
 *   ctl    – "Allow remote control"
 *   input  – "Allow typing and key presses"
 *   danger – "Allow power commands"
 *
 * Safety rules (same as the rest of the PC app): user text never goes into a command line — it is passed
 * through an environment variable; only values from the fixed tables below are ever put into a script;
 * every action has a timeout; unknown arguments are refused.
 */
const os = require('os');
const cp = require('child_process');

const TIER = {
  pcinfo: 'ctl', brightness: 'ctl', darkmode: 'ctl', settingspage: 'ctl',
  clipset: 'input', clipget: 'input', pckey: 'input',
  logoff: 'danger', emptybin: 'danger'
};

// Windows "Settings" pages that may be opened (fixed list)
const SETTINGS = {
  wifi: 'ms-settings:network-wifi', network: 'ms-settings:network', bluetooth: 'ms-settings:bluetooth',
  display: 'ms-settings:display', sound: 'ms-settings:sound', update: 'ms-settings:windowsupdate',
  apps: 'ms-settings:appsfeatures', battery: 'ms-settings:batterysaver', power: 'ms-settings:powersleep',
  storage: 'ms-settings:storagesense', privacy: 'ms-settings:privacy', personalization: 'ms-settings:personalization',
  notifications: 'ms-settings:notifications', 'default apps': 'ms-settings:defaultapps', 'startup apps': 'ms-settings:startupapps',
  about: 'ms-settings:about', 'night light': 'ms-settings:nightlight', keyboard: 'ms-settings:keyboard', mouse: 'ms-settings:mousetouchpad',
  printer: 'ms-settings:printers', printers: 'ms-settings:printers', time: 'ms-settings:dateandtime', language: 'ms-settings:regionlanguage'
};

// Key combinations as Windows virtual-key codes (pressed in order, released in reverse)
const VK = { ALT: 0x12, CTRL: 0x11, SHIFT: 0x10, WIN: 0x5B, TAB: 0x09, F4: 0x73, F5: 0x74, F11: 0x7A,
  UP: 0x26, DOWN: 0x28, LEFT: 0x25, RIGHT: 0x27, T: 0x54, W: 0x57, PGUP: 0x21, PGDN: 0x22 };
const KEYS = {
  switchwindow: [VK.ALT, VK.TAB], closewindow: [VK.ALT, VK.F4], maxwindow: [VK.WIN, VK.UP], minwindow: [VK.WIN, VK.DOWN],
  snapleft: [VK.WIN, VK.LEFT], snapright: [VK.WIN, VK.RIGHT], taskview: [VK.WIN, VK.TAB],
  newtab: [VK.CTRL, VK.T], closetab: [VK.CTRL, VK.W], nexttab: [VK.CTRL, VK.TAB], prevtab: [VK.CTRL, VK.SHIFT, VK.TAB],
  refresh: [VK.F5], fullscreen: [VK.F11], scrollup: [VK.PGUP], scrolldown: [VK.PGDN]
};
const KEY_SAY = { switchwindow: 'Switched window.', closewindow: 'Closed the window.', maxwindow: 'Maximised the window.', minwindow: 'Minimised the window.',
  snapleft: 'Snapped left.', snapright: 'Snapped right.', taskview: 'Showing all windows.', newtab: 'New tab.', closetab: 'Closed the tab.',
  nexttab: 'Next tab.', prevtab: 'Previous tab.', refresh: 'Refreshed.', fullscreen: 'Toggled full screen.', scrollup: 'Scrolled up.', scrolldown: 'Scrolled down.' };

const PS = 'powershell.exe';
const PS_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];

function make(deps) {
  deps = deps || {};
  const exec = deps.exec || cp.execFile;                 // injectable for tests
  const platform = deps.platform || process.platform;

  function ps(script, env, timeout) {
    return new Promise((resolve) => {
      if (platform !== 'win32') { resolve({ ok: false, out: '', err: WINMSG }); return; }
      try {
        exec(PS, PS_ARGS.concat([script]), { env: Object.assign({}, process.env, env || {}), windowsHide: true, timeout: timeout || 10000, maxBuffer: 1 << 20 },
          (e, stdout, stderr) => resolve({ ok: !e, out: String(stdout || '').trim(), err: String((stderr || (e && e.message)) || '').trim() }));
      } catch (e) { resolve({ ok: false, out: '', err: String(e && e.message || e) }); }
    });
  }
  const WINMSG = 'This command only works on Windows.';
  const R = (ok, msg) => ({ ok: !!ok, msg: msg });
  const fail = (r, fallback) => R(false, r && r.err === WINMSG ? WINMSG : fallback);
  const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const gb = (b) => (b / 1073741824).toFixed(1);

  async function cpuPct() {
    const snap = () => os.cpus().reduce((a, c) => { const t = c.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq; return a; }, { idle: 0, total: 0 });
    const a = snap(); await new Promise((r) => setTimeout(r, 500)); const b = snap();
    const dt = b.total - a.total; return dt > 0 ? Math.round((1 - (b.idle - a.idle) / dt) * 100) : 0;
  }
  function memLine() { const t = os.totalmem(), f = os.freemem(); return Math.round((1 - f / t) * 100) + '% of memory used (' + gb(t - f) + ' of ' + gb(t) + ' GB)'; }
  function upLine() {
    const s = Math.floor(os.uptime()), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return (d ? d + (d === 1 ? ' day ' : ' days ') : '') + (h ? h + ' h ' : '') + m + ' min';
  }
  function ipLine() {
    const out = []; const ifs = os.networkInterfaces();
    Object.keys(ifs).forEach((n) => (ifs[n] || []).forEach((a) => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); }));
    return out.length ? out.slice(0, 2).join(' and ') : 'no network address';
  }
  async function diskLine() {
    const r = await ps("Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null } | ForEach-Object { '{0}: {1} GB free of {2} GB' -f $_.Name, [math]::Round($_.Free/1GB), [math]::Round(($_.Used+$_.Free)/1GB) }");
    return r.ok && r.out ? r.out.split(/\r?\n/).slice(0, 3).join('; ') : '';
  }
  async function batteryLine() {
    const r = await ps("$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if ($b) { '{0}% {1}' -f $b.EstimatedChargeRemaining, $(if ($b.BatteryStatus -eq 2) {'(charging)'} else {'(on battery)'}) }");
    return r.ok && r.out ? r.out : 'no battery (this is a desktop PC)';
  }
  async function appsLine() {
    const r = await ps("Get-Process | Where-Object { $_.MainWindowTitle } | Sort-Object WorkingSet64 -Descending | Select-Object -ExpandProperty ProcessName -Unique | Select-Object -First 8");
    return r.ok && r.out ? r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join(', ') : '';
  }

  const H = {
    async pcinfo(arg) {
      switch (String(arg || 'status').toLowerCase()) {
        case 'cpu': return R(true, 'The processor is at ' + (await cpuPct()) + '%.');
        case 'memory': case 'ram': return R(true, memLine() + '.');
        case 'uptime': return R(true, 'Your PC has been on for ' + upLine() + '.');
        case 'ip': return R(true, 'The PC address is ' + ipLine() + '.');
        case 'battery': return R(true, 'PC battery: ' + (await batteryLine()) + '.');
        case 'disk': { const d = await diskLine(); return d ? R(true, d + '.') : R(false, 'I could not read the disk space.'); }
        case 'apps': { const a = await appsLine(); return a ? R(true, 'Open apps: ' + a + '.') : R(false, 'I could not list the open apps.'); }
        case 'status': {
          const cpu = await cpuPct(), bat = await batteryLine();
          return R(true, 'Processor ' + cpu + '%, ' + memLine() + ', battery ' + bat + ', on for ' + upLine() + '.');
        }
        default: return R(false, 'I do not know that PC report.');
      }
    },
    async brightness(arg) {
      const a = String(arg || '').toLowerCase();
      let script, env = {};
      if (a === 'up' || a === 'down') { script = "$c = (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness).CurrentBrightness; $n = [math]::Max(0,[math]::Min(100,$c + ($env:JARVIS_DELTA -as [int]))); (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods).WmiSetBrightness(1,$n) | Out-Null; $n"; env.JARVIS_DELTA = a === 'up' ? '15' : '-15'; }
      else if (/^\d{1,3}$/.test(a) && +a <= 100) { script = "$n = $env:JARVIS_LEVEL -as [int]; (Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods).WmiSetBrightness(1,$n) | Out-Null; $n"; env.JARVIS_LEVEL = a; }
      else return R(false, 'Say a brightness from 0 to 100, or up or down.');
      const r = await ps(script, env);
      return r.ok && r.out ? R(true, 'Brightness is now ' + r.out.split(/\r?\n/).pop() + '%.') : fail(r, 'This screen does not support brightness control (it works on laptop screens).');
    },
    async darkmode(arg) {
      const a = String(arg || 'toggle').toLowerCase();
      if (!/^(on|off|toggle)$/.test(a)) return R(false, 'Say on, off or toggle.');
      const script = "$k = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'; $m = $env:JARVIS_MODE; $cur = (Get-ItemProperty -Path $k -Name AppsUseLightTheme).AppsUseLightTheme; " +
        "if ($m -eq 'on') { $v = 0 } elseif ($m -eq 'off') { $v = 1 } else { $v = 1 - $cur }; " +
        "Set-ItemProperty -Path $k -Name AppsUseLightTheme -Value $v; Set-ItemProperty -Path $k -Name SystemUsesLightTheme -Value $v; if ($v -eq 0) { 'dark' } else { 'light' }";
      const r = await ps(script, { JARVIS_MODE: a });
      return r.ok ? R(true, 'Switched Windows to ' + (r.out.indexOf('dark') >= 0 ? 'dark' : 'light') + ' mode.') : fail(r, 'I could not change the theme.');
    },
    async settingspage(arg) {
      const uri = SETTINGS[String(arg || '').toLowerCase()];
      if (!uri) return R(false, 'I do not know that settings page.');
      try {
        if (deps.shell && deps.shell.openExternal) { await deps.shell.openExternal(uri); return R(true, 'Opened ' + arg + ' settings.'); }
      } catch (e) { /* fall back below */ }
      const r = await ps('Start-Process $env:JARVIS_URI', { JARVIS_URI: uri });
      return r.ok ? R(true, 'Opened ' + arg + ' settings.') : fail(r, 'I could not open that settings page.');
    },
    async clipset(arg) {
      const text = String(arg == null ? '' : arg).slice(0, 5000);
      if (!text) return R(false, 'There is nothing to copy.');
      try { if (deps.clipboard && deps.clipboard.writeText) { deps.clipboard.writeText(text); return R(true, 'Copied to the PC clipboard.'); } } catch (e) { /* fall back */ }
      const r = await ps('Set-Clipboard -Value $env:JARVIS_TEXT', { JARVIS_TEXT: text });
      return r.ok ? R(true, 'Copied to the PC clipboard.') : fail(r, 'I could not use the clipboard.');
    },
    async clipget() {
      let t = '';
      try { if (deps.clipboard && deps.clipboard.readText) t = deps.clipboard.readText(); else { const r = await ps('Get-Clipboard -Raw'); t = r.out; } } catch (e) { /* ignore */ }
      t = String(t || '').trim();
      return t ? R(true, 'The PC clipboard says: ' + clip(t.replace(/\s+/g, ' '), 240)) : R(true, 'The PC clipboard is empty.');
    },
    async pckey(arg) {
      const name = String(arg || '').toLowerCase(), codes = KEYS[name];
      if (!codes) return R(false, 'I do not know that key command.');
      const script = "Add-Type -Name K -Namespace J -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void keybd_event(byte b, byte s, uint f, UIntPtr e);'; " +
        "$c = $env:JARVIS_KEYS.Split(',') | ForEach-Object { [byte]([int]$_) }; foreach ($k in $c) { [J.K]::keybd_event($k,0,0,[UIntPtr]::Zero) }; [array]::Reverse($c); foreach ($k in $c) { [J.K]::keybd_event($k,0,2,[UIntPtr]::Zero) }";
      const r = await ps(script, { JARVIS_KEYS: codes.join(',') });
      return r.ok ? R(true, KEY_SAY[name]) : fail(r, 'The key press failed.');
    },
    async logoff() {
      return new Promise((resolve) => {
        if (platform !== 'win32') { resolve(R(false, 'This command only works on Windows.')); return; }
        try { exec('shutdown.exe', ['/l'], { windowsHide: true, timeout: 8000 }, (e) => resolve(e ? R(false, 'Sign out failed.') : R(true, 'Signing out.'))); } catch (e) { resolve(R(false, 'Sign out failed.')); }
      });
    },
    async emptybin() {
      const r = await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; "ok"');
      return r.ok ? R(true, 'Recycle bin emptied.') : fail(r, 'I could not empty the recycle bin.');
    }
  };

  return {
    TIER, SETTINGS, KEYS,
    handles(type) { return Object.prototype.hasOwnProperty.call(H, type); },
    tier(type) { return TIER[type] || null; },
    async run(type, arg, arg2) {
      if (!this.handles(type)) return R(false, 'Unknown PC action.');
      try { return await H[type](arg, arg2); } catch (e) { return R(false, 'That did not work.'); }
    }
  };
}

module.exports = make;
