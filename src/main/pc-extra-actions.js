'use strict';
/**
 * Jarvis PC — extra remote/local actions (v1.22.0: whole-PC library — every drive: movies, music, photos, documents; YouTube autoplay; player on/off).
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
const fs = require('fs');
const path = require('path');
const https = require('https');
const cp = require('child_process');

const TIER = {
  pcinfo: 'ctl', brightness: 'ctl', darkmode: 'ctl', settingspage: 'ctl',
  clipset: 'input', clipget: 'input', pckey: 'input',
  logoff: 'danger', emptybin: 'danger',
  // local library + YouTube (v1.21.0)
  playfile: 'ctl', playany: 'ctl', playrandom: 'ctl', ytplay: 'ctl', medialist: 'ctl', openfolder: 'ctl',
  stopmedia: 'input'
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


// ---- local media library ------------------------------------------------------------------------------------
const EXT = {
  music: ['.mp3', '.m4a', '.flac', '.wav', '.aac', '.ogg', '.opus', '.wma'],
  video: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.flv', '.mpg', '.mpeg'],
  photo: ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.tif', '.tiff'],
  // documents: only passive file types — never programs or scripts (.exe .bat .cmd .ps1 .vbs .js .msi .lnk ... are never indexed)
  doc: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.ods', '.odp', '.csv', '.epub']
};
const SKIP_DIRS = /^(?:node_modules|\$recycle\.bin|system volume information|appdata|\.git|windows|windows\.old|program files|program files \(x86\)|programdata|recovery|config\.msi|onedrivetemp|\.cache|cache|temp|tmp|\$windows\.~bt|\$winreagent|msocache|perflogs|steamapps|\.gradle|\.m2|\.npm|site-packages)$/i;
const MOVIE_MIN_BYTES = 150 * 1024 * 1024;        // "a movie" means a big video file, not a short clip
const ROOT_GUESSES = ['Movies', 'Films', 'Videos', 'Music', 'Songs', 'Series', 'Shows', 'Downloads', 'Entertainment', 'Media'];
// Real media players that "stop the movie / music" may close (fixed list)
const PLAYERS = ['vlc', 'wmplayer', 'mpv', 'PotPlayerMini64', 'PotPlayerMini', 'PotPlayer64', 'PotPlayer', 'Video.UI', 'Music.UI', 'Microsoft.Media.Player', 'MediaPlayer', 'GOM', 'GomPlayer', 'MPC-HC64', 'mpc-hc', 'mpc-hc64', 'AIMP', 'foobar2000', 'Groove'];
const FOLDERS = { downloads: 'downloads', documents: 'documents', desktop: 'desktop', pictures: 'pictures', photos: 'pictures', music: 'music', videos: 'videos', movies: 'videos' };

function norm(x) { return String(x || '').toLowerCase().replace(/[\u2018\u2019']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9\u0980-\u09ff\u0900-\u097f]+/g, ' ').replace(/\s+/g, ' ').trim(); }
const NOISE = /\b(?:1080p|720p|480p|2160p|4k|x264|x265|h264|h265|hevc|bluray|brrip|webrip|web dl|webdl|hdrip|dvdrip|aac|ac3|yify|yts|rarbg|official|video|audio|lyrics|lyric|hd|mp3)\b/g;
function nameKey(file) { return norm(path.basename(file, path.extname(file))).replace(NOISE, ' ').replace(/\s+/g, ' ').trim(); }
function kindOf(file) { const e = path.extname(file).toLowerCase(); return EXT.music.indexOf(e) >= 0 ? 'music' : EXT.video.indexOf(e) >= 0 ? 'video' : EXT.photo.indexOf(e) >= 0 ? 'photo' : EXT.doc.indexOf(e) >= 0 ? 'doc' : null; }

/** Scores how well a file name matches the spoken words. 0 = no match. */
function score(query, key) {
  const q = norm(query).replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (!q || !key) return 0;
  if (q === key) return 100;
  const qt = q.split(' '), kt = key.split(' '), qc = q.replace(/ /g, ''), kc = key.replace(/ /g, '');
  let hit = 0;
  for (const t of qt) { if (kt.some((k) => k === t || (t.length >= 3 && (k.startsWith(t) || t.startsWith(k) && k.length >= 3)))) hit++; else if (t.length >= 4 && kc.indexOf(t) >= 0) hit++; }
  let sc = (hit / qt.length) * 60;
  if (kc.indexOf(qc) >= 0) sc += 30;                 // whole phrase inside the name ("spider man" ~ "spiderman")
  if (key.startsWith(q)) sc += 8;
  sc -= Math.min(10, Math.max(0, kt.length - qt.length) * 0.8);   // prefer the tighter name
  return hit === qt.length || kc.indexOf(qc) >= 0 ? sc : sc * 0.5;
}

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


  // ---------------------------------------------------------------- media index (built in the background, cached 5 minutes)
  let index = null, indexAt = 0, indexing = null;
  // Every fixed drive (C: .. Z:) is searched. Your own folders go first so the most useful results appear early.
  function defaultRoots() {
    const roots = [];
    const g = deps.getPath || ((n) => { const h = os.homedir(); return { downloads: path.join(h, 'Downloads'), documents: path.join(h, 'Documents'), desktop: path.join(h, 'Desktop'), pictures: path.join(h, 'Pictures'), music: path.join(h, 'Music'), videos: path.join(h, 'Videos') }[n]; });
    ['videos', 'music', 'pictures', 'downloads', 'documents', 'desktop'].forEach((n) => { try { const d = g(n); if (d) roots.push(d); } catch (e) { /* ignore */ } });
    (deps.mediaRoots || []).forEach((r) => roots.push(r));
    if (platform === 'win32') for (let c = 67; c <= 90; c++) roots.push(String.fromCharCode(c) + ':\\');   // C:\ .. Z:\
    else roots.push(os.homedir());
    return roots;
  }
  const MAX_FILES = 400000, MAX_DEPTH = 14;
  async function buildIndex() {
    const out = [], seen = new Set(); let n = 0, tick = 0;
    const queue = defaultRoots().filter((r) => { try { return fs.statSync(r).isDirectory(); } catch (e) { return false; } }).map((r) => [r, 0]);
    while (queue.length && n < MAX_FILES) {
      const [dir, depth] = queue.shift();
      const key = dir.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      let items; try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const it of items) {
        const full = path.join(dir, it.name);
        if (it.isDirectory()) { if (depth < MAX_DEPTH && !SKIP_DIRS.test(it.name) && !it.name.startsWith('.') && !it.isSymbolicLink()) queue.push([full, depth + 1]); }
        else if (it.isFile()) {
          const k = kindOf(it.name); if (!k) continue;
          let size = 0, mtime = 0; try { const st = await fs.promises.stat(full); size = st.size; mtime = st.mtimeMs; } catch (e) { /* ignore */ }
          if (k === 'photo' && size > 0 && size < 20 * 1024) continue;      // skip tiny icons and thumbnails
          out.push({ p: full, key: nameKey(it.name), kind: k, size, mtime }); n++;
        }
      }
      if (++tick % 40 === 0) await new Promise((r) => setImmediate(r));       // let the app breathe while indexing a big disk
    }
    return out;
  }
  async function getIndex(force) {
    if (!force && index && Date.now() - indexAt < 600000) return index;
    if (!indexing) indexing = buildIndex().then((r) => { index = r; indexAt = Date.now(); indexing = null; return r; }, (e) => { indexing = null; throw e; });
    return indexing;
  }
  function pool(idx, kind) {
    if (kind === 'music') return idx.filter((f) => f.kind === 'music');
    if (kind === 'movie') return idx.filter((f) => f.kind === 'video' && f.size >= MOVIE_MIN_BYTES);
    if (kind === 'video') return idx.filter((f) => f.kind === 'video');
    if (kind === 'photo') return idx.filter((f) => f.kind === 'photo');
    if (kind === 'doc') return idx.filter((f) => f.kind === 'doc');
    return idx;
  }
  function rank(idx, query, kind) {
    return pool(idx, kind).map((f) => ({ f, s: score(query, f.key) })).filter((x) => x.s >= 45).sort((a, b) => b.s - a.s || b.f.mtime - a.f.mtime);
  }
  const KINDS = /^(music|video|movie|photo|doc)$/;
  const NOUN = { music: 'song', movie: 'movie', video: 'video', photo: 'photo', doc: 'document', '': 'file' };
  const PLURAL = { music: 'songs', movie: 'movies', video: 'videos', photo: 'photos', doc: 'documents', '': 'files' };
  const LATEST = /^(?:\*latest|latest|newest|recent|last|most recent)$/i;
  const pretty = (f) => clip(path.basename(f.p, path.extname(f.p)).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim(), 70);
  async function openFile(f) {
    try { if (deps.shell && deps.shell.openPath) { const e = await deps.shell.openPath(f.p); return !e; } } catch (e) { /* fall back */ }
    const r = await ps('Start-Process -LiteralPath $env:JARVIS_FILE', { JARVIS_FILE: f.p }); return r.ok;
  }

  // ---------------------------------------------------------------- YouTube: find the first real video and open it
  function fetchText(url) {
    if (deps.fetchText) return deps.fetchText(url);
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' }, timeout: 8000 }, (res) => {
        let b = '', n = 0; res.setEncoding('utf8');
        res.on('data', (c) => { n += c.length; if (n < 2500000) b += c; else req.destroy(); });
        res.on('end', () => resolve(b)); res.on('error', reject);
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); }); req.on('error', reject);
    });
  }
  async function openUrl(u) {
    try { if (deps.shell && deps.shell.openExternal) { await deps.shell.openExternal(u); return true; } } catch (e) { /* fall back */ }
    const r = await ps('Start-Process $env:JARVIS_URI', { JARVIS_URI: u }); return r.ok;
  }
  async function youtubePlay(query) {
    const q = String(query || '').trim().slice(0, 120);
    if (!q) return R(false, 'Tell me what to play on YouTube.');
    const search = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(q);
    try {
      const html = await fetchText(search);
      const m = /"videoRenderer":\{"videoId":"([\w-]{11})"/.exec(html);
      if (m) {
        const win = html.slice(m.index, m.index + 4000), t = /"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/.exec(win);
        let title = ''; try { title = t ? JSON.parse('"' + t[1] + '"') : ''; } catch (e) { title = t ? t[1] : ''; }
        if (await openUrl('https://www.youtube.com/watch?v=' + m[1] + '&autoplay=1')) return R(true, title ? 'Playing ' + clip(title, 80) + ' on YouTube.' : 'Playing it on YouTube.');
      }
    } catch (e) { /* fall through to the search page */ }
    return (await openUrl(search)) ? R(true, 'I opened the YouTube results for ' + q + '; pick one to play.') : R(false, 'I could not open YouTube.');
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
    async playfile(arg, arg2) {
      const kind = KINDS.test(String(arg2 || '')) ? String(arg2) : '';
      const name = String(arg || '').trim().slice(0, 120);
      if (!name) return R(false, 'Tell me the name of the ' + NOUN[kind] + '.');
      const verb = kind === 'photo' || kind === 'doc' || kind === '' ? 'Opening' : 'Playing';
      let idx = await getIndex(false), best = null;
      if (LATEST.test(name)) {                                        // "my latest photo", "the newest movie"
        const l = pool(idx, kind).slice().sort((a, b) => b.mtime - a.mtime); best = l[0] || null;
      } else {
        let hits = rank(idx, name, kind);
        if (!hits.length && kind === 'movie') hits = rank(idx, name, 'video');
        if (!hits.length) { idx = await getIndex(true); hits = rank(idx, name, kind === 'movie' ? 'video' : kind); }   // maybe a brand-new file
        best = hits.length ? hits[0].f : null;
      }
      if (!best) return R(false, 'I could not find ' + (LATEST.test(name) ? 'any ' + PLURAL[kind] : 'a ' + NOUN[kind] + ' called ' + clip(name, 50)) + ' on this PC.');
      return (await openFile(best)) ? R(true, verb + ' ' + pretty(best) + '.') : R(false, 'I found ' + pretty(best) + ' but could not open it.');
    },
    async playrandom(arg) {
      const kind = /^(movie|video)/.test(String(arg || '')) ? 'movie' : 'music';
      const list = pool(await getIndex(false), kind);
      if (!list.length) return R(false, 'I could not find any ' + (kind === 'movie' ? 'movies' : 'music') + ' on this PC.');
      const f = list[Math.floor((deps.random || Math.random)() * list.length)];
      return (await openFile(f)) ? R(true, 'Playing ' + pretty(f) + '.') : R(false, 'I could not open that file.');
    },
    async playany(arg) {
      const name = String(arg || '').trim().slice(0, 120);
      if (!name) return R(false, 'Tell me what to play.');
      const hits = rank(await getIndex(false), name, '').filter((x) => x.s >= 60 && (x.f.kind === 'music' || x.f.kind === 'video'));
      if (hits.length && (await openFile(hits[0].f))) return R(true, 'Playing ' + pretty(hits[0].f) + ' from this PC.');
      return youtubePlay(name);
    },
    async ytplay(arg) { return youtubePlay(arg); },
    async medialist(arg, arg2) {
      const kind = KINDS.test(String(arg2 || '')) ? String(arg2) : '';
      const idx = await getIndex(false), q = String(arg || '').trim();
      const list = q && !LATEST.test(q) ? rank(idx, q, kind).map((x) => x.f) : pool(idx, kind).slice().sort((a, b) => b.mtime - a.mtime);
      const noun = PLURAL[kind];
      if (!list.length) return R(true, 'I did not find any ' + noun + (q && !LATEST.test(q) ? ' matching ' + clip(q, 40) : '') + ' on this PC.');
      const m = q && !LATEST.test(q);
      return R(true, 'I found ' + list.length + ' ' + noun + (m ? ' matching ' + clip(q, 40) : '') + '. ' + (m ? 'Best matches' : 'Newest') + ': ' + list.slice(0, 4).map(pretty).join('; ') + '.');
    },
    async openfolder(arg) {
      const key = String(arg || '').toLowerCase();
      const dm = /^drive:([a-z])$/.exec(key);
      if (dm) {                                                          // "open D drive"
        const root = dm[1].toUpperCase() + ':\\';
        try { if (!fs.statSync(root).isDirectory()) throw new Error('x'); } catch (e) { return R(false, 'I cannot find drive ' + dm[1].toUpperCase() + ' on this PC.'); }
        try { if (deps.shell && deps.shell.openPath) { const e = await deps.shell.openPath(root); return e ? R(false, 'I could not open drive ' + dm[1].toUpperCase() + '.') : R(true, 'Opened drive ' + dm[1].toUpperCase() + '.'); } } catch (e) { /* fall back */ }
        const r = await ps('Start-Process -LiteralPath $env:JARVIS_DIR', { JARVIS_DIR: root });
        return r.ok ? R(true, 'Opened drive ' + dm[1].toUpperCase() + '.') : fail(r, 'I could not open that drive.');
      }
      if (key === 'recycle bin') { const r = await ps('Start-Process explorer.exe -ArgumentList "shell:RecycleBinFolder"'); return r.ok ? R(true, 'Opened the recycle bin.') : fail(r, 'I could not open the recycle bin.'); }
      const name = FOLDERS[key]; if (!name) return R(false, 'I do not know that folder.');
      const g = deps.getPath || ((n) => path.join(os.homedir(), n.charAt(0).toUpperCase() + n.slice(1)));
      let dir = ''; try { dir = g(name); } catch (e) { /* ignore */ }
      if (!dir) return R(false, 'I could not find that folder.');
      try { if (deps.shell && deps.shell.openPath) { const e = await deps.shell.openPath(dir); return e ? R(false, 'I could not open that folder.') : R(true, 'Opened the ' + key + ' folder.'); } } catch (e) { /* fall back */ }
      const r = await ps('Start-Process -LiteralPath $env:JARVIS_DIR', { JARVIS_DIR: dir });
      return r.ok ? R(true, 'Opened the ' + key + ' folder.') : fail(r, 'I could not open that folder.');
    },
    async stopmedia() {
      const r = await ps("$p = Get-Process -Name ($env:JARVIS_PLAYERS -split ',') -ErrorAction SilentlyContinue; if ($p) { $p | Stop-Process -Force; $p.Count } else { 0 }", { JARVIS_PLAYERS: PLAYERS.join(',') });
      if (!r.ok) return fail(r, 'I could not close the player.');
      return /^[1-9]/.test(r.out.split(/\r?\n/).pop()) ? R(true, 'Closed the media player.') : R(true, 'No media player is open. If it is playing in a browser, say pause.');
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
    TIER, SETTINGS, KEYS, score, nameKey,
    refreshMediaIndex() { return getIndex(true).then((i) => i.length); },   // optional: call once at app start so the first command is instant
    handles(type) { return Object.prototype.hasOwnProperty.call(H, type); },
    tier(type) { return TIER[type] || null; },
    async run(type, arg, arg2) {
      if (!this.handles(type)) return R(false, 'Unknown PC action.');
      try { return await H[type](arg, arg2); } catch (e) { return R(false, 'That did not work.'); }
    }
  };
}

module.exports = make;
