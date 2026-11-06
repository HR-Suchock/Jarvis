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
  // v1.23.0
  pclink: 'ctl', wolsetup: 'ctl',
  // v1.24.0
  jobadd: 'ctl', joblist: 'ctl', jobdel: 'ctl', backup: 'ctl', mouse: 'input', mediakey: 'ctl',
  logoff: 'danger', emptybin: 'danger',
  // v1.28.0: PC management + files from the phone
  procs: 'ctl', netinfo: 'ctl', startups: 'ctl', taskmgr: 'ctl', cleantemp: 'danger', filepart: 'ctl',
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
function ctxKey(dir) { const parts = String(dir).split(/[\\/]+/).filter(Boolean); return norm(parts.slice(-2).join(' ')); }
function kindOf(file) { const e = path.extname(file).toLowerCase(); return EXT.music.indexOf(e) >= 0 ? 'music' : EXT.video.indexOf(e) >= 0 ? 'video' : EXT.photo.indexOf(e) >= 0 ? 'photo' : EXT.doc.indexOf(e) >= 0 ? 'doc' : null; }

/** Scores how well a file name matches the spoken words. 0 = no match. */
function score(query, key, ctx) {
  const q = norm(query).replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (!q || !key) return 0;
  if (q === key) return 100;
  const qt = q.split(' '), kt = key.split(' '), qc = q.replace(/ /g, ''), kc = key.replace(/ /g, '');
  const ct = ctx ? String(ctx).split(' ') : [];
  let hit = 0;
  for (const t of qt) {
    if (kt.some((k) => k === t || (t.length >= 3 && (k.startsWith(t) || t.startsWith(k) && k.length >= 3)))) hit++;
    else if (t.length >= 4 && kc.indexOf(t) >= 0) hit++;
    else if (ct.length && t.length >= 3 && ct.some((c) => c === t || c.startsWith(t))) hit += 0.85;   // word is in the folder name, e.g. "marvel studios"
  }
  let sc = (hit / qt.length) * 60;
  if (kc.indexOf(qc) >= 0) sc += 30;                 // whole phrase inside the name ("spider man" ~ "spiderman")
  if (key.startsWith(q)) sc += 8;
  sc -= Math.min(10, Math.max(0, kt.length - qt.length) * 0.8);   // prefer the tighter name
  return hit >= qt.length - 0.01 || kc.indexOf(qc) >= 0 ? sc : sc * 0.5;
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

  const inbound = new Map();
  const BLOCKED_EXT = /\.(exe|bat|cmd|msi|vbs|vbe|ps1|psm1|scr|com|js|jse|wsf|lnk|jar|dll|reg|hta|cpl|msc|apk|sh)$/i;
  function cleanName(n) {
    n = String(n == null ? '' : n).replace(/\\/g, '/'); n = n.slice(n.lastIndexOf('/') + 1).replace(/[\x00-\x1f<>:"|?*]/g, '_').trim();
    while (n.startsWith('.')) n = n.slice(1);
    if (n.length > 80) n = n.slice(-80);
    return n || 'from-phone';
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
  function macLine() {
    const ifs = os.networkInterfaces(); let best = '';
    Object.keys(ifs).forEach((n) => (ifs[n] || []).forEach((a) => { if (!best && a.family === 'IPv4' && !a.internal && a.mac && a.mac !== '00:00:00:00:00:00') best = a.mac.toUpperCase(); }));
    return best;
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
          // no stat() here: reading size/date for every file of a big disk is what made the app lag. It is done lazily for the few best matches.
          out.push({ p: full, key: nameKey(it.name), ctx: ctxKey(dir), kind: k, size: -1, mtime: -1 }); n++;
        }
      }
      if (++tick % 8 === 0) await new Promise((r) => setImmediate(r));       // let the app breathe while indexing a big disk
    }
    return out;
  }
  // The index is saved to disk (deps.cacheFile) so only the very first search after installing is slow. A saved index is
  // used immediately and refreshed quietly in the background (stale-while-revalidate).
  const cacheFile = deps.cacheFile || (deps.userData ? path.join(deps.userData, 'jarvis-media-index.json') : '');
  let cacheTried = false;
  function loadCache() {
    cacheTried = true;
    try {
      if (!cacheFile) return false;
      const st = fs.statSync(cacheFile); if (Date.now() - st.mtimeMs > 14 * 86400000) return false;
      const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (!j || j.v !== 1 || !Array.isArray(j.f)) return false;
      index = j.f.map((a) => ({ p: a[0], key: a[1], ctx: a[2], kind: a[3], size: -1, mtime: -1 }));
      indexAt = st.mtimeMs; return true;
    } catch (e) { return false; }
  }
  function saveCache(list) {
    try { if (cacheFile && list.length && list.length <= MAX_FILES) { const tmp = cacheFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ v: 1, f: list.map((f) => [f.p, f.key, f.ctx, f.kind]) })); fs.renameSync(tmp, cacheFile); } } catch (e) { /* optional */ }
  }
  function startBuild() {
    if (!indexing) indexing = buildIndex().then((r) => { index = r; indexAt = Date.now(); indexing = null; saveCache(r); return r; }, (e) => { indexing = null; throw e; });
    return indexing;
  }
  async function getIndex(force) {
    if (!cacheTried && !index) loadCache();
    if (force) return startBuild();
    if (index) {
      if (Date.now() - indexAt > 600000) startBuild().catch(() => {});       // refresh quietly; answer from what we have right now
      return index;
    }
    return startBuild();
  }
  function pool(idx, kind) {
    if (kind === 'music') return idx.filter((f) => f.kind === 'music');
    if (kind === 'movie' || kind === 'video') return idx.filter((f) => f.kind === 'video');
    if (kind === 'photo') return idx.filter((f) => f.kind === 'photo');
    if (kind === 'doc') return idx.filter((f) => f.kind === 'doc');
    return idx;
  }
  // read size + date only for the files we really need (cached on the entry)
  async function ensureStat(list) {
    const todo = list.filter((f) => f.size < 0);
    for (let i = 0; i < todo.length; i += 32) {
      await Promise.all(todo.slice(i, i + 32).map(async (f) => { try { const st = await fs.promises.stat(f.p); f.size = st.size; f.mtime = st.mtimeMs; } catch (e) { f.size = 0; f.mtime = 0; } }));
      await new Promise((r) => setImmediate(r));
    }
  }
  // "iron man" or "iron man|marvel studios" (name | folder hint). Returns the best matches, newest first among equals.
  async function rank(idx, query, kind) {
    const parts = String(query || '').split('|'), name = parts[0], hint = norm(parts[1] || '');
    const cand = pool(idx, kind).map((f) => {
      let sc = score(name, f.key, f.ctx);
      if (hint) { const ht = hint.split(' ').filter(Boolean), ct = String(f.ctx || ''); sc = ht.every((t) => ct.indexOf(t) >= 0) ? sc + 20 : sc * 0.6; }
      return { f, s: sc };
    }).filter((x) => x.s >= 45).sort((a, b) => b.s - a.s);
    const top = cand.slice(0, 25);
    await ensureStat(top.map((x) => x.f));
    let out = top;
    if (kind === 'photo') out = out.filter((x) => x.f.size === 0 || x.f.size >= 20 * 1024);          // skip tiny icons
    if (kind === 'movie') { const big = out.filter((x) => x.f.size >= MOVIE_MIN_BYTES); if (big.length) out = big; }   // prefer real movies over short clips
    out.total = cand.length;
    return out.sort((a, b) => (b.s - a.s) || (b.f.mtime - a.f.mtime));
  }
  async function newest(idx, kind, limit) {
    const l = pool(idx, kind); await ensureStat(l);
    let out = l.filter((f) => kind === 'photo' ? (f.size === 0 || f.size >= 20 * 1024) : kind === 'movie' ? f.size >= MOVIE_MIN_BYTES : true);
    out = out.sort((a, b) => b.mtime - a.mtime); return limit ? out.slice(0, limit) : out;
  }
  const KINDS = /^(music|video|movie|photo|doc)$/;
  const NOUN = { music: 'song', movie: 'movie', video: 'video', photo: 'photo', doc: 'document', '': 'file' };
  const PLURAL = { music: 'songs', movie: 'movies', video: 'videos', photo: 'photos', doc: 'documents', '': 'files' };
  const LATEST = /^(?:\*latest|latest|newest|recent|last|most recent)$/i;
  const pretty = (f) => clip(path.basename(f.p, path.extname(f.p)).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim(), 70);
  async function openFile(f) {
    try { if (deps.shell && deps.shell.openPath) { const e = await deps.shell.openPath(f.p); return !e; } } catch (e) { /* fall back */ }
    const r = await ps('Invoke-Item -LiteralPath $env:JARVIS_FILE', { JARVIS_FILE: f.p }); return r.ok;
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


  // ---------------------------------------------------------------- v1.24.0: scheduled jobs on the PC ----------
  // A job runs ONE whitelisted action at a time (see SCHED_OK). Danger-tier jobs (sleep/shutdown/restart) can only be
  // created while the "power commands" switch is on (deps.tierOn('danger')) and are re-checked when they run.
  const SCHED_OK = { lock: 'ctl', volume: 'ctl', media: 'ctl', open: 'ctl', screenshot: 'ctl', url: 'ctl', youtube: 'ctl', cancelshutdown: 'ctl',
    sleep: 'danger', shutdown: 'danger', restart: 'danger', backup: 'ctl', playrandom: 'ctl', playfile: 'ctl', playany: 'ctl', ytplay: 'ctl',
    stopmedia: 'ctl', brightness: 'ctl', darkmode: 'ctl', openfolder: 'ctl', pclink: 'ctl', settingspage: 'ctl' };
  const okType = (t) => typeof t === 'string' && Object.prototype.hasOwnProperty.call(SCHED_OK, t);
  const JOBS_MAX = 30, LATE_MS = 10 * 60000;
  const jobsFile = deps.userData ? path.join(deps.userData, 'jarvis-jobs.json') : '';
  let jobs = [], jobSeq = 1, jobsLoaded = false, schedTimer = null;
  const nowMs = () => (deps.now ? deps.now() : Date.now());
  function loadJobs() {
    if (jobsLoaded) return; jobsLoaded = true;
    try { if (jobsFile) { const j = JSON.parse(fs.readFileSync(jobsFile, 'utf8')); if (Array.isArray(j.jobs)) { jobs = j.jobs.filter((x) => x && okType(x.type)).slice(0, JOBS_MAX); jobSeq = Math.max(1, +j.seq || 1); } } } catch (e) { /* none yet */ }
  }
  function saveJobs() { try { if (jobsFile) fs.writeFileSync(jobsFile, JSON.stringify({ seq: jobSeq, jobs })); } catch (e) { /* ignore */ } }
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hhmm = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  function nextAt(j, from) {
    if (j.k === 'in') return j.at;
    const d = new Date(from); d.setHours(j.h, j.m, 0, 0);
    for (let i = 0; i < 9; i++) {
      if (d.getTime() > from && (j.k !== 'weekly' || (j.dow || []).indexOf(d.getDay()) >= 0)) return d.getTime();
      d.setDate(d.getDate() + 1); d.setHours(j.h, j.m, 0, 0);
    }
    return from + 86400000;
  }
  function whenText(j) {
    if (j.k === 'in') return 'at ' + new Date(j.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (j.k === 'once') return 'once at ' + hhmm(j.h, j.m);
    if (j.k === 'daily') return 'every day at ' + hhmm(j.h, j.m);
    return 'every ' + (j.dow || []).map((d) => DAYN[d]).join('/') + ' at ' + hhmm(j.h, j.m);
  }
  const int = (x, lo, hi) => { const n = Math.floor(+x); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  function ensureScheduler() {
    loadJobs();
    if (schedTimer || deps.scheduler === false) return;
    schedTimer = setInterval(() => { tick(nowMs()); }, 20000);
    if (schedTimer.unref) schedTimer.unref();
  }
  async function runJob(j) {
    const tier = SCHED_OK[j.type];
    if (tier !== 'ctl' && !(deps.tierOn && deps.tierOn(tier))) return R(false, 'skipped — power commands are switched off on the PC');
    try {
      if (Object.prototype.hasOwnProperty.call(H, j.type)) return await H[j.type](j.arg, j.arg2);
      if (deps.run) return await deps.run(j.type, j.arg, j.arg2);
    } catch (e) { /* fall through */ }
    return R(false, 'that action is not available');
  }
  async function tick(now) {
    loadJobs();
    const due = jobs.filter((j) => j.at <= now);
    for (const j of due) {
      const late = now - j.at;
      if (j.k === 'in' || j.k === 'once') jobs = jobs.filter((x) => x.id !== j.id); else j.at = nextAt(j, now);
      saveJobs();
      if (late > LATE_MS) { if (deps.notifyPhone) { try { deps.notifyPhone('Missed (PC was off): ' + j.label); } catch (e) { /* ignore */ } } continue; }
      const r = await runJob(j);
      if (deps.notifyPhone && j.type !== 'backup') { try { deps.notifyPhone(j.label + ': ' + (r.ok ? 'done' : (r.msg || 'failed'))); } catch (e) { /* ignore */ } }
    }
    return due.length;
  }
  // ---- backup: copy only (robocopy /E /XO, never /MIR or /PURGE), in the background
  const BK = { documents: 'documents', desktop: 'desktop', pictures: 'pictures', photos: 'pictures', music: 'music', videos: 'videos', downloads: 'downloads' };
  let backupBusy = false;
  function defaultBackupDrive(srcDrive) {
    for (const L of 'DEFGHIJKLMNOPQRSTUVWXYZ') { if (L !== srcDrive && fs.existsSync(L + ':\\')) return L; }
    return '';
  }
  // ---- remote mouse / keyboard: one small persistent PowerShell reads fixed numeric commands from stdin
  const MOUSE_PS = "Add-Type -Name M -Namespace J -MemberDefinition '[DllImport(\"user32.dll\")] public static extern void mouse_event(uint f,int dx,int dy,int d,UIntPtr e); [DllImport(\"user32.dll\")] public static extern void keybd_event(byte b,byte s,uint f,UIntPtr e);'; " +
    "while (($l = [Console]::In.ReadLine()) -ne $null) { $p = $l.Split(' '); try { if ($p[0] -eq 'e') { [J.M]::mouse_event([uint32]$p[1],[int]$p[2],[int]$p[3],[int]$p[4],[UIntPtr]::Zero) } elseif ($p[0] -eq 'k') { [J.M]::keybd_event([byte]$p[1],0,[uint32]$p[2],[UIntPtr]::Zero) } } catch { } }";
  const MKEYS = { enter: 0x0D, backspace: 0x08, esc: 0x1B, tab: 0x09, space: 0x20, delete: 0x2E, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
    left: 0x25, up: 0x26, right: 0x27, down: 0x28, win: 0x5B, f5: 0x74, f11: 0x7A, volup: 0xAF, voldown: 0xAE, mute: 0xAD, next: 0xB0, prev: 0xB1, playpause: 0xB3, stop: 0xB2 };
  const MEDIAKEY_SAY = { volup: 'Volume up.', voldown: 'Volume down.', mute: 'Mute toggled.', playpause: 'Play / pause.', next: 'Next track.', prev: 'Previous track.', stop: 'Stopped.' };
  // volume/media commands are sent as real key presses (works on every Windows PC); the PowerShell audio route failed silently on some
  function remap(type, arg) {
    const a = String(arg || '').toLowerCase().trim();
    if (type === 'volume') { if (a === 'upstep') return { type: 'mediakey', arg: 'volup', arg2: '1' }; if (a === 'downstep') return { type: 'mediakey', arg: 'voldown', arg2: '1' }; if (a === 'up' || a === 'louder') return { type: 'mediakey', arg: 'volup', arg2: '5' }; if (a === 'down' || a === 'quieter') return { type: 'mediakey', arg: 'voldown', arg2: '5' }; if (a === 'mute') return { type: 'mediakey', arg: 'mute', arg2: '1' }; }
    if (type === 'media') { const k = { play: 'playpause', pause: 'playpause', resume: 'playpause', toggle: 'playpause', next: 'next', previous: 'prev', stop: 'stop' }[a]; if (k) return { type: 'mediakey', arg: k, arg2: '1' }; }
    return null;
  }
  let helper = null, helperIdle = null;
  function helperWrite(lines) {
    if (platform !== 'win32') return WINMSG;
    try {
      if (!helper) {
        const sp = deps.spawn || cp.spawn;
        helper = sp(PS, PS_ARGS.concat([MOUSE_PS]), { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
        const mine = helper;
        helper.on('exit', () => { if (helper === mine) helper = null; });
        helper.on('error', () => { if (helper === mine) helper = null; });
      }
      helper.stdin.write(lines.join('\n') + '\n');
      clearTimeout(helperIdle);
      helperIdle = setTimeout(() => { try { if (helper) helper.stdin.end(); } catch (e) { /* ignore */ } helper = null; }, 120000);
      if (helperIdle.unref) helperIdle.unref();
      return '';
    } catch (e) { helper = null; return 'Mouse control could not start.'; }
  }
  const press = (vk) => ['k ' + vk + ' 0', 'k ' + vk + ' 2'];

  const H = {

    // ---------------------------------------------------------------- v1.28.0 PC management tools (all read-only except cleantemp)
    async procs() {
      if (platform !== 'win32') return R(false, WINMSG);
      const out = await new Promise((res) => { try { exec('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 8000, maxBuffer: 4 << 20 }, (e, o) => res(e ? null : String(o))); } catch (e) { res(null); } });
      if (!out) return R(false, 'I could not read the running programs.');
      const m = new Map();
      for (const line of out.split(/\r?\n/)) {
        const c = line.match(/^"([^"]+)","[^"]*","[^"]*","[^"]*","([\d.,\s]+)\s*K"/i); if (!c) continue;
        const nm = c[1].replace(/\.exe$/i, ''), kb = parseInt(c[2].replace(/[^\d]/g, ''), 10);
        if (kb && !/^system idle process$/i.test(nm)) m.set(nm, (m.get(nm) || 0) + kb / 1024);
      }
      const top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, mb]) => n + ' ' + (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : Math.round(mb) + ' MB'));
      return top.length ? R(true, 'Biggest memory users: ' + top.join(', ') + '.') : R(false, 'I could not read the running programs.');
    },
    async netinfo() {
      const base = 'Address ' + ipLine();
      if (platform !== 'win32') return R(true, base + '.');
      const out = await new Promise((res) => { try { exec('netsh', ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 6000 }, (e, o) => res(e ? '' : String(o))); } catch (e) { res(''); } });
      const ssid = (out.match(/^\s*SSID\s*:\s*(.+)$/im) || [])[1], sig = (out.match(/^\s*Signal\s*:\s*(\d+)%/im) || [])[1];
      return R(true, ssid ? 'Wi-Fi "' + clip(ssid.trim(), 40) + '"' + (sig ? ' (signal ' + sig + '%)' : '') + '. ' + base + '.' : 'Wired or no Wi-Fi. ' + base + '.');
    },
    async startups() {
      const r = await ps('Get-CimInstance Win32_StartupCommand | ForEach-Object { $_.Name } | Select-Object -Unique -First 14', {}, 12000);
      if (!r.ok) return fail(r, 'I could not read the startup programs.');
      const names = r.out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      return names.length ? R(true, 'Starting with Windows: ' + names.join(', ') + '.') : R(true, 'No startup programs found.');
    },
    async taskmgr() {
      if (platform !== 'win32') return R(false, WINMSG);
      try { exec('cmd', ['/c', 'start', '', 'taskmgr'], { windowsHide: true, timeout: 5000 }, () => {}); } catch (e) { return R(false, 'I could not open Task Manager.'); }
      return R(true, 'Opening Task Manager.');
    },
    async cleantemp() {
      const dir = os.tmpdir();
      if (!/temp|tmp/i.test(dir) || dir.length < 8) return R(false, 'I will not clean that folder.');
      const cutoff = Date.now() - 48 * 3600 * 1000;
      let files = 0, bytes = 0, seen = 0;
      const walk = (d, depth) => {
        let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
        for (const ent of list) {
          if (++seen > 30000) return;
          const full = path.join(d, ent.name);
          try {
            if (ent.isSymbolicLink()) continue;
            if (ent.isDirectory()) { if (depth < 4) walk(full, depth + 1); continue; }
            const st = fs.statSync(full);
            if (st.mtimeMs < cutoff && st.atimeMs < cutoff) { fs.unlinkSync(full); files++; bytes += st.size; }
          } catch (e) { /* in use or protected: skip it */ }
        }
      };
      walk(dir, 0);
      return R(true, files ? 'Cleaned ' + files + ' old temporary files (' + (bytes / 1048576).toFixed(1) + ' MB freed).' : 'The temp folder is already tidy (nothing older than two days).');
    },
    // a file sent from the phone arrives in numbered pieces; the finished file is handed to deps.saveFile
    async filepart(metaJson, b64) {
      try {
        const m = JSON.parse(String(metaJson || '{}'));
        const id = String(m.id || '').replace(/[^A-Za-z0-9_-]/g, ''); const i = m.i | 0, n = m.n | 0, size = +m.size || 0;
        if (id.length < 4 || id.length > 40 || n < 1 || n > 120 || i < 0 || i >= n || size < 1 || size > 3000000) return R(false, 'That file transfer was not valid.');
        const name = cleanName(m.name), mime = /^[a-z]+\/[a-z0-9.+-]{1,60}$/i.test(String(m.mime || '')) ? String(m.mime).toLowerCase() : 'application/octet-stream';
        if (BLOCKED_EXT.test(name)) return R(false, 'I do not accept that type of file (programs and scripts are refused).');
        const part = Buffer.from(String(b64 || ''), 'base64');
        if (!part.length || part.length > 300000) return R(false, 'That piece of the file was not valid.');
        const now = Date.now();
        for (const [k, v] of inbound) if (now - v.t > 300000) inbound.delete(k);
        let f = inbound.get(id);
        if (i === 0) { if (!f && inbound.size >= 3) return R(false, 'Too many files at once.'); f = { n, size, next: 0, parts: [], got: 0, t: now }; inbound.set(id, f); }
        if (!f || f.next !== i || f.n !== n) { inbound.delete(id); return R(false, 'File pieces arrived out of order. Please send it again.'); }
        f.got += part.length; if (f.got > size) { inbound.delete(id); return R(false, 'The file was larger than announced.'); }
        f.parts.push(part); f.next++; f.t = now;
        if (f.next < n) return R(true, 'Piece ' + f.next + ' of ' + n + '.');
        inbound.delete(id);
        const data = Buffer.concat(f.parts);
        if (data.length !== size) return R(false, 'The file arrived incomplete. Please send it again.');
        if (!deps.saveFile) return R(false, 'This PC cannot save files.');
        return await deps.saveFile(name, mime, data);
      } catch (e) { return R(false, 'Could not receive the file.'); }
    },

    async pcinfo(arg) {
      switch (String(arg || 'status').toLowerCase()) {
        case 'time': { const n = Date.now(); return R(true, 'PC time ' + new Date(n).toLocaleTimeString() + ' (epoch ' + n + ')'); }
        case 'mac': { const m = macLine(); return m ? R(true, 'The PC network address is ' + m + ' (' + ipLine() + ').') : R(false, 'I could not read the PC network address.'); }
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
    async jobadd(arg) {
      let o; try { o = JSON.parse(String(arg || '')); } catch (e) { return R(false, 'I could not read that schedule.'); }
      if (!o || !okType(o.type)) return R(false, 'I cannot schedule that kind of command.');
      loadJobs();
      if (jobs.length >= JOBS_MAX) return R(false, 'There are too many scheduled jobs. Cancel some first.');
      const tier = SCHED_OK[o.type];
      if (tier !== 'ctl' && !(deps.tierOn && deps.tierOn(tier))) return R(false, 'Power commands are switched off on the PC, so I cannot schedule that. Turn on "Allow power commands" there first.');
      const now = nowMs(), j = { id: jobSeq, type: o.type, arg: clip(o.arg || '', 300), arg2: clip(o.arg2 || '', 100), label: clip(String(o.label || o.type).replace(/[\r\n]+/g, ' '), 60), k: o.k };
      if (o.k === 'in') { const mins = int(o.min, 1, 1440); if (!mins) return R(false, 'I can schedule from 1 minute to 24 hours ahead.'); j.at = now + mins * 60000; }
      else if (o.k === 'once' || o.k === 'daily' || o.k === 'weekly') {
        j.h = int(o.h, 0, 23); j.m = int(o.m, 0, 59); if (j.h === null || j.m === null) return R(false, 'That time is not valid.');
        if (o.k === 'weekly') { j.dow = (Array.isArray(o.dow) ? o.dow : []).map((d) => int(d, 0, 6)).filter((d) => d !== null).slice(0, 7); if (!j.dow.length) return R(false, 'Which days?'); }
        j.at = nextAt(j, now);
      } else return R(false, 'I do not understand that schedule.');
      jobSeq++; jobs.push(j); saveJobs(); ensureScheduler();
      return R(true, 'Scheduled #' + j.id + ': ' + j.label + ' ' + whenText(j) + '.');
    },
    async joblist() {
      loadJobs();
      if (!jobs.length) return R(true, 'There are no scheduled jobs on the PC.');
      return R(true, jobs.length + ' scheduled: ' + jobs.slice(0, 6).map((j) => '#' + j.id + ' ' + j.label + ' ' + whenText(j)).join('; ') + (jobs.length > 6 ? '; and more' : '') + '.');
    },
    async jobdel(arg) {
      loadJobs(); const a = String(arg || '').trim().toLowerCase();
      if (a === 'all') { const n = jobs.length; jobs = []; saveJobs(); return R(true, n ? 'Cancelled all ' + n + ' scheduled jobs.' : 'There were no scheduled jobs.'); }
      const id = int(a.replace(/^#/, ''), 1, 1e9), j = jobs.filter((x) => x.id === id)[0];
      if (!j) return R(false, 'I could not find that job number.');
      jobs = jobs.filter((x) => x.id !== id); saveJobs(); return R(true, 'Cancelled #' + id + ': ' + j.label + '.');
    },
    async backup(arg, arg2) {
      const key = BK[norm(arg)];
      if (!key) return R(false, 'I can back up Documents, Desktop, Pictures, Music, Videos or Downloads.');
      if (platform !== 'win32') return R(false, WINMSG);
      if (backupBusy) return R(false, 'A backup is already running.');
      let src = ''; try { src = deps.getPath ? deps.getPath(key) : ''; } catch (e) { /* ignore */ }
      if (!src) return R(false, 'I could not find that folder.');
      const srcDrive = String(src).slice(0, 1).toUpperCase();
      let drive = /^[a-z]$/i.test(String(arg2 || '').trim()) ? String(arg2).trim().toUpperCase() : defaultBackupDrive(srcDrive);
      if (!drive) return R(false, 'I did not find a second drive. Say which drive to use, for example "back up my documents to F drive".');
      if (!fs.existsSync(drive + ':\\')) return R(false, 'Drive ' + drive + ' is not available.');
      if (drive === srcDrive) return R(false, 'That is the same drive as the folder, so it would not protect you. Pick another drive.');
      const name = key.charAt(0).toUpperCase() + key.slice(1), dest = drive + ':\\Jarvis-Backup\\' + name;
      backupBusy = true;
      try {
        exec('robocopy', [src, dest, '/E', '/XO', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NP', '/MT:2'], { windowsHide: true, timeout: 6 * 3600 * 1000, maxBuffer: 1 << 22 }, (e) => {
          backupBusy = false;
          const ok = !e || (typeof e.code === 'number' && e.code < 8);
          if (deps.notifyPhone) { try { deps.notifyPhone(ok ? 'Backup of ' + name + ' to ' + dest + ' finished.' : 'Backup of ' + name + ' had a problem.'); } catch (x) { /* ignore */ } }
        });
      } catch (e) { backupBusy = false; return R(false, 'I could not start the backup.'); }
      return R(true, 'Backup of ' + name + ' started to ' + dest + '. Files are only copied, never deleted. I will tell your phone when it is done.');
    },
    async mediakey(arg, arg2) {
      const k = String(arg || '').toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(MEDIAKEY_SAY, k)) return R(false, 'I do not know that media key.');
      const n = int(arg2, 1, 10) || 1; let lines = [];
      for (let i = 0; i < n; i++) lines = lines.concat(press(MKEYS[k]));
      const err = helperWrite(lines);
      return err ? R(false, err) : R(true, MEDIAKEY_SAY[k]);
    },
    async mouse(arg, arg2) {
      const a = String(arg || '').toLowerCase(), d = String(arg2 || '');
      let lines = [], said = '';
      if (a === 'move') {
        let dx = 0, dy = 0;
        d.split(';').slice(0, 30).forEach((p) => { const m = /^\s*(-?\d{1,4})\s*,\s*(-?\d{1,4})\s*$/.exec(p); if (m) { dx += +m[1]; dy += +m[2]; } });
        dx = Math.max(-4000, Math.min(4000, dx)); dy = Math.max(-4000, Math.min(4000, dy));
        if (!dx && !dy) return R(true, 'ok');
        lines = ['e 1 ' + dx + ' ' + dy + ' 0'];
      } else if (a === 'click') {
        const b = d.toLowerCase();
        if (b === 'r') lines = ['e 8 0 0 0', 'e 16 0 0 0']; else if (b === 'd') lines = ['e 2 0 0 0', 'e 4 0 0 0', 'e 2 0 0 0', 'e 4 0 0 0']; else lines = ['e 2 0 0 0', 'e 4 0 0 0'];
        said = b === 'r' ? 'Right click.' : b === 'd' ? 'Double click.' : 'Click.';
      } else if (a === 'down') lines = ['e 2 0 0 0'];
      else if (a === 'up') lines = ['e 4 0 0 0'];
      else if (a === 'scroll') { const n = int(d, -40, 40); if (!n) return R(true, 'ok'); lines = ['e 2048 0 0 ' + (-n * 40)]; }
      else if (a === 'key') {
        const k = d.toLowerCase();
        if (k === 'alttab') lines = ['k 18 0'].concat(press(9), ['k 18 2']);
        else if (Object.prototype.hasOwnProperty.call(MKEYS, k)) lines = press(MKEYS[k]);
        else return R(false, 'I do not know that key.');
        said = 'Pressed ' + k + '.';
      } else return R(false, 'I do not know that mouse action.');
      const err = helperWrite(lines);
      return err ? R(false, err) : R(true, said || 'ok');
    },
    async pclink(arg) {
      const u = String(arg || '').trim();
      if (!/^https?:\/\/[^\s]{3,2000}$/i.test(u)) return R(false, 'That is not a web link I can open.');
      return (await openUrl(u)) ? R(true, 'Opened the link on the PC.') : R(false, 'I could not open the link on the PC.');
    },
    async wolsetup() {
      const script = "$a = Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1; if (-not $a) { 'NOADAPTER'; exit } try { Set-NetAdapterPowerManagement -Name $a.Name -WakeOnMagicPacket Enabled -ErrorAction Stop; 'OK ' + $a.Name } catch { 'ERR ' + $_.Exception.Message }";
      const r = await ps(script);
      const o = String(r.out || '').trim();
      if (/^OK/.test(o)) return R(true, 'Wake-on-LAN is switched on for the network adapter. If the PC still does not wake, also enable "Wake on LAN" in the BIOS and turn off Windows Fast Startup.');
      if (/^NOADAPTER/.test(o)) return R(false, 'I could not find an active network adapter.');
      return R(false, 'I could not change that automatically (Jarvis may need to run as administrator). Open Device Manager, your network adapter, Power Management, tick "Allow this device to wake the computer" and "Only allow a magic packet", then enable Wake-on-LAN in the BIOS.');
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
      const raw = String(arg || '').trim().slice(0, 140), name = raw.split('|')[0].trim();
      if (!name) return R(false, 'Tell me the name of the ' + NOUN[kind] + '.');
      const verb = kind === 'photo' || kind === 'doc' || kind === '' ? 'Opening' : 'Playing';
      let idx = await getIndex(false), best = null;
      if (LATEST.test(name)) { best = (await newest(idx, kind, 1))[0] || null; }
      else {
        let hits = await rank(idx, raw, kind);
        if (!hits.length && Date.now() - indexAt > 120000) { idx = await getIndex(true); hits = await rank(idx, raw, kind); }     // maybe a brand-new file
        best = hits.length ? hits[0].f : null;
      }
      if (!best && kind === '' && !LATEST.test(name)) {                 // "open marvel studios file" = the user named a folder: open it
        const q = norm(name).split(' ').filter(Boolean);
        const hit = q.length ? idx.find((f) => { const d = norm(path.basename(path.dirname(f.p))); return d === q.join(' ') || (q.length > 1 ? q.every((t) => d.indexOf(t) >= 0) : false); }) : null;
        if (hit) { const dir = path.dirname(hit.p); try { if (deps.shell && deps.shell.openPath) { const e = await deps.shell.openPath(dir); if (!e) return R(true, 'Opened the ' + path.basename(dir) + ' folder.'); } } catch (e2) { /* fall back */ } const r2 = await ps('Invoke-Item -LiteralPath $env:JARVIS_DIR', { JARVIS_DIR: dir }); if (r2.ok) return R(true, 'Opened the ' + path.basename(dir) + ' folder.'); }
      }
      if (!best) return R(false, 'I could not find ' + (LATEST.test(name) ? 'any ' + PLURAL[kind] : 'a ' + NOUN[kind] + ' called ' + clip(name, 50)) + ' on this PC.');
      return (await openFile(best)) ? R(true, verb + ' ' + pretty(best) + '.') : R(false, 'I found ' + pretty(best) + ' but could not open it.');
    },
    async playrandom(arg) {
      const kind = /^(movie|video)/.test(String(arg || '')) ? 'movie' : 'music';
      const list = pool(await getIndex(false), kind);
      if (!list.length) return R(false, 'I could not find any ' + (kind === 'movie' ? 'movies' : 'music') + ' on this PC.');
      const rnd = deps.random || Math.random; let f = null;
      for (let i = 0; i < 30 && !f; i++) {                                       // movies must be big files: stat random picks until one is
        const c = list[Math.floor(rnd() * list.length)];
        if (kind !== 'movie') { f = c; break; }
        await ensureStat([c]); if (c.size >= MOVIE_MIN_BYTES) f = c;
      }
      if (!f) return R(false, 'I could not find a full-length movie on this PC.');
      return (await openFile(f)) ? R(true, 'Playing ' + pretty(f) + '.') : R(false, 'I could not open that file.');
    },
    async playany(arg) {
      const name = String(arg || '').trim().slice(0, 120);
      if (!name) return R(false, 'Tell me what to play.');
      const hits = (await rank(await getIndex(false), name, '')).filter((x) => x.s >= 60 && (x.f.kind === 'music' || x.f.kind === 'video'));
      if (hits.length && (await openFile(hits[0].f))) return R(true, 'Playing ' + pretty(hits[0].f) + ' from this PC.');
      return youtubePlay(name);
    },
    async ytplay(arg) { return youtubePlay(arg); },
    async medialist(arg, arg2) {
      const kind = KINDS.test(String(arg2 || '')) ? String(arg2) : '';
      const idx = await getIndex(false), q = String(arg || '').trim(), m = q && !LATEST.test(q.split('|')[0]);
      let list, total;
      if (m) { const r = await rank(idx, q, kind); list = r.map((x) => x.f); total = r.total || list.length; }
      else { list = await newest(idx, kind, 0); total = list.length; }
      const noun = PLURAL[kind];
      if (!list.length) return R(true, 'I did not find any ' + noun + (m ? ' matching ' + clip(q.split('|')[0], 40) : '') + ' on this PC.');
      return R(true, 'I found ' + total + ' ' + noun + (m ? ' matching ' + clip(q.split('|')[0], 40) : '') + '. ' + (m ? 'Best matches' : 'Newest') + ': ' + list.slice(0, 4).map(pretty).join('; ') + '.');
    },
    async openfolder(arg) {
      const key = String(arg || '').toLowerCase();
      const dm = /^drive:([a-z])$/.exec(key);
      if (dm) {                                                          // "open D drive"
        const root = dm[1].toUpperCase() + ':\\';
        try { if (!fs.statSync(root).isDirectory()) throw new Error('x'); } catch (e) { return R(false, 'I cannot find drive ' + dm[1].toUpperCase() + ' on this PC.'); }
        try { if (deps.shell && deps.shell.openPath) { const e = await deps.shell.openPath(root); return e ? R(false, 'I could not open drive ' + dm[1].toUpperCase() + '.') : R(true, 'Opened drive ' + dm[1].toUpperCase() + '.'); } } catch (e) { /* fall back */ }
        const r = await ps('Invoke-Item -LiteralPath $env:JARVIS_DIR', { JARVIS_DIR: root });
        return r.ok ? R(true, 'Opened drive ' + dm[1].toUpperCase() + '.') : fail(r, 'I could not open that drive.');
      }
      if (key === 'recycle bin') { const r = await ps('Start-Process explorer.exe -ArgumentList "shell:RecycleBinFolder"'); return r.ok ? R(true, 'Opened the recycle bin.') : fail(r, 'I could not open the recycle bin.'); }
      const name = FOLDERS[key]; if (!name) return R(false, 'I do not know that folder.');
      const g = deps.getPath || ((n) => path.join(os.homedir(), n.charAt(0).toUpperCase() + n.slice(1)));
      let dir = ''; try { dir = g(name); } catch (e) { /* ignore */ }
      if (!dir) return R(false, 'I could not find that folder.');
      try { if (deps.shell && deps.shell.openPath) { const e = await deps.shell.openPath(dir); return e ? R(false, 'I could not open that folder.') : R(true, 'Opened the ' + key + ' folder.'); } } catch (e) { /* fall back */ }
      const r = await ps('Invoke-Item -LiteralPath $env:JARVIS_DIR', { JARVIS_DIR: dir });
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
    remap,
    startScheduler() { ensureScheduler(); }, stopScheduler() { clearInterval(schedTimer); schedTimer = null; try { if (helper) helper.stdin.end(); } catch (e) { /* ignore */ } helper = null; }, _tick: tick, _jobs: () => { loadJobs(); return jobs; },
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
