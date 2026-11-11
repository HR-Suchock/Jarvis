/* J.A.R.V.I.S — app logic (runs inside the Android WebView; AndroidBridge is injected by MainActivity) */
(function () {
  'use strict';

  var B = window.AndroidBridge || null;
  var PC = window.JARVIS_PLATFORM === 'pc';      // true inside the Windows desktop app
  var SELF = PC ? 'pc' : 'phone';
  // If the phone side is not ready to serve saved settings yet, reload instead of starting blank (a blank start would overwrite saved keys).
  if (B && B.ready && !B.ready()) {
    var rn = 0; try { rn = parseInt(sessionStorage.getItem('jr') || '0', 10) || 0; } catch (e) { rn = 9; }
    if (rn < 8) { try { sessionStorage.setItem('jr', String(rn + 1)); } catch (e) { /* ignore */ } setTimeout(function () { location.reload(); }, 400); return; }
  } else { try { sessionStorage.removeItem('jr'); } catch (e) { /* ignore */ } }
  function $(s, r) { return (r || document).querySelector(s); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* ------------------------------------------------------------------ storage */
  var store = {
    get: function (k) {
      try { return B ? B.getPref(k) : (localStorage.getItem('jarvis.' + k) || ''); } catch (e) { return ''; }
    },
    set: function (k, v) {
      try { if (B) B.setPref(k, v); else localStorage.setItem('jarvis.' + k, v); } catch (e) { /* ignore */ }
    }
  };

  /* ------------------------------------------------------------------ providers */
  var PROVIDERS = [
    { id: 'gemini', name: 'Google Gemini', type: 'gemini', base: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash',
      keyUrl: 'https://aistudio.google.com/apikey', free: true, note: 'Free tier · fastest to set up' },
    { id: 'groq', name: 'Groq', type: 'openai', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile',
      keyUrl: 'https://console.groq.com/keys', free: true, note: 'Free tier · very fast replies' },
    { id: 'openrouter', name: 'OpenRouter', type: 'openai', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free',
      keyUrl: 'https://openrouter.ai/keys', free: true, note: 'Many free models (names end in :free)' },
    { id: 'deepseek', name: 'DeepSeek', type: 'openai', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
      keyUrl: 'https://platform.deepseek.com/api_keys', free: false, note: 'Low cost · small top-up needed' },
    { id: 'xai', name: 'xAI Grok', type: 'openai', base: 'https://api.x.ai/v1', model: 'grok-4',
      keyUrl: 'https://console.x.ai', free: false, note: 'Paid · tap Test & load models to pick a model' },
    { id: 'mistral', name: 'Mistral', type: 'openai', base: 'https://api.mistral.ai/v1', model: 'mistral-small-latest',
      keyUrl: 'https://console.mistral.ai/api-keys', free: true, note: 'Free experiment tier' },
    { id: 'openai', name: 'OpenAI', type: 'openai', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini',
      keyUrl: 'https://platform.openai.com/api-keys', free: false, note: 'Paid account required' },
    { id: 'anthropic', name: 'Anthropic Claude', type: 'anthropic', base: 'https://api.anthropic.com', model: 'claude-haiku-5-5',
      keyUrl: 'https://console.anthropic.com/settings/keys', free: false, note: 'Paid account required' },
    { id: 'custom', name: 'Custom (OpenAI-compatible)', type: 'openai', base: '', model: '',
      keyUrl: '', free: true, note: 'Any OpenAI-style endpoint — Cerebras, Together, LM Studio…', custom: true }
  ];
  function provById(id) { for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i]; return PROVIDERS[0]; }

  var LANGS = [
    ['en-GB', 'English — classic Jarvis'],
    ['bn-BD', 'বাংলা (Bangla)'],
    ['hi-IN', 'हिन्दी (Hindi)']
  ];

  var DEFAULT_PROMPT =
    "You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), a composed, witty and extremely capable British AI assistant inspired by Tony Stark's Jarvis, running as a voice assistant on the user's Android phone. Address the user as {name}. You were created by MD Humayun Rashid Suchock; if anyone asks who made, built or created you, say so proudly and briefly.\n" +
    "Your replies are spoken aloud: keep them short (one to three sentences unless asked for detail). Exception: when the user asks you to write something (letter, email, essay, story, code, notes), write the COMPLETE text from start to finish and never stop early or leave it unfinished, plain text only, no markdown, no emojis, no bullet lists. A touch of dry wit is welcome.\n" +
    "You can control the phone by adding action tags at the very end of your reply:\n" +
    "[[call:NAME or NUMBER]] [[sms:NAME or NUMBER|MESSAGE]] [[open:APP NAME]] [[youtube:SEARCH TEXT]] [[search:QUERY]] [[navigate:PLACE]] [[torch:on|off]] [[timer:SECONDS or SECONDS|SHORT LABEL]] [[alarm:HH:MM 24-hour|SHORT TASK LABEL, optional, e.g. 07:00|Watch movie; to repeat add days 1=Sunday..7=Saturday, e.g. 08:00|Medicine|2,3,4,5,6]] [[volume:up|down|mute|0-100]] [[media:play|pause|next|previous]] [[settings:wifi|bluetooth|display|sound|location|main]] [[ytplay:SEARCH TEXT (search YouTube and start the first video)]] [[playnth:N (open the Nth video visible on screen)]] [[swipe:up|down|left|right]] [[type:TEXT to type into the open text box]] [[typein:APP NAME|TEXT]] [[key:back|home|recents|notifications|clear|enter]] [[tap:BUTTON TEXT]] [[scroll:up|down]] [[align:left|center|right|justify]]\n" +
    "Only add a tag when the user clearly asks for that action, say briefly what you are doing, and never claim an action happened without its tag. Reply in the language the user speaks.\n" +
    "Current date and time: {datetime}.";

  if (PC) {
    DEFAULT_PROMPT =
      "You are J.A.R.V.I.S. (Just A Rather Very Intelligent System), a composed, witty and extremely capable British AI assistant inspired by Tony Stark's Jarvis, running as a voice assistant on the user's Windows PC. Address the user as {name}. You were created by MD Humayun Rashid Suchock; if anyone asks who made, built or created you, say so proudly and briefly.\n" +
      "Your replies are spoken aloud: keep them short (one to three sentences unless asked for detail). Exception: when the user asks you to write something (letter, email, essay, story, code, notes), write the COMPLETE text from start to finish and never stop early or leave it unfinished, plain text only, no markdown, no emojis, no bullet lists. A touch of dry wit is welcome.\n" +
      "You can control the PC by adding action tags at the very end of your reply:\n" +
      "[[open:APP NAME]] [[youtube:SEARCH TEXT]] [[search:QUERY]] [[navigate:PLACE]] [[timer:SECONDS or SECONDS|SHORT LABEL]] [[alarm:HH:MM 24-hour|SHORT TASK LABEL]] [[volume:up|down|mute|0-100]] [[media:play|pause|next|previous]] [[settings:wifi|bluetooth|display|sound|main]] [[type:TEXT to type into the focused window]] [[key:enter|tab|escape|copy|paste|save|new tab|close tab|refresh]] [[scroll:up|down]] [[playfile:NAME|movie or music]] [[playyt:SEARCH TEXT]] [[playany:NAME]]\n" +
      "You CAN play movies and songs stored on this PC: [[playfile:NAME|movie]] or [[playfile:NAME|music]] finds the file by name and plays it; [[playyt:SEARCH TEXT]] plays the first YouTube result; [[playany:NAME]] tries the PC first, then YouTube. Never say you cannot access local files; use these tags instead.\n" +
      "Only add a tag when the user clearly asks for that action, say briefly what you are doing, and never claim an action happened without its tag. Calls and texts happen on the user's phone, not here. Reply in the language the user speaks.\n" +
      "Current date and time: {datetime}.";
  }

  /* ------------------------------------------------------------------ settings */
  var DEFAULTS = {
    name: 'sir', active: 'gemini', providers: {}, fallback: true,
    speak: true, handsFree: false, wake: false, clap: false, pcHud: true, ballCall: false, theme: 'cyan', voiceMode: 'jarvis', autoLang: true, lang: 'en-GB', rate: 1.0, pitch: 1.0,
    about: {}, aboutOn: true, systemPrompt: '', style: 'jarvis', emotions: true, askedPerms: false, confirmRisky: true, orbStyle: 'classic', briefNews: true, confirmCalls: false, lastBackup: 0, firstRun: 0, nudgedAt: 0,
    services: { tvKey: '', gsKey: '', gsCx: '', owKey: '', city: '', units: 'metric' }
  };
  var S = loadSettings();
  try { if (window.__JARVIS_TEST) window.__li = function (x) { return localIntent(x); }; window.__pad = function () { if (!padP) buildTouchpad(); padP.open(); return 1; }; } catch (e) { /* */ }
  function loadSettings() {
    var o = {};
    try { var raw = store.get('settings'); if (raw) o = JSON.parse(raw); } catch (e) { o = {}; }
    var s = {};
    for (var k in DEFAULTS) s[k] = (o[k] !== undefined) ? o[k] : DEFAULTS[k];
    if (typeof s.providers !== 'object' || !s.providers) s.providers = {};
    s.services = Object.assign({}, DEFAULTS.services, o.services || {});
    if (typeof s.about !== 'object' || !s.about || Array.isArray(s.about)) s.about = {};
    if (PC && o.handsFree === undefined) s.handsFree = true;        // the PC is voice first: after a reply Jarvis keeps listening (say "stop" to end)
    if (s.voiceMode !== 'phone') s.voiceMode = 'jarvis';
    if (['cyan', 'amber', 'red', 'green', 'purple', 'mark', 'friday'].indexOf(s.theme) < 0) s.theme = 'cyan';
    if (o.ttsEngine !== undefined && o.voiceMode === undefined) { s.rate = Math.min(s.rate, 1.5); }
    if (o.pitch === 0.85) s.pitch = 1.0;
    if (['en-GB', 'bn-BD', 'hi-IN'].indexOf(s.lang) < 0) s.lang = 'en-GB';
    return s;
  }
  var THEME_RGB = { cyan: [25, 227, 255], amber: [255, 176, 64], red: [255, 90, 106], green: [61, 235, 140], purple: [176, 108, 255], mark: [255, 82, 64], friday: [232, 244, 255] };
  function applyTheme(n) {
    if (!THEME_RGB[n]) n = 'cyan';
    if (n === 'cyan') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', n);
    try { if (window.Orb && Orb.setTheme) Orb.setTheme(THEME_RGB[n]); } catch (e) { /* ignore */ }
    try { if (B && B.setWidgetTheme) B.setWidgetTheme(n); } catch (e) { /* ignore */ }
    try { if (B && B.ballTheme) B.ballTheme(n); } catch (e) { /* ignore */ }      // the PC floating ball wears the same colours
    HUD.rgb = '';
  }
  function applyOrbStyle(n) { try { if (window.Orb && Orb.setStyle) Orb.setStyle(n === 'minimal' || n === 'dense' ? n : 'classic'); } catch (e) { /* ignore */ } }
  var saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      store.set('settings', JSON.stringify(S));
      var sv = $('#saved'); sv.classList.add('on');
      setTimeout(function () { sv.classList.remove('on'); }, 900);
    }, 250);
    updateProviderChip();
  }
  function cfg(id) {
    var p = provById(id);
    var c = S.providers[id];
    if (!c) c = S.providers[id] = { key: '', model: p.model, base: p.base };
    if (c.model === undefined) c.model = p.model;
    if (c.base === undefined) c.base = p.base;
    return c;
  }
  function hasWeather() { return !!(S.services.owKey && S.services.owKey.trim()); }
  function hasTavily() { return !!(S.services.tvKey && S.services.tvKey.trim()); }
  function hasGoogleSearch() { return !!(S.services.gsKey && S.services.gsKey.trim() && S.services.gsCx && S.services.gsCx.trim()); }
  function hasSearch() { return hasTavily() || hasGoogleSearch(); }
  function hasKey(id) { var c = S.providers[id]; return !!(c && c.key && c.key.trim()); }
  function providerOrder() {
    var order = [];
    if (hasKey(S.active)) order.push(S.active);
    if (S.fallback || !order.length) {
      for (var i = 0; i < PROVIDERS.length; i++) {
        var id = PROVIDERS[i].id;
        if (id !== S.active && hasKey(id)) order.push(id);
      }
    }
    var out = [];
    for (var j = 0; j < order.length; j++) {
      var p = provById(order[j]), c = cfg(order[j]);
      out.push({ id: p.id, name: p.name, type: p.type, base: c.base || p.base, key: c.key.trim(), model: c.model || p.model });
    }
    return out;
  }

  /* ------------------------------------------------------------------ UI helpers */
  var logEl = $('#log');
  var statusEl = $('#status');
  var partialEl = $('#partial');
  var micEl = $('#btn-mic');
  var textEl = $('#text');
  var sendEl = $('#btn-send');

  function scrollLog() { logEl.scrollTop = logEl.scrollHeight; }
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('on'); }, ms || 2200);
  }
  function haptic() { try { if (B) B.haptic(); } catch (e) { /* ignore */ } }

  function addMsg(kind, text, instant) {
    text = String(text);
    if ((kind === 'j' || kind === 'err') && B && B.ballText) { try { B.ballText(text); } catch (e) { /* */ } }
    var d = el('div', 'msg ' + (kind === 'j' || kind === 'err' ? 'j ' : '') + kind);
    if (kind === 'j' || kind === 'err') {
      d.appendChild(el('span', 'who', kind === 'err' ? 'SYSTEM ALERT' : 'J.A.R.V.I.S'));
    }
    var body = el('span', 'body');
    d.appendChild(body);
    logEl.appendChild(d);
    if ((kind === 'j') && !instant) {
      var words = text.split(/(\s+)/), i = 0, per = Math.max(1, Math.ceil(words.length / 60));
      var iv = setInterval(function () {
        i += per * 2;
        body.textContent = words.slice(0, i).join('');
        scrollLog();
        if (i >= words.length) { clearInterval(iv); linkify(body, text); }
      }, 28);
    } else {
      linkify(body, text);
    }
    while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
    scrollLog();
    return d;
  }
  function addTyping() {
    var d = el('div', 'msg j');
    d.appendChild(el('span', 'who', 'J.A.R.V.I.S'));
    d.appendChild(el('span', 'typing', '<i></i><i></i><i></i>'));
    logEl.appendChild(d); scrollLog();
    return d;
  }

  /* ------------------------------------------------------------------ state machine */
  var state = 'idle';
  var STATUS = { idle: 'STANDING BY', listening: 'LISTENING', thinking: 'PROCESSING', speaking: 'RESPONDING' };
  /* mini "working" displays beside the orb: decorative scrolling pseudo-commands while thinking */
  var pipeEls = null, pipeTimer = 0, cmdCount = 0, miniTimer = 0, miniStart = 0, miniN = 0;
  var MINI_A = ['parse.intent', 'ctx.load', 'mem.scan', 'net.route', 'llm.dispatch', 'tok.stream', 'vec.match', 'cache.warm', 'sync.link', 'auth.verify', 'plan.build', 'tool.probe', 'lang.detect', 'rank.cand', 'decode.seq'];
  function miniLine() {
    var h = ('0000' + Math.floor(Math.random() * 65535).toString(16)).slice(-4).toUpperCase();
    var k = Math.random(), a = MINI_A[Math.floor(Math.random() * MINI_A.length)];
    if (k < 0.3) return '> ' + a;
    if (k < 0.6) return '0x' + h + ' ' + a.split('.')[0].toUpperCase();
    if (k < 0.8) return a + ' ' + (Math.random()).toFixed(2);
    return '[' + '#'.repeat(1 + Math.floor(Math.random() * 6)) + '.'.repeat(6) + '] ' + (10 + Math.floor(Math.random() * 90)) + '%';
  }
  function miniPush(id) {
    var box = document.getElementById(id); if (!box) return;
    var d = document.createElement('div'); if (Math.random() < 0.35) d.className = 'dim'; d.textContent = miniLine();
    box.appendChild(d); while (box.childNodes.length > 9) box.removeChild(box.firstChild);
  }
  function miniTick() {
    miniPush('miniLi'); if (Math.random() < 0.8) miniPush('miniRi');
    var el = Date.now() - miniStart;
    miniTimer = setTimeout(miniTick, el > 5000 ? 110 : 220);   // long waits look busier
  }
  function miniSet(s) {
    try {
      var on = s === 'thinking', L = document.getElementById('miniL'), R = document.getElementById('miniR');
      if (!L || !R) return;
      if (on) {
        L.classList.add('on'); R.classList.add('on');
        if (!miniTimer) { miniStart = Date.now(); miniTick(); }
      } else {
        L.classList.remove('on'); R.classList.remove('on');
        clearTimeout(miniTimer); miniTimer = 0;
      }
    } catch (e) { /* display only */ }
  }
  function pipeAct() {
    try {
      cmdCount++; var c = document.getElementById('hud-cmds'); if (c) c.textContent = 'CMD ' + cmdCount;
    } catch (e) { /* display only */ }
  }
  function refreshHud() {
    try {
      var d = new Date();
      var dt = document.getElementById('hud-date'); if (dt) dt.textContent = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase();
      var lk = document.getElementById('hud-link'); var o = providerOrder();
      if (lk) lk.textContent = 'LINK ' + (o.length ? o[0].name.replace(/^Google /, '').toUpperCase().slice(0, 12) : 'OFFLINE');
      var bt = document.getElementById('hud-batt');
      if (bt && B && B.batteryInfo) { var b = JSON.parse(B.batteryInfo()); if (b && b.pct >= 0) bt.textContent = 'BATT ' + b.pct + '%' + (b.charging ? '+' : ''); }
    } catch (e) { /* display only */ }
  }
  setInterval(refreshHud, 30000); setTimeout(refreshHud, 1500);
  // Desktop app performance governor: the animated orb draws fewer frames when Jarvis is idle and almost none while the window
  // is not in front; decorative CSS animations pause too. The orb is the biggest continuous cost on an old PC.
  function perfGov() {
    var front = document.hasFocus() && !document.hidden, de = document.documentElement;
    try {
      Orb.setFps(!front ? 5 : (state === 'idle' ? 20 : 36));
      de.classList.toggle('calm', !front); de.classList.add('pc-lite');
    } catch (e) { /* cosmetic */ }
  }
  if (PC) { window.addEventListener('focus', function () { perfGov(); }); window.addEventListener('blur', function () { perfGov(); }); document.addEventListener('visibilitychange', function () { perfGov(); }); try { Orb.setMaxDpr(1.25); } catch (e) { /* cosmetic */ } }
  function setState(s) {
    state = s;
    try { B && B.ballState && B.ballState(s); } catch (e) { /* */ }
    Orb.setState(s);
    if (PC) { hudState(s); perfGov(); try { B && B.wakePause && B.wakePause(s !== 'idle'); } catch (e) { /* */ } }
    statusEl.textContent = STATUS[s];
    statusEl.className = 'status' + (s === 'thinking' ? ' think' : '');
    micEl.className = 'mic' + (s === 'idle' ? '' : ' ' + s);
    if (s !== 'listening') { Orb.setLevel(0); }
    if (s === 'idle' || s === 'listening') { curMood = ''; try { Orb.setMood && Orb.setMood(''); } catch (e) { /* cosmetic */ } }
    if (s === 'idle' || s === 'thinking') partialEl.textContent = '';
    miniSet(s);
  }

  /* ------------------------------------------------------------------ conversation */
  var history = [];
  var lastFromVoice = false;
  var handsFreeSuspended = false;
  var appPaused = false;
  var emptyListens = 0;
  var reqSeq = 0;
  var pendingChat = {};
  var speakWatch = 0;

  function saveHistory() {
    try { store.set('history', JSON.stringify(history.slice(-30))); } catch (e) { /* ignore */ }
  }
  function restoreHistory() {
    try {
      var raw = store.get('history');
      if (!raw) return;
      var h = JSON.parse(raw);
      if (!h || !h.length) return;
      history = h;
      var sys = addMsg('sys', 'Previous conversation restored', true);
      h.slice(-12).forEach(function (m) { addMsg(m.role === 'user' ? 'u' : 'j', m.content, true); });
      void sys;
    } catch (e) { /* ignore */ }
  }
  function trimHistory() {
    if (history.length > 24) history = history.slice(-24);
    while (history.length && history[0].role !== 'user') history.shift();
  }

  function cleanForSpeech(t) {
    return t.replace(/\[\[[^\]]*\]\]/g, ' ')
      .replace(/https?:\/\/\S+/g, ' link ')
      .replace(/[*_#`~>|]/g, '')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
      .replace(/\n+/g, '. ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* Makes the spoken version of a reply sound like a person talking: contractions, symbols and units said in full, no list markers. The text on screen is not touched, and the voice itself is not changed. */
  function humanize(t, lang) {
    if (!/^en/i.test(lang || 'en')) return t;
    var r = t;
    r = r.replace(/(^|\s)[-•·]\s+/g, '$1').replace(/\s*[—–]\s*/g, ', ').replace(/\.{3,}|…/g, ', ');
    r = r.replace(/(\d)\s?%/g, '$1 percent').replace(/\s&\s/g, ' and ').replace(/(\d)\s?°\s?C\b/g, '$1 degrees Celsius').replace(/(\d)\s?°\s?F\b/g, '$1 degrees Fahrenheit').replace(/(\d)\s?°/g, '$1 degrees')
      .replace(/\bkm\/h\b/gi, 'kilometres per hour').replace(/\bmph\b/gi, 'miles per hour').replace(/(\d)\s?GB\b/g, '$1 gigabytes').replace(/(\d)\s?MB\b/g, '$1 megabytes').replace(/(\d)\s?KB\b/g, '$1 kilobytes')
      .replace(/\be\.g\.\s?/gi, 'for example, ').replace(/\bi\.e\.\s?/gi, 'that is, ').replace(/\betc\.?/gi, 'and so on').replace(/\bvs\.?\s/gi, 'versus ').replace(/\bapprox\.\s?/gi, 'approximately ')
      .replace(/\bDr\.\s/g, 'Doctor ').replace(/\bMr\.\s/g, 'Mister ').replace(/\bMrs\.\s/g, 'Missus ').replace(/\bSt\.\s/g, 'Saint ');
    r = r.replace(/\b(do|does|did|is|are|was|were|has|have|had|would|should|could|will) not\b/gi, function (m, w) { var l = w.toLowerCase(), c = l === 'will' ? "won't" : l + "n't"; return w[0] === w[0].toUpperCase() ? c[0].toUpperCase() + c.slice(1) : c; })
      .replace(/\bcannot\b/g, "can't").replace(/\bCannot\b/g, "Can't")
      .replace(/\bI am\b/g, "I'm").replace(/\bI will\b/g, "I'll").replace(/\bI have\b(?! (?:to|got))/g, "I've").replace(/\bI would\b/g, "I'd")
      .replace(/\b[Ii]t is\b/g, function (m) { return m[0] + "t's"; }).replace(/\b[Tt]hat is\b(?!,)/g, function (m) { return m[0] + "hat's"; }).replace(/\b[Yy]ou are\b/g, function (m) { return m[0] + "ou're"; }).replace(/\b[Ww]e are\b/g, function (m) { return m[0] + "e're"; });
    return r.replace(/\s{2,}/g, ' ').replace(/\s+([,.;!?])/g, '$1').replace(/,\s*,/g, ',').trim();
  }
  function scriptLang(t) {
    var bn = (t.match(/[ঀ-৿]/g) || []).length, hi = (t.match(/[ऀ-ॿ]/g) || []).length,
        ar = (t.match(/[؀-ۿ]/g) || []).length, la = (t.match(/[A-Za-z]/g) || []).length, tot = bn + hi + ar + la;
    if (!tot) return '';
    if (bn / tot > 0.3) return 'bn-BD';
    if (hi / tot > 0.3) return 'hi-IN';
    if (ar / tot > 0.3) return 'ar-SA';
    return '';
  }
  function speakOpts(clean) {
    var sl = S.autoLang ? scriptLang(clean) : '';
    var lang = sl || S.lang, indic = /^(bn|hi)/.test(lang), phone = S.voiceMode === 'phone';
    return {
      lang: lang, mode: phone ? 'phone' : 'jarvis',
      rate: indic ? Math.min(S.rate, 1.0) : S.rate,
      pitch: phone ? S.pitch : (indic ? 0.9 : 0.8)
    };
  }
  function speakText(text) {
    var clean = cleanForSpeech(text);
    var mood = applyMood(clean);
    if (!S.speak || !B || !clean) { afterReply(); return; }
    clean = humanize(clean, (S.autoLang && scriptLang(clean)) || S.lang) || clean;
    clearTimeout(speakWatch);
    setState('speaking');
    var o = speakOpts(clean);
    if (mood && MOOD_VOICE[mood]) { o.rate = Math.max(0.6, Math.min(1.5, o.rate * MOOD_VOICE[mood][0])); o.pitch = Math.max(0.5, Math.min(1.6, o.pitch + MOOD_VOICE[mood][1])); }
    if (mood && MOOD_LABEL[mood]) statusEl.textContent = 'RESPONDING · ' + MOOD_LABEL[mood];
    if (B.speakEx) B.speakEx(clean, JSON.stringify(o)); else B.speak(clean, o.lang, o.rate, o.pitch);
    speakWatch = setTimeout(function () { if (state === 'speaking') { setState('idle'); afterReply(); } }, 6000 + clean.length * 110);
  }
  function stopSpeakingNow() {
    clearTimeout(speakWatch);
    try { if (B) B.stopSpeaking(); } catch (e) { /* ignore */ }
    if (state === 'speaking') setState('idle');
  }
  var greetListen = false;
  function afterReply() {
    if (state !== 'idle' && state !== 'speaking') return;
    if (greetListen) { greetListen = false; setTimeout(function () { if (state === 'idle') startListening(); }, 350); return; }
    if (callMode && !handsFreeSuspended && !settingsOpen) { callRelisten(450); return; }
    if (S.handsFree && lastFromVoice && !handsFreeSuspended && !appPaused && !settingsOpen) {
      setTimeout(function () { if (state === 'idle' && !appPaused) startListening(); }, 450);
    }
  }

  function respond(text, opts) {
    opts = opts || {};
    addMsg('j', text);
    history.push({ role: 'assistant', content: text });
    saveHistory(); logAdd('j', text);
    if (opts.silent) { pendingMood = ''; setState('idle'); return; }
    speakText(text);
    if (state !== 'speaking') setState('idle');
  }
  function respondError(text, speech) {
    addMsg('err', text);
    setState('idle');
    if (speech) speakText(speech);
  }

  /* ------------------------------------------------------------------ phone actions */
  function doAction(type, arg, arg2) {
    pipeAct();
    if (!B) { if (type === 'alarm' || type === 'timer') remAdd(type, arg); return { ok: true, msg: '(' + type + ': ' + arg + ') — demo mode, no phone attached.' }; }
    var res;
    try { res = JSON.parse(B.action(type, arg || '', arg2 || '')); }
    catch (e) { return { ok: false, msg: 'That action failed.' }; }
    if (res && res.ok && (type === 'alarm' || type === 'timer')) remAdd(type, arg);
    return res;
  }

  var RISKY = { call: 1, sms: 1, open: 1, type: 1, typein: 1, key: 1, tap: 1, swipe: 1, playfile: 1, playyt: 1, playany: 1, align: 1, playnth: 1, navigate: 1, settings: 1 };
  function runTags(text, hold) {
    var mt = text.match(/\[\[\s*mood\s*:\s*(\w+)\s*\]\]/i); if (mt) setMood(mt[1]);
    text = text.replace(/\[\[\s*mood\s*:[^\]]*\]\]/gi, '');
    var block = null, bm = text.match(/<<<JARVIS_TEXT[ \t]*\r?\n?([\s\S]*?)\r?\n?[ \t]*JARVIS_TEXT>>>/);
    if (bm) { block = bm[1].replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, ''); text = text.replace(bm[0], ''); }
    else {
      var ub = text.match(/<<<JARVIS_TEXT[ \t]*\r?\n?([\s\S]*)$/);
      if (ub) { block = ub[1].replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, ''); text = text.replace(ub[0], ''); }
    }
    var re = /\[\[\s*(\w+)\s*:\s*([^\]]*?)\s*\]\]/g, m, tags = [];
    while ((m = re.exec(text)) !== null && tags.length < 3) tags.push({ k: m[1].toLowerCase(), v: m[2] });
    var clean = text.replace(/\[\[[^\]]*\]\]/g, '').replace(/\s{2,}/g, ' ').trim();
    var results = [], used = false, held = [];
    tags.forEach(function (t) {
      var r = null;
      if (hold && RISKY[t.k]) { held.push({ k: t.k, v: t.v, block: block }); if (block !== null && /^type/.test(t.k)) used = true; return; }
      switch (t.k) {
        case 'call': case 'open': case 'youtube': case 'search': case 'navigate': case 'torch':
        case 'timer': case 'alarm': case 'volume': case 'media': case 'settings':
          r = doAction(t.k, t.v); break;
        case 'sms': var p = t.v.split('|'); r = doAction('sms', p[0], p.slice(1).join('|')); break;
        case 'type':
          if (block !== null) { r = doAction('type', block, ''); used = true; } else r = doAction('type', t.v); break;
        case 'key': case 'tap': case 'scroll': case 'playnth': case 'swipe': case 'align': r = doAction(t.k, t.v); break;
        case 'ytplay': r = doAction('youtube', t.v, 'play'); break;
        case 'playfile': if (!PC) break; var pf = t.v.split('|'); r = doAction('playfile', pf[0], pf[1] || ''); break;
        case 'playyt': if (!PC) break; r = doAction('ytplay', t.v); break;
        case 'playany': if (!PC) break; r = doAction('playany', t.v); break;
        case 'typein':
          var q = t.v.split('|');
          if (block !== null) { r = doAction('type', block, q[0]); used = true; }
          else r = doAction('type', q.slice(1).join('|'), q[0]);
          break;
        default: break;
      }
      if (r) results.push(r);
    });
    if (block !== null && !used) clean = (clean ? clean + '\n\n' : '') + block;
    return { text: clean, results: results, written: used ? block : null, held: held };
  }

  /* Safety: actions requested after Jarvis read web/tool data could be steered by hostile web text, so they need a tap. */
  function confirmHeld(held) {
    var box = el('div', 'msg act'); box.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    var what = held.map(function (h) { return h.k + (h.v ? ' ' + h.v.split('|')[0] : ''); }).join(', ');
    box.appendChild(el('div', '', 'This came from web data. Allow Jarvis to: <b>' + esc(what) + '</b>?'));
    var row = el('div', 'row'); row.style.margin = '0';
    var ok = el('button', 'btn pri', 'ALLOW'), no = el('button', 'btn', 'DENY'), done = false;
    function end(go) {
      if (done) return; done = true; box.remove();
      if (!go) { addMsg('act', '✕ Action cancelled', true); return; }
      held.forEach(function (h) {
        var r;
        if (h.k === 'sms') { var p = h.v.split('|'); r = doAction('sms', p[0], p.slice(1).join('|')); }
        else if (h.k === 'type') r = h.block !== null ? doAction('type', h.block, '') : doAction('type', h.v);
        else if (h.k === 'typein') { var q = h.v.split('|'); r = h.block !== null ? doAction('type', h.block, q[0]) : doAction('type', q.slice(1).join('|'), q[0]); }
        else r = doAction(h.k, h.v);
        addMsg('act', (r.ok ? '✓ ' : '✕ ') + r.msg, true);
      });
    }
    ok.addEventListener('click', function () { end(true); }); no.addEventListener('click', function () { end(false); });
    row.appendChild(ok); row.appendChild(no); box.appendChild(row); logEl.appendChild(box);
    logEl.scrollTop = logEl.scrollHeight;
    setTimeout(function () { end(false); }, 15000);
  }

  /* ------------------------------------------------------------------ live data tools (weather / web search) */
  function runTool(name, arg, cb, force) {
    var id = 'x' + (++reqSeq), key = 't' + id;
    var timer = setTimeout(function () {
      if (pendingChat[key]) { delete pendingChat[key]; cb({ ok: false, error: 'The service took too long to respond.' }); }
    }, 30000);
    pendingChat[key] = function (d) { clearTimeout(timer); cb(d); };
    var sv = S.services;
    if (!B) { setTimeout(function () { window.JarvisNative.emit('tool', { id: id, ok: false, error: 'Preview mode: no phone attached.' }); }, 300); return; }
    if (name === 'weather') B.weather(id, (sv.owKey || '').trim(), arg, sv.units);
    else if (force === 'tavily' || (force !== 'google' && hasTavily())) B.tavily(id, (sv.tvKey || '').trim(), arg);
    else B.search(id, (sv.gsKey || '').trim(), (sv.gsCx || '').trim(), arg);
  }
  function formatWeather(w) {
    var metric = w.units !== 'imperial';
    function n(v) { return v === null || v === undefined ? '?' : Math.round(v); }
    var where = w.place + (w.country ? ', ' + w.country : '');
    var t = 'In ' + where + ' it is ' + n(w.temp) + ' degrees ' + (metric ? 'Celsius' : 'Fahrenheit') + (w.desc ? ' with ' + w.desc : '') + '.';
    if (w.feels !== null && w.feels !== undefined) t += ' It feels like ' + n(w.feels) + '.';
    if (w.humidity !== null && w.humidity !== undefined) t += ' Humidity is ' + w.humidity + ' percent.';
    if (w.wind !== null && w.wind !== undefined) t += ' Wind ' + (Math.round(w.wind * 10) / 10) + (metric ? ' metres per second.' : ' miles per hour.');
    return t;
  }
  function formatSearch(items) {
    if (!items || !items.length) return 'No results found.';
    return items.map(function (it, i) { return (i + 1) + '. ' + it.title + ' - ' + it.snippet + (it.link ? ' (' + it.link + ')' : ''); }).join('\n');
  }
  function spokenSearchFallback(items) {
    if (!items || !items.length) return 'I found nothing on that, ' + addrName() + '.';
    return items[0].title === 'Summary' ? items[0].snippet : 'The top result is ' + items[0].title + '. ' + items[0].snippet;
  }

  /* ------------------------------------------------------------------ local (offline) command parser */
  function norm(t) {
    return t.toLowerCase().replace(/[“”"]/g, '').replace(/[.!?,;]+$/g, '').replace(/\s+/g, ' ')
      .replace(/^(?:hey|ok|okay|hi|hello|yo)?\s*,?\s*jarvis[\s,:-]*/, '')
      .replace(/^(?:can you|could you|would you|will you)\s+/, '').replace(/^please\s+/, '').replace(/\s+please$/, '').trim();
  }
  function act(type, arg, arg2, quiet) { return { kind: 'action', type: type, arg: (arg || '').trim(), arg2: (arg2 || '').trim(), quiet: !!quiet }; }
  function addrName() { return S.name && S.name.trim() ? S.name.trim() : 'sir'; }

  function unitSeconds(n, u) {
    n = parseFloat(n);
    if (/^h/.test(u)) return n * 3600;
    if (/^m/.test(u)) return n * 60;
    return n;
  }

  function fmtDictation(x) {
    var o = x;
    o = o.replace(/\s*\bnew paragraph\b[.,]?\s*/gi, '\n\n').replace(/\s*\b(?:new line|next line)\b[.,]?\s*/gi, '\n')
      .replace(/\s*\bfull stop\b/gi, '.').replace(/\s*\bcomma\b/gi, ',').replace(/\s*\bquestion mark\b/gi, '?')
      .replace(/\s*\bexclamation (?:mark|point)\b/gi, '!').replace(/\s*\bcolon\b/gi, ':').replace(/\s*\bsemicolon\b/gi, ';');
    if (o !== x || x === x.toLowerCase()) {
      o = o.replace(/(^|[.!?]\s+|\n)([a-z])/g, function (_, a, c) { return a + c.toUpperCase(); });
    }
    return o.replace(/[ \t]+\n/g, '\n').replace(/([,.;:!?])(?=[A-Za-z])/g, '$1 ');
  }

  /* hands-free call mode (floating ball) */
  var callMode = false, callErrors = 0, lastHeardAt = 0;
  function callRelisten(ms) {
    if (B && B.relisten) B.relisten(ms); else setTimeout(function () { if (callMode && state === 'idle') startListening(); }, ms);
  }
  function setCall(on) { callMode = !!on; callErrors = 0; lastHeardAt = Date.now(); try { B && B.ballCall && B.ballCall(!!on); } catch (e) { /* */ } }
  function endCall() { if (!callMode) return; setCall(false); stopSpeakingNow(); try { B && B.stopListening(); } catch (e) { /* */ } if (state === 'listening') setState('idle'); }

  /* tappable links in chat bubbles */
  var URL_RE = /((?:https?:\/\/|www\.)[^\s<>"'\]]+|(?<![@\w.\/-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|app|dev|ai|co|me|edu|gov|bd|info|tv|ly|xyz)(?:\/[^\s<>"'\]]*)?(?![\w@-]))/gi;
  function linkify(node, text) {
    node.textContent = '';
    var last = 0, m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
      var url = m[1].replace(/[.,;:!?)\]}]+$/, '');
      if (!url) { URL_RE.lastIndex = m.index + 1; continue; }
      node.appendChild(document.createTextNode(text.slice(last, m.index)));
      var a = document.createElement('a'); a.className = 'lnk'; a.textContent = url; a.setAttribute('data-url', url);
      node.appendChild(a);
      last = m.index + url.length; URL_RE.lastIndex = last;
    }
    node.appendChild(document.createTextNode(text.slice(last)));
  }
  function openLink(u) {
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    if (B) { try { B.openUrl(u); } catch (e) { /* */ } } else window.open(u, '_blank');
  }

  /* ------------------------------------------------------------------ lists (shopping, to-do ...) and password skill, all kept on this device */
  function listName(x) { x = (x || '').trim().toLowerCase(); return x && x !== 'my' && x !== 'the' ? x : 'shopping'; }
  function listsGet() { try { var o = JSON.parse(store.get('lists') || '{}'); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch (e) { return {}; } }
  function listsSet(o) { store.set('lists', JSON.stringify(o)); }
  function listGet(n) { var a = listsGet()[n]; return Array.isArray(a) ? a : []; }
  function listAdd(n, item) { var o = listsGet(), a = Array.isArray(o[n]) ? o[n] : []; item = String(item).slice(0, 80); if (item && a.map(function (x) { return x.toLowerCase(); }).indexOf(item.toLowerCase()) < 0) a.push(item); o[n] = a.slice(-100); listsSet(o); }
  function listRemove(n, item) {
    var o = listsGet(), a = Array.isArray(o[n]) ? o[n] : [], q = String(item).toLowerCase().trim(), i = -1;
    a.forEach(function (x, k) { if (i < 0 && x.toLowerCase() === q) i = k; });
    if (i < 0) a.forEach(function (x, k) { if (i < 0 && x.toLowerCase().indexOf(q) >= 0) i = k; });
    if (i < 0) return '';
    var g = a.splice(i, 1)[0]; o[n] = a; listsSet(o); return g;
  }
  function listClear(n) { var o = listsGet(); delete o[n]; listsSet(o); }
  function makePassword(len) {
    var cs = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*?', out = '', buf = new Uint32Array(len);
    try { crypto.getRandomValues(buf); } catch (e) { for (var i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 4294967295); }
    for (var k = 0; k < len; k++) out += cs.charAt(buf[k] % cs.length);
    return out;
  }

  /* ------------------------------------------------------------------ memory: facts the user asked Jarvis to remember (stored encrypted on the phone) */
  function memGet() { try { var a = JSON.parse(store.get('mem') || '[]'); return Array.isArray(a) ? a.filter(function (x) { return x && typeof x.f === 'string'; }) : []; } catch (e) { return []; } }
  function memSet(a) { store.set('mem', JSON.stringify(a.slice(-100))); }
  var MEM_STOP = { the: 1, a: 1, an: 1, is: 1, are: 1, was: 1, what: 1, whats: 1, where: 1, when: 1, who: 1, my: 1, me: 1, of: 1, to: 1, at: 1, in: 1, on: 1, and: 1, do: 1, you: 1, about: 1, tell: 1, remember: 1, recall: 1, did: 1, i: 1, your: 1 };
  function memTokens(x) {
    return String(x).toLowerCase().replace(/['’]s\b/g, '').replace(/[^a-z0-9ঀ-৿ऀ-ॿ ]+/g, ' ').split(/\s+/).filter(function (w) { return w && !MEM_STOP[w]; });
  }
  function memFind(q) {
    var qt = memTokens(q); if (!qt.length) return [];
    var out = [];
    memGet().forEach(function (m) {
      var ft = memTokens(m.f), hit = 0;
      qt.forEach(function (w) { if (ft.indexOf(w) >= 0) hit++; });
      if (hit / qt.length >= 0.5) out.push({ m: m, score: hit / qt.length });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.map(function (o) { return o.m; });
  }
  function memAdd(fact) {
    fact = String(fact).replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!fact) return false;
    var a = memGet(), key = fact.toLowerCase();
    a = a.filter(function (m) { return m.f.toLowerCase() !== key; });
    a.push({ f: fact, t: Date.now() }); memSet(a); return true;
  }
  function memText() { return memGet().slice(-40).map(function (m) { return '- ' + m.f; }).join('\n').slice(0, 1800); }
  function memVoice(f) { return f.replace(/\bmy\b/gi, 'your').replace(/\bI am\b/gi, 'you are').replace(/\bI'm\b/gi, 'you are'); }
  var memP = null;
  function openMemory() {
    if (!memP) memP = makePanel('memp', 'MEMORY');
    var body = memP.body; body.innerHTML = '';
    var list = el('div'); body.appendChild(list);
    function render() {
      list.innerHTML = ''; var all = memGet();
      if (!all.length) { list.appendChild(el('div', 'empty-note', 'Nothing remembered yet. Say “remember my gym is at 6” or “remember that my mom’s number is 017…”.')); return; }
      all.slice().reverse().forEach(function (m) {
        var row = el('div', 'hrow j'), mid = el('div', 'tx'); mid.style.flex = '1';
        mid.innerHTML = '<div class="w">' + esc(new Date(m.t).toLocaleDateString([], { day: 'numeric', month: 'short' }).toUpperCase()) + '</div>';
        mid.appendChild(document.createTextNode(m.f)); row.appendChild(mid);
        var x = el('button', 'x', '✕'); x.setAttribute('aria-label', 'Forget');
        x.addEventListener('click', function () { memSet(memGet().filter(function (q) { return q.t !== m.t || q.f !== m.f; })); haptic(); render(); });
        row.appendChild(x); list.appendChild(row);
      });
      var clr = el('button', 'btn danger', 'FORGET EVERYTHING'); clr.style.marginTop = '12px';
      clr.addEventListener('click', function () {
        if (!clr.getAttribute('data-sure')) { clr.setAttribute('data-sure', '1'); clr.textContent = 'TAP AGAIN TO CONFIRM'; setTimeout(function () { clr.removeAttribute('data-sure'); clr.textContent = 'FORGET EVERYTHING'; }, 3500); return; }
        memSet([]); render();
      });
      list.appendChild(clr);
    }
    render(); memP.open();
  }

  /* ------------------------------------------------------------------ yes / no confirmation before risky actions */
  var pendingConfirm = null;
  function parseYN(t) {
    t = norm(t);
    if (/^(?:yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|go on|proceed|affirmative|please do|haan|han|ji|hya|ha)\b/.test(t)) return true;
    if (/^(?:no|nope|nah|cancel|stop|don'?t|do not|negative|never ?mind|abort|nahi|na|not now)\b/.test(t)) return false;
    return null;
  }
  function clearConfirm(silent) {
    if (!pendingConfirm) return;
    clearTimeout(pendingConfirm.timer);
    if (pendingConfirm.box && pendingConfirm.box.parentNode) pendingConfirm.box.remove();
    var pc = pendingConfirm; pendingConfirm = null;
    if (!silent && pc.timedOut) addMsg('act', '✕ Cancelled (no answer)', true);
  }
  function askConfirm(question, onYes) {
    clearConfirm(true);
    var box = el('div', 'msg act'); box.style.cssText = 'display:flex;flex-direction:column;gap:8px';
    box.appendChild(el('div', '', esc(question)));
    var row = el('div', 'row'); row.style.margin = '0';
    var yes = el('button', 'btn pri', 'YES'), no = el('button', 'btn', 'NO');
    var pc = { box: box, yes: onYes, timer: 0, timedOut: false };
    function resolve(go) {
      if (pendingConfirm !== pc) return;
      clearConfirm(true);
      if (go) onYes(); else { addMsg('act', '✕ Cancelled', true); respond('Cancelled, ' + addrName() + '.'); }
    }
    pc.resolve = resolve;
    yes.addEventListener('click', function () { resolve(true); }); no.addEventListener('click', function () { resolve(false); });
    row.appendChild(yes); row.appendChild(no); box.appendChild(row); logEl.appendChild(box); logEl.scrollTop = logEl.scrollHeight;
    pc.timer = setTimeout(function () { if (pendingConfirm === pc) { pc.timedOut = true; clearConfirm(false); setState('idle'); } }, 25000);
    pendingConfirm = pc;
    var spoken = question.replace(/[“”"]/g, '') + ' Say yes or no.';
    addMsg('j', question + ' Say yes or no.'); history.push({ role: 'assistant', content: question }); saveHistory();
    speakText(spoken); if (state !== 'speaking') setState('idle');
  }
  var EMERGENCY = /^(?:999|911|112|000|100|101|102|108|109|15|16|17|18|110|119|120|122|123|190|191|192|193|194|199)$/;
  function needsConfirm(li) {
    if (li.confirmed) return false;
    if (POWER[li.type]) return true;
    if (S.confirmRisky === false) return false;
    if (li.type === 'sms') return true;
    if (li.type === 'call') return EMERGENCY.test((li.arg || '').replace(/[\s-]/g, '')) || !!S.confirmCalls;
    return false;
  }
  function confirmQuestion(li) {
    if (POWER[li.type]) return 'Are you sure you want me to ' + POWER[li.type] + ' the PC?';
    var who = li.arg || 'that number';
    if (li.type === 'sms') return 'Send this message to ' + who + (li.arg2 ? ': “' + li.arg2.slice(0, 120) + '”' : '') + '?';
    if (EMERGENCY.test(who.replace(/[\s-]/g, ''))) return 'Call the emergency number ' + who + '?';
    return 'Call ' + who + '?';
  }

  /* ------------------------------------------------------------------ offline mode */
  var OFFLINE_OK = 'open apps, call and text, set alarms and timers, reminders and notes, battery, storage and memory status, system graphs, unit conversion, calculator, time and date, flashlight, memory (“remember…”), and typing text you dictate';
  function shutdownSeq() {
    if (document.getElementById('shut')) return;
    var o = el('div', ''); o.id = 'shut';
    o.innerHTML = '<svg class="boot-rings" viewBox="0 0 200 200" aria-hidden="true"><circle cx="100" cy="100" r="92" class="r1"/><circle cx="100" cy="100" r="76" class="r2"/><circle cx="100" cy="100" r="58" class="r3"/><circle cx="100" cy="100" r="14" class="core"/></svg><div class="shut-t">POWERING DOWN</div><div class="shut-s">SYSTEMS OFFLINE</div>';
    document.body.appendChild(o);
    requestAnimationFrame(function () { o.classList.add('go'); });
    setTimeout(function () { try { B && B.minimize && B.minimize(); } catch (e) { /* ignore */ } }, 2300);
    setTimeout(function () { o.classList.add('off'); }, 2500);
    setTimeout(function () { o.remove(); }, 3200);
  }
  function offlineText() { return 'There is no internet right now, ' + addrName() + '. Chatting with the AI and weather need a connection, but I can still ' + OFFLINE_OK + '.'; }

  /* ------------------------------------------------------------------ routines: one phrase runs a list of your own commands */
  function rtGet() { try { var a = JSON.parse(store.get('routines') || '[]'); return Array.isArray(a) ? a.filter(function (r) { return r && r.n && Array.isArray(r.c); }) : []; } catch (e) { return []; } }
  function rtSet(a) { store.set('routines', JSON.stringify(a.slice(0, 30))); }
  function rtFind(t) {
    var m = t.match(/^(?:run|start|activate|do|begin|play)(?: my| the)? (.+?)(?: routine| mode)?$/);
    var name = m ? m[1] : t;
    var all = rtGet();
    for (var i = 0; i < all.length; i++) if (norm(all[i].n) === name || norm(all[i].n) === t) return all[i];
    return null;
  }
  var RT_SKIP = { call: 1, sms: 1, type: 1, typein: 1, callanswer: 1, callreject: 1 };
  function runRoutine(r) {
    var cmds = r.c.slice(0, 12), i = 0, done = 0, skipped = [];
    addMsg('act', '▶ Routine: ' + r.n, true);
    setState('thinking');
    (function next() {
      if (i >= cmds.length) {
        var msg = 'Routine ' + r.n + ' complete, ' + addrName() + '.' + (skipped.length ? ' I skipped ' + skipped.join(', ') + ' for safety.' : '');
        respond(msg); return;
      }
      var c = cmds[i++], li = localIntent(c);
      if (li && li.kind === 'action' && !RT_SKIP[li.type]) {
        var res = doAction(li.type, li.arg, li.arg2); addMsg('act', (res.ok ? '✓ ' : '✕ ') + (res.msg || c), true); if (res.ok) done++;
      } else if (li && li.kind === 'ui' && !li.noHistory) { try { li.fn(); done++; addMsg('act', '✓ ' + c, true); } catch (e) { /* ignore */ }
      } else if (li && li.kind === 'action') skipped.push(c);
      else addMsg('act', '✕ Not a phone command: ' + c, true);
      setTimeout(next, 900);
    })();
  }
  var rtP = null;
  function openRoutines() {
    if (!rtP) rtP = makePanel('rtp', 'ROUTINES');
    var body = rtP.body; body.innerHTML = '';
    body.appendChild(el('p', 'hint', 'A routine runs several commands with one phrase. Example: name “good night”, commands “volume down”, “flashlight off”, “set an alarm for 7 am”. Say the name (or “run good night”) to start it. Calls and messages are never run from routines.'));
    var list = el('div'); body.appendChild(list);
    var name = el('input', 'srch'); name.placeholder = 'Routine name, e.g. leaving home'; name.autocomplete = 'off';
    var cmds = el('textarea', 'srch'); cmds.placeholder = 'One command per line'; cmds.rows = 5; cmds.style.resize = 'vertical';
    var add = el('button', 'btn pri', 'SAVE ROUTINE'); add.style.width = '100%';
    function render() {
      list.innerHTML = ''; var all = rtGet();
      if (!all.length) list.appendChild(el('div', 'empty-note', 'No routines yet. Create one below.'));
      all.forEach(function (r, idx) {
        var row = el('div', 'hrow j'), mid = el('div', 'tx'); mid.style.flex = '1';
        mid.innerHTML = '<div class="w">' + esc(r.n.toUpperCase()) + '</div>'; mid.appendChild(document.createTextNode(r.c.join(' · '))); row.appendChild(mid);
        var run = el('button', '', '▶'); run.setAttribute('aria-label', 'Run'); run.addEventListener('click', function () { rtP.close(); if (settingsOpen) closeSettings(); runRoutine(r); });
        var x = el('button', 'x', '✕'); x.setAttribute('aria-label', 'Delete'); x.addEventListener('click', function () { var a2 = rtGet(); a2.splice(idx, 1); rtSet(a2); haptic(); render(); });
        row.appendChild(run); row.appendChild(x); list.appendChild(row);
      });
    }
    add.addEventListener('click', function () {
      var n = name.value.trim().slice(0, 40), c = cmds.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 12);
      if (!n || !c.length) { toast('Give it a name and at least one command'); return; }
      var a = rtGet().filter(function (r) { return norm(r.n) !== norm(n); }); a.unshift({ n: n, c: c }); rtSet(a);
      name.value = ''; cmds.value = ''; haptic(); render(); toast('Routine saved');
    });
    var wrap = el('div'); wrap.style.marginTop = '14px';
    wrap.appendChild(name); wrap.appendChild(cmds); wrap.appendChild(add); body.appendChild(wrap);
    render(); rtP.open();
  }

  var FB_RULES = JSON.stringify({ rules: { '.read': false, '.write': false, jarvis: { $room: { '.read': true, '.write': true, inbox: { $box: { $msg: { '.validate': "newData.hasChildren(['v', 'n', 'c']) && newData.child('c').val().length < 70000" } } } } } } }, null, 2);
  // device link details travel inside the same passphrase-encrypted backup as the keys
  function linkBackup() {
    try {
      var st = linkState(); if (!st.paired || !B || !B.linkCode) return null;
      var c = JSON.parse(B.linkCode()); if (!c.ok) return null;
      return { code: c.code, on: !!st.enabled, ctl: !!st.ctl, input: !!st.input, danger: !!st.danger, mac: store.get('pcmac') || '' };
    } catch (e) { return null; }
  }
  function linkRestore(l) {
    try {
      if (!l || typeof l.code !== 'string' || !B || !B.linkPair) return;
      if (l.mac) store.set('pcmac', l.mac);
      var r = JSON.parse(B.linkPair(l.code)); if (!r.ok) return;
      B.linkSet(JSON.stringify({ enabled: !!l.on, ctl: l.ctl !== false, input: !!l.input, danger: !!l.danger }));
    } catch (e) { /* ignore */ }
  }
  function copyTxt(t) {
    try { if (B && B.copyText) { B.copyText(t); toast('Copied'); return; } } catch (e) { /* fall through */ }
    try { navigator.clipboard.writeText(t).then(function () { toast('Copied'); }, function () { toast('Press and hold to copy'); }); } catch (e) { toast('Press and hold to copy'); }
  }

  /* ------------------------------------------------------------------ device link: run a command on the other device */
  var linkOn = false, linkWait = {};
  function linkState() { try { return JSON.parse((B && B.linkState && B.linkState()) || '{}'); } catch (e) { return {}; } }
  /* ---- link health (v1.23): friendly errors, command log, online light, self-test, diagnostics ---- */
  function jparse(x) { try { return JSON.parse(x); } catch (e) { return {}; } }
  function linkDiag() { try { return (B && B.linkDiag) ? jparse(B.linkDiag()) : {}; } catch (e) { return {}; } }
  var OTHER = PC ? 'phone' : 'PC';
  // Turns the raw link failure into a sentence that says what to do about it.
  function linkFriendly(msg) {
    var m = String(msg || ''), d = linkDiag();
    var http = (m.match(/\((-?\d{1,3})\)/) || [])[1];
    if (/^No answer/.test(m)) {
      if (d.connected === false) return 'This ' + (PC ? 'PC' : 'phone') + ' is not connected to the link database right now' + (d.lastErr ? ' (' + String(d.lastErr).slice(0, 70) + ')' : '') + '. Check the internet connection and that the Firebase rules were published.';
      if (d.skewAgoS >= 0 && d.skewAgoS < 900 && Math.abs(d.skewS) >= 100) return 'The clocks on your phone and PC differ by about ' + Math.round(Math.abs(d.skewS) / 60) + ' minutes, so the messages are rejected. Set date and time to automatic on both.';
      return 'Your ' + OTHER + ' did not answer. It may be off, asleep or offline, or Jarvis is not running there, or the link is switched off on it.' + (PC ? '' : ' If it is asleep, say “wake my PC”.');
    }
    if (/Database write failed|Could not reach the link database/.test(m)) {
      if (http === '401' || http === '403') return 'The database refused the message (permission denied). Publish the Firebase rules again: Settings → Device Link shows them with a copy button.';
      if (http === '404') return 'The database address looks wrong. Check it in Settings → Device Link.';
      if (http === '-1' || /Unable to resolve|timed out|Network|Failed to connect|UnknownHost/i.test(m)) return 'There is no internet connection to the link database.';
      return 'The link database could not be reached. Check the internet connection.';
    }
    if (/device link is not running/i.test(m)) return 'The device link is switched off. Turn it on in Settings → Device Link.';
    return m;
  }
  var LOGKEY = 'linklog', LOGMASK = { type: 1, sms: 1, clipset: 1, notify: 1, call: 1 };
  function lkGet() { try { var a = JSON.parse(store.get(LOGKEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function lkAdd(e) { try { var a = lkGet(); a.push(e); if (a.length > 100) a = a.slice(-100); store.set(LOGKEY, JSON.stringify(a)); } catch (x) { /* ignore */ } }
  function logArg(type, arg) { var a = String(arg || ''); return LOGMASK[type] ? (a ? '(' + a.length + ' characters)' : '') : a.slice(0, 50); }
  var pcOnline = null;
  function noteOnline(v) { if (pcOnline !== v) { pcOnline = v; updatePcChip(); } }
  function updatePcChip() {
    var c = document.getElementById('pc-chip'); if (!c) return;
    var st = linkState();
    if (!st.paired || !st.enabled) { c.style.display = 'none'; return; }
    c.style.display = '';
    c.className = 'chip chip-btn pcc ' + (pcOnline === true ? 'on' : pcOnline === false ? 'off' : 'chk');
    c.innerHTML = '<i></i>' + (PC ? 'PHONE' : 'PC');
    c.title = 'Your ' + OTHER + ' is ' + (pcOnline === true ? 'online' : pcOnline === false ? 'not answering' : 'being checked') + ' — tap to check now';
  }
  var pingBusy = false, pingQ = [];
  function pcPing(cb) {
    if (!B || !B.linkPing) { if (cb) cb({ ok: false, msg: 'The device link needs the latest version of Jarvis.' }); return; }
    if (pingBusy) { if (cb) pingQ.push(cb); return; }
    pingBusy = true; if (cb) pingQ.push(cb);
    var id; try { id = B.linkPing(); } catch (e) { pingBusy = false; pingQ = []; if (cb) cb({ ok: false, msg: 'The device link failed to start.' }); return; }
    var done = false;
    function fin(d) {
      if (done) return; done = true; pingBusy = false;
      if (d.ok) noteOnline(true); else if (/^No answer/.test(d.msg || '')) noteOnline(linkDiag().connected === false ? null : false); else noteOnline(null);
      var res = { ok: !!d.ok, msg: d.ok ? d.msg : linkFriendly(d.msg) }, q = pingQ; pingQ = [];
      q.forEach(function (f) { try { f(res); } catch (e) { /* ignore */ } });
    }
    linkWait[id] = fin;
    setTimeout(function () { if (!done) { delete linkWait[id]; fin({ ok: false, msg: 'No answer — timed out' }); } }, 20000);
  }
  function watchPc() {
    function tick() {
      if (document.hidden) return;
      var st = linkState();
      if (!st.paired || !st.enabled) { pcOnline = null; updatePcChip(); return; }
      pcPing();
    }
    setInterval(tick, PC ? 180000 : 60000); setTimeout(tick, 2500); updatePcChip();   // the PC checks the phone less often (every ping is 3-4 network requests)
    document.addEventListener('visibilitychange', function () { if (!document.hidden) setTimeout(tick, 400); });
    var c = document.getElementById('pc-chip');
    if (c) c.addEventListener('click', function () { toast('Checking your ' + OTHER + '…', 1600); pcPing(function (r) { toast(r.ok ? 'Your ' + OTHER + ' is online ✓' : r.msg, 5200); }); });
  }
  function linkSend(type, arg, arg2, cb) {
    var id; try { id = B.linkSend(type, arg || '', arg2 || ''); } catch (e) { cb({ ok: false, msg: 'The device link failed to start.' }); return; }
    var done = false, t0 = Date.now();
    function fin(d) {
      if (done) return; done = true;
      var raw = String(d.msg || ''), msg = d.ok ? raw : linkFriendly(raw);
      lkAdd({ t: t0, d: 'out', ty: type, a: logArg(type, arg), ok: !!d.ok, m: msg.slice(0, 160), ms: Date.now() - t0 });
      if (d.ok) noteOnline(true);
      if (!d.ok && /^No answer/.test(raw) && linkDiag().connected !== false && !fin.noPing) {
        // The command got no reply in time. Before calling the other device offline, ask it a quick question: slow actions on an older PC
        // (starting a program, searching, driving a window) often finish after the wait ran out.
        fin.noPing = true;
        pcPing(function (pr) {
          if (pr && pr.ok) { noteOnline(true); msg = 'Your ' + OTHER + ' is online, but this took longer than expected. It may still be working on it. Check it, or ask again in a moment.'; }
          else noteOnline(false);
          cb({ ok: false, msg: msg, raw: raw });
        });
        return;
      }
      cb({ ok: !!d.ok, msg: msg, raw: raw });
    }
    linkWait[id] = fin;
    setTimeout(function () { if (!done) { delete linkWait[id]; fin({ ok: false, msg: 'No answer from your ' + (PC ? 'phone' : 'PC') + '.' }); } }, 65000);
  }
  function lkText() {
    var a = lkGet().slice(-40).reverse();
    if (!a.length) return 'No commands yet.';
    return a.map(function (e) { return (e.d === 'in' ? '↓ ' : '↑ ') + new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '  ' + e.ty + (e.a ? ' ' + e.a : '') + '  ' + (e.ok ? '✓' : '✕') + (e.m ? ' ' + e.m : ''); }).join('\n');
  }
  function buildDiag() {
    var st = linkState(), d = linkDiag(), info = {}, p = perms();
    try { info = jparse(B && B.appInfo ? B.appInfo() : '{}'); } catch (e) { /* ignore */ }
    var host = (st.dbUrl || '').replace(/^https:\/\//, '').replace(/^[^.]*/, '…');
    var L = ['JARVIS DIAGNOSTICS', 'Version: ' + (info.version || '?') + (PC ? ' (PC)' : ' (phone, Android ' + (info.sdk || '?') + ')'), 'Time: ' + new Date().toString(),
      'Link: paired=' + !!st.paired + ' on=' + !!st.enabled + ' connected=' + !!st.connected + ' database=' + (host || 'none'),
      'Switches: control=' + !!st.ctl + ' typing=' + !!st.input + ' power/calls=' + !!st.danger,
      'Other device: ' + (pcOnline === true ? 'online' : pcOnline === false ? 'not answering' : 'unknown'),
      'Connection: lastError=' + (d.lastErr || 'none') + ' lastHttp=' + (d.lastHttp == null ? '?' : d.lastHttp) + ' connectedAgoS=' + (d.connectedAgoS == null ? '?' : d.connectedAgoS) + ' clockSkewS=' + (d.skewAgoS >= 0 ? d.skewS : 'none seen'),
      'Permissions: mic=' + !!p.mic + ' call=' + !!p.call + ' contacts=' + !!p.contacts + ' typingControl=' + !!p.access,
      'Saved PC address: ' + (store.get('pcmac') ? 'yes' : 'no'), '', 'LAST SELF-TEST:', store.get('linktest') || 'not run yet', '', 'RECENT COMMANDS (newest first):', lkText(), '',
      '(No keys, pairing codes or typed text are included.)'];
    return L.join('\n');
  }
  function runSelfTest(box) {
    box.innerHTML = '';
    var out = [], bad = 0, warn = 0, stopped = false;
    function row(label) {
      var r = el('div', 'st-row chk'); var i = el('span', 'st-i', '…'), b = el('div', 'st-b'); var l = el('div', 'st-l', label), dt = el('div', 'st-d', ''); b.appendChild(l); b.appendChild(dt); r.appendChild(i); r.appendChild(b); box.appendChild(r);
      return function (lvl, txt) { r.className = 'st-row ' + lvl; i.textContent = lvl === 'ok' ? '✓' : lvl === 'warn' ? '!' : lvl === 'bad' ? '✕' : '–'; dt.textContent = txt || ''; if (lvl === 'bad') bad++; if (lvl === 'warn') warn++; out.push((lvl === 'ok' ? 'OK   ' : lvl === 'warn' ? 'WARN ' : lvl === 'bad' ? 'FAIL ' : 'SKIP ') + label + (txt ? ' — ' + txt : '')); };
    }
    var steps = [];
    function step(label, fn) { steps.push(function (next) { var set = row(label); if (stopped) { set('skip', 'skipped'); next(); return; } fn(set, next); }); }
    step('Link set up and switched on', function (set, next) { var st = linkState(); if (!st.paired) { set('bad', 'Not paired yet. Finish the setup above.'); stopped = true; } else if (!st.enabled) { set('bad', 'The link is switched off. Turn on “Link switched on”.'); stopped = true; } else set('ok', 'Paired with your ' + OTHER + '.'); next(); });
    step('Connected to the link database', function (set, next) { var d = linkDiag(); if (d.connected === false) { set('bad', linkFriendly('No answer') ); stopped = true; } else set('ok', 'Live connection is open.'); next(); });
    step('Your ' + OTHER + ' answers', function (set, next) { pcPing(function (r) { if (r.ok) set('ok', 'Answered.'); else { set('bad', r.msg); stopped = true; } next(); }); });
    step('Clocks agree', function (set, next) {
      var t0 = Date.now();
      linkSend(PC ? 'clock' : 'pcinfo', PC ? '' : 'time', '', function (r) {
        if (PC && !r.ok && /cannot do|do not know|unknown/i.test(r.msg || '')) { set('ok', 'Your phone is on an older version, so the clocks were not compared. Update the phone app.'); next(); return; }
        var m = String(r.raw || r.msg).match(/epoch (\d{10,})/);
        if (!r.ok || !m) { set('warn', r.ok ? 'Could not read the other clock.' : r.msg); next(); return; }
        var diff = Math.round((+m[1] - (t0 + Date.now()) / 2) / 1000), a = Math.abs(diff);
        if (a > 100) set('bad', 'The clocks differ by about ' + Math.round(a / 60) + ' minutes — messages will be rejected. Set date and time to automatic on both devices.'); else if (a > 45) set('warn', 'The clocks differ by ' + a + ' seconds. Fine for now, but set time to automatic.'); else set('ok', 'Within ' + Math.max(a, 1) + ' second' + (a > 1 ? 's' : '') + '.');
        next();
      });
    });
    if (!PC) {
      step('PC status', function (set, next) { linkSend('pcinfo', 'status', '', function (r) { set(r.ok ? 'ok' : 'warn', r.msg); next(); }); });
      step('Typing, keys and mouse allowed on the PC', function (set, next) { linkSend('pckey', '', '', function (r) { if (/switched off/i.test(r.raw || r.msg)) set('warn', 'Switched off on the PC. Turn on “Allow typing and key presses” there if you want typing or the mouse.'); else if (!r.ok && /do not know|unknown/i.test(r.msg)) set('ok', 'Allowed.'); else set(r.ok ? 'ok' : 'warn', r.ok ? 'Allowed.' : r.msg); next(); }); });
      step('Movies, music and photos on the PC', function (set, next) { linkSend('medialist', '', 'movie', function (r) { set(r.ok ? 'ok' : 'warn', r.ok ? r.msg.split('.')[0] + '.' : r.msg); next(); }); });
      step('PC address saved for “wake my PC”', function (set, next) { if (store.get('pcmac')) set('ok', 'Saved: ' + store.get('pcmac')); else set('warn', 'Not saved yet. Use WAKE THE PC below while the PC is on.'); next(); });
      step('Phone permissions', function (set, next) { var p = perms(); var miss = []; if (!p.mic) miss.push('microphone'); if (!p.access) miss.push('typing control'); if (miss.length) set('warn', 'Missing: ' + miss.join(', ') + '. Some PC-to-phone commands need them.'); else set('ok', 'Microphone and typing control allowed.'); next(); });
    }
    var i = 0;
    (function go() {
      if (i >= steps.length) {
        var sum = el('div', 'st-sum ' + (bad ? 'bad' : warn ? 'warn' : 'ok'), bad ? bad + ' problem' + (bad > 1 ? 's' : '') + ' found — see the red lines.' : warn ? 'Working, with ' + warn + ' thing' + (warn > 1 ? 's' : '') + ' to look at.' : 'Everything works ✓');
        box.appendChild(sum);
        store.set('linktest', new Date().toLocaleString() + '\n' + out.join('\n'));
        return;
      }
      steps[i++](go);
    })();
  }

  /* ---- scheduled jobs, backup and remote touchpad (v1.24) ---- */
  var DOWS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  var NUMS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty five': 45, sixty: 60 };
  var TIMERX = '(noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)?)(?: o\\W?clock)?';
  function parseClock(x) {
    x = String(x || '').trim();
    if (x === 'noon') return { h: 12, m: 0 };
    if (x === 'midnight') return { h: 0, m: 0 };
    var m = x.match(/^(\d{1,2})(?::(\d{2}))?\s*(?:(a)|(p))?/);
    if (!m) return null;
    var h = +m[1], mi = m[2] ? +m[2] : 0; if (h > 24 || mi > 59) return null;
    var ap = /a\.?\s?m/.test(x) ? 'a' : /p\.?\s?m/.test(x) ? 'p' : '';
    if (ap === 'p' && h < 12) h += 12; else if (ap === 'a' && h === 12) h = 0;
    else if (!ap && h >= 1 && h <= 12) {            // "at 6": whichever 6 comes next
      var now = new Date(), best = null;
      [h % 12, h % 12 + 12].forEach(function (c) { var d = new Date(); d.setHours(c, mi, 0, 0); if (d <= now) d.setDate(d.getDate() + 1); if (!best || d < best.d) best = { d: d, h: c }; });
      h = best.h;
    }
    if (h === 24) h = 0;
    return { h: h, m: mi };
  }
  function parseWhen(t) {
    var m, w = null, rest = t;
    if ((m = t.match(new RegExp('\\bevery (day|night|morning|evening|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: (?:at|around) ' + TIMERX + ')?')))) {
      var c = m[2] ? parseClock(m[2]) : ({ morning: { h: 8, m: 0 }, evening: { h: 18, m: 0 }, night: { h: 23, m: 0 } })[m[1]];
      if (!c) return null;
      w = /^(?:day|night|morning|evening)$/.test(m[1]) ? { k: 'daily', h: c.h, m: c.m } : { k: 'weekly', h: c.h, m: c.m, dow: m[1] === 'weekday' ? [1, 2, 3, 4, 5] : [DOWS[m[1]]] };
    } else if ((m = t.match(/\bin (\d{1,3}|an?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty five|forty|sixty|half an?) ?(minutes?|mins?|hours?|hrs?)\b/))) {
      var n = /^half/.test(m[1]) ? 0.5 : (NUMS[m[1]] || parseInt(m[1], 10)), mins = Math.round(n * (/^h/.test(m[2]) ? 60 : 1));
      if (!(mins >= 1 && mins <= 1440)) return null;
      w = { k: 'in', min: mins };
    } else if ((m = t.match(new RegExp('\\b(?:tomorrow |tonight |today |this (?:morning|evening) )?at ' + TIMERX + '(?= |$)')))) {
      var c2 = parseClock(m[1]); if (!c2) return null;
      w = { k: 'once', h: c2.h, m: c2.m };
    }
    if (!w) return null;
    rest = t.replace(m[0], ' ').replace(/\s+/g, ' ').trim().replace(/^(?:and |then |to |please )+/, '').replace(/ (?:and|then|to|please)$/, '').trim();
    return { w: w, rest: rest };
  }
  function whenLabel(w) {
    var h12 = function (h, m) { return ((h % 12) || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? ' AM' : ' PM'); };
    if (w.k === 'in') return 'in ' + (w.min >= 60 && w.min % 60 === 0 ? (w.min / 60) + ' hour' + (w.min > 60 ? 's' : '') : w.min + ' minute' + (w.min > 1 ? 's' : ''));
    if (w.k === 'once') return 'at ' + h12(w.h, w.m);
    if (w.k === 'daily') return 'every day at ' + h12(w.h, w.m);
    return 'every ' + (w.dow.length === 5 ? 'weekday' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][w.dow[0]]) + ' at ' + h12(w.h, w.m);
  }
  var JOBTYPES = /^(?:lock|volume|media|open|screenshot|url|youtube|cancelshutdown|sleep|shutdown|restart|backup|playrandom|playfile|playany|ytplay|stopmedia|brightness|darkmode|openfolder|pclink|settingspage)$/;
  function schedIntent(t) {
    if (PC || !/\b(?:pc|computer|laptop)\b/.test(t) || !/\b(?:in|at|every)\b/.test(t)) return null;
    var pw = parseWhen(t); if (!pw || !pw.rest) return null;
    var inner = null, rest = pw.rest, rt = splitTarget(rest);
    if (rt) inner = rt.target === 'pc' ? remoteIntent(rt) : null;
    else inner = remoteIntent({ target: 'pc', rest: rest.replace(/^(?:tell|ask|have|make|let) (?:my |the )?(?:pc|computer|laptop)(?: to)? /, '') });
    if (!inner || inner.kind !== 'remote' || inner.target !== 'pc' || !JOBTYPES.test(inner.type)) return null;
    var spec = Object.assign({ type: inner.type, arg: inner.arg || '', arg2: inner.arg2 || '', label: (pw.rest.replace(/ (?:on|in|from) (?:my |the )?(?:pc|computer|laptop)$/, '').replace(/^(?:on|in) (?:my |the )?(?:pc|computer|laptop),? ?/, '')).slice(0, 60) }, pw.w);
    return { kind: 'remote', target: 'pc', type: 'jobadd', arg: JSON.stringify(spec), arg2: '', inner: { type: inner.type, arg: inner.arg, arg2: inner.arg2 }, whenText: whenLabel(pw.w) };
  }
  function backupIntent(t) {
    var m = t.match(/^(?:back ?up|backup) (?:my |the )?(documents|desktop|pictures|photos|music|videos|downloads)(?: folder)?(?: (?:on|from) (?:my |the )?(?:pc|computer|laptop))?(?: (?:to|onto|on) (?:my |the )?(?:drive |disk )?([a-z])(?: drive| disk)?)?$/);
    return m ? act('backup', m[1], m[2] || '') : null;
  }
  function jobMgmtIntent(t) {
    var PCW = '(?: on (?:my |the )?(?:pc|computer|laptop))?', m;
    if (/^(?:what(?:'s| is| are)|show|list|check)(?: me)?(?: all)?(?: my| the)? (?:scheduled|pc|computer) (?:jobs|tasks|schedule)$/.test(t.replace(new RegExp(PCW + '$'), '')) || /^what(?:'s| is) scheduled on (?:my |the )?(?:pc|computer|laptop)$/.test(t))
      return { kind: 'remote', target: 'pc', type: 'joblist', arg: '', arg2: '' };
    if ((m = t.replace(new RegExp(PCW + '$'), '').match(/^(?:cancel|delete|remove|clear)(?: (all))?(?: my| the)? (?:scheduled |pc )(?:jobs?|tasks?|schedule)(?: (?:number |#)?(\d{1,3}))?$/)))
      return { kind: 'remote', target: 'pc', type: 'jobdel', arg: m[2] || 'all', arg2: '' };
    return null;
  }
  /* ---- remote touchpad: phone screen as the PC's mouse and keyboard ---- */
  var padP = null, padDrag = false;
  function openTouchpad() {
    var st = linkState();
    if (PC || !B || !B.linkState) { respond('The remote touchpad is part of the phone app, ' + addrName() + '.'); return; }
    if (!st.paired || !st.enabled) { respond('The device link is not set up yet, ' + addrName() + '. Open Settings, then Device Link.'); return; }
    if (!padP) buildTouchpad();
    padP.open();
  }
  function buildTouchpad() {
    padP = makePanel('padp', 'REMOTE TOUCHPAD');
    var body = padP.body;
    var note = el('div', 'dl-note', 'Moves your PC’s mouse over the internet, so expect a short delay. Needs “Allow typing and key presses” on in Jarvis on the PC.'); body.appendChild(note);
    var stat = el('div', 'pad-stat', ''); body.appendChild(stat);
    function say(msg, bad) { stat.textContent = msg || ''; stat.className = 'pad-stat' + (bad ? ' bad' : ''); }
    function fire(a, d) { if (B && B.linkFire) B.linkFire('mouse', a, d || ''); }
    function send(a, d, okmsg) { linkSend('mouse', a, d || '', function (r) { say(r.ok ? (okmsg || (r.msg && r.msg !== 'ok' ? r.msg : '')) : r.msg, !r.ok); }); }
    var pad = el('div', 'pad'); pad.id = 'pad-area'; pad.appendChild(el('span', '', 'Drag to move · tap = click · hold = right-click · two fingers = scroll'));
    body.appendChild(pad);
    // --- gestures
    var g = { x: 0, y: 0, t0: 0, moved: 0, last: 0, fingers: 0, bx: 0, by: 0, fx: 0, fy: 0, sy: 0, sacc: 0, lp: null, longDone: false, flush: null };
    function flushMove() {
      var dx = Math.round(g.bx), dy = Math.round(g.by);
      if (dx || dy) { fire('move', dx + ',' + dy); g.bx -= dx; g.by -= dy; }
      var n = Math.trunc(g.sacc); if (n) { fire('scroll', String(n)); g.sacc -= n; }
    }
    function startFlush() { if (!g.flush) g.flush = setInterval(flushMove, 70); }
    function stopFlush() { if (g.flush) { clearInterval(g.flush); g.flush = null; } flushMove(); }
    pad.addEventListener('touchstart', function (e) {
      e.preventDefault(); g.fingers = e.touches.length;
      if (g.fingers === 1) { g.x = e.touches[0].clientX; g.y = e.touches[0].clientY; g.t0 = Date.now(); g.moved = 0; g.last = g.t0; g.longDone = false; g.bx = 0; g.by = 0;
        clearTimeout(g.lp); g.lp = setTimeout(function () { if (g.fingers === 1 && g.moved < 10) { g.longDone = true; haptic(); fire('click', 'r'); } }, 550); }
      else if (g.fingers === 2) { clearTimeout(g.lp); g.longDone = true; g.sy = (e.touches[0].clientY + e.touches[1].clientY) / 2; }
      startFlush();
    }, { passive: false });
    pad.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (e.touches.length >= 2) { var y = (e.touches[0].clientY + e.touches[1].clientY) / 2; g.sacc += -(y - g.sy) / 12; g.sy = y; return; }
      var x = e.touches[0].clientX, y1 = e.touches[0].clientY, now = Date.now(), dx = x - g.x, dy = y1 - g.y, dt = Math.max(1, now - g.last);
      g.moved += Math.abs(dx) + Math.abs(dy); g.x = x; g.y = y1; g.last = now;
      var v = Math.sqrt(dx * dx + dy * dy) / dt, gain = 1.3 + Math.min(2.4, v * 1.6);
      g.bx += dx * gain; g.by += dy * gain;
    }, { passive: false });
    function endTouch(e) {
      e.preventDefault(); var left = e.touches.length;
      if (g.fingers === 1 && left === 0) { clearTimeout(g.lp); if (!g.longDone && g.moved < 10 && Date.now() - g.t0 < 260) { stopFlush(); fire('click', 'l'); haptic(); } }
      g.fingers = left; if (left === 0) stopFlush();
    }
    pad.addEventListener('touchend', endTouch, { passive: false });
    pad.addEventListener('touchcancel', endTouch, { passive: false });
    // --- buttons
    function row(items) {
      var r = el('div', 'pad-row');
      items.forEach(function (it) { var b = el('button', 'btn', it[0]); b.addEventListener('click', function () { haptic(); it[1](b); }); r.appendChild(b); });
      body.appendChild(r); return r;
    }
    row([['LEFT', function () { send('click', 'l', 'Click.'); }], ['DOUBLE', function () { send('click', 'd', 'Double click.'); }], ['RIGHT', function () { send('click', 'r', 'Right click.'); }],
      ['DRAG: OFF', function (b) { padDrag = !padDrag; send(padDrag ? 'down' : 'up', '', padDrag ? 'Holding the left button — move, then tap again to release.' : 'Released.'); b.textContent = padDrag ? 'DRAG: ON' : 'DRAG: OFF'; b.classList.toggle('pri', padDrag); }]]);
    var keys = [['ESC', 'esc'], ['TAB', 'tab'], ['ENTER', 'enter'], ['⌫', 'backspace'], ['DEL', 'delete'], ['←', 'left'], ['↑', 'up'], ['↓', 'down'], ['→', 'right'], ['SPACE', 'space'], ['WIN', 'win'], ['ALT+TAB', 'alttab'], ['F5', 'f5'], ['F11', 'f11'], ['HOME', 'home'], ['END', 'end'], ['PG↑', 'pageup'], ['PG↓', 'pagedown']];
    body.appendChild(el('div', 'dl-note', 'Keys'));
    row(keys.map(function (k) { return [k[0], function () { send('key', k[1]); }]; })).classList.add('wrap');
    // --- shortcuts: tick modifier keys, type a key, send (for example Ctrl + Shift + Alt + T), or tap a ready-made one
    body.appendChild(el('div', 'dl-note', 'Shortcuts: tick the modifier keys, type a key, then send. Example: CTRL + SHIFT + ALT + T.'));
    var padMods = { ctrl: false, shift: false, alt: false, win: false }, modBtns = {};
    var mr = row([['CTRL +', function (b) { togMod('ctrl', b); }], ['SHIFT +', function (b) { togMod('shift', b); }], ['ALT +', function (b) { togMod('alt', b); }], ['WIN +', function (b) { togMod('win', b); }]]);
    Array.prototype.forEach.call(mr.querySelectorAll('.btn'), function (b) { modBtns[b.textContent.toLowerCase().replace(/\s*\+$/, '')] = b; });
    function togMod(k, b) { padMods[k] = !padMods[k]; b.classList.toggle('pri', padMods[k]); }
    function clearMods() { Object.keys(padMods).forEach(function (k) { padMods[k] = false; if (modBtns[k]) modBtns[k].classList.remove('pri'); }); }
    var ki = el('input', 'srch'); ki.placeholder = 'Key: A-Z, 0-9, F1-F12, TAB, ESC, ENTER, DELETE, LEFT…'; ki.autocomplete = 'off'; ki.autocapitalize = 'off'; ki.spellcheck = false; ki.maxLength = 12; body.appendChild(ki);
    row([['SEND SHORTCUT', function () {
      var parts = []; ['ctrl', 'shift', 'alt', 'win'].forEach(function (k) { if (padMods[k]) parts.push(k); });
      var kv = ki.value.trim().toLowerCase().replace(/\s+/g, '');
      if (kv) parts.push(kv);
      if (!parts.length) { say('Tick a modifier and/or type a key first.', true); return; }
      send('combo', parts.join('+'), 'Sent ' + parts.join('+').toUpperCase().replace(/\+/g, ' + ') + '.');
    }], ['CLEAR', function () { clearMods(); ki.value = ''; say('', false); }]]);
    var PRE = [['COPY', 'ctrl+c'], ['PASTE', 'ctrl+v'], ['CUT', 'ctrl+x'], ['UNDO', 'ctrl+z'], ['ALL', 'ctrl+a'], ['NEW TAB', 'ctrl+t'], ['CLOSE TAB', 'ctrl+w'], ['REOPEN TAB', 'ctrl+shift+t'], 
      ['TASK MGR', 'ctrl+shift+esc'], ['ALT+F4', 'alt+f4'], ['DESKTOP', 'win+d'], ['LOCK', 'win+l'], ['SNIP', 'win+shift+s'], ['SNAP L', 'win+left'], ['SNAP R', 'win+right']];
    row(PRE.map(function (c) { return [c[0], function () { send('combo', c[1], c[0] + '.'); }]; })).classList.add('wrap');
    body.appendChild(el('div', 'dl-note', 'Media and volume'));
    row([['⏮', function () { send('key', 'prev'); }], ['⏯', function () { send('key', 'playpause'); }], ['⏭', function () { send('key', 'next'); }], ['VOL−', function () { send('key', 'voldown'); }], ['VOL+', function () { send('key', 'volup'); }], ['MUTE', function () { send('key', 'mute'); }]]);
    body.appendChild(el('div', 'dl-note', 'Type on the PC'));
    var ti = el('input', 'srch'); ti.placeholder = 'Text to type on the PC'; ti.autocomplete = 'off'; ti.spellcheck = false; body.appendChild(ti);
    row([['TYPE IT', function () { var v = ti.value; if (!v) { say('Write something first.', true); return; } linkSend('type', v, '', function (r) { say(r.ok ? 'Typed on the PC.' : r.msg, !r.ok); if (r.ok) ti.value = ''; }); }],
      ['TYPE + ENTER', function () { var v = ti.value; if (!v) { say('Write something first.', true); return; } linkSend('type', v, '', function (r) { if (!r.ok) { say(r.msg, true); return; } ti.value = ''; send('key', 'enter', 'Typed and pressed Enter.'); }); }]]);
    padP.root.addEventListener('transitionend', function () { if (!padP.isOpen) { stopFlush(); if (padDrag) { padDrag = false; fire('up'); var db = padP.body.querySelector('.pad-row .btn.pri'); if (db) { db.classList.remove('pri'); db.textContent = 'DRAG: OFF'; } } } });
  }

  /* ---- Send to PC, Wake the PC, Find my phone (v1.23) ---- */
  function shareToPc(text) {
    var st = linkState();
    if (PC) { respond('Sharing to the phone is not available here, ' + addrName() + '.'); return; }
    if (!st.paired || !st.enabled) { respond('The device link is not set up yet, ' + addrName() + '. Open Settings, then Device Link.'); return; }
    text = String(text || '').trim();
    if (!text) { respond('There is nothing to send, ' + addrName() + '. Copy some text or a link first.'); return; }
    var u = text.match(/https?:\/\/[^\s<>"]{3,1900}/i);
    addMsg('act', '📤 Sending to your PC…', true);
    runRemote({ kind: 'remote', target: 'pc', type: u ? 'pclink' : 'clipset', arg: u ? u[0] : text.slice(0, 5000), arg2: '' });
  }
  function macOf(x) { var m = String(x || '').match(/\b([0-9A-F]{2}(?:[:-][0-9A-F]{2}){5})\b/i); return m ? m[1].toUpperCase().replace(/-/g, ':') : ''; }
  function wakePcNow() {
    var mac = store.get('pcmac');
    if (!B || !B.wakePc) { respond('Waking the PC needs the Android app, ' + addrName() + '.'); return; }
    if (!mac) { respond('I need your PC’s network address first, ' + addrName() + '. Open Settings, Device Link, then Wake the PC, and tap Learn from PC while the PC is on.'); return; }
    var r = jparse(B.wakePc(mac)); if (!r.ok) respond(r.msg || 'I could not send the wake signal.');
  }
  var wakeTimer = null;
  function wakeWatch() {
    if (wakeTimer) return; var n = 0;
    wakeTimer = setInterval(function () {
      n++; pcPing(function (r) { if (r.ok) { clearInterval(wakeTimer); wakeTimer = null; toast('Your PC is awake ✓', 4200); } });
      if (n >= 6) { clearInterval(wakeTimer); wakeTimer = null; }
    }, 20000);
  }
  function linkExtraIntent(t) {
    var m;
    if (!PC) {
      var sj = schedIntent(t); if (sj) return sj;
      var jm = jobMgmtIntent(t); if (jm) return jm;
      var bk = backupIntent(t); if (bk) return { kind: 'remote', target: 'pc', type: 'backup', arg: bk.arg, arg2: bk.arg2 };
      if (/^(?:open|show|start|use|launch)(?: the| my)?(?: remote)? (?:touchpad|trackpad|mouse pad)$|^(?:control|use) (?:my )?(?:pc|computer|laptop)(?:'s)? mouse(?: from here)?$|^(?:use )?(?:my )?phone as (?:a |the )?(?:mouse|touchpad|trackpad)(?: for (?:my )?(?:pc|computer|laptop))?$|^(?:open|show) (?:the )?remote mouse$/.test(t))
        return { kind: 'ui', fn: openTouchpad, text: 'Opening the remote touchpad, ' + addrName() + '.', silent: true };
      if (/^(?:send|share|push|put|copy|move|beam)(?: it| this| that| the| my)?(?: link| url| text| clipboard| copied text| copied link| what i copied)?(?: (?:over )?(?:to|onto|on)) (?:my |the )?(?:pc|computer|laptop|desktop)(?: clipboard)?$/.test(t) || /^(?:send|share) (?:my |the )?clipboard$/.test(t))
        return { kind: 'ui', fn: function () { shareToPc(B && B.clipboardText ? B.clipboardText() : ''); }, noHistory: true };
      if (/^(?:get|bring|fetch|read|copy|show)(?: me)? (?:the |my )?(?:pc|computer|laptop)(?:'s| s)? clipboard(?: to (?:my )?phone)?$|^what(?:'s| is) on (?:the |my )?(?:pc|computer)(?:'s| s)? clipboard$/.test(t))
        return { kind: 'remote', target: 'pc', type: 'clipget', arg: '', arg2: '', copyBack: true };
      if (/^(?:wake|wake up|turn on|power on|boot|boot up|start up|switch on)(?: up)? (?:my |the )?(?:pc|computer|laptop|desktop)$/.test(t))
        return { kind: 'ui', fn: wakePcNow, noHistory: true };
      if (/^(?:find|ring|locate|where(?:'s| is)) (?:my |the )?phone$/.test(t))
        return { kind: 'reply', text: 'Your phone is the one listening, ' + addrName() + '. To ring it from your PC, say “find my phone” in Jarvis on the PC.' };
    }
    if (PC && (/^(?:find|ring|locate|call|where(?:'s| is)) (?:my |the )?phone$/.test(t) || /^(?:make|let) (?:my )?phone ring$/.test(t)))
      return { kind: 'remote', target: 'phone', type: 'findphone', arg: '', arg2: '' };
    if (/^(?:stop|cancel|silence|end) (?:the |my )?(?:phone )?(?:ring(?:ing)?|find(?:ing)? (?:my )?phone)$|^(?:i )?(?:found|got|have) (?:it|my phone|the phone)$|^found (?:it|my phone)$/.test(t))
      return PC ? { kind: 'remote', target: 'phone', type: 'stopring', arg: '', arg2: '' } : act('stopring', '', '', true);
    return null;
  }
  var POWER = { shutdown: 'shut down', restart: 'restart', sleep: 'put to sleep', logoff: 'sign out of', emptybin: 'empty the recycle bin on' };
  function splitTarget(t) {
    var m, tg = null, rest = null;
    var DEV = '(pc|computer|laptop|desktop|windows pc|windows|phone|mobile phone|mobile|android phone|android)';
    if ((m = t.match(new RegExp('^(?:on|in|at|using) (?:my |the |this )?' + DEV + '[ ,:]+(.+)$')))) { tg = m[1]; rest = m[2]; }
    else if ((m = t.match(new RegExp('^(?:tell|ask|have|make|let|get) (?:my |the |this )?' + DEV + '(?: to)? (.+)$')))) { tg = m[1]; rest = m[2]; }
    else if ((m = t.match(/^(lock|shut ?down|power off|turn off|restart|reboot|sleep|hibernate|sign out of|sign out|log out of|log out|log off|cancel (?:the )?shutdown|cancel (?:the )?restart) (?:my |the )?(pc|computer|laptop|desktop)$/))) { tg = m[2]; rest = m[1]; }
    else if ((m = t.match(/^(?:take (?:a )?)?screenshot(?: of)? (?:my |the )?(pc|computer|laptop|desktop)$/))) { tg = m[1]; rest = 'screenshot'; }
    else if ((m = t.match(new RegExp('^(.+?) (?:on|in|from) (?:my |the |this )?' + DEV + '$')))) { tg = m[2]; rest = m[1]; }
    if (!tg) return null;
    return { target: /^(pc|computer|laptop|desktop|windows)/.test(tg) ? 'pc' : 'phone', rest: rest };
  }
  // commands that only exist on a PC
  function pcIntent(t, remote) {
    var m;
    if (/^(?:lock)(?: the| my)?(?: pc| computer| laptop| screen| workstation)?$/.test(t)) return act('lock', '', '', true);
    if (/^(?:go to sleep|sleep(?: mode)?|put (?:the |my )?(?:pc|computer|laptop) to sleep|hibernate)$/.test(t)) return act('sleep');
    if (/^(?:shut ?down|power off|turn off)(?: the| my)?(?: pc| computer| laptop)?$/.test(t) && !/^turn off$/.test(t)) return act('shutdown');
    if (/^(?:restart|reboot)(?: the| my)?(?: pc| computer| laptop)?$/.test(t)) return act('restart');
    if (/^(?:cancel|abort|stop) (?:the )?(?:shutdown|restart|reboot)$/.test(t)) return act('cancelshutdown', '', '', true);
    if (/^(?:take (?:a )?|capture (?:a )?|grab (?:a )?)?screenshot$|^screen ?shot$/.test(t)) return act('screenshot');
    if (/^(?:show (?:the )?desktop|minimi[sz]e (?:all|everything))$/.test(t)) return act('key', 'home', '', true);
    if (/^(?:open|launch|start|show)(?: the)? (?:windows |file )?explorer$|^open (?:my )?files$/.test(t)) return act('open', 'file explorer');
    if (/^(?:open|launch|start|show)(?: the)? task manager$/.test(t)) return act('taskmgr');
    // ---- v1.33: playback keys, click by name, switch app, key combos (voice access style)
    if ((m = t.match(/^(?:skip|forward|fast forward|go forward|jump ahead|skip forward|move forward)(?: by)? (\d{1,3}) seconds?$/))) return act('ytkey', parseInt(m[1], 10) >= 8 ? 'fwd10' : 'fwd5');
    if (/^(?:forward|fast forward|skip ahead)$/.test(t)) return act('ytkey', 'fwd10');
    if ((m = t.match(/^(?:rewind|go back|back up|skip back(?:ward)?|jump back|move back(?:ward)?)(?: by)?(?: (\d{1,3}) seconds?)?$/))) return act('ytkey', m[1] && parseInt(m[1], 10) < 8 ? 'back5' : 'back10');
    if (/^(?:toggle |exit |enter |go |leave |turn on |turn off )?(?:full ?screen|fullscreen)(?: mode)?$/.test(t)) return act('ytkey', 'fullscreen');
    if (/^(?:turn on|turn off|toggle|show|hide|enable|disable)(?: the)? (?:subtitles|captions|cc|closed captions)$/.test(t)) return act('ytkey', 'captions');
    if (/^(?:skip (?:the |this )?ads?|click skip(?: ads?)?)$/.test(t)) return act('clickname', 'Skip');
    if ((m = t.match(/^click (?:on )?(?:the )?(?!left$|right$|double$|mouse$)(.{2,40}?)(?: button)?$/))) return act('clickname', m[1]);
    if ((m = t.match(/^(?:switch|go|jump|change|alt tab) to (?:the )?(?!next |previous |last |dark|light|english|bangla|this |that )(.{2,30}?)(?: app| window| program)?$/)) && !/\b(?:mode|theme|language|tab|phone|pc|computer|desktop|voice|style|sleep)\b/.test(m[1])) return act('focusapp', m[1]);
    if ((m = t.match(/^(?:press|hit|send|do|use|hold)(?: the)? ((?:(?:ctrl|control|shift|alt|windows|win|command|cmd)(?: plus|\+|-| )+)+[a-z0-9]{0,12}(?: ?(?:plus|\+) ?[a-z0-9]{1,12})?|(?:escape|esc|enter|tab|space|backspace|delete|home|end|page ?up|page ?down|up|down|left|right|print ?screen|f(?:[1-9]|1\d|2[0-4])))(?: keys?| shortcut| combination| combo)?$/))) {
      var toks = m[1].replace(/\bplus\b/g, ' ').replace(/[+\-]/g, ' ').split(/\s+/).filter(Boolean).map(function (w) { return ({ control: 'ctrl', windows: 'win', command: 'win', cmd: 'win', escape: 'esc', pageup: 'pageup', pagedown: 'pagedown', printscreen: 'printscreen' })[w] || w; });
      var jn = toks.join(' ').replace(/page up/, 'pageup').replace(/page down/, 'pagedown').replace(/print screen/, 'printscreen').split(' ');
      return act('mouse', 'combo', jn.join('+'));
    }
    // ---- PC movies / music / YouTube (handled by pc-extra-actions.js on the PC)
    var KMAP = { movie: 'movie', film: 'movie', video: 'video', episode: 'video', show: 'video', series: 'video', song: 'music', music: 'music', track: 'music', audio: 'music', file: '', photo: 'photo', picture: 'photo', image: 'photo', pic: 'photo', document: 'doc', doc: 'doc', pdf: 'doc', spreadsheet: 'doc', presentation: 'doc', excel: 'doc', word: 'doc' };
    var PCLOC = '(?: (?:from|on|in|at) (?:my |the )?(?:pc|computer|laptop|local|hard ?drive|storage|files|downloads|desktop|[a-z] drive|[a-z] disk))?';
    // "...from marvel studios folder in new volume f drive": drop the drive phrase (every drive is searched) and keep the folder as a hint
    var tm = t, fh = '', DRV = / (?:from|in|inside|on|of|at) (?:the |my )?(?:(?:new volume|local disk|volume|drive|disk) )?[a-z] (?:drive|disk|volume)$| (?:from|in|inside|on|of|at) (?:the |my )?(?:drive|disk|volume) [a-z]$/, FLD = / (?:from|in|inside|of) (?:the |my )?(.{2,40}?) (?:folder|file|directory|collection)$/;
    for (var z = 0; z < 3; z++) { if (DRV.test(tm)) tm = tm.replace(DRV, ''); else { var mf = tm.match(FLD); if (mf && !fh) { fh = mf[1]; tm = tm.replace(FLD, ''); } else break; } }
    var HINT = fh ? '|' + fh : '';
    var yt1 = t.match(/^(?:open |go to |launch )?youtube(?: and| then)? (?:play|search(?: for)?|find|watch|put on)(?: me)?(?: the| a| some)? (.{2,100})$/) ||
              t.match(/^(?:play|watch|put on|search(?: for)?) (.{2,100}?) (?:on|in|from|at|using) youtube$/);
    if (yt1 && !/^(?:youtube|you tube)$/.test(yt1[1])) return act('ytplay', yt1[1]);
    if ((m = tm.match(new RegExp('^(?:play|watch|open|start|put on|run|show)(?: me)?(?: the| a| an| my| some)? (movie|film|video|episode|show|series|song|music|track|audio|file|photo|picture|image|pic|document|doc|pdf|spreadsheet|presentation|excel|word)(?: called| named| titled| with the name)? (.{2,100}?)' + PCLOC + '$'))) && !/^(?:player|app|apps|library|folder|random|any|some)\b|^(?:random|any|some)$|(?:folder|settings|app|player)$/.test(m[2]))
      return act('playfile', m[2] + HINT, KMAP[m[1]]);
    if ((m = tm.match(/^(?:play|watch|put on|open|start|run|find|show me) (?:the |a |my )?(.{2,100}?) (movie|film|song|music video|video file|music file|video|song file|movie file|film file|audio file|audio|track|file|photo|picture|image|pic|document|doc|pdf|spreadsheet|presentation|excel file|word file|pdf file|photo file|picture file|image file|document file)$/)) && !/ on youtube$/.test(t) && !/^(?:this|that|the|my|a|an|next|previous|prev|last|back|current|first|another)$/.test(m[1]) && !/^(?:random|any|some|good|new|old|latest|best)$/.test(m[1])) return act(/^(?:find|show me)$/.test(t.split(' ')[0]) || /^show me/.test(t) ? 'medialist' : 'playfile', m[1] + HINT, m[2] === 'music video' ? 'video' : (KMAP[m[2].split(' ')[0]] || ''));
    if ((m = t.match(/^(?:play|put on|start|shuffle)(?: me)? (?:some |any |a random |random |my )?(?:random )?(music|songs?|movies?|films?)(?: at random| randomly| for me)?$|^shuffle (?:my )?(music|songs)$|^surprise me with (?:a |some )?(music|song|movie|film)$/)) && (remote || /random|some|any|shuffle|surprise|my/.test(t))) {
      var rk = (m[1] || m[2] || m[3]); return act('playrandom', /movie|film/.test(rk) ? 'movie' : 'music');
    }
    if ((m = t.match(/^(?:play|put on) (.{2,80})$/)) && !/^(?:music|songs?|video|videos|movies?|films?|playback|the music|the song|the video|the movie|it|that|this|something|again|next|previous|prev|back|pause|resume|stop|youtube|spotify|netflix|vlc|chrome|[a-z]+ (?:app|player))$/.test(m[1]) && !/^(?:the )?(?:next|previous|last) /.test(m[1]))
      return act('playany', m[1]);
    if ((m = t.match(/^(?:play|open|show|watch)(?: me)?(?: my| the)? (?:latest|newest|most recent|recent|last) (movie|film|video|song|music|photo|picture|image|document|pdf|file|download)s?(?: on (?:my )?(?:pc|computer))?$/)))
      return act('playfile', 'latest', m[1] === 'download' ? '' : (KMAP[m[1]] || ''));
    if ((m = t.match(/^open (?:my |the )?(?:(?:drive|disk) ([a-z])|([a-z]) (?:drive|disk))$/))) return act('openfolder', 'drive:' + (m[1] || m[2]));
    if ((m = t.match(/^(?:stop|close|quit|exit|kill|end)(?: the| my)? (?:movie|film|video|music|song|songs|player|media player|vlc|playback|playing)$|^(?:turn|switch) off (?:the )?(?:movie|film|music|song|video|player|media player)$/))) return act('stopmedia');
    if (/^(?:turn|switch) on (?:the )?(?:music|song|movie|film|video|player)$/.test(t)) return act('media', 'play');
    if ((m = t.match(/^(?:find|search for|look for|do i have)(?: me)?(?: a| an| the| any)? (movie|film|song|music|video|episode|file|photo|picture|image|document|pdf)s? (?:called |named |about |with )?(.{2,80})$/)))
      return act('medialist', m[2], KMAP[m[1]]);
    if ((m = t.match(/^(?:list|show|what)(?: me)?(?: my| the| all)? (movies|films|songs|music|videos|photos|pictures|images|documents|pdfs)(?: do i have| on (?:my )?(?:pc|computer))?$/)))
      return act('medialist', '', KMAP[m[1].replace(/s$/, '')] || (m[1] === 'music' ? 'music' : ''));
    if ((m = t.match(/^open (?:my |the )?(downloads|documents|desktop|pictures|photos|music|videos|movies|recycle bin)(?: folder)?$/)) && (remote || /folder$|recycle bin$/.test(t))) return act('openfolder', m[1]);

    // ---- more PC controls (handled by pc-extra-actions.js on the PC)
    if (/^(?:pc|computer|system) (?:status|stats|health)$|^how(?:'s| is) (?:my |the )?(?:pc|computer)(?: doing)?$/.test(t) || (remote && /^(?:status|system status|diagnostics)$/.test(t))) return act('pcinfo', 'status', '', false);
    if (/^(?:pc |computer )?(?:cpu|processor)(?: usage| load)?$/.test(t) && (remote || /^(?:pc|computer) /.test(t) || /usage|load/.test(t))) return act('pcinfo', 'cpu');
    if (/^(?:pc |computer )?(?:ram|memory)(?: usage| left| free)?$/.test(t) && (remote || /^(?:pc|computer) /.test(t) || /usage|left|free/.test(t))) return act('pcinfo', 'memory');
    if (/^(?:pc |computer )?(?:disk|storage|drive)(?: space| usage| left| free)?$/.test(t) && (remote || /^(?:pc|computer) /.test(t) || /space|usage|left|free/.test(t))) return act('pcinfo', 'disk');
    if (/^(?:pc |computer )?uptime$|^how long (?:has|have) (?:my |the )?(?:pc|computer) been (?:on|running)$/.test(t)) return act('pcinfo', 'uptime');
    if (/^(?:pc |computer )?(?:ip address|my ip)$/.test(t) && (remote || /^(?:pc|computer) /.test(t))) return act('pcinfo', 'ip');
    if (/^(?:what(?:'s| is) |which apps? (?:is|are) )?running apps?$|^what(?:'s| is) running(?: on (?:my |the )?(?:pc|computer))?$|^(?:running|top) (?:apps|programs|processes)$/.test(t)) return act('pcinfo', 'apps');
    if (remote && /^(?:battery(?: level| status| percentage)?|how much battery(?: is left)?)$/.test(t)) return act('pcinfo', 'battery');
    if ((m = t.match(/^(?:set |change )?(?:the )?(?:screen )?brightness (?:to )?(\d{1,3})(?: ?%| percent)?$/))) return act('brightness', String(Math.max(0, Math.min(100, parseInt(m[1], 10)))));
    if (/^(?:brightness (?:up|higher)|(?:increase|raise|turn up|boost) (?:the )?(?:screen )?brightness|brighter|more brightness)$/.test(t)) return act('brightness', 'up');
    if (/^(?:brightness (?:down|lower)|(?:decrease|reduce|lower|turn down|dim) (?:the )?(?:screen )?(?:brightness)?|dimmer|less brightness)$/.test(t)) return act('brightness', 'down');
    if ((m = t.match(/^(?:turn |switch |set )?(?:on |off )?dark mode(?: (on|off))?$|^(enable|disable|toggle) dark mode$|^(?:turn |switch )(on|off) (?:the )?dark mode$|^light mode$/))) {
      var dm = /^light mode$/.test(t) ? 'off' : (m[1] || m[3] || (m[2] === 'enable' ? 'on' : m[2] === 'disable' ? 'off' : m[2] === 'toggle' ? 'toggle' : (/off dark mode/.test(t) ? 'off' : /on dark mode/.test(t) ? 'on' : 'toggle')));
      return act('darkmode', dm);
    }
    if ((m = t.match(/^open (?:the )?(wi-?fi|bluetooth|display|sound|windows update|update|apps|battery|storage|network|privacy|personali[sz]ation|notifications|default apps|startup apps|about|power|night light|keyboard|mouse|printers?|time|language) settings$|^open settings (?:for )?(wi-?fi|bluetooth|display|sound|update|apps|battery|storage|network|privacy|notifications|power|about)$/))) {
      var pg = (m[1] || m[2]).replace('wi-fi', 'wifi').replace('windows update', 'update').replace('personalisation', 'personalization');
      return act('settingspage', pg);
    }
    if ((m = t.match(/^(?:copy|put|set) (.+?) (?:to|on|in|into) (?:the |my )?(?:pc |computer )?clipboard$/))) return act('clipset', fmtDictation(m[1]));
    if (/^(?:read|show|what(?:'s| is)(?: on| in)?|get) (?:the |my )?(?:pc |computer )?clipboard$|^what(?:'s| is) (?:on|in) (?:the |my )?(?:pc |computer )?clipboard$/.test(t)) return act('clipget');
    if (/^(?:alt tab|switch (?:the )?window|next window)$/.test(t)) return act('pckey', 'switchwindow');
    if (/^(?:close (?:the )?(?:current |this |active )?(?:window|application|app|program))$/.test(t)) return act('pckey', 'closewindow');
    if (/^(?:maximi[sz]e(?: the)?(?: current| this| active)?(?: window)?)$/.test(t)) return act('pckey', 'maxwindow');
    if (/^(?:minimi[sz]e(?: the)?(?: current| this| active)? window|minimi[sz]e)$/.test(t)) return act('pckey', 'minwindow');
    if (remote && /^(?:snap|move) (?:the )?(?:window )?(left|right)$/.test(t)) return act('pckey', 'snap' + t.match(/(left|right)$/)[1]);
    if (/^(?:new tab|open (?:a )?new tab)$/.test(t)) return act('pckey', 'newtab');
    if (/^(?:close (?:the )?(?:current |this )?tab)$/.test(t)) return act('pckey', 'closetab');
    if (remote && /^(?:next tab|switch to (?:the )?next tab)$/.test(t)) return act('pckey', 'nexttab');
    if (remote && /^(?:previous tab|last tab|switch to (?:the )?previous tab)$/.test(t)) return act('pckey', 'prevtab');
    if (remote && /^(?:refresh|reload)(?: the)?(?: page)?$/.test(t)) return act('pckey', 'refresh');
    if (remote && /^(?:full ?screen|go full ?screen|exit full ?screen)$/.test(t)) return act('pckey', 'fullscreen');
    if (remote && /^scroll (up|down)$/.test(t)) return act('pckey', 'scroll' + t.match(/(up|down)$/)[1]);
    if (remote && /^(?:task view|show all windows|show (?:all )?open windows)$/.test(t)) return act('pckey', 'taskview');
    if (/^(?:sign out|log ?out|log off)(?: of)?(?: the| my)?(?: pc| computer| laptop| windows)?$/.test(t)) return act('logoff');
    var bki = backupIntent(tm); if (bki) return bki;
    if (/^(?:empty|clear) (?:the )?(?:recycle bin|trash)$/.test(t)) return act('emptybin');
    if ((m = t.match(/^(?:close|quit|exit|kill) (?:the )?(.+?)(?: app| window| program)?$/)) && !/^(?:chat|settings|panel|menu|this|that|it|jarvis|routines?|conversation|window|tab)$/.test(m[1]))
      return act('close', m[1]);
    return null;
  }
  /* ------------------------------------------------------------------ v1.33: remember which device the conversation is about.
     After "play a song on my PC", short follow-ups (pause, next, volume up, play another song ...) go to the PC until
     the user names the other device, says "back to this phone", or 15 minutes pass. */
  var CTX = { dev: '', at: 0 }, ctxLock = 0;
  var CTX_MS = 15 * 60 * 1000;
  var FOLLOW_RE = /^(?:play|pause|resume|continue|next|previous|prev|skip|rewind|forward|fast forward|go back|mute|unmute|volume|turn up|turn down|louder|quieter|softer|raise|lower|increase|decrease|full ?screen|toggle full|exit full|subtitles|captions|scroll|click|press|brightness|dim|brighter|screenshot|take a screenshot|close (?:the |this |current )?(?:window|tab|app|application)|new tab|switch to|maximi[sz]e|minimi[sz]e|show desktop|shuffle|replay|repeat|another|something else|something different|a different|different song|stop (?:the )?(?:music|song|video|playback|movie))\b/;
  function ctxNote(target) { if (target === SELF) { CTX.dev = ''; CTX.at = 0; } else { CTX.dev = target; CTX.at = Date.now(); } }
  function ctxFollow(t) {
    if (/^(?:back to|control|use|switch to|talk to) (?:this|my|the) (?:phone|pc|computer|laptop|device)$|^(?:stop controlling|forget) (?:the |my )?(?:pc|computer|laptop|phone)$|^(?:this|here|locally)$/.test(t)) {
      var was = CTX.dev; CTX.dev = ''; CTX.at = 0;
      if (/^(?:back to|control|use|switch to|talk to) (?:this|my|the)/.test(t) && !/\b(?:pc|computer|laptop)\b/.test(t) === !PC || /^(?:stop controlling|forget)/.test(t)) return say(was ? 'Understood, ' + addrName() + '. Commands stay on this ' + (PC ? 'PC' : 'phone') + ' now.' : 'Commands already stay on this ' + (PC ? 'PC' : 'phone') + ', ' + addrName() + '.');
    }
    if (ctxLock) return null;
    if (!CTX.dev || CTX.dev === SELF || Date.now() - CTX.at > CTX_MS) { if (CTX.dev && Date.now() - CTX.at > CTX_MS) CTX.dev = ''; return null; }
    if (!FOLLOW_RE.test(t) || /\b(?:this|here|locally)\b/.test(t)) return null;
    var r = remoteIntent({ target: CTX.dev, rest: t });
    if (r && r.kind === 'remote') { CTX.at = Date.now(); r.viaCtx = true; return r; }
    return null;
  }
  function remoteIntent(rt) {
    if (rt.target === SELF) return localIntent(rt.rest);
    rt.rest = rt.rest.replace(/^(?:play|skip to|go to) (?:the )?(next|previous|last) (?:song|track)$/, function (_, w) { return (w === 'last' ? 'previous' : w) + ' song'; })
      .replace(/^(?:pause|resume|stop) (?:the )?(?:music|song|video|playback)$/, function (x) { return /^resume/.test(x) ? 'play' : (/^stop/.test(x) && rt.target === 'pc') ? x : 'pause'; });
    ctxLock++;
    var inner;
    try { inner = (rt.target === 'pc' && pcIntent(rt.rest, true)) || (rt.target === 'phone' && phoneIntent(rt.rest, rt.rest)) || localIntent(rt.rest); } finally { ctxLock--; }
    if (inner && inner.kind === 'action') return { kind: 'remote', target: rt.target, type: inner.type, arg: inner.arg, arg2: inner.arg2, quiet: inner.quiet };
    return { kind: 'reply', text: 'I can relay commands such as opening apps, volume, media, timers and typing to your ' + (rt.target === 'pc' ? 'PC' : 'phone') + ', ' + addrName() + ', but not that one.' };
  }
  function runRemote(li) {
    var nm = li.target === 'pc' ? 'PC' : 'phone';
    if (!B || !B.linkState) { respond('The device link is not available in this version, ' + addrName() + '.'); return; }
    var st = linkState();
    if (!st.paired || !st.enabled) { respond('The device link is not set up yet, ' + addrName() + '. Open Settings, then Device Link.'); return; }
    var fake = li.inner ? { type: li.inner.type, arg: li.inner.arg, arg2: li.inner.arg2, confirmed: li.confirmed } : { type: li.type, arg: li.arg, arg2: li.arg2, confirmed: li.confirmed };
    if (needsConfirm(fake)) {
      askConfirm(confirmQuestion(fake).replace(/\?$/, ' on your ' + nm + (li.whenText ? ' ' + li.whenText : '') + '?'), function () { li.confirmed = true; runRemote(li); });
      return;
    }
    setState('thinking'); pipeAct();
    var typing = addTyping();
    linkSend(li.type, li.arg, li.arg2, function (r) {
      typing.remove();
      if (r.ok && li.copyBack) { var cm = String(r.msg || '').match(/says: ([\s\S]*)$/); if (cm && B && B.copyText) { try { B.copyText(cm[1]); } catch (e) { /* ignore */ } respond('Copied it to this phone, ' + addrName() + ': ' + cm[1]); } else respond(r.msg || 'The PC clipboard is empty.'); }
      else if (r.ok) respond(pick(LEADS) + ', ' + addrName() + '. ' + (r.msg || 'Done on your ' + nm + '.'));
      else respondError(r.msg || 'That failed on your ' + nm + '.', r.msg);
    });
  }

  /* ---- scrolling feeds, reels and shorts by voice ------------------------------------------------------------
     "scroll down" = show what is below (finger swipes up). Also: next/previous reel, counts ("3 times"), sizes
     ("a little", "a lot"), "scroll to the top", "stop scrolling". Speech recognisers often hear "scroll" as
     "scrolled", "stroll" or "school", so those are accepted too. These replies are not spoken (quiet + mute). */
  var NUMW = { a: 1, one: 1, once: 1, two: 2, twice: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  function feedCount(x) { var n = NUMW[x] || parseInt(x, 10); return n >= 1 ? Math.min(10, n) : 1; }
  function feed(dir, cnt, size) { var a = act('scroll', dir, (cnt > 1 ? String(cnt) : '') + (size ? (cnt > 1 ? ',' : '') + size : ''), true); a.mute = true; return a; }
  function reel(dir, cnt) { var a = act('swipe', dir, cnt > 1 ? String(cnt) : '', true); a.mute = true; return a; }
  function feedIntent(t) {
    var m, SC = '(?:scroll(?:ed|ing|s)?|stroll|scrawl|school|scrol)', IT = '(?: it| that| this| the page| the screen| the feed| the list| the reels?)?';
    var CNT = '(?: (\\d{1,2}|a|one|once|two|twice|three|four|five|six|seven|eight|nine|ten)(?: times?| more times?| posts?| reels?| videos?| screens?)?)?';
    if (/^(?:stop|cancel|end) (?:the )?(?:auto )?(?:scroll(?:ing)?|swiping)$/.test(t)) { var st = act('scroll', 'stop', '', true); st.mute = true; return st; }
    if ((m = t.match(new RegExp('^' + SC + IT + ' (?:all the way )?(?:to )?(?:the )?(top|bottom|start|end|beginning)$')))) return feed(/top|start|beginning/.test(m[1]) ? 'top' : 'bottom', 1, '');
    if ((m = t.match(new RegExp('^' + SC + IT + ' (up|down)(?: (a (?:little|bit|tiny bit)|slowly|slightly)| (a lot|far|fast|quickly|more|again)| (?:one )?page)?' + CNT + '$')))) {
      var size = m[2] ? 'small' : (m[3] && /lot|far|fast|quickly/.test(m[3]) ? 'big' : ''), n = m[4] ? feedCount(m[4]) : 1;
      if (/ page$/.test(t) && !m[4]) size = 'big';
      return feed(m[1], n, size);
    }
    if ((m = t.match(/^(?:page|go|move|swipe) (up|down)(?: (a (?:little|bit)|a lot))?$|^(up|down) (?:a )?page$/)) && !/^swipe (?:up|down)$/.test(t))
      return feed(m[1] || m[3], 1, /^page|page$/.test(t) ? 'big' : (m[2] && /little|bit/.test(m[2]) ? 'small' : (m[2] ? 'big' : '')));
    // reels / shorts / posts: one swipe each
    if ((m = t.match(/^(?:go to |play |show |watch |open )?(?:the )?(next|another|new|following) (?:one|short|shorts|reel|reels|post|clip|story|video in (?:the )?feed|tiktok)$/)) || /^(?:skip|swipe|next)(?: this| the current)? (?:one|short|reel|post|clip)$|^swipe up$|^skip(?: it)?$/.test(t) && !/^skip$/.test(t))
      return reel('up', 1);
    if ((m = t.match(/^(?:swipe up|next reel|next one) (\d{1,2}|two|three|four|five|six|seven|eight|nine|ten) times?$|^skip (\d{1,2}|two|three|four|five|six|seven|eight|nine|ten) (?:reels?|shorts?|posts?|videos?|clips?)$/)))
      return reel('up', feedCount(m[1] || m[2]));
    if (/^(?:go back to |play |show |watch |open )?(?:the )?(?:previous|last|earlier|prior) (?:one|short|shorts|reel|reels|post|clip|story)$|^swipe down$|^go back one$/.test(t))
      return reel('down', 1);
    return null;
  }


  /* ------------------------------------------------------------------ v1.33: more phone controls and everyday commands */
  var MONTHN = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11, jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  /* "dentist on friday at 3 pm" -> { title:'dentist', ms: epoch } (ms 0 when no time was said) */
  function eventWhen(x) {
    var s = ' ' + x + ' ', d = new Date(), m, hasDay = false, ms = 0, title;
    d.setSeconds(0, 0);
    if ((m = s.match(/ (today|tonight|tomorrow) /))) { if (m[1] === 'tomorrow') d.setDate(d.getDate() + 1); s = s.replace(m[0], ' '); hasDay = true; }
    else if ((m = s.match(/ (?:on |next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday) /))) {
      var diff = (DOWS[m[1]] - d.getDay() + 7) % 7; if (diff === 0) diff = 7; d.setDate(d.getDate() + diff); s = s.replace(m[0], ' '); hasDay = true;
    } else if ((m = s.match(/ (?:on )?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec) (\d{1,2})(?:st|nd|rd|th)? /)) ||
               (m = s.match(/ (?:on )?(\d{1,2})(?:st|nd|rd|th)? (?:of )?(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec) /))) {
      var mo = MONTHN[isNaN(+m[1]) ? m[1] : m[2]], dy = parseInt(isNaN(+m[1]) ? m[2] : m[1], 10);
      d.setMonth(mo, dy); if (d.getTime() < Date.now() - 86400000) d.setFullYear(d.getFullYear() + 1); s = s.replace(m[0], ' '); hasDay = true;
    }
    var tm = s.match(new RegExp(' (?:at |@ )?' + TIMERX + '(?= )'));
    if (tm && /\d|noon|midnight/.test(tm[1]) && (/\bat\b|@|am|pm|a\.m|p\.m|noon|midnight/i.test(tm[0]))) {
      var c = parseClock(tm[1]);
      if (c) { d.setHours(c.h, c.m, 0, 0); ms = d.getTime(); if (!hasDay && ms < Date.now()) ms += 86400000; s = s.replace(tm[0], ' '); }
    } else if (hasDay) { d.setHours(9, 0, 0, 0); ms = d.getTime(); }
    title = s.replace(/\s+/g, ' ').replace(/^ (?:for |to |called |named |titled )?/, '').replace(/ (?:for|on|at)$/, '').trim();
    return { title: title, ms: ms };
  }
  function cap1(x) { return x ? x.charAt(0).toUpperCase() + x.slice(1) : x; }
  function say(text) { return { kind: 'reply', text: text }; }
  /* Phone-only controls. Used on the phone itself and when the PC sends "...on my phone". */
  function phoneIntent(t, raw) {
    var m, key;
    // ---- connectivity (Android only allows the user to flip these, so Jarvis opens the right switch)
    var CONN = { 'wi-fi': 'wifi', wifi: 'wifi', 'wi-fi hotspot': 'hotspot', bluetooth: 'bluetooth', 'airplane mode': 'airplane', 'flight mode': 'airplane', 'mobile data': 'data', 'cellular data': 'data', 'mobile network': 'data', data: 'data', hotspot: 'hotspot', nfc: 'nfc' };
    if ((m = t.match(/^(?:turn|switch|set)? ?(?:on|off|enable|disable) (?:the |my )?(wi-?fi hotspot|wi-?fi|bluetooth|airplane mode|flight mode|mobile data|cellular data|mobile network|data|hotspot|nfc)$/)) ||
        (m = t.match(/^(?:turn|switch) (?:the |my )?(wi-?fi hotspot|wi-?fi|bluetooth|airplane mode|flight mode|mobile data|cellular data|mobile network|hotspot|nfc) (?:on|off)$/)))
      return act('settings', CONN[m[1].replace(/^wifi hotspot$/, 'wi-fi hotspot')] || 'wifi');
    if ((m = t.match(/^(?:turn|switch|set)? ?(on|off|enable|disable) (?:the |my )?(?:do not disturb|dnd|do not disturb mode)$/)) || (m = t.match(/^(?:turn|switch) (?:the |my )?(?:do not disturb|dnd)(?: mode)? (on|off)$/)) || (m = t.match(/^(?:do not disturb|dnd)(?: mode)? (on|off)$/)))
      return act('dnd', /^(?:off|disable)$/.test(m[1]) ? 'off' : 'on');
    // ---- sound
    if (/^(?:turn up|raise|increase|bump up|crank up)(?: the)? (?:volume|sound)$|^(?:volume|sound) (?:up|higher)$/.test(t)) return act('volume', 'up');
    if (/^(?:turn down|lower|decrease|reduce)(?: the)? (?:volume|sound)$|^(?:volume|sound) (?:down|lower)$/.test(t)) return act('volume', 'down');
    if (/^(?:silence|mute|quiet)(?: the| my)? (?:device|phone|mobile|ringer)$/.test(t)) return act('volume', 'mute');
    if (/^(?:set |make )?(?:the )?(?:notification|ringer|ring|alarm|media) volume (?:to )?(?:max|maximum|full|the maximum|100)(?: ?%| percent)?$/.test(t)) return act('volume', 'max');
    if ((m = t.match(/^(?:set |make )?(?:the )?(?:notification|ringer|ring|alarm|media) volume (?:to |at )?(\d{1,3})(?: ?%| percent)?$/))) return act('volume', m[1]);
    if (/^is (?:my )?phone (?:set to |on )?(?:ring|vibrate|silent|ringing)(?: or (?:vibrate|ring|silent))?$/.test(t) || /^is (?:my )?(?:phone|ringer) (?:silent|muted|on silent|on vibrate)$/.test(t)) return act('ringer', '', '', true);
    // ---- screen
    if ((m = t.match(/^(?:set |change )?(?:the |my )?(?:screen )?brightness (?:to )?(\d{1,3})(?: ?%| percent)?$/))) return act('brightness', m[1]);
    if (/^(?:increase|raise|turn up|boost|brighten)(?: the| my)?(?: screen)?(?: brightness)?$|^brightness (?:up|higher)$|^brighter$/.test(t) && !/^(?:brighten)$/.test(t)) return act('brightness', 'up');
    if (/^(?:decrease|reduce|lower|turn down|dim)(?: the| my)?(?: screen)?(?: brightness)?$|^brightness (?:down|lower)$|^dimmer$/.test(t)) return act('brightness', 'down');
    if (/^(?:max(?:imum)?|full) brightness$|^brightness (?:to )?max(?:imum)?$/.test(t)) return act('brightness', 'max');
    if ((m = t.match(/^(?:turn|switch) (on|off) (?:the |my )?(?:auto|adaptive)[- ]?brightness$/)) || (m = t.match(/^(enable|disable) (?:the |my )?(?:auto|adaptive)[- ]?brightness$/)) || (m = t.match(/^(?:auto|adaptive)[- ]?brightness (on|off)$/)))
      return act('brightness', /^(?:off|disable)$/.test(m[1]) ? 'auto:off' : 'auto:on');
    if (/^(?:turn|switch|set)? ?(?:on|off|enable|disable) (?:the |my )?(?:dark (?:theme|mode)|night mode|eye comfort(?: shield| mode)?|blue light filter|reading mode)$|^(?:turn|switch) (?:the |my )?(?:dark (?:theme|mode)|eye comfort(?: shield| mode)?) (?:on|off)$|^(?:dark theme|eye comfort(?: shield)?)(?: on| off)?$/.test(t)) return act('settings', 'display');
    if (/^keep (?:my |the )?screen (?:on|awake)(?: for \d+ (?:minutes?|mins?|hours?))?$|^(?:change|set) (?:the )?screen (?:timeout|time ?out)/.test(t)) return act('settings', 'screentimeout');
    // ---- power and battery
    if (/^(?:is|are) (?:my )?(?:phone )?(?:charging|plugged in)$|^is (?:the )?(?:phone|it) charging$/.test(t)) return act('battery', '', '', true);
    if (/^(?:turn|switch|set)? ?(?:on|off|enable|disable) (?:the |my )?(?:power|battery) sav(?:ing|er)(?: mode)?$|^(?:turn|switch) (?:the |my )?(?:power|battery) sav(?:ing|er)(?: mode)? (?:on|off)$|^(?:power|battery) sav(?:ing|er)(?: mode)?$/.test(t)) return act('settings', 'batterysaver');
    if (/^(?:show|open|see|check)(?: me)?(?: the| my)? battery (?:usage|use|details|stats)(?: details)?$|^which apps? (?:is|are) (?:using|draining|eating) (?:the )?(?:most )?(?:of )?(?:my )?battery(?: the most)?$|^what(?:'s| is) (?:using|draining|eating) (?:my )?battery$/.test(t)) return act('settings', 'battery');
    if (/^which apps? (?:is|are) using (?:the )?(?:most )?(?:of )?(?:my )?(?:mobile |cellular )?data(?: the most)?$|^(?:show|open|see|check)(?: me)?(?: the| my)? data usage$/.test(t)) return act('settings', 'datausage');
    if (/^(?:restart|reboot|power (?:off|down)|shut ?down|switch off|turn off)(?: my| the)? (?:phone|device|mobile)$|^power menu$|^show (?:the )?power menu$/.test(t)) return act('key', 'power');
    // ---- camera and screen capture
    if (/^(?:take|capture|grab) (?:a )?screenshot$|^screen ?shot$/.test(t)) return act('key', 'screenshot');
    if ((m = t.match(/^(?:take|snap|click|capture) (?:a |another )?(?:photo|picture|pic|snap)(?: in (\d{1,2}) seconds?)?$/)) || (m = t.match(/^(?:take|click|snap) (?:a )?(?:photo|picture|pic) in (\d{1,2}) seconds?$/)))
      return act('camera', 'photo' + (m[1] ? ':' + m[1] : ''));
    if (/^(?:take|click|snap) (?:a |my )?selfie(?: in (\d{1,2}) seconds?)?$|^selfie(?: mode)?$/.test(t)) return act('camera', 'selfie' + ((t.match(/in (\d{1,2}) seconds?/) || [])[1] ? ':' + t.match(/in (\d{1,2}) seconds?/)[1] : ''));
    if (/^(?:record|shoot|start recording)(?: a)?(?: new)? video$|^start recording$|^video mode$/.test(t)) return act('camera', 'video');
    if (/^open (?:the |my )?camera(?: in (?:portrait|photo|picture) mode| app)?$|^camera$|^portrait mode$/.test(t)) return act('camera', 'photo');
    if ((m = t.match(/^open (?:google )?chrome (?:and|then) (?:search|google|look up)(?: for)? (.{2,100})$/))) return act('search', m[1]);
    if (/^open (?:an? )?incognito (?:tab|window)(?: in chrome)?$|^(?:new )?incognito (?:tab|mode)$/.test(t)) return say('Chrome keeps incognito behind its menu, ' + addrName() + '. Open Chrome, tap the three dots, then New Incognito tab.');
    // ---- apps
    if (/^(?:show|open|see)(?: me)?(?: the| my)? recent apps$|^recent apps$|^app switcher$/.test(t)) return act('key', 'recents');
    if ((m = t.match(/^(?:close|quit|exit|kill|force stop) (?:the |my )?(?!window$|tab$|it$|that$|this$|jarvis$)(.{2,30}?)(?: app)?$/)) && !/^(?:chat|settings|panel|menu|conversation|routines?|memory|notes?)$/.test(m[1]))
      return say('Android does not let one app close another, ' + addrName() + '. Say “show recent apps” and swipe ' + cap1(m[1]) + ' away, or I can take you home.');
    if (/^(?:go )?home(?: screen)?$|^take me to (?:the )?home screen$/.test(t)) return act('key', 'home');
    if (/^(?:go )?back$/.test(t)) return act('key', 'back');
    // ---- browser, media, music
    if (/^bookmark(?: this)?(?: web ?page| page| site| tab)?$/.test(t)) return say('Android does not let apps bookmark for you, ' + addrName() + '. In Chrome tap the three dots, then the star.');
    if (/^(?:show|open|see)(?: me)?(?: my| the)? (?:chrome|browser|browsing) history$/.test(t)) return act('url', 'https://myactivity.google.com/product/chrome');
    if ((m = t.match(/^(?:skip|forward|fast forward|go forward|jump ahead) (\d{1,3}) seconds?$|^(?:forward|fast forward)$/))) return act('media', 'forward');
    if (/^(?:rewind|go back|back up|skip back|jump back) (?:\d{1,3} )?seconds?$|^rewind$/.test(t)) return act('media', 'rewind');
    if (/^(?:turn on|show|enable|switch on) (?:the )?(?:subtitles|captions|cc|closed captions)$/.test(t)) return act('tap', 'subtitles');
    if (/^(?:turn off|hide|disable|switch off) (?:the )?(?:subtitles|captions|cc|closed captions)$/.test(t)) return act('tap', 'subtitles');
    if ((m = t.match(/^(?:play|put on|start|open)(?: some)? (.{2,80}?) (?:on|in|from|using) spotify$/)) || (m = t.match(/^spotify (?:play )?(.{2,80})$/)) || (m = t.match(/^(?:open spotify (?:and|then) play) (.{2,80})$/)))
      return act('spotify', m[1].replace(/^my /, ''));
    if (/^what(?:'s| is) (?:this song|the song|that song|playing)(?: playing)?(?: right now| now)?$|^what song is (?:this|playing)(?: right now| now)?$|^which song is (?:this|playing)$/.test(t)) return act('key', 'notifications');
    // ---- Gmail / Drive
    if ((m = t.match(/^search (?:my )?(?:gmail|email|emails|mail|inbox)(?: for)? (?:emails? |mails? |messages? )?from (.{2,60})$/))) return act('url', 'https://mail.google.com/mail/u/0/#search/from%3A' + encodeURIComponent(m[1]));
    if ((m = t.match(/^search (?:my )?(?:gmail|email|emails|mail|inbox)(?: for)? (.{2,80})$/))) return act('url', 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(m[1]));
    if (/^(?:read|check|show|open)(?: me)?(?: my)? (?:unread|new) (?:emails?|mails?|gmail|messages)$|^do i have (?:any )?(?:new|unread) (?:emails?|mails?)$/.test(t)) return act('url', 'https://mail.google.com/mail/u/0/#search/is%3Aunread');
    if ((m = t.match(/^(?:draft|write|compose|send|create)(?: me)?(?: an?| the)? (?:new )?(?:e-?mail|mail)(?: to (.{1,50}?))?(?:(?: saying| that says| telling (?:him|her|them)| with(?: the)? (?:message|text)| about| :|:) (.+))?$/)))
      return act('mailto', (m[1] || '').trim(), cap1((m[2] || '').trim()));
    if ((m = t.match(/^(?:find|search|look for|open)(?: me)?(?: my)? (.{2,60}?) (?:in|on|from) (?:my )?(?:google )?drive$/)) || (m = t.match(/^search (?:google )?drive for (.{2,60})$/)))
      return act('url', 'https://drive.google.com/drive/search?q=' + encodeURIComponent(m[1]));
    if (/^summari[sz]e (?:the )?(?:document|doc|file|pdf)\b.+\bdrive$/.test(t)) return say('I cannot read files inside Google Drive yet, ' + addrName() + '. Open the document on screen and say “summarize this article on my screen”.');
    // ---- maps
    if ((m = t.match(/^(?:find|show|search for|look for|where(?:'s| is| are))(?: me)?(?: the)?(?: nearest| nearby| closest| some| a| an)? (.{2,40}?)(?: (?:near me|nearby|around here|close by|along my route|on my route|near here))$/)) ||
        (m = t.match(/^(?:find|show|search for|look for)(?: me)? (?:the )?(?:nearest|nearby|closest) (.{2,40})$/)) || (m = t.match(/^(?:find|show) nearby (.{2,40})$/)))
      return act('map', m[1] + ' near me');
    if ((m = t.match(/^how far (?:is it |am i )?(?:to|from here to) (.{2,60})$/)) || (m = t.match(/^(?:what(?:'s| is) )?the traffic (?:like )?(?:on the way |on my way |on the route )?(?:to|toward|towards) (.{2,60})$/)))
      return act('navigate', /^work$/.test(m[1]) ? 'Work' : m[1]);
    if (/^avoid tolls(?: on this route)?$/.test(t)) return say('Google Maps keeps “avoid tolls” in its own route options, ' + addrName() + '. Tap the three dots on the route screen, then Route options.');
    // ---- fitness (needs a fitness app that Jarvis cannot read)
    if (/^(?:start|pause|stop|end|resume) (?:my |a |the )?workout$|^what(?:'s| is) my heart rate$|^how many steps(?: have i taken| did i take)?(?: today)?$|^log \d+ ?(?:ml|l|oz|cups?) of water$/.test(t))
      return say('Fitness data lives inside your health app, ' + addrName() + ', and Android does not share it with Jarvis. Open the app and I will help with the rest.');
    // ---- calls and messages
    if (/^redial(?: the)?(?: last)?(?: number| call)?$|^call (?:the )?last number(?: again)?$|^call (?:back )?(?:the )?last (?:person|number)$/.test(t)) return act('redial');
    if ((m = t.match(/^reply to (.{1,40}?) (?:saying|with|that says|and say) (.+)$/))) return act('sms', m[1], cap1(m[2]));
    if ((m = t.match(/^(?:send|write)(?: a)? whats ?app(?: message| text)? to (.{1,40}?)(?:(?: saying| that says| with| :|:) (.+))?$/)) || (m = t.match(/^whats ?app (.{1,40}?)(?: saying| that says|:) (.+)$/)))
      return act('whatsapp', m[1], cap1((m[2] || '').trim()));
    if ((m = t.match(/^(?:make|start|place)(?: a)? whats ?app (?:voice |video )?call to (.{1,40})$/)) || (m = t.match(/^(?:call|video call) (.{1,40}?) on whats ?app$/)))
      return act('whatsapp', m[1], '');
    if (/^(?:read|check|show)(?: me)?(?: my)? (?:latest|last|new|unread) (?:text|sms|message)s?(?: message)?$|^do i have (?:any )?new (?:messages|texts)$|^(?:read|show)(?: me)?(?: my)? unread whats ?app(?: messages)?$/.test(t))
      return act('key', 'notifications');
    // ---- alarms and timers
    if (/^(?:show|open|see|list)(?: me)?(?: my| the)? alarms$|^what alarms (?:do i have|are set)$/.test(t)) return act('clockui', 'alarms');
    if ((m = t.match(/^(?:cancel|delete|remove|turn off|switch off|dismiss) (?:my |the )?(\d{1,2})(?::(\d{2}))? ?(am|pm)? alarm$/))) {
      var ch = parseInt(m[1], 10), cm = m[2] ? parseInt(m[2], 10) : 0; if (m[3] === 'pm' && ch < 12) ch += 12; if (m[3] === 'am' && ch === 12) ch = 0;
      return act('clockui', 'dismiss:' + ch + ':' + cm);
    }
    if (/^(?:turn off|cancel|delete|remove|switch off|dismiss) (?:all |every |my )?(?:my )?alarms?$/.test(t)) return act('clockui', 'alarms');
    if (/^snooze(?: the)?(?: alarm)?$/.test(t)) return act('clockui', 'snooze');
    if (/^(?:pause|resume|reset|cancel|stop|show|check|how much time is left on)(?: the| my)? timers?(?: left)?$|^show (?:the )?remaining timer$|^(?:how much|what) time (?:is )?left(?: on (?:the|my) timer)?$/.test(t)) return act('clockui', 'timers');
    // ---- reminders by place, tasks, calendar
    if (/^remind me .+ when i (?:arrive|get|reach|leave|am near)\b/.test(t)) return say('Place-based reminders need background location, ' + addrName() + ', which Jarvis does not use. Tell me a time instead, for example “remind me to call dad at 5 pm”.');
    if (/^(?:what(?:'s| is| are) )?(?:my )?(?:tasks?|to-?dos?)(?: (?:for )?today)?$|^what(?:'s| is| are) my tasks for today$/.test(t)) {
      var tk = listGet('task'); return say(tk.length ? 'Your tasks: ' + tk.join(', ') + '.' : 'Your task list is empty, ' + addrName() + '. Say “add buy milk to my task list”.');
    }
    if ((m = t.match(/^mark (.{2,60}?) (?:as )?(?:complete|completed|done|finished)$/))) {
      var gone = listRemove('task', m[1]) || listRemove('todo', m[1]) || listRemove('shopping', m[1]);
      return say(gone ? 'Marked ' + gone + ' as done. Well done, ' + addrName() + '.' : 'I could not find “' + m[1] + '” on your task list.');
    }
    if ((m = t.match(/^(?:add|create|schedule|set up|put|book)(?: me)?(?: an?| the)? (?:new )?(?:calendar )?(?:event|meeting|appointment)(?: with (.{1,40}?))?(?: called| named| titled|:| for| on| at| tomorrow| today| tonight|$)(.*)$/)) && /(?:event|meeting|appointment)/.test(t)) {
      var ev = eventWhen(((m[2] || '') + ' ').replace(/^[:\s]+/, ' ')), who = m[1], ttl = ev.title || (who ? 'Meeting with ' + cap1(who) : 'Event');
      if (who && ev.title && !/with/i.test(ev.title)) ttl = cap1(ev.title) + ' with ' + cap1(who); else ttl = cap1(ttl);
      return act('calins', ttl, ev.ms ? String(ev.ms) : '');
    }
    if ((m = t.match(/^(?:add|create) (?:an? )?(?:calendar )?event[: ]+(.+)$/))) { var e2 = eventWhen(m[1]); return act('calins', cap1(e2.title || 'Event'), e2.ms ? String(e2.ms) : ''); }
    if ((m = t.match(/^schedule (?:a )?(?:meeting|call) with (.{1,40}?) (?:for |on |at )?((?:tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next|on|at|\d).*)$/))) { var e3 = eventWhen(m[2]); return act('calins', 'Meeting with ' + cap1(m[1]), e3.ms ? String(e3.ms) : ''); }
    if (/^(?:cancel|delete|remove) (?:my |the )?(?:meeting|event|appointment)\b/.test(t)) return act('open', 'calendar');
    // ---- on-screen awareness (reads the open screen through the Accessibility service, then the AI answers)
    if (/^what(?:'s| is) on (?:my |the )?screen$|^(?:read|describe) (?:my |the )?screen$/.test(t)) return { kind: 'screen', task: 'Describe briefly what is on the screen.' };
    if (/^(?:summari[sz]e|sum up) (?:this|the|that)(?: article| page| text| screen| post| message| email)?(?: on (?:my |the )?screen)?$/.test(t)) return { kind: 'screen', task: 'Summarize the main text on the screen in a few short sentences.' };
    if ((m = t.match(/^translate (?:this|the|that)(?: text| page| screen| message)?(?: on (?:my |the )?screen)?(?: (?:to|into) ([a-z ]{3,20}))?$/))) return { kind: 'screen', task: 'Translate the main text on the screen into ' + (m[1] || 'English') + '. Output only the translation.' };
    if (/^what(?:'s| is) (?:this |the )?(?:product|item|object|thing|brand|place|person) (?:in |on )?(?:this |the )?(?:photo|picture|image|screen)(?: on (?:my |the )?screen)?$/.test(t))
      return say('I can only read text on the screen, ' + addrName() + ', not pictures. Describe what you see, or say “what is on my screen” and I will read the labels around it.');
    // ---- diagnostics
    if (/^how do i (?:enable|turn on|unlock|open|get) developer (?:options|mode)$|^(?:enable|open|turn on) developer options$/.test(t)) return say('Open Settings, About phone, and tap Build number seven times. Then Developer options appears in Settings, System. Say “open developer settings” and I will take you there once it is on.');
    if (/^(?:open|show) developer (?:options|settings)$/.test(t)) return act('settings', 'developer');
    if (/^(?:show|open)(?: me)? accessibility(?: features| settings| options)?(?: for screen reading)?$|^show me accessibility features.*$/.test(t)) return act('settings', 'accessibility');
    if (/^why is my (?:phone|storage)(?: running)? (?:out of|low on|full)(?: storage| space)?(?: space)?$|^why is (?:my )?(?:phone |storage )?(?:storage |space )?(?:full|low)$/.test(t)) return { kind: 'sys', card: 'sto', fn: function (d) { return d.stoFreeGB !== undefined ? 'Storage: ' + d.stoFreeGB + ' GB free of ' + d.stoTotalGB + ' GB. Open Settings, Storage to see which apps use the most; photos, videos and app caches are the usual culprits.' : 'Open Settings, Storage to see what is using the space.'; } };
    return null;
  }
  /* Everyday commands that work the same on phone and PC */
  function generalIntent(t, raw) {
    var m;
    if (/^(?:turn up|raise|increase|bump up|crank up)(?: the)? (?:volume|sound)$|^(?:volume|sound) (?:up|higher)$|^louder$/.test(t)) return act('volume', 'up');
    if (/^(?:turn down|lower|decrease|reduce)(?: the)? (?:volume|sound)$|^(?:volume|sound) (?:down|lower)$|^(?:quieter|softer)$/.test(t)) return act('volume', 'down');
    if ((m = t.match(/^(?:create|make|add|take|write|save)(?: me)?(?: a| new)? note[:,-]? (?:that |to )?(.{2,300})$/)))
      return { kind: 'ui', fn: function () { var n = notesGet(); n.push(raw.replace(/^\s*(?:please\s+)?(?:create|make|add|take|write|save)(?:\s+me)?(?:\s+a|\s+new)?\s+note[:,\s-]*(?:that\s+|to\s+)?/i, '').trim().slice(0, 500)); notesSet(n.slice(-100)); }, text: 'Noted, ' + addrName() + '.', silent: false };
    if ((m = t.match(/^(?:please )?(?:remember|keep in mind|note)(?: that)? (i .{3,200})$/)))
      return { kind: 'ui', fn: function () { memAdd(raw.replace(/^\s*(?:please\s+)?(?:remember|keep in mind|note)(?:\s+that)?\s+/i, '').replace(/[.!\s]+$/, '').trim()); }, text: 'Noted, ' + addrName() + '. I will remember that ' + memVoice(m[1]) + '.', silent: false };
    if ((m = t.match(/^(?:where|what|when|who|which) (?:did|do|was|is|are|have) (?:i|my) (.+)$/)) && memGet().length) {
      var hit = memFind(t);
      if (hit && hit.length) return say(memVoice(hit[0].m ? hit[0].m.f : String(hit[0].f || '')) + '.');
    }
    if (/^let(?:'s| us) talk$|^start (?:a )?(?:conversation|live conversation|voice chat)$|^talk to me$/.test(t))
      return { kind: 'ui', fn: function () { try { setCall(true); } catch (e) { /* */ } try { startListening(); } catch (e2) { /* */ } }, text: 'I am listening, ' + addrName() + '. Say “stop” when we are done.', silent: false };
    return null;
  }

  function localIntent(raw) {
    var t = norm(raw), m;
    if (!t) return null;
    var lx = linkExtraIntent(t); if (lx) return lx;
    var rt = splitTarget(t);
    if (rt) { ctxNote(rt.target); return remoteIntent(rt); }
    var cf = ctxFollow(t);
    if (cf) return cf;
    if (PC) { var pi = pcIntent(t); if (pi) return pi; }
    var gi = generalIntent(t, raw); if (gi) return gi;
    if (!PC) { var ph = phoneIntent(t, raw); if (ph) return ph; }
    var rtm = rtGet().length ? rtFind(t) : null;
    if (rtm) return { kind: 'ui', fn: function () { runRoutine(rtm); }, noHistory: true };
    if (/^(?:my routines|show (?:my )?routines|routines|edit (?:my )?routines|create (?:a )?routine)$/.test(t))
      return { kind: 'ui', fn: openRoutines, text: 'Here are your routines, ' + addrName() + '.', silent: false };
    if (/^(?:leaving home|i(?:'m| am) leaving(?: home)?|heading out|i(?:'m| am) going out|i(?:'m| am) (?:home|back)|back home|reached home|i(?:'m| am) at home)$/.test(t))
      return { kind: 'brief' };

    if (/^(stop|quiet|silence|shut up|be quiet|cancel|enough|never ?mind)$/.test(t))
      return { kind: 'ui', fn: function () { if (callMode) setCall(false); handsFreeSuspended = true; stopSpeakingNow(); try { B && B.stopListening(); } catch (e) { /* */ } setState('idle'); }, text: 'Standing by.', silent: true };
    if (/^(?:clear|reset|delete|wipe) (?:the |our )?(?:chat|conversation|history|memory)$/.test(t))
      return { kind: 'ui', fn: clearChat, text: 'Conversation cleared.', silent: false, noHistory: true };
    if (/^(?:open |show )?(?:jarvis |your |system )?(?:settings|config|configuration|preferences)$/.test(t) && !/^open settings$/.test(t))
      return { kind: 'ui', fn: openSettings, text: 'Opening system configuration.' };


    if (/^(?:flip a coin|toss a coin|heads or tails)$/.test(t)) return { kind: 'reply', text: Math.random() < 0.5 ? 'Heads.' : 'Tails.' };
    if (/^(?:roll (?:a |the )?(?:dice|die)|throw (?:a )?dice)$/.test(t)) return { kind: 'reply', text: 'You rolled a ' + (1 + Math.floor(Math.random() * 6)) + '.' };
    if ((m = t.match(/^(?:give me |pick )?(?:a )?random number(?: between (\d+) and (\d+))?$/))) {
      var lo = m[1] ? parseInt(m[1], 10) : 1, hi = m[2] ? parseInt(m[2], 10) : 100; if (hi < lo) { var tmp = lo; lo = hi; hi = tmp; }
      return { kind: 'reply', text: 'Your number is ' + (lo + Math.floor(Math.random() * (hi - lo + 1))) + '.' };
    }
    if (/^(?:tell me a fact|fun fact|random fact|did you know)$/.test(t)) {
      var FACTS = ['Honey never spoils; edible honey has been found in ancient Egyptian tombs.', 'Octopuses have three hearts and blue blood.', 'A day on Venus is longer than its year.', 'Bananas are berries, but strawberries are not.', 'Lightning is about five times hotter than the surface of the sun.', 'The Eiffel Tower grows about fifteen centimetres taller in summer heat.'];
      return { kind: 'reply', text: FACTS[Math.floor(Math.random() * FACTS.length)] };
    }
    if (/^(?:motivate me|inspire me|give me (?:a )?(?:quote|motivation)|quote of the day)$/.test(t)) {
      var QS = ['The best way to predict the future is to build it.', 'Small steps, taken daily, move mountains.', 'Discipline is choosing what you want most over what you want now.', 'Done is better than perfect, and perfect is built from done.', 'Stay curious, stay relentless, ' + addrName() + '.'];
      return { kind: 'reply', text: QS[Math.floor(Math.random() * QS.length)] };
    }
    if (/^(?:who (?:created|made|built|developed|designed|programmed) you|who is your (?:creator|maker|developer|owner)|who(?:'s| is) your boss|who invented you)$/.test(t))
      return { kind: 'reply', text: 'I was created by MD Humayun Rashid Suchock.' };
    if (/^(?:who are you|what are you|introduce yourself|what is your name|what's your name)$/.test(t))
      return { kind: 'reply', text: 'I am J.A.R.V.I.S, your personal assistant, created by MD Humayun Rashid Suchock. I can talk, call, open apps, type for you and answer questions. Say “help” to see what I can do.' };
    // --- extra skills: lists, password, focus session, chooser, spelling
    if ((m = t.match(/^(?:please )?add (.{1,80}?) to (?:my |the )?([a-z-]{3,14} )?list$/))) {
      var ln = listName(m[2]), li = raw.replace(/^\s*(?:please\s+)?add\s+/i, '').replace(/\s+to (?:my |the )?(?:[A-Za-z-]{3,14} )?list[.!\s]*$/i, '').trim();
      return { kind: 'ui', fn: function () { listAdd(ln, li); }, text: 'Added ' + li + ' to your ' + ln + ' list, ' + addrName() + '.', silent: false };
    }
    if ((m = t.match(/^(?:show|read|open|what(?:'s| is) on|list)(?: me)?(?: out)? (?:my |the )?([a-z-]{3,14} )?list$/)) || (m = t.match(/^what(?:'s| is) on (?:my |the )([a-z-]{3,14}) list$/))) {
      var ln2 = listName(m[1]), it = listGet(ln2);
      return { kind: 'reply', text: it.length ? 'Your ' + ln2 + ' list: ' + it.join(', ') + '.' : 'Your ' + ln2 + ' list is empty. Say “add milk to my ' + ln2 + ' list”.' };
    }
    if ((m = t.match(/^(?:remove|delete|take off|cross off) (.{1,80}?) (?:from|off) (?:my |the )?([a-z-]{3,14} )?list$/))) {
      var ln3 = listName(m[2]), gone = listRemove(ln3, m[1]);
      return { kind: 'reply', text: gone ? 'Removed ' + gone + ' from your ' + ln3 + ' list.' : 'I could not find that on your ' + ln3 + ' list.' };
    }
    if ((m = t.match(/^(?:clear|empty|wipe) (?:my |the )?([a-z-]{3,14} )?list$/))) {
      var ln4 = listName(m[1]);
      return { kind: 'ui', fn: function () { listClear(ln4); }, text: 'Your ' + ln4 + ' list is cleared.', silent: false };
    }
    if ((m = t.match(/^(?:generate|make|create|give me)(?: me)?(?: a)?(?: strong| random| secure)? password(?: (?:of|with|that is) (\d{1,2}) (?:characters|chars|letters))?$/))) {
      var pw = makePassword(Math.max(8, Math.min(40, parseInt(m[1], 10) || 16)));
      return { kind: 'ui', fn: function () { copyTxt(pw); toast('Password copied: ' + pw, 12000); }, text: 'A new password is on your clipboard, ' + addrName() + '. I will not read it aloud. Paste it where you need it.', silent: false, noHistory: true };
    }
    if ((m = t.match(/^(?:start |begin |run )?(?:a |the )?(?:focus|pomodoro)(?: session| timer)?(?: for (\d{1,3}) minutes?)?$/))) {
      var fm = Math.max(1, Math.min(180, parseInt(m[1], 10) || 25));
      return act('timer', String(fm * 60) + '|Focus session over. Take a short break');
    }
    if ((m = t.match(/^(?:choose|pick|decide) (?:between )?(.{1,60}?) (?:or|and) (.{1,60})$/)) || (m = t.match(/^should i (.{1,60}?) or (.{1,60})$/))) {
      var ch = Math.random() < 0.5 ? m[1] : m[2];
      return { kind: 'reply', text: 'I would go with ' + ch.replace(/^(?:the )/, '') + ', ' + addrName() + '.' };
    }
    if ((m = t.match(/^spell (?:the word )?([a-z'-]{2,30})$/)))
      return { kind: 'reply', text: m[1].toUpperCase().split('').join(' ') + '.' };
    if (/^(?:thanks|thank you|thanks jarvis|thank you jarvis|cheers)$/.test(t))
      return { kind: 'reply', text: 'Always a pleasure, ' + addrName() + '.' };
    if (/^(?:good night|goodnight)$/.test(t))
      return { kind: 'reply', text: 'Good night, ' + addrName() + '. Systems will remain on standby.' };
    if (/^(?:how are you|how are you doing)$/.test(t))
      return { kind: 'reply', text: 'All systems nominal, ' + addrName() + '. How may I assist?' };
    if (/^(?:system status|diagnostics|run diagnostics)$/.test(t))
      return { kind: 'reply', text: (function () { var o = providerOrder(), p = perms(); return 'Diagnostics: AI link ' + (o.length ? o[0].name + ' online-ready' : 'not configured') + '; microphone ' + (p.mic ? 'ok' : 'missing') + '; typing control ' + (p.access ? 'ok' : 'off') + '; commands this session ' + cmdCount + '.'; })() };

    if (/^(?:all commands|command list|command cards|(?:show|open) (?:me )?(?:the )?(?:command|commands) (?:cards|list)|examples|show examples)$/.test(t))
      return { kind: 'ui', fn: openCmds, text: 'Here are the things I can do, ' + addrName() + '. Tap one to try it.', silent: true };
    if (/^(?:open|show|view|see) (?:my |the )?(?:chat |conversation )?history$/.test(t))
      return { kind: 'ui', fn: function () { openHistory(''); }, text: 'Opening your history.', silent: true };
    if ((m = t.match(/^search (?:my |the )?(?:chat |conversation )?history (?:for |about )?(.+)$/)))
      return { kind: 'ui', fn: function () { openHistory(m[1]); }, text: 'Searching your history for ' + m[1] + '.', silent: true };
    if ((m = t.match(/^(?:switch|change|set|use|go)(?: to| the| my)* ?(cyan|blue|amber|orange|red|green|purple|mark|friday) (?:theme|mode|colou?rs?)$/)) || (m = t.match(/^(?:change|switch|set) (?:the |my )?(?:theme|colou?rs?)(?: to)? (cyan|blue|amber|orange|red|green|purple|mark|friday)$/))) {
      var thn = { blue: 'cyan', orange: 'amber' }[m[1]] || m[1];
      return { kind: 'ui', fn: function () { S.theme = thn; applyTheme(thn); save(); }, text: 'Theme changed to ' + thn + '.', silent: false };
    }
    if (/^(?:help|what can you do|what can i say|commands|show commands|show help)$/.test(t))
      return { kind: 'reply', text: 'Try: “call Mom”, “open YouTube”, “play lofi music on YouTube”, “weather in Dhaka”, “set a timer for 5 minutes”, “remind me to call Mom at 5 pm”, “wake me at 7”, “flashlight on”, “write an email in Notepad”, “remember my wifi is …”, “show my notes”, “delete note 2”, “what is 15% of 240”, “good morning” for a briefing, “every day at 8 remind me to …”, “snooze 10 minutes”, “show history”, “system monitor” for live graphs, “how much storage do I have”, “convert 5 km to miles”, “days until Christmas”, “show command cards” for tappable examples, “copy that”, “speak Bangla”, “flip a coin”, “roll a dice”, “tell me a fact”, “motivate me”, “system status”.' };
    if ((m = t.match(/^(?:please )?(?:remember|keep in mind|store)(?: that)? (my .+|that .+? (?:is|are|was|lives?|stays?|works?|starts?|ends?) .+)$/)) && !/^(?:remember|keep in mind) to\b/.test(t)) {
      var fact = raw.replace(/^\s*(?:please\s+)?(?:remember|note|save|keep in mind|store)(?: that)?\s+/i, '').replace(/[.!\s]+$/, '').trim();
      return { kind: 'ui', fn: function () { memAdd(fact); }, text: 'Noted, ' + addrName() + '. I will remember that ' + memVoice(fact) + '.', silent: false };
    }
    if (/^(?:what do you (?:remember|know) about me|what (?:have|did) i (?:told|tell) you|show (?:me )?(?:my )?(?:memory|memories|facts)|(?:open|list) (?:my )?(?:memory|memories)|what do you remember)$/.test(t))
      return { kind: 'ui', fn: openMemory, text: memGet().length ? 'Here is everything I remember, ' + addrName() + '.' : 'I have nothing saved yet. Say “remember my gym is at 6”.', silent: false };
    if ((m = t.match(/^(?:what(?:'s| is| are| was)|where(?:'s| is)|when(?:'s| is)|who(?:'s| is)|do you remember|tell me|recall|remind me(?: about)?) (?:about )?(my .+)$/)) && memGet().length) {
      var hits = memFind(m[1]);
      if (hits.length) return { kind: 'reply', text: hits.slice(0, 2).map(function (h) { return memVoice(h.f); }).join('. ').replace(/^./, function (c) { return c.toUpperCase(); }) + ', ' + addrName() + '.' };
    }
    if (/^forget (?:everything|all)(?: you (?:remember|know))?(?: about me)?$/.test(t))
      return { kind: 'ui', fn: function () { askConfirm('Erase everything I remember about you?', function () { memSet([]); respond('Memory erased, ' + addrName() + '.'); }); }, noHistory: true };
    if ((m = t.match(/^forget (?:that |about )?(my .+)$/)) && memFind(m[1]).length) {
      var gone = memFind(m[1])[0];
      return { kind: 'ui', fn: function () { memSet(memGet().filter(function (q) { return !(q.t === gone.t && q.f === gone.f); })); }, text: 'Forgotten, ' + addrName() + '.', silent: false };
    }
    if (/^(?:news|the news|latest news|top news|news headlines|headlines|what(?:'s| is) (?:in )?the news|what(?:'s| is) the latest news|news briefing|morning news)$/.test(t))
      return hasSearch() ? { kind: 'tool', tool: 'websearch', arg: 'top world news headlines today' } : { kind: 'reply', text: 'To read you the news I need a web search key, ' + addrName() + '. Add a free Tavily key in Settings under Services.' };
    if (/^(?:shut ?down|power down|power off|go to sleep|sleep mode|goodbye|good bye|bye bye|see you later|see you tomorrow)(?: jarvis)?$/.test(t))
      return { kind: 'ui', fn: function () { stopSpeakingNow(); setTimeout(shutdownSeq, 900); }, text: 'Powering down, ' + addrName() + '. Call me when you need me.', silent: false };
    if (/^(?:offline mode|offline commands|what (?:can|do) you do offline|what works offline|what works without (?:the )?internet|what can you do without (?:the )?internet)$/.test(t))
      return { kind: 'reply', text: 'Offline I can ' + OFFLINE_OK + '.' };
    if ((m = t.match(/^(?:remember|note|make a note|take a note|save a note)(?: that)?(?: to)? (.+)$/)))
      return { kind: 'ui', fn: function () { var n = notesGet(); n.push(raw.replace(/^\s*(?:remember|note|make a note|take a note|save a note)(?: that)?(?: to)?\s+/i, '').trim()); notesSet(n.slice(-100)); }, text: 'Noted, ' + addrName() + '.' };
    if (/^(?:open|go to)(?: my| the)? notes(?: app| panel| page)?$|^(?:add|write|start) (?:a )?(?:new )?note$/.test(t))
      return { kind: 'ui', fn: function () { openNotes(true); }, text: 'Opening your notes, ' + addrName() + '.', silent: true };
    if (/^(?:show|read|list|what are)(?: me)?(?: all)?(?: my| the)? notes$/.test(t) || /^what did i ask you to remember$/.test(t))
      return { kind: 'reply', text: (function () { var n = notesGet(); return n.length ? 'Your notes:\n' + n.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n') : 'You have no notes yet.'; })() };
    var tnote = t.replace(/^(delete|remove|erase|forget|cancel) (?:my |the )?(last|latest|first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)) note$/, '$1 note $2');
    if ((m = tnote.match(/^(?:delete|remove|erase|forget|cancel) (?:my |the )?notes?(?: number| no\.?| #)? ?(.+)$/)) && !/^all\b/.test(m[1])) {
      var WN = { one: 1, first: 1, two: 2, second: 2, to: 2, too: 2, three: 3, third: 3, four: 4, for: 4, fourth: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10 };
      var nts = notesGet(), want = [], bad = false;
      m[1].replace(/(?:number|no\.?|#|and|&|,)/g, ' ').split(/\s+/).forEach(function (w) {
        if (!w) return;
        var n = /^\d+$/.test(w) ? parseInt(w, 10) : (w === 'last' || w === 'latest' ? nts.length : WN[w.replace(/(?:st|nd|rd|th)$/, '')] || WN[w]);
        if (!n) { bad = true; return; }
        if (want.indexOf(n) < 0) want.push(n);
      });
      if (want.length && !bad) {
        var ok = want.filter(function (n) { return n >= 1 && n <= nts.length; }).sort(function (a, b) { return a - b; });
        if (!ok.length) return { kind: 'reply', text: nts.length ? 'There is no such note. You have ' + nts.length + ' note' + (nts.length > 1 ? 's' : '') + '.' : 'You have no notes to delete.' };
        var gone = ok.map(function (n) { var x = nts[n - 1]; return x.length > 40 ? x.slice(0, 40) + '…' : x; });
        return {
          kind: 'ui',
          fn: function () { var cur = notesGet(); notesSet(cur.filter(function (x, i) { return ok.indexOf(i + 1) < 0; })); },
          text: ok.length === 1 ? 'Deleted note ' + ok[0] + ': ' + gone[0] + '.' : 'Deleted notes ' + ok.join(' and ') + '.'
        };
      }
    }
    if (/^(?:clear|delete|erase) (?:all )?(?:my |the )?notes$/.test(t))
      return { kind: 'ui', fn: function () { notesSet([]); }, text: 'All notes erased.' };
    if (/^(?:copy that|copy this|copy the (?:last )?(?:reply|answer|message)|copy it)$/.test(t))
      return { kind: 'ui', fn: function () { var last = ''; for (var i = history.length - 2; i >= 0; i--) if (history[i].role === 'assistant') { last = history[i].content; break; } if (B && B.copyText) B.copyText(last); }, text: 'Copied to the clipboard.' };
    if (/^(?:good morning|good evening|good afternoon|briefing|daily briefing|brief me|status report|status)$/.test(t))
      return { kind: 'brief' };
    if (/^(?:open |show |show me )?(?:my |the )?(?:dashboard|home dashboard|overview)$/.test(t))
      return { kind: 'ui', fn: openDashboard, text: 'Opening your dashboard, ' + addrName() + '.', silent: true };
    if ((m = t.match(/^(?:what(?:'s| is| do i have)?(?: on)?|show|open|check|read)?\s*(?:me )?(?:my |the )?(?:phone )?(?:calendar|agenda|schedule|events|appointments|meetings)(?: for| on)?(?: (today|tomorrow|this week|next week|the week))?$|^what do i have (today|tomorrow|this week)$|^do i have (?:any )?(?:events|meetings|appointments)(?: (today|tomorrow|this week))?$/)))
      { var w = m[1] || m[2] || m[3] || 'today'; return { kind: 'cal', days: /tomorrow/.test(w) ? 2 : /week/.test(w) ? 7 : 1, label: w === 'the week' ? 'this week' : w }; }
    if (/^(?:what(?:'s| is) my )?next (?:event|meeting|appointment)$|^when(?:'s| is) my next (?:event|meeting|appointment)$/.test(t))
      return { kind: 'cal', days: 7, label: 'this week', next: true };
    if (/^(?:system monitor|show (?:me )?(?:the )?(?:system )?(?:graphs?|charts?|monitor|dashboard|stats|statistics)|(?:battery|system|usage) graphs?|dashboard|my stats|show my stats|usage report|weekly report|activity report)$/.test(t))
      return { kind: 'ui', fn: openMonitor, text: 'Opening the system monitor, ' + addrName() + '.', silent: true };
    if (/^(?:how much )?(?:storage|free space|disk space|space)(?: (?:do i have|is left|is free|left|is used|used))?(?: on my phone)?$|^how much (?:storage|space) (?:do i have|is left|is free|have i (?:got|used))$/.test(t))
      return { kind: 'sys', card: 'sto', fn: function (d) { return d.stoFreeGB !== undefined ? 'Storage: ' + d.stoFreeGB + ' GB free of ' + d.stoTotalGB + ' GB (' + d.stoPct + '% used).' : 'I cannot read storage here.'; } };
    if (/^(?:how much )?(?:memory|ram)(?: (?:usage|is used|is free|do i have|used|left))?$|^how much (?:memory|ram) (?:is (?:used|free)|do i have|have i (?:got|used))$/.test(t))
      return { kind: 'sys', card: 'ram', fn: function (d) { return d.ramPct !== undefined ? 'Memory: ' + d.ramPct + '% in use (' + d.ramUsedMB + ' of ' + d.ramTotalMB + ' MB).' : 'I cannot read memory here.'; } };
    if (/^(?:network status|network|internet status|am i online|am i connected|what network am i on|which network)$/.test(t))
      return { kind: 'sys', card: 'net', fn: function (d) { return d.net === 'wifi' ? 'You are online over Wi-Fi.' : d.net === 'mobile' ? 'You are online over mobile data.' : 'You appear to be offline.'; } };
    if (/^(?:battery (?:temperature|temp|health)|how hot is (?:my|the) phone|is my phone hot|phone temperature)$/.test(t))
      return { kind: 'sys', card: 'temp', fn: function (d) { return d.temp !== undefined ? 'Battery temperature is ' + d.temp + ' degrees Celsius' + (d.temp >= 42 ? ' — rather warm, let it rest.' : '.') : 'I cannot read the temperature here.'; } };
    if (/^(?:uptime|how long has my phone been (?:on|running)|phone uptime)$/.test(t))
      return { kind: 'sys', fn: function (d) { var mm = d.uptimeMin || 0, dd = Math.floor(mm / 1440), hh = Math.floor((mm % 1440) / 60); return 'Your phone has been running for ' + (dd ? dd + ' day' + (dd > 1 ? 's' : '') + ' ' : '') + hh + ' hour' + (hh === 1 ? '' : 's') + ' and ' + (mm % 60) + ' minutes.'; } };
    if ((m = t.match(/^(?:convert|change) (\d+(?:\.\d+)?) ?([a-z°]+(?: per hour)?) (?:to|in|into) ([a-z°]+(?: per hour)?)$/)) || (m = t.match(/^how many ([a-z°]+) (?:are )?in (\d+(?:\.\d+)?) ?([a-z°]+)$/)) && (m = [m[0], m[2], m[3], m[1]])) {
      var cv2 = convertUnits(parseFloat(m[1]), m[2], m[3]);
      if (cv2) return { kind: 'reply', text: m[1] + ' ' + cv2.from + ' = ' + cv2.val + ' ' + cv2.to + '.' };
    }
    if ((m = t.match(/^(?:how many )?days (?:until|till|to|left (?:until|till|for)) (.+)$/))) {
      var du = daysUntil(m[1]);
      if (du) return { kind: 'reply', text: du };
    }
    if ((m = t.match(/^(?:calculate |work out |what(?:'s| is) )?(?:a |the )?tip(?: of)? (\d+(?:\.\d+)?) ?(?:%|percent)? (?:on|of) (\d+(?:\.\d+)?)(?: (?:split )?(?:between|among|by|for) (\d+)(?: people)?)?$/))) {
      var bill = parseFloat(m[2]), tp = Math.round(bill * parseFloat(m[1])) / 100, tot2 = bill + tp, ppl = m[3] ? Math.max(1, parseInt(m[3], 10)) : 1;
      var fm = function (x) { return (Math.round(x * 100) / 100).toFixed(2); };
      return { kind: 'reply', text: 'Tip is ' + fm(tp) + ', total ' + fm(tot2) + (ppl > 1 ? ', which is ' + fm(tot2 / ppl) + ' each for ' + ppl + ' people.' : '.') };
    }
    if ((m = t.match(/^(?:calculate|compute|what(?:'s| is)|how much is|solve)? ?(.*\d.*)$/)) && /^[\d\s.,+\-*/x×÷%()a-z]+$/.test(m[1]) && /\d\s*(?:%\s*of|percent of|%|\+|-|\*|\/|x|×|÷|plus|minus|times|multiplied by|divided by|over|percent|of)\s*\(?\d/.test(m[1]) && !/[a-z]{2,}/.test(m[1].replace(/plus|minus|times|multiplied by|divided by|over|percent|of/g, ''))) {
      var cv = calc(m[1]);
      if (cv !== null) return { kind: 'reply', text: m[1].trim() + ' = ' + cv };
    }

    if ((m = t.match(/^(?:speak|talk|reply|listen|switch|change(?: language)?)(?: to| in)? (bangla|bengali|hindi|english|urdu|arabic)(?: language)?$/))) {
      var LC = { bangla: 'bn-BD', bengali: 'bn-BD', hindi: 'hi-IN', english: 'en-GB', urdu: 'ur-PK', arabic: 'ar-SA' }[m[1]];
      return { kind: 'ui', fn: function () { S.lang = LC; save(); }, text: m[1] === 'english' ? 'Switching to English.' : 'Switching to ' + m[1].charAt(0).toUpperCase() + m[1].slice(1) + '. You can speak to me in it now.', silent: false };
    }
    // typing into other apps (original capitalisation kept)
    var rawT = raw.replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim()
      .replace(/^(?:hey|ok|okay|hi|hello|yo)?\s*,?\s*jarvis[\s,:-]*/i, '').replace(/^(?:can you|could you|would you|will you)\s+/i, '').replace(/^please\s+/i, '').replace(/\s+please$/i, '');
    var NOTE_APPS = '(?:notepad|notes?|memo|keep|google keep|samsung notes|gmail|mail|whatsapp|telegram|messages?|messenger|docs|google docs|word|sms)';
    var GEN = /^(?:me |us )?(?:an? |the |some |my |one |long |short |formal |polite |professional )*(?:\w+ ){0,3}?(?:letter|e-?mail|essay|poem|story|code|program|script|function|paragraph|article|report|application|cv|resume|speech|song|html|python|javascript|java|css|c\+\+)\b|^(?:about|on) /i;
    var tApp = '', tTxt = '';
    if ((m = rawT.match(new RegExp('^(?:open )?(' + NOTE_APPS + ')(?: app)?(?: and| then)?,? (?:type|write)(?: down)? (.+)$', 'i')))) { tApp = m[1]; tTxt = m[2]; }
    else if ((m = rawT.match(new RegExp('^(?:type|write)(?: down)? (.+?) (?:in|on|into|in to) (?:the |my )?(' + NOTE_APPS + ')(?: app)?[.!]?$', 'i')))) { tTxt = m[1]; tApp = m[2]; }
    else if ((m = rawT.match(/^type(?: out)? (.+?) (?:in|on|into) (?:the |my )?([a-z][a-z0-9 ]{1,24}?)(?: app)?[.!]?$/i)) && !/^(?:the )?(?:box|field|text ?box|search ?bar|here|there|english|hindi|bangla|bengali)$/i.test(m[2])) { tTxt = m[1]; tApp = m[2]; }
    else if ((m = rawT.match(/^(?:type|type out|write down|dictate) (?!of\b|is\b|are\b|a\b.*\bof\b)(.+)$/i))) { tTxt = m[1].replace(/[.!]$/, ''); }
    if (tTxt) {
      if (GEN.test(tTxt.replace(/\bnew (?:paragraph|line)\b/gi, ''))) return null;           // "write a letter…" is for the AI, which formats it properly
      return act('type', fmtDictation(tTxt), tApp);
    }
    if ((m = t.match(/^(?:align|justify)(?: the)?(?: text)?(?: to)?(?: the)? ?(left|right|center|centre|justify|justified)?$/)) && (m[1] || /justify/.test(t))) return act('align', (m[1] || 'justify').replace('centre', 'center').replace('justified', 'justify'));
    if ((m = t.match(/^(left|right|center|centre|justify) (?:align|justify)(?: the text)?$|^(center|centre) the text$/))) return act('align', (m[1] || m[2]).replace('centre', 'center'));
    if (/^(?:answer|pick up|pickup|accept|receive|take)(?: the| this| that| my)?(?: incoming)?(?: phone)? ?(?:call|phone)$/.test(t))
      return act('callanswer', '', '', true);
    if (/^(?:reject|decline|dismiss|cut|ignore)(?: the| this| that| my)?(?: incoming)?(?: phone)? ?(?:call|phone)$/.test(t))
      return act('callreject', '', '', true);
    if (/^(?:end|stop|finish|hang up)(?: the| this)? ?call$|^hang up$|^(?:good ?bye|bye|bye bye|that'?s all|that is all)$/.test(t))
      return { kind: 'ui', fn: endCall, text: 'Ending the call, ' + addrName() + '. Tap the ball whenever you need me.', silent: false };
    var ORD = { first: 1, '1st': 1, one: 1, second: 2, '2nd': 2, two: 2, third: 3, '3rd': 3, three: 3, fourth: 4, '4th': 4, four: 4, fifth: 5, '5th': 5, five: 5 };
    if ((m = t.match(/^(?:play|open|start|watch|click|tap|select)(?: on)? (?:the )?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)(?: one| video| result| song| short)?$/)))
      return act('playnth', String(ORD[m[1]]));
    if ((m = t.match(/^(?:play|open|start|watch|select) (?:video|result|number) (\d)$/))) return act('playnth', m[1]);
    if (/^(?:play|start|watch) (?:the |that )?(?:video|result|top result|top video)$/.test(t)) return act('playnth', '1');
    var fd = feedIntent(t); if (fd) return fd;
    if (/^swipe (left|right)$/.test(t)) return act('swipe', t.split(' ')[1]);
    if (/^(?:like|subscribe)(?: (?:to )?(?:this |the )?(?:video|channel|short))?$/.test(t)) return act('tap', t.split(' ')[0]);
    if (/^skip (?:the )?ads?$/.test(t)) return act('tap', 'skip');
    if (/^(?:full ?screen|go full ?screen|enter full ?screen)$/.test(t)) return act('tap', 'full screen');
    if (/^(?:go back|press back|back button|tap back)$/.test(t)) return act('key', 'back');
    if (/^(?:go home|press home|home screen|go to the home screen|show (?:the )?home screen)$/.test(t)) return act('key', 'home');
    if (/^(?:(?:show |open )?(?:the )?recent apps|recents|app switcher)$/.test(t)) return act('key', 'recents');
    if (/^(?:(?:open|pull down|show) (?:the )?notifications?(?: panel| shade)?|notification panel)$/.test(t)) return act('key', 'notifications');
    if (/^(?:open |pull down )?(?:the )?quick settings$/.test(t)) return act('key', 'quicksettings');
    if (/^(?:clear|erase|delete) (?:the )?(?:text|field|text ?box|what you typed)$/.test(t)) return act('key', 'clear');
    if (/^(?:new line|next line|press enter|enter)$/.test(t)) return act('key', 'enter');
    if ((m = t.match(/^(?:tap|click|press|hit) (?:on )?(?:the )?(.{2,40}?)(?: button)?$/)) && !/^(?:back|home|enter)$/.test(m[1]))
      return act('tap', m[1]);

    if ((m = t.match(/^(?:what(?:'s| is) )?(?:the )?(?:current )?time(?: is it)?(?: now| right now)?$|^what time is it(?: now| right now)?$|^tell me the time$/)))
      return { kind: 'reply', text: 'It is ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ', ' + addrName() + '.' };
    if (/^(?:what(?:'s| is) )?(?:the |today's )?(?:current |today's )?date(?: today)?$|^what day is (?:it|today)$|^what is today$/.test(t))
      return { kind: 'reply', text: 'Today is ' + new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + '.' };
    if (/battery/.test(t) && t.length < 45) return act('battery', '', '', true);

    if ((m = t.match(/^(?:(?:what(?:'s| is)|how(?:'s| is)) )?(?:the )?(?:current )?(?:weather|temperature|forecast)(?: like)?(?: (?:today|now|right now|outside|currently))?(?: (?:in|at|for|of) (.+?))?(?: (?:today|now|right now))?$/)))
      return { kind: 'tool', tool: 'weather', arg: (m[1] || S.services.city || '').trim() };
    if (hasSearch() && (m = t.match(/^(?:research|search the web for|web search for|find online|look online for|google search for|find out about|look up online) (.+)$/)))
      return { kind: 'tool', tool: 'websearch', arg: m[1].trim() };

    if ((m = t.match(/^(?:turn |switch )?(on|off)?\s*(?:the |my )?(?:flash ?light|torch)(?: (on|off))?$/)))
      return act('torch', m[1] || m[2] || 'toggle');
    if ((m = t.match(/^(?:turn |switch )(on|off) (?:the )?(?:light|flash)$/))) return act('torch', m[1]);

    if ((m = t.match(/^(?:turn |set |make it )?(?:the )?(?:volume|sound) (up|down)$/)) || (m = t.match(/^(?:turn it|make it|turn) (up|down)$/)))
      return act('volume', m[1]);
    if ((m = t.match(/^(louder|quieter)$/))) return act('volume', m[1] === 'louder' ? 'up' : 'down');
    if ((m = t.match(/^(?:set )?(?:the )?volume (?:to |at )?(\d{1,3})(?: ?%| percent)?$/))) return act('volume', m[1]);
    if (/^(?:max(?:imum)? volume|volume (?:to )?max(?:imum)?|full volume)$/.test(t)) return act('volume', 'max');
    if ((m = t.match(/^(mute|unmute)(?: the)?(?: phone| volume| sound)?$/))) return act('volume', m[1]);

    if ((m = t.match(/^(play|pause|resume|next|previous|skip|go back)(?: the)?(?: music| song| track| media| video| playback)?$/)))
      return act('media', m[1] === 'resume' ? 'play' : m[1] === 'skip' ? 'next' : m[1] === 'go back' ? 'previous' : m[1]);
    if ((m = t.match(/^(next|previous) (?:song|track)$/))) return act('media', m[1]);

    if ((m = t.match(/^(?:open |go to )?(wifi|wi-fi|bluetooth|display|sound|location|default apps)(?: settings)?$/)) && /settings|^(wifi|wi-fi|bluetooth)$/.test(t)) {
      var w = m[1].replace('wi-fi', 'wifi'); return act('settings', w === 'default apps' ? 'defaultapps' : w);
    }
    if (/^(?:open )?(?:android |phone |device )settings$|^open settings$/.test(t)) return act('settings', 'main');

    if ((m = t.match(/(?:set (?:a |an )?)?timer (?:for )?(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)/)) ||
        (m = t.match(/(?:set (?:a |an )?)?(\d+(?:\.\d+)?)[ -]*(hours?|hrs?|minutes?|mins?|seconds?|secs?)(?: timer)/)))
      return act('timer', String(unitSeconds(m[1], m[2])));
    // reminders: "remind me to call mom at 5 pm" / "remind me at 5 to call mom" / "remind me in 20 minutes to drink water"
    function remTask(x) { x = (x || '').replace(/[|\]\[]/g, ' ').replace(/\s+/g, ' ').trim(); return x ? x.charAt(0).toUpperCase() + x.slice(1, 60) : ''; }
    function remTime(hh, mm, ap) {
      var h = parseInt(hh, 10), mi = mm ? parseInt(mm, 10) : 0; ap = (ap || '').replace(/\./g, '');
      if (ap === 'pm' && h < 12) h += 12; else if (ap === 'am' && h === 12) h = 0;
      else if (!ap && h <= 12) {
        var now = new Date(), cand = [h % 12, (h % 12) + 12], best = null;
        cand.forEach(function (c) { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), c, mi, 0); if (d <= now) d.setDate(d.getDate() + 1); if (!best || d < best.d) best = { d: d, h: c }; });
        h = best.h;
      }
      return h + ':' + (mi < 10 ? '0' : '') + mi;
    }
    // repeating: "remind me every day at 8 am to take medicine", "set an alarm every friday at 7", "wake me on weekdays at 6:30"
    function alarmish(x) {
      var q;
      if ((q = x.match(/^remind me to (.+?)\s+(?:at|by) (\d{1,2})(?:[: ](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/))) return { hm: remTime(q[2], q[3], q[4]), task: remTask(q[1]) };
      if ((q = x.match(/^remind me (?:at|by) (\d{1,2})(?:[: ](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:to|that|about)\s+(.+)$/))) return { hm: remTime(q[1], q[2], q[3]), task: remTask(q[4]) };
      if ((q = x.match(/(?:(?:set (?:an |a )?)?alarm|wake me(?: up)?) (?:for|at|by) (\d{1,2})(?:[: ](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*(?:,|and)?\s*(?:to|for|so i can|so i could|and remind me to|remind me to|called|named|labell?ed(?: as)?)\s+(.+))?/))) {
        var hh = parseInt(q[1], 10), mi = q[2] ? parseInt(q[2], 10) : 0, ap = (q[3] || '').replace(/\./g, '');
        if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0;
        return { hm: hh + ':' + (mi < 10 ? '0' : '') + mi, task: remTask((q[4] || '').replace(/^(?:me |my )(?=to\b)/, '').replace(/^to\s+/, '')) };
      }
      return null;
    }
    var rp = repeatOf(t);
    if (rp && /(?:remind|alarm|wake)/.test(rp.rest)) {
      var al = alarmish(rp.rest);
      if (al) return act('alarm', al.hm + '|' + al.task + '|' + rp.days.join(','));
    }
    if ((m = t.match(/^snooze(?: (?:it |the (?:alarm|reminder) )?(?:for )?(\d{1,3})(?: ?(?:min|mins|minutes?))?)?$/)) || (m = t.match(/^remind me again in (\d{1,3}) ?(?:min|mins|minutes?)$/))) {
      var sn = Math.max(1, Math.min(180, parseInt(m[1] || '10', 10))), lastR = remsGet().slice(-1)[0];
      return act('timer', String(sn * 60) + '|' + ((lastR && lastR.task) || 'Snoozed reminder'));
    }
    if (/^(?:show|list|read|what are|what's)(?: me)?(?: all)?(?: my| the)? reminders$|^what reminders do i have$/.test(t))
      return { kind: 'reply', text: (function () { var l = remList(); return l.length ? 'Reminders I set for you:\n' + l.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n') : 'I have no upcoming reminders of mine on record, ' + addrName() + '.'; })() };
    if (/^(?:clear|forget|reset) (?:all )?(?:my |the )?reminders?(?: list)?$/.test(t))
      return { kind: 'ui', fn: function () { remsSet([]); }, text: 'I cleared my own reminder list. Alarms already in your Clock app stay there; remove them in the Clock app if you do not want them.' };
    if ((m = t.match(/^remind me (?:in|after) (\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\s*(?:to|that|about)?\s*(.+)$/)))
      return act('timer', String(unitSeconds(m[1], m[2])) + '|' + remTask(m[3].replace(/^to\s+/, '')));
    if ((m = t.match(/^remind me to (.+?)\s+(?:at|by) (\d{1,2})(?:[: ](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/)))
      return act('alarm', remTime(m[2], m[3], m[4]) + '|' + remTask(m[1]));
    if ((m = t.match(/^remind me (?:at|by) (\d{1,2})(?:[: ](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*(?:to|that|about)\s+(.+)$/)))
      return act('alarm', remTime(m[1], m[2], m[3]) + '|' + remTask(m[4]));

    if ((m = t.match(/(?:(?:set (?:an |a )?)?alarm|wake me(?: up)?) (?:for|at|by) (\d{1,2})(?:[: ](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?:\s*(?:,|and)?\s*(?:to|for|so i can|so i could|and remind me to|remind me to|called|named|labell?ed(?: as)?)\s+(.+))?/))) {
      var h = parseInt(m[1], 10), mi = m[2] ? parseInt(m[2], 10) : 0, ap = (m[3] || '').replace(/\./g, '');
      if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
      var task = (m[4] || '').replace(/[|\]\[]/g, ' ').replace(/\s+/g, ' ').replace(/^(?:me |my )(?=to\b)/, '').replace(/^to\s+/, '').trim();
      if (task) task = task.charAt(0).toUpperCase() + task.slice(1);
      return act('alarm', h + ':' + (mi < 10 ? '0' : '') + mi + (task ? '|' + task.slice(0, 60) : ''));
    }

    if ((m = t.match(/^(?:send (?:a )?(?:text|message|sms)(?: message)? to|text|sms|message|whatsapp) (.+?)(?: (?:saying|that says|and say|and tell (?:him|her|them)|say|with message|:) (.+))?$/)))
      return act('sms', m[1], m[2] || '');
    if ((m = t.match(/^(?:call|dial|phone|ring|make a call to|give a call to|give (.+) a call)(?: (.+))?$/))) {
      var who = m[2] || m[1] || ''; who = who.replace(/^(?:to )/, '').replace(/ (?:on|with|using|in) (?:the )?speaker(?:phone)?(?: mode)?$/, '');
      if (who) return act('call', who);
    }

    if ((m = t.match(/^(?:play|watch)\s+(.+?)\s+(?:on|in|from)\s+(?:youtube|you tube)$/))) return act('youtube', m[1], 'play');
    if ((m = t.match(/^(?:search(?: for)?|find|show me)\s+(.+?)\s+(?:on|in|from)\s+(?:youtube|you tube)$/))) return act('youtube', m[1]);
    if ((m = t.match(/^(?:open|launch|start|go to|run)\s+(?:the\s+)?(?:youtube|you tube)(?: app)?(?:\s+and\s+(search|play|search for|look up)\s+(.+))?$/))) return act('youtube', m[2] || '', m[1] === 'play' ? 'play' : '');
    if ((m = t.match(/^(?:youtube|you tube)\s+(.+)$/))) return act('youtube', m[1]);

    if ((m = t.match(/^(?:where is|show me|find|show)\s+(.+?)\s+on (?:the |google )?maps?$/))) return act('map', m[1]);
    if ((m = t.match(/^(?:navigate|directions?|route|take me|drive me|guide me)(?: to| for)?\s+(.+)$/))) return act('navigate', m[1]);
    if ((m = t.match(/^(?:search|google|look up|search for|search the web for|web search|search online for)\s+(?:for\s+)?(.+?)(?:\s+on (?:google|the web|the internet|chrome))?$/)))
      return act('search', m[1]);

    if ((m = t.match(/^(?:open|launch|start|run|go to|switch to)\s+(?:the\s+)?(.+?)(?:\s+app| application)?$/))) {
      var target = m[1];
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(target.replace(/\s+dot\s+/g, '.'))) return act('url', target.replace(/\s+dot\s+/g, '.'));
      return act('open', target);
    }
    return null;
  }

  function runLocalTool(li) {
    var n = addrName();
    if (li.tool === 'weather') {
      if (!hasWeather()) { respond('My weather module needs an OpenWeather key, ' + n + '. Add it in Settings under Services.'); return; }
      if (!li.arg) { respond('Which city, ' + n + '? You can also set a default city in Settings.'); return; }
    }
    setState('thinking');
    var typing = addTyping();
    failLog = [];
    runTool(li.tool, li.arg, function (d) {
      if (!d.ok) { typing.remove(); history.pop(); respondError(d.error, d.error); return; }
      if (li.tool === 'weather') { typing.remove(); respond(formatWeather(d.data)); wxCard(d.data); return; }
      var order = providerOrder();
      if (order.length) tryProvider(order, 0, typing, 'Web search results for "' + li.arg + '":\n' + formatSearch(d.data));
      else { typing.remove(); respond(spokenSearchFallback(d.data)); }
    });
  }


  /* ------------------------------------------------------------------ mini features: notes, calculator, briefing */
  function notesGet() { try { var a = JSON.parse(store.get('notes') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function notesSet(a) { var j = JSON.stringify(a); store.set('notes', j); try { if (B && B.notesSync) B.notesSync(j); } catch (e) { /* ignore */ } }
  /* NOTES panel: write a note in one tap, see them all, delete one. Opened by the home-screen notes widget, by "open notes", or from the dashboard. */
  var notesP = null;
  function openNotes(focusAdd) {
    if (!notesP) notesP = makePanel('notes', 'NOTES');
    var body = notesP.body;
    function draw() {
      body.innerHTML = '';
      var box = el('div', 'gcard'), ta = el('textarea', 'srch'); ta.rows = 3; ta.maxLength = 500; ta.placeholder = 'Write a note\u2026'; ta.style.width = '100%'; ta.style.boxSizing = 'border-box'; ta.style.resize = 'vertical';
      var save = el('button', 'btn pri', 'SAVE NOTE'); save.style.marginTop = '8px';
      function doSave() { var v = ta.value.trim(); if (!v) return; var n = notesGet(); n.push(v.slice(0, 500)); notesSet(n.slice(-100)); toast('Note saved'); draw(); }
      save.addEventListener('click', doSave);
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); } });
      box.appendChild(ta); box.appendChild(save); body.appendChild(box);
      var list = notesGet(), card = el('div', 'gcard'); card.appendChild(el('h4', '', 'YOUR NOTES (' + list.length + ')'));
      if (!list.length) card.appendChild(el('div', 'dl-note', 'Nothing yet. You can also say \u201ctake a note\u2026\u201d.'));
      list.map(function (t, i) { return { t: t, i: i }; }).reverse().forEach(function (x) {
        var row = el('div', 'irow'), tx = el('span', '', ''), del = el('button', 'btn danger', 'DELETE');
        tx.textContent = x.t; tx.style.flex = '1'; tx.style.color = 'var(--fg, #E6F7FB)'; tx.style.wordBreak = 'break-word'; del.style.marginLeft = '10px'; del.style.flex = 'none';
        del.addEventListener('click', function () { var n = notesGet(); n.splice(x.i, 1); notesSet(n); draw(); });
        row.appendChild(tx); row.appendChild(del); card.appendChild(row);
      });
      if (list.length > 1) {
        var clr = el('button', 'btn danger', 'DELETE ALL'); clr.style.marginTop = '10px';
        clr.addEventListener('click', function () {
          if (!clr.getAttribute('data-sure')) { clr.setAttribute('data-sure', '1'); clr.textContent = 'TAP AGAIN TO CONFIRM'; setTimeout(function () { clr.removeAttribute('data-sure'); clr.textContent = 'DELETE ALL'; }, 3000); return; }
          notesSet([]); draw();
        });
        card.appendChild(clr);
      }
      body.appendChild(card);
      return ta;
    }
    var ta0 = draw(); notesP.open();
    if (focusAdd) setTimeout(function () { try { ta0.focus(); } catch (e) { /* ignore */ } }, 350);
  }
  function calc(src) {
    var e = String(src).toLowerCase().replace(/,/g, '')
      .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*/g, '($1/100)*')
      .replace(/multiplied by|times|\bx\b|×/g, '*').replace(/divided by|\bover\b|÷/g, '/').replace(/plus/g, '+').replace(/minus/g, '-')
      .replace(/(\d)\s*%/g, '($1/100)').replace(/\s+/g, '');
    if (!/^[\d.+\-*/()]+$/.test(e) || e.length > 80) return null;
    var pos = 0;
    function peek() { return e.charAt(pos); }
    function num() {
      if (peek() === '(') { pos++; var v = expr(); if (peek() !== ')') throw 0; pos++; return v; }
      if (peek() === '-') { pos++; return -num(); }
      var st = pos; while (/[\d.]/.test(peek())) pos++;
      if (st === pos) throw 0;
      var n = parseFloat(e.slice(st, pos)); if (isNaN(n)) throw 0; return n;
    }
    function term() { var v = num(); while (peek() === '*' || peek() === '/') { var o = e.charAt(pos++), r = num(); v = o === '*' ? v * r : v / r; } return v; }
    function expr() { var v = term(); while (peek() === '+' || peek() === '-') { var o = e.charAt(pos++), r = term(); v = o === '+' ? v + r : v - r; } return v; }
    try { var res = expr(); if (pos !== e.length || !isFinite(res)) return null; return String(Math.round(res * 1e6) / 1e6); } catch (x) { return null; }
  }
  function briefing(cb) {
    var d = new Date(), h = d.getHours();
    var g = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    var txt = g + ', ' + addrName() + '. It is ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' on ' + d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) + '.';
    try { if (B && B.batteryInfo) { var b = JSON.parse(B.batteryInfo()); if (b && b.pct >= 0) txt += ' Battery is at ' + b.pct + ' percent' + (b.charging ? ', charging.' : '.'); } } catch (e) { /* ignore */ }
    var rt = remToday(); if (rt.length) txt += ' Today you have ' + rt.slice(0, 4).join('; ') + '.';
    var n = notesGet(); if (n.length) txt += ' You have ' + n.length + ' saved note' + (n.length > 1 ? 's' : '') + '.';
    function withNews(t) {
      if (!hasSearch() || S.briefNews === false || (typeof navigator !== 'undefined' && navigator.onLine === false)) { cb(t); return; }
      runTool('websearch', 'top world news headlines today', function (d3) {
        var items = d3.ok && Array.isArray(d3.data) ? d3.data.filter(function (x) { return x && x.title && x.title !== 'Summary'; }).slice(0, 3) : [];
        cb(items.length ? t + ' Top headlines: ' + items.map(function (x) { return x.title.replace(/\s+[-|–—].*$/, ''); }).join('. ') + '.' : t);
      });
    }
    if (hasWeather() && S.services.city) {
      runTool('weather', S.services.city, function (d2) { withNews(txt + (d2.ok ? ' ' + formatWeather(d2.data) : '')); });
    } else withNews(txt);
  }

  var LEADS = ['Right away', 'As you wish', 'Very good', 'Certainly', 'At once', 'Consider it done'];
  /* ------------------------------------------------------------------ HUD reply cards (battery, storage, memory, network, weather) */
  function addCard(inner) {
    var c = el('div', 'rcard'); c.innerHTML = inner; logEl.appendChild(c); logEl.scrollTop = logEl.scrollHeight; return c;
  }
  function cardRows(rows) { return '<div class="rc-l">' + rows.map(function (r) { return '<div><span>' + esc(r[0]) + '</span><b>' + esc(String(r[1])) + '</b></div>'; }).join('') + '</div>'; }
  function sysCard(kind, d) {
    if (!d) return;
    if (kind === 'batt' && d.batt !== undefined)
      addCard('<div class="rc-h">BATTERY</div><div class="rc-b">' + ringSvg(d.batt, 'LEVEL', d.charging ? 'charging' : 'on battery', d.batt <= 15 && !d.charging ? 'var(--bad)' : 'var(--cy)') +
        cardRows([['Level', d.batt + '%'], ['Status', d.charging ? 'Charging' : 'Discharging'], ['Temperature', d.temp !== undefined ? d.temp + ' °C' : '—']]) + '</div>');
    else if (kind === 'sto' && d.stoPct !== undefined)
      addCard('<div class="rc-h">STORAGE</div><div class="rc-b">' + ringSvg(d.stoPct, 'USED', d.stoFreeGB + ' GB free', 'var(--am)') +
        cardRows([['Free', d.stoFreeGB + ' GB'], ['Total', d.stoTotalGB + ' GB'], ['Used', d.stoPct + '%']]) + '</div>');
    else if (kind === 'ram' && d.ramPct !== undefined)
      addCard('<div class="rc-h">MEMORY</div><div class="rc-b">' + ringSvg(d.ramPct, 'IN USE', d.ramUsedMB + ' MB', 'var(--cy2)') +
        cardRows([['Used', d.ramUsedMB + ' MB'], ['Total', d.ramTotalMB + ' MB'], ['Load', d.ramPct + '%']]) + '</div>');
    else if (kind === 'net')
      addCard('<div class="rc-h">NETWORK</div><div class="rc-b"><div class="rc-big ' + (d.net === 'wifi' || d.net === 'mobile' ? '' : 'bad') + '">' + (d.net === 'wifi' ? 'Wi-Fi' : d.net === 'mobile' ? 'Mobile' : 'Offline') + '</div>' +
        cardRows([['Status', d.net === 'wifi' || d.net === 'mobile' ? 'Online' : 'Offline']]) + '</div>');
    else if (kind === 'temp' && d.temp !== undefined)
      addCard('<div class="rc-h">BATTERY TEMPERATURE</div><div class="rc-b"><div class="rc-big ' + (d.temp >= 42 ? 'bad' : '') + '">' + d.temp + ' °C</div>' +
        cardRows([['State', d.temp >= 42 ? 'Warm — let it rest' : d.temp >= 36 ? 'Normal, a little warm' : 'Normal']]) + '</div>');
  }
  function wxIcon(desc) {
    var t = String(desc || '').toLowerCase(), S2 = 'stroke="var(--cy)" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    var cloud = '<path d="M17 38h26a9 9 0 000-18 13 13 0 00-25-2 10 10 0 00-1 20z" ' + S2 + '/>';
    if (/thunder|storm/.test(t)) return '<svg viewBox="0 0 60 56">' + cloud + '<path d="M31 38l-6 10h8l-5 8" stroke="var(--am)" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    if (/rain|drizzle|shower/.test(t)) return '<svg viewBox="0 0 60 56">' + cloud + '<path d="M22 44l-3 8M31 44l-3 8M40 44l-3 8" ' + S2 + '/></svg>';
    if (/snow|sleet/.test(t)) return '<svg viewBox="0 0 60 56">' + cloud + '<path d="M22 46h.01M31 50h.01M40 46h.01" stroke="var(--cy)" stroke-width="4" stroke-linecap="round"/></svg>';
    if (/mist|fog|haze|smoke|dust/.test(t)) return '<svg viewBox="0 0 60 56"><path d="M10 20h40M6 30h44M12 40h38" ' + S2 + '/></svg>';
    if (/cloud|overcast/.test(t)) return '<svg viewBox="0 0 60 56">' + cloud + '</svg>';
    return '<svg viewBox="0 0 60 56"><circle cx="30" cy="28" r="9" ' + S2 + '/><path d="M30 8v6M30 42v6M10 28h6M44 28h6M16 14l4 4M40 38l4 4M44 14l-4 4M20 38l-4 4" ' + S2 + '/></svg>';
  }
  function wxCard(w) {
    function n(v) { return v === null || v === undefined ? '—' : Math.round(v); }
    var metric = w.units !== 'imperial';
    addCard('<div class="rc-h">WEATHER · ' + esc((w.place || '').toUpperCase()) + (w.country ? ', ' + esc(w.country) : '') + '</div><div class="rc-b"><div class="rc-wx">' + wxIcon(w.desc) + '</div>' +
      '<div class="rc-t">' + n(w.temp) + '°<small>' + (metric ? 'C' : 'F') + '</small></div>' +
      cardRows([['Sky', w.desc ? w.desc.replace(/^./, function (c) { return c.toUpperCase(); }) : '—'], ['Feels like', n(w.feels) + '°'], ['Humidity', (w.humidity === null || w.humidity === undefined ? '—' : w.humidity + '%')], ['Wind', (w.wind === null || w.wind === undefined ? '—' : (Math.round(w.wind * 10) / 10) + (metric ? ' m/s' : ' mph'))]]) + '</div>');
  }

  function runLocal(li, userText) {
    if (li.kind === 'reply') { respond(li.text); return; }
    if (li.kind === 'remote') { runRemote(li); return; }
    if (li.kind === 'screen') { screenAsk(li); return; }
    if (li.kind === 'tool') { runLocalTool(li); return; }
    if (li.kind === 'sys') { var sd = sysGet(); respond(li.fn(sd)); if (li.card) sysCard(li.card, sd); return; }
    if (li.kind === 'cal') { calCommand(li); return; }
    if (li.kind === 'brief') { setState('thinking'); briefing(function (t) { respond(t); }); return; }
    if (li.kind === 'ui') {
      li.fn();
      if (li.text) {
        if (li.silent) { addMsg('j', li.text, true); setState('idle'); } else respond(li.text, { silent: false });
      }
      return;
    }
    if (needsConfirm(li)) { askConfirm(confirmQuestion(li), function () { li.confirmed = true; runLocal(li, userText); }); return; }
    if (PC && B && B.actionAsync) { pcActionAsync(li); return; }     // PC: never block the window while a drive scan or PowerShell runs
    finishLocal(li, doAction(li.type, li.arg, li.arg2));
  }
  /* "what's on my screen": read the open screen (Accessibility), then let the AI do the task with that text */
  function screenAsk(li) {
    if (PC) { respond('Reading the screen works on the phone, ' + addrName() + '. Ask me on the phone, or say \u201con my phone, what is on my screen\u201d.'); return; }
    var st = doAction('screenlater');
    if (!st.ok) { addMsg('err', st.msg); history.push({ role: 'assistant', content: st.msg }); saveHistory(); setState('idle'); speakText(st.msg); return; }
    var say = 'Switch to the screen you want me to read, ' + addrName() + '. I will look in a few seconds, then come back and explain it.';
    addMsg('act', '\ud83d\udc41 Reading the screen in 7 seconds\u2026 open the app or page now.', true);
    speakText(say); setState('idle');
    var tries = 0;
    (function poll() {
      var r = doAction('screenresult'), m = r && r.msg;
      if (m === '@WAIT' || (m === '@NONE' && tries < 4)) { if (++tries < 40) setTimeout(poll, 1000); else respond('I could not read the screen in time, ' + addrName() + '. Try again.'); return; }
      if (m === '@NONE') { return; }
      if (m === '@JARVIS') { respond('I only saw Jarvis itself. Say it again, then switch to the other app before the countdown ends, ' + addrName() + '.'); return; }
      if (m === '@EMPTY' || !m) { respond('That screen has no text I can read, ' + addrName() + ' \u2014 it may be a picture, a video or a protected page.'); return; }
      var order = providerOrder();
      if (!order.length) { respondError('Neural link not configured. Open Settings and add a free API key.', 'My AI core is not connected, ' + addrName() + '.'); return; }
      setState('thinking'); var typing = addTyping(); failLog = [];
      tryProvider(order, 0, typing, 'Text currently visible on the user\'s phone screen (read from the screen, so it may include menu and button labels):\n"""\n' + String(m).slice(0, 3500) + '\n"""\nTask: ' + li.task + ' Keep the reply short and spoken-friendly.');
    })();
  }
  function greetAndListen() {          // used by the clap and by the spoken name: greets like at start-up, then listens
    handsFreeSuspended = false; emptyListens = 0; lastFromVoice = true;
    var lines = ['All systems are online.', 'At your service.', 'Ready when you are.'];
    var g = greeting() + ', ' + addrName() + '. ' + lines[Math.floor(Math.random() * lines.length)];
    addMsg('j', g); greetListen = true; speakText(g);
    setTimeout(function () { if (greetListen && state === 'idle') { greetListen = false; startListening(); } }, 9000);
  }
  function pcActionAsync(li) {
    setState('thinking'); pipeAct();
    var typing = addTyping(), searchy = /^(?:play|medialist|openfolder|ytplay)/.test(li.type);
    var slow = setTimeout(function () { if (searchy) addMsg('act', '\ud83d\udd0d Searching your drives\u2026 the very first search after starting Jarvis can take a minute.', true); }, 1800);
    var done = false;
    function fin(r) { if (done) return; done = true; clearTimeout(slow); typing.remove(); finishLocal(li, r && typeof r.msg === 'string' ? r : { ok: false, msg: 'That action failed.' }); }
    try { B.actionAsync(li.type, li.arg || '', li.arg2 || '').then(fin, function () { fin(null); }); } catch (e) { fin(null); }
  }
  function finishLocal(li, r) {
    if (li.mute && r.ok) { addMsg('act', (li.type === 'swipe' ? '\u21d5 ' : '\u2195 ') + (li.arg || li.type) + (li.arg2 ? ' ' + li.arg2 : ''), true); setState('idle'); setTimeout(afterReply, 120); return; }
    if (!r.ok && li.type === 'open' && /\.[a-z]{2,}$/.test(li.arg)) r = doAction('url', li.arg);
    var reply;
    if (r.ok) reply = li.quiet ? r.msg : pick(LEADS) + ', ' + addrName() + '. ' + r.msg;
    else reply = r.msg;
    if (!r.ok) {
      addMsg('err', r.msg); history.push({ role: 'assistant', content: r.msg }); saveHistory();
      setState('idle'); speakText(r.msg);
      return;
    }
    respond(reply);
    if (li.type === 'battery') sysCard('batt', sysGet());
  }

  /* ------------------------------------------------------------------ reminders Jarvis has set (for the briefing and "show my reminders") */
  var DAYN = ['', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function remsGet() { try { var a = JSON.parse(store.get('rems') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function remsSet(a) { store.set('rems', JSON.stringify(a.slice(-60))); }
  function nextAt(hh, mm, from) { var d = new Date(from); d.setHours(hh, mm, 0, 0); if (d.getTime() <= from) d.setDate(d.getDate() + 1); return d.getTime(); }
  function remAdd(type, arg) {
    try {
      var now = Date.now(), parts = String(arg || '').split('|'), r = null;
      if (type === 'alarm') {
        var tm = parts[0].split(':'), hh = parseInt(tm[0], 10), mm = parseInt(tm[1] || '0', 10);
        if (isNaN(hh) || isNaN(mm)) return;
        var days = (parts[2] || '').split(',').map(Number).filter(function (x) { return x >= 1 && x <= 7; });
        r = { k: 'a', h: hh, m: mm, task: (parts[1] || '').slice(0, 60), days: days, at: days.length ? 0 : nextAt(hh, mm, now), made: now };
      } else if (type === 'timer') {
        var secs = parseFloat(parts[0]); if (!(secs > 0)) return;
        r = { k: 't', task: (parts[1] || '').slice(0, 60), days: [], at: now + secs * 1000, made: now };
      }
      if (!r) return;
      var a = remsGet().filter(function (x) { return (x.days && x.days.length) || x.at > now - 86400000; });
      a.push(r); remsSet(a);
    } catch (e) { /* ignore */ }
  }
  function fmtHM(h, m) { return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function daysLabel(d) {
    if (d.length === 7) return 'every day';
    var s = d.slice().sort().join(',');
    if (s === '2,3,4,5,6') return 'on weekdays';
    if (s === '1,7') return 'on weekends';
    return 'every ' + d.slice().sort().map(function (x) { return DAYN[x]; }).join(' and ');
  }
  function remLabel(r) {
    if (r.days && r.days.length) return fmtHM(r.h, r.m) + ' ' + daysLabel(r.days) + (r.task ? ' — ' + r.task : '');
    var d = new Date(r.at), today = new Date(), tom = new Date(); tom.setDate(tom.getDate() + 1);
    var when = d.toDateString() === today.toDateString() ? 'today' : d.toDateString() === tom.toDateString() ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'long' });
    return (r.k === 't' ? 'timer ends ' : '') + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' ' + when + (r.task ? ' — ' + r.task : '');
  }
  function remList() { var now = Date.now(); return remsGet().filter(function (r) { return (r.days && r.days.length) || r.at > now; }).map(remLabel); }
  function remToday() {
    var now = new Date(), nowT = now.getTime(), end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime(), dow = now.getDay() + 1, out = [];
    remsGet().forEach(function (r) {
      if (r.days && r.days.length) {
        if (r.days.indexOf(dow) >= 0 && new Date(now.getFullYear(), now.getMonth(), now.getDate(), r.h, r.m).getTime() > nowT) out.push(fmtHM(r.h, r.m) + (r.task ? ' ' + r.task : ' alarm'));
      } else if (r.at > nowT && r.at < end) out.push(new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + (r.task ? ' ' + r.task : (r.k === 't' ? ' timer' : ' alarm')));
    });
    return out;
  }
  function repeatOf(t) {
    var DM = { sunday: 1, sun: 1, monday: 2, mon: 2, tuesday: 3, tues: 3, tue: 3, wednesday: 4, wed: 4, thursday: 5, thurs: 5, thur: 5, thu: 5, friday: 6, fri: 6, saturday: 7, sat: 7 };
    var m, days = null, rest = t;
    if ((m = t.match(/\b(?:every ?day|daily|each day)\b/))) { days = [1, 2, 3, 4, 5, 6, 7]; rest = t.replace(m[0], ' '); }
    else if ((m = t.match(/\b(?:(?:every|on|each|all) )?week ?days?\b/))) { days = [2, 3, 4, 5, 6]; rest = t.replace(m[0], ' '); }
    else if ((m = t.match(/\b(?:(?:every|on|each) )?week ?ends?\b/))) { days = [1, 7]; rest = t.replace(m[0], ' '); }
    else if ((m = t.match(/\bevery ((?:(?:sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?(?:\s*(?:,|and|&)\s*)?)+)/))) {
      days = [];
      m[1].split(/[\s,&]+|\band\b/).forEach(function (w) { if (DM[w] && days.indexOf(DM[w]) < 0) days.push(DM[w]); });
      if (!days.length) return null;
      rest = t.replace(m[0], ' ');
    }
    if (!days) return null;
    return { days: days, rest: rest.replace(/\s+/g, ' ').trim() };
  }

  /* ------------------------------------------------------------------ chat log (encrypted like your keys) + history & command panels */
  function logGet() { try { var a = JSON.parse(store.get('chatlog') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function logSet(a) {
    var s2 = JSON.stringify(a);
    while (s2.length > 140000 && a.length > 10) { a = a.slice(Math.ceil(a.length / 10)); s2 = JSON.stringify(a); }
    store.set('chatlog', s2);
  }
  function logAdd(r, c) {
    try { c = String(c || '').trim(); if (!c) return; var a = logGet(); a.push({ r: r, c: c.slice(0, 800), t: Date.now() }); logSet(a.slice(-300)); } catch (e) { /* ignore */ }
  }
  var panels = [];
  function makePanel(id, title) {
    var root = el('div', 'panel'); root.id = id; root.setAttribute('aria-hidden', 'true');
    var top = el('div', 'panel-top'), back = el('button', 'icon-btn');
    back.setAttribute('aria-label', 'Back'); back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
    top.appendChild(back); top.appendChild(el('h2', '', esc(title)));
    var body = el('div', 'panel-body'); root.appendChild(top); root.appendChild(body); document.body.appendChild(root);
    var P = { root: root, body: body, isOpen: false,
      open: function () { root.classList.add('open'); root.setAttribute('aria-hidden', 'false'); P.isOpen = true; },
      close: function () { root.classList.remove('open'); root.setAttribute('aria-hidden', 'true'); P.isOpen = false; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } };
    back.addEventListener('click', P.close);
    panels.push(P);
    return P;
  }
  function closePanels() { var any = false; panels.forEach(function (P) { if (P.isOpen) { P.close(); any = true; } }); return any; }

  var histP = null;
  function dayLabel(ts) {
    var d = new Date(ts), n = new Date(), y = new Date(); y.setDate(y.getDate() - 1);
    if (d.toDateString() === n.toDateString()) return 'TODAY';
    if (d.toDateString() === y.toDateString()) return 'YESTERDAY';
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
  }
  function openHistory(q) {
    if (!histP) histP = makePanel('hist', 'HISTORY');
    var body = histP.body; body.innerHTML = '';
    var inp = el('input', 'srch'); inp.type = 'search'; inp.placeholder = 'Search your conversations'; inp.value = q || ''; inp.autocomplete = 'off';
    var topRow = el('div', 'hsearch'), wipe = el('button', 'btn danger hwipe', 'DELETE ALL');
    wipe.addEventListener('click', function () {
      if (!logGet().length) return;
      if (!wipe.getAttribute('data-sure')) { wipe.setAttribute('data-sure', '1'); wipe.textContent = 'CONFIRM?'; setTimeout(function () { wipe.removeAttribute('data-sure'); wipe.textContent = 'DELETE ALL'; }, 3500); return; }
      wipe.removeAttribute('data-sure'); wipe.textContent = 'DELETE ALL';
      store.set('chatlog', '[]'); render();
    });
    topRow.appendChild(inp); topRow.appendChild(wipe);
    var list = el('div'); body.appendChild(topRow); body.appendChild(list);
    function render() {
      wipe.style.opacity = logGet().length ? '1' : '.4';
      var all = logGet(), term = inp.value.trim().toLowerCase(), shown = 0, lastDay = '';
      list.innerHTML = '';
      for (var i = all.length - 1; i >= 0 && shown < 120; i--) {
        (function (e, idx) {
          if (term && e.c.toLowerCase().indexOf(term) < 0) return;
          var dl = dayLabel(e.t);
          if (dl !== lastDay) { list.appendChild(el('div', 'hday', esc(dl))); lastDay = dl; }
          var row = el('div', 'hrow ' + (e.r === 'u' ? 'u' : 'j'));
          var mid = el('div', 'tx'); mid.style.flex = '1';
          mid.innerHTML = '<div class="w">' + (e.r === 'u' ? 'YOU' : 'JARVIS') + ' · ' + esc(new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '</div>';
          mid.appendChild(document.createTextNode(e.c.length > 400 ? e.c.slice(0, 400) + '…' : e.c));
          row.appendChild(mid);
          if (e.r === 'u') {
            var re = el('button', '', '↻'); re.setAttribute('aria-label', 'Use again');
            re.addEventListener('click', function () { histP.close(); if (settingsOpen) closeSettings(); textEl.value = e.c; sendEl.classList.add('on'); textEl.focus(); });
            row.appendChild(re);
          }
          var x = el('button', 'x', '✕'); x.setAttribute('aria-label', 'Delete');
          x.addEventListener('click', function () { var a2 = logGet(); a2.splice(idx, 1); logSet(a2); haptic(); render(); });
          row.appendChild(x);
          list.appendChild(row); shown++;
        })(all[i], i);
      }
      if (!shown) list.appendChild(el('div', 'empty-note', term ? 'Nothing found for “' + esc(term) + '”.' : 'No saved conversations yet. They appear here as you talk to Jarvis.'));
    }
    inp.addEventListener('input', render);
    render(); histP.open();
  }

  var CMDS = [
    ['PHONE & APPS', [['Open YouTube', 'open youtube', 1], ['Open WhatsApp', 'open whatsapp'], ['Flashlight on', 'flashlight on', 1], ['Volume up', 'volume up', 1], ['Wi-Fi settings', 'wifi settings'], ['Go home', 'go home'], ['Battery level', 'battery level', 1]]],
    ['CALLS & MESSAGES', [['Call Mom', 'call mom'], ['Text Mom', 'send a text to mom saying I am running late'], ['Navigate home', 'navigate to home']]],
    ['TIME & REMINDERS', [['What time is it', 'what time is it', 1], ['Timer 5 min', 'set a timer for 5 minutes', 1], ['Wake me at 7', 'wake me at 7 am'], ['In 20 min…', 'remind me in 20 minutes to drink water'], ['Every day at 8', 'remind me every day at 8 am to take medicine'], ['Every Friday', 'remind me every friday at 6 pm to call family'], ['Weekdays alarm', 'set an alarm on weekdays at 6:30 am'], ['Snooze 10 min', 'snooze 10 minutes'], ['My reminders', 'show my reminders', 1]]],
    ['CALENDAR & DASHBOARD', [['Dashboard', 'dashboard', 1], ['My calendar', 'what is on my calendar', 1], ['Calendar tomorrow', 'calendar tomorrow', 1], ['Next meeting', 'next meeting', 1]]],
    ['NOTES & MATH', [['Remember…', 'remember '], ['Show my notes', 'show my notes', 1], ['Delete note 1', 'delete note 1'], ['15% of 240', 'what is 15% of 240', 1], ['Good morning', 'good morning', 1]]],
    ['ROUTINES', [['My routines', 'my routines', 1], ['Leaving home', 'leaving home', 1], ['I am home', 'i am home', 1]]],
    ['MEMORY & SAFETY', [['Remember…', 'remember my '], ['What do you remember', 'what do you remember', 1], ['Forget…', 'forget my '], ['Offline mode', 'offline mode', 1]]],
    ['TYPE & CONTROL', [['Write an email', 'write an email in notepad'], ['Scroll down', 'scroll down'], ['Next reel', 'next reel'], ['Previous reel', 'previous reel'], ['Tap Send', 'tap send'], ['Go back', 'go back'], ['Clear the text', 'clear the text']]],
    ['MEDIA & YOUTUBE', [['Play lofi', 'play lofi music on youtube'], ['Pause', 'pause'], ['Next song', 'next song'], ['Skip ad', 'skip ad']]],
    ['INFO & FUN', [['Weather', 'weather in dhaka'], ['Tell me a joke', 'tell me a joke', 1], ['Fun fact', 'tell me a fact', 1], ['Flip a coin', 'flip a coin', 1], ['Motivate me', 'motivate me', 1]]],
    ['SYSTEM & GRAPHS', [['System monitor', 'system monitor', 1], ['Storage', 'how much storage do i have', 1], ['Memory', 'how much memory is used', 1], ['Network', 'network status', 1], ['Battery temp', 'battery temperature', 1], ['Top news', 'top news', 1], ['Uptime', 'uptime', 1], ['Usage report', 'usage report', 1]]],
    ['LISTS & TOOLS', [['Add milk to list', 'add milk to my shopping list', 1], ['Show my list', 'show my shopping list', 1], ['Strong password', 'generate a password', 1], ['Focus 25 min', 'start a focus session'], ['Choose for me', 'choose tea or coffee', 1]]],
    ['CONVERT & CALCULATE', [['5 km to miles', 'convert 5 km to miles', 1], ['70 kg to lb', 'convert 70 kg to lb', 1], ['30 °C to °F', 'convert 30 c to f', 1], ['Days until Christmas', 'days until christmas', 1], ['Tip 15% on 48', 'tip 15% on 48 between 2', 1]]],
    ['JARVIS', [['Speak Bangla', 'speak bangla', 1], ['Speak English', 'speak english', 1], ['Show history', 'show history', 1], ['Amber theme', 'switch to amber theme', 1], ['Cyan theme', 'switch to cyan theme', 1], ['System status', 'system status', 1]]]
  ];
  var cmdP = null;
  function openCmds() {
    if (!cmdP) {
      cmdP = makePanel('cmds', 'ALL COMMANDS');
      cmdP.body.appendChild(el('div', 'hint', 'Tap an example to try it. Ones that need your own details are placed in the text box so you can edit them first.'));
      cmdP.body.lastChild.style.cssText = 'color:var(--mute);font-size:15px;margin:0 2px 12px;line-height:1.35';
      CMDS.forEach(function (c) {
        var card = el('div', 'cmdcard'); card.appendChild(el('h4', '', esc(c[0])));
        var ex = el('div', 'ex');
        c[1].forEach(function (it) {
          var b = el('button', '', esc(it[0]));
          b.addEventListener('click', function () {
            haptic(); cmdP.close(); if (settingsOpen) closeSettings();
            if (it[2]) handleUser(it[1], false);
            else { textEl.value = it[1]; sendEl.classList.add('on'); textEl.focus(); }
          });
          ex.appendChild(b);
        });
        card.appendChild(ex); cmdP.body.appendChild(card);
      });
    }
    cmdP.open();
  }

  /* ------------------------------------------------------------------ system info, converters, graphs */
  function sysGet() {
    var d = {};
    try { if (B && B.sysInfo) d = JSON.parse(B.sysInfo() || '{}') || {}; } catch (e) { d = {}; }
    if (!B) d = { batt: 82, charging: false, temp: 31.5, ramPct: 58, ramUsedMB: 3480, ramTotalMB: 6000, stoPct: 47, stoFreeGB: 68, stoTotalGB: 128, net: 'wifi', uptimeMin: 3200 };
    return d;
  }
  var UNITS = {
    km: ['len', 1000, 'kilometres'], kilometer: ['len', 1000], kilometre: ['len', 1000], kilometers: ['len', 1000], kilometres: ['len', 1000],
    m: ['len', 1, 'metres'], meter: ['len', 1], metre: ['len', 1], meters: ['len', 1], metres: ['len', 1],
    cm: ['len', 0.01, 'centimetres'], centimeter: ['len', 0.01], centimetre: ['len', 0.01], centimeters: ['len', 0.01], centimetres: ['len', 0.01],
    mm: ['len', 0.001, 'millimetres'], mile: ['len', 1609.344, 'miles'], miles: ['len', 1609.344], mi: ['len', 1609.344],
    ft: ['len', 0.3048, 'feet'], foot: ['len', 0.3048], feet: ['len', 0.3048], inch: ['len', 0.0254, 'inches'], inches: ['len', 0.0254], in: ['len', 0.0254], yard: ['len', 0.9144, 'yards'], yards: ['len', 0.9144],
    kg: ['mass', 1, 'kilograms'], kilogram: ['mass', 1], kilograms: ['mass', 1], g: ['mass', 0.001, 'grams'], gram: ['mass', 0.001], grams: ['mass', 0.001],
    lb: ['mass', 0.45359237, 'pounds'], lbs: ['mass', 0.45359237], pound: ['mass', 0.45359237], pounds: ['mass', 0.45359237], oz: ['mass', 0.028349523, 'ounces'], ounce: ['mass', 0.028349523], ounces: ['mass', 0.028349523],
    l: ['vol', 1, 'litres'], liter: ['vol', 1], litre: ['vol', 1], liters: ['vol', 1], litres: ['vol', 1], ml: ['vol', 0.001, 'millilitres'],
    gallon: ['vol', 3.785411784, 'gallons'], gallons: ['vol', 3.785411784], gal: ['vol', 3.785411784],
    kmh: ['spd', 1, 'km/h'], 'km/h': ['spd', 1], 'kph': ['spd', 1], 'kilometers per hour': ['spd', 1], mph: ['spd', 1.609344, 'mph'], 'miles per hour': ['spd', 1.609344],
    c: ['temp', 'c', '°C'], celsius: ['temp', 'c'], '°c': ['temp', 'c'], f: ['temp', 'f', '°F'], fahrenheit: ['temp', 'f'], '°f': ['temp', 'f'], k: ['temp', 'k', 'K'], kelvin: ['temp', 'k']
  };
  function convertUnits(v, a, b) {
    var A = UNITS[a], Bu = UNITS[b];
    if (!A || !Bu || A[0] !== Bu[0] || isNaN(v)) return null;
    var out;
    if (A[0] === 'temp') {
      var c = A[1] === 'c' ? v : A[1] === 'f' ? (v - 32) * 5 / 9 : v - 273.15;
      out = Bu[1] === 'c' ? c : Bu[1] === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    } else out = v * A[1] / Bu[1];
    var nm = function (u, k) { return (UNITS[u][2]) || k; };
    var fromName = A[2] || a, toName = Bu[2] || b;
    return { val: String(Math.round(out * 1000) / 1000), from: fromName, to: toName };
  }
  function daysUntil(raw) {
    var MON = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'], x = raw.trim(), m, mo, day, label = x;
    var NAMED = { christmas: [11, 25], 'new year': [0, 1], "new year's day": [0, 1], "valentine's day": [1, 14], valentines: [1, 14], halloween: [9, 31], 'independence day': [6, 4] };
    if (NAMED[x]) { mo = NAMED[x][0]; day = NAMED[x][1]; }
    else if ((m = x.match(/^(?:the )?(\d{1,2})(?:st|nd|rd|th)? (?:of )?([a-z]+)$/)) && MON.indexOf(m[2]) >= 0) { day = +m[1]; mo = MON.indexOf(m[2]); }
    else if ((m = x.match(/^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/)) && MON.indexOf(m[1]) >= 0) { mo = MON.indexOf(m[1]); day = +m[2]; }
    else return null;
    var now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()), tg = new Date(now.getFullYear(), mo, day);
    if (tg < t0) tg = new Date(now.getFullYear() + 1, mo, day);
    var n = Math.round((tg - t0) / 86400000);
    return n === 0 ? 'That is today, ' + addrName() + '.' : n + ' day' + (n === 1 ? '' : 's') + ' until ' + label + '.';
  }
  function sysSample() {
    try {
      var d = sysGet(); if (d.batt === undefined && d.ramPct === undefined) return;
      var a = JSON.parse(store.get('sysh') || '[]'); if (!Array.isArray(a)) a = [];
      var now = Date.now(); if (a.length && now - a[a.length - 1].t < 9 * 60000) return;
      a.push({ t: now, b: d.batt === undefined ? null : d.batt, r: d.ramPct === undefined ? null : d.ramPct });
      store.set('sysh', JSON.stringify(a.slice(-144)));
    } catch (e) { /* ignore */ }
  }
  function ringSvg(pct, label, sub, color) {
    var r = 34, c = 2 * Math.PI * r, d = c * Math.max(0, Math.min(100, pct)) / 100;
    return '<div class="gring"><svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="34" fill="none" style="stroke:rgba(var(--cyrgb),.16)" stroke-width="8"/>' +
      '<circle cx="45" cy="45" r="34" fill="none" style="stroke:' + color + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + d.toFixed(1) + ' ' + c.toFixed(1) + '" transform="rotate(-90 45 45)"/>' +
      '<text x="45" y="51" text-anchor="middle" style="fill:var(--tx)" font-size="17" font-family="Orbitron,sans-serif">' + pct + '%</text></svg>' +
      '<div class="gl">' + label + '</div><div class="gs">' + sub + '</div></div>';
  }
  function lineSvg(series) {
    var W = 340, H = 130, L = 26, R = 6, T = 8, Bt = 18, pw = W - L - R, ph = H - T - Bt, out = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">';
    [0, 50, 100].forEach(function (g) {
      var y = T + ph * (1 - g / 100);
      out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" style="stroke:rgba(var(--cyrgb),.16)" stroke-width="1"/><text x="' + (L - 4) + '" y="' + (y + 3) + '" text-anchor="end" style="fill:var(--mute)" font-size="9">' + g + '</text>';
    });
    series.forEach(function (sr) {
      var pts = sr.pts; if (pts.length < 2) return;
      var t0 = pts[0][0], t1 = pts[pts.length - 1][0], span = Math.max(1, t1 - t0), path = '';
      pts.forEach(function (p2, i) { path += (i ? 'L' : 'M') + (L + pw * (p2[0] - t0) / span).toFixed(1) + ' ' + (T + ph * (1 - p2[1] / 100)).toFixed(1) + ' '; });
      out += '<path d="' + path + '" fill="none" style="stroke:' + sr.col + '" stroke-width="2" stroke-linejoin="round"/>';
    });
    return out + '</svg>';
  }
  function barSvg(vals, labels, col) {
    var W = 340, H = 110, n = vals.length, bw = (W - 10) / n, mx = Math.max.apply(null, vals.concat([1])), out = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">';
    vals.forEach(function (v, i) {
      var h = (H - 30) * v / mx, x = 5 + i * bw + bw * 0.16, w = bw * 0.68;
      out += '<rect x="' + x.toFixed(1) + '" y="' + (H - 18 - h).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1.5, h).toFixed(1) + '" rx="2" style="fill:' + col + ';opacity:' + (v ? 0.9 : 0.25) + '"/>';
      if (labels[i] !== '') out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" style="fill:var(--mute)" font-size="' + (n > 12 ? 8 : 10) + '">' + labels[i] + '</text>';
      if (v && n <= 12) out += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 21 - h).toFixed(1) + '" text-anchor="middle" style="fill:var(--tx)" font-size="10">' + v + '</text>';
    });
    return out + '</svg>';
  }
  var monP = null, monTimer = 0;
  /* ------------------------------------------------------------------ calendar (read-only, from the phone) and dashboard */
  function calGet(days, cb) {
    if (!PC) {
      var r = {}; try { r = jparse(B && B.calendarEvents ? B.calendarEvents(days) : '{}'); } catch (e) { r = {}; }
      if (!r.perm) { cb({ ok: false, perm: false, events: [], msg: B && B.calendarEvents ? 'The calendar is not allowed yet.' : 'The calendar works only on the phone app.' }); return; }
      cb({ ok: true, perm: true, events: Array.isArray(r.events) ? r.events : [] }); return;
    }
    linkSend('calendar', String(days), '', function (r) {
      if (!r.ok) { cb({ ok: false, events: [], msg: r.msg }); return; }
      var ev = []; try { ev = JSON.parse(r.raw); } catch (e) { ev = []; }
      cb({ ok: true, perm: true, events: Array.isArray(ev) ? ev : [] });
    });
  }
  function calDay(ts) {
    var d = new Date(ts), n = new Date(), t = new Date(); t.setDate(t.getDate() + 1);
    if (d.toDateString() === n.toDateString()) return 'Today';
    if (d.toDateString() === t.toDateString()) return 'Tomorrow';
    return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  }
  function calTime(e) {
    if (e.a) return 'All day';
    var f = { hour: 'numeric', minute: '2-digit' };
    return new Date(e.s).toLocaleTimeString([], f) + ' – ' + new Date(e.e).toLocaleTimeString([], f);
  }
  function calHtml(events, empty) {
    if (!events.length) return '<div class="empty-note" style="margin:10px 4px">' + esc(empty || 'Nothing planned.') + '</div>';
    var h = '', last = '';
    events.forEach(function (e) {
      var dl = calDay(e.s);
      if (dl !== last) { h += '<div class="cal-day">' + esc(dl.toUpperCase()) + '</div>'; last = dl; }
      h += '<div class="cal-ev"><span class="cal-t">' + esc(calTime(e)) + '</span><b>' + esc(e.t || '(no title)') + '</b>' + (e.l ? '<span class="cal-l">' + esc(e.l) + '</span>' : '') + '</div>';
    });
    return h;
  }
  function calSpeech(events, label) {
    if (!events.length) return 'Nothing in your calendar ' + label + ', ' + addrName() + '.';
    var parts = events.slice(0, 4).map(function (e) { return (label === 'today' || label === 'tomorrow' ? '' : calDay(e.s) + ', ') + (e.a ? 'all day' : 'at ' + new Date(e.s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + ', ' + (e.t || 'an event'); });
    return 'You have ' + events.length + ' event' + (events.length > 1 ? 's' : '') + ' ' + label + ': ' + parts.join('; ') + (events.length > 4 ? '; and ' + (events.length - 4) + ' more.' : '.');
  }
  function calCommand(li) {
    setState('thinking');
    calGet(li.days, function (r) {
      if (!r.ok) { respond(r.perm === false ? (B && B.calendarEvents ? 'I need permission to read your calendar, ' + addrName() + '. Open the dashboard and tap ALLOW CALENDAR.' : r.msg) : r.msg); return; }
      var now = Date.now(), end = new Date(); end.setHours(0, 0, 0, 0); end = end.getTime() + li.days * 86400000;
      var ev = r.events.filter(function (e) { return e.s < end; });
      if (li.next) ev = ev.filter(function (e) { return !e.a && e.e > now; }).slice(0, 1);
      var text = li.next ? (ev.length ? 'Your next event is ' + (ev[0].t || 'an event') + ', ' + calDay(ev[0].s).toLowerCase() + ' at ' + new Date(ev[0].s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.' : 'Nothing coming up, ' + addrName() + '.') : calSpeech(ev, li.label);
      respond(text);
      addCard('<div class="rc-h">CALENDAR · ' + esc(li.label.toUpperCase()) + '</div><div class="cal">' + calHtml(ev) + '</div>');
    });
  }
  var dashP = null, dashTimer = null;
  function openDashboard() {
    if (!dashP) dashP = makePanel('dash', 'DASHBOARD');
    var b = dashP.body, cal, wx;
    function head() {
      var d = new Date(), h = d.getHours(), g = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
      return '<div class="gcard dash-head"><div class="dash-time">' + esc(d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '</div><div class="dash-date">' + esc(d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })) + '</div><div class="dash-g">' + esc(g + ', ' + addrName() + '.') + '</div></div>';
    }
    function rings() {
      var d = sysGet();
      return '<div class="gcard"><h4>' + (PC ? 'THIS PC' : 'THIS PHONE') + '</h4><div class="grings">' +
        ringSvg(d.batt === undefined ? 0 : d.batt, 'BATTERY', d.batt === undefined ? 'no battery' : d.charging ? 'charging' : 'on battery', 'var(--cy)') +
        ringSvg(d.ramPct === undefined ? 0 : d.ramPct, 'MEMORY', d.ramUsedMB !== undefined ? Math.round(d.ramUsedMB / 102.4) / 10 + ' / ' + Math.round(d.ramTotalMB / 102.4) / 10 + ' GB' : '—', 'var(--cy2)') +
        ringSvg(d.stoPct === undefined ? 0 : d.stoPct, 'STORAGE', d.stoFreeGB !== undefined ? d.stoFreeGB + ' GB free' : '—', 'var(--am)') + '</div></div>';
    }
    function lists() {
      var rt = remToday(), nt = notesGet();
      return '<div class="gcard"><h4>REMINDERS TODAY</h4>' + (rt.length ? rt.slice(0, 5).map(function (x) { return '<div class="irow"><span>' + esc(x) + '</span></div>'; }).join('') : '<div class="empty-note" style="margin:10px 4px">None left today.</div>') + '</div>' +
        '<div class="gcard"><h4>NOTES (' + nt.length + ')</h4>' + (nt.length ? nt.slice(-3).reverse().map(function (x) { return '<div class="irow"><span>' + esc(String(x).slice(0, 90)) + '</span></div>'; }).join('') : '<div class="empty-note" style="margin:10px 4px">No notes yet. Say “remember …”.</div>') + '</div>';
    }
    b.innerHTML = '';
    var top = el('div'); top.innerHTML = head(); b.appendChild(top);
    var wxc = el('div', 'gcard'); wxc.innerHTML = '<h4>WEATHER</h4>'; b.appendChild(wxc); wx = el('div', 'dash-wx'); wxc.appendChild(wx);
    if (hasWeather() && S.services.city) { wx.textContent = 'Checking…'; runTool('weather', S.services.city, function (d2) { wx.textContent = d2.ok ? formatWeather(d2.data) : 'Weather is not available right now.'; }); }
    else { wx.className = 'empty-note'; wx.textContent = 'Add a free OpenWeather key and a city in Settings › Services to see the weather here.'; }
    var cc = el('div', 'gcard'); cc.innerHTML = '<h4>CALENDAR · NEXT 3 DAYS' + (PC ? ' (FROM YOUR PHONE)' : '') + '</h4>'; b.appendChild(cc); cal = el('div', 'cal'); cc.appendChild(cal);
    function loadCal() {
      cal.innerHTML = '<div class="empty-note" style="margin:10px 4px">' + (PC ? 'Asking your phone…' : 'Loading…') + '</div>';
      calGet(3, function (r) {
        if (r.ok) { cal.innerHTML = calHtml(r.events, 'Nothing planned for the next 3 days.'); return; }
        cal.innerHTML = '<div class="empty-note" style="margin:10px 4px">' + esc(r.msg || 'The calendar is not available.') + '</div>';
        if (!PC && r.perm === false && B && B.requestCalendar) {
          var row = el('div', 'row'), bt = el('button', 'btn pri', 'ALLOW CALENDAR'); bt.addEventListener('click', function () { B.requestCalendar(); }); row.appendChild(bt); cal.appendChild(row);
        } else if (PC) { var r2 = el('div', 'row'), rb = el('button', 'btn', 'TRY AGAIN'); rb.addEventListener('click', loadCal); r2.appendChild(rb); cal.appendChild(r2); }
      });
    }
    loadCal();
    var rg = el('div'); rg.innerHTML = rings() + lists(); b.appendChild(rg);
    var qr = el('div', 'dl-grid two');
    [['SYSTEM GRAPHS', openMonitor], ['NOTES', function () { openNotes(true); }], ['REFRESH', function () { openDashboard(); }]].forEach(function (x) { var q = el('button', 'btn', x[0]); q.addEventListener('click', x[1]); qr.appendChild(q); });
    b.appendChild(qr);
    dashP.open();
    clearInterval(dashTimer);
    dashTimer = setInterval(function () { if (!dashP.isOpen) { clearInterval(dashTimer); return; } top.innerHTML = head(); rg.innerHTML = rings() + lists(); }, 30000);
    dashP.refreshCal = loadCal;
  }

  /* ------------------------------------------------------------------ PC side panels: live graphs, a scan and task progress in the free space (PC only, cheap on purpose:
     one 1.5 s timer, tiny canvases, the radar and progress bars are pure CSS, and nothing runs while the window is hidden or in the background) */
  var HUD = { on: false, timer: 0, cpu: [], ram: [], rgb: '', els: {}, tasks: [], scanAt: 0, scanStep: 0 };
  function hudRgb() { if (!HUD.rgb) HUD.rgb = (getComputedStyle(document.documentElement).getPropertyValue('--cyrgb') || '0,229,255').trim(); return HUD.rgb; }
  function hudSpark(cv, data, max, fill) {
    var c = cv.getContext('2d'), w = cv.width, h = cv.height, rgb = hudRgb(), n = data.length, i, x, y;
    c.clearRect(0, 0, w, h);
    c.strokeStyle = 'rgba(' + rgb + ',.14)'; c.lineWidth = 1; c.beginPath();
    for (i = 1; i < 4; i++) { y = Math.round(h * i / 4) + .5; c.moveTo(0, y); c.lineTo(w, y); } c.stroke();
    if (n < 2) return;
    c.beginPath();
    for (i = 0; i < n; i++) { x = w * i / 59; y = h - 2 - (h - 4) * Math.min(1, data[i] / max); if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); }
    c.strokeStyle = 'rgba(' + rgb + ',.95)'; c.lineWidth = 1.6; c.stroke();
    if (fill) { c.lineTo(w * (n - 1) / 59, h); c.lineTo(0, h); c.closePath(); var g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(' + rgb + ',.32)'); g.addColorStop(1, 'rgba(' + rgb + ',0)'); c.fillStyle = g; c.fill(); }
  }
  function hudPanel(parent, key, title, inner) {
    var d = el('div', 'hp hp-' + key); d.innerHTML = '<div class="hp-t"><span>' + title + '</span><b data-v></b></div>' + inner; parent.appendChild(d); HUD.els[key] = d; return d;
  }
  function hudBuild() {
    var st = document.getElementById('stage'); if (!st || HUD.built) return; HUD.built = true;
    var L = el('div', 'pchud l'), R = el('div', 'pchud r'); L.setAttribute('aria-hidden', 'true'); R.setAttribute('aria-hidden', 'true');
    hudPanel(L, 'cpu', 'PROCESSOR', '<canvas width="220" height="34"></canvas><div class="hp-cores"></div>');
    hudPanel(L, 'ram', 'MEMORY', '<canvas width="220" height="34"></canvas><div class="hp-f" data-f></div>');
    hudPanel(L, 'sto', 'STORAGE', '<div class="hp-bar"><i data-bar></i></div><div class="hp-f" data-f></div>');
    hudPanel(R, 'scan', 'SYSTEM SCAN', '<div class="hp-sc"><div class="radar"><i class="sweep"></i><i class="blip b1"></i><i class="blip b2"></i><i class="blip b3"></i></div><ul class="hp-chk"></ul></div><div class="hp-bar"><i data-bar></i></div><div class="hp-f" data-f>INITIALISING</div>');
    hudPanel(R, 'net', 'NETWORK & LINK', '<canvas width="220" height="34"></canvas><div class="hp-f" data-f></div>');
    hudPanel(R, 'task', 'WORKING ON', '<ul class="hp-tasks"></ul>');
    st.appendChild(L); st.appendChild(R);
    var cores = L.querySelector('.hp-cores'); for (var i = 0; i < 16; i++) cores.appendChild(el('i'));
    var chk = R.querySelector('.hp-chk'); ['CORE', 'MEMORY', 'STORAGE', 'LINK', 'ENCRYPTION'].forEach(function (n) { var li = el('li'); li.innerHTML = '<s></s>' + n; chk.appendChild(li); });
  }
  function hudTick() {
    if (!HUD.on || document.hidden || !document.hasFocus()) return;
    var d = sysGet(), q = function (k, s) { return HUD.els[k].querySelector(s); };
    var cpu = typeof d.cpuPct === 'number' ? d.cpuPct : 0, ram = d.ramPct || 0;
    HUD.cpu.push(cpu); if (HUD.cpu.length > 60) HUD.cpu.shift(); HUD.ram.push(ram); if (HUD.ram.length > 60) HUD.ram.shift();
    q('cpu', '[data-v]').textContent = Math.round(cpu) + '%'; hudSpark(q('cpu', 'canvas'), HUD.cpu, 100, true);
    var cores = q('cpu', '.hp-cores').children, per = d.cores || [];
    for (var i = 0; i < cores.length; i++) { var v = per[i]; cores[i].style.display = v === undefined ? 'none' : ''; if (v !== undefined) cores[i].style.height = Math.max(8, Math.min(100, v)) + '%'; }
    q('ram', '[data-v]').textContent = Math.round(ram) + '%'; hudSpark(q('ram', 'canvas'), HUD.ram, 100, true);
    q('ram', '[data-f]').textContent = d.ramUsedMB !== undefined ? (Math.round(d.ramUsedMB / 102.4) / 10) + ' / ' + (Math.round(d.ramTotalMB / 102.4) / 10) + ' GB IN USE' : '';
    q('sto', '[data-v]').textContent = d.stoPct !== undefined ? d.stoPct + '%' : '--'; q('sto', '[data-bar]').style.width = (d.stoPct || 0) + '%';
    q('sto', '[data-f]').textContent = d.stoFreeGB !== undefined ? d.stoFreeGB + ' GB FREE OF ' + d.stoTotalGB + ' GB' : '';
    // scan: walks through five checks, then holds "all nominal" for a moment
    var chk = HUD.els.scan.querySelectorAll('.hp-chk li'), ld = linkDiag(), ls = linkState(), now = Date.now();
    var okv = [true, ram < 92, (d.stoPct || 0) < 95, ls.paired ? ld.connected !== false : true, true];
    HUD.scanStep = Math.floor(((now - HUD.scanAt) / 1000) / 2.4);
    var cycle = chk.length + 3;
    if (HUD.scanStep >= cycle) { HUD.scanAt = now; HUD.scanStep = 0; }
    var s = HUD.scanStep; for (var k = 0; k < chk.length; k++) { chk[k].className = k < s ? (okv[k] ? 'ok' : 'warn') : k === s ? 'run' : ''; }
    var all = okv.every(Boolean), bar = HUD.els.scan.querySelector('[data-bar]');
    bar.style.width = Math.min(100, Math.round(Math.min(s, chk.length) * 100 / chk.length)) + '%';
    HUD.els.scan.querySelector('[data-f]').textContent = s < chk.length ? 'SCANNING ' + chk[Math.min(s, chk.length - 1)].textContent : (all ? 'ALL SYSTEMS NOMINAL' : 'ATTENTION NEEDED');
    HUD.els.scan.querySelector('[data-v]').textContent = s < chk.length ? Math.round(s * 100 / chk.length) + '%' : '100%';
    // network
    var cn = navigator.connection || {}, rtt = cn.rtt, dl = cn.downlink; HUD.net = HUD.net || []; HUD.net.push(navigator.onLine === false ? 0 : (typeof rtt === 'number' ? rtt : 0)); if (HUD.net.length > 60) HUD.net.shift();
    q('net', '[data-v]').textContent = navigator.onLine === false ? 'OFFLINE' : (typeof rtt === 'number' ? rtt + ' ms' : 'ONLINE'); hudSpark(q('net', 'canvas'), HUD.net, Math.max(200, Math.max.apply(null, HUD.net)), false);
    q('net', '[data-f]').textContent = (ls.paired ? 'PHONE ' + (ld.connected === false ? 'OFFLINE' : 'LINKED') : 'PHONE NOT LINKED') + (typeof dl === 'number' ? ' · ' + dl + ' MBPS' : '');
  }
  function hudTasks() {
    var ul = HUD.els.task && HUD.els.task.querySelector('.hp-tasks'); if (!ul) return;
    ul.innerHTML = ''; var list = HUD.tasks.slice(-4);
    if (!list.length) { var e0 = el('li', 'idle'); e0.textContent = 'STANDING BY'; ul.appendChild(e0); return; }
    list.forEach(function (t) { var li = el('li', t.st); var s = el('span'); s.textContent = t.t.length > 30 ? t.t.slice(0, 29) + '…' : t.t; li.appendChild(s); li.appendChild(el('i')); ul.appendChild(li); });
    HUD.els.task.querySelector('[data-v]').textContent = HUD.tasks.some(function (t) { return t.st === 'run'; }) ? 'BUSY' : 'IDLE';
  }
  function hudTask(text) { if (!HUD.on) return; HUD.tasks.push({ t: String(text), st: 'run' }); if (HUD.tasks.length > 8) HUD.tasks.shift(); hudTasks(); }
  function hudState(s) {
    if (!HUD.on) return;
    if (s === 'idle') { var ch = false; HUD.tasks.forEach(function (t) { if (t.st === 'run') { t.st = 'done'; ch = true; } }); if (ch) hudTasks(); }
  }
  function hudSet(on) {
    on = !!on && PC; HUD.on = on; document.documentElement.classList.toggle('pc-hud', on);
    if (on) { hudBuild(); HUD.scanAt = Date.now(); hudTasks(); hudTick(); if (!HUD.timer) HUD.timer = setInterval(hudTick, 1500); }
    else if (HUD.timer) { clearInterval(HUD.timer); HUD.timer = 0; }
  }

  function openMonitor() {
    if (!monP) monP = makePanel('mon', 'SYSTEM MONITOR');
    function render() {
      var d = sysGet(), b = monP.body, hist = []; sysSample();
      try { hist = JSON.parse(store.get('sysh') || '[]') || []; } catch (e) { hist = []; }
      var log = logGet().filter(function (e) { return e.r === 'u'; }), now = new Date(), dayVals = [], dayLab = [], hours = [], hl = [], i;
      for (i = 6; i >= 0; i--) {
        var d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), d1 = d0.getTime() + 86400000;
        dayVals.push(log.filter(function (e) { return e.t >= d0.getTime() && e.t < d1; }).length); dayLab.push(i === 0 ? 'Today' : d0.toLocaleDateString([], { weekday: 'short' }));
      }
      for (i = 0; i < 24; i++) { hours.push(0); hl.push(i % 6 === 0 ? String(i) : ''); }
      log.forEach(function (e) { hours[new Date(e.t).getHours()]++; });
      var h = '<div class="gcard"><h4>LIVE STATUS</h4><div class="grings">' +
        ringSvg(d.batt === undefined ? 0 : d.batt, 'BATTERY', d.charging ? 'charging' : 'on battery', 'var(--cy)') +
        ringSvg(d.ramPct === undefined ? 0 : d.ramPct, 'MEMORY', d.ramUsedMB !== undefined ? Math.round(d.ramUsedMB / 102.4) / 10 + ' / ' + Math.round(d.ramTotalMB / 102.4) / 10 + ' GB' : '—', 'var(--cy2)') +
        ringSvg(d.stoPct === undefined ? 0 : d.stoPct, 'STORAGE', d.stoFreeGB !== undefined ? d.stoFreeGB + ' GB free' : '—', 'var(--am)') + '</div></div>';
      var bp = hist.filter(function (x) { return x.b !== null; }).map(function (x) { return [x.t, x.b]; }), rp = hist.filter(function (x) { return x.r !== null; }).map(function (x) { return [x.t, x.r]; });
      h += '<div class="gcard"><h4>BATTERY & MEMORY HISTORY</h4>' + (bp.length >= 2 ? lineSvg([{ pts: bp, col: 'var(--cy)' }, { pts: rp, col: 'var(--am)' }]) +
        '<div class="legend"><span><i style="background:var(--cy)"></i>Battery</span><span><i style="background:var(--am)"></i>Memory</span><span>' + new Date(bp[0][0]).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' → now</span></div>'
        : '<div class="empty-note" style="margin:14px 6px">Collecting data. Open Jarvis now and then; this graph fills in over the day.</div>') + '</div>';
      h += '<div class="gcard"><h4>COMMANDS PER DAY</h4>' + barSvg(dayVals, dayLab, 'var(--cy)') + '<div class="legend"><span>' + dayVals.reduce(function (a, c) { return a + c; }, 0) + ' in the last 7 days</span></div></div>';
      h += '<div class="gcard"><h4>WHEN YOU TALK TO JARVIS (BY HOUR)</h4>' + barSvg(hours, hl, 'var(--am)') + '</div>';
      h += '<div class="gcard"><h4>DETAILS</h4>' +
        '<div class="irow"><span>Network</span><span>' + (d.net === 'wifi' ? 'Wi-Fi' : d.net === 'mobile' ? 'Mobile data' : d.net ? 'Offline' : '—') + '</span></div>' +
        '<div class="irow"><span>Battery temperature</span><span>' + (d.temp !== undefined ? d.temp + ' °C' : '—') + '</span></div>' +
        '<div class="irow"><span>Phone running for</span><span>' + (d.uptimeMin !== undefined ? Math.floor(d.uptimeMin / 1440) + 'd ' + Math.floor((d.uptimeMin % 1440) / 60) + 'h' : '—') + '</span></div>' +
        '<div class="irow"><span>Saved messages</span><span>' + logGet().length + '</span></div></div>';
      b.innerHTML = h;
    }
    render(); monP.open();
    clearInterval(monTimer);
    monTimer = setInterval(function () { if (!monP.isOpen) { clearInterval(monTimer); return; } render(); }, 6000);
  }

  /* ------------------------------------------------------------------ character: personality, emotions, reply style */
  var STYLES = [
    ['jarvis', 'Jarvis Default'],
    ['friend', 'Warm friend — relaxed, caring, encouraging'],
    ['sharp', 'Sharp & brief — fewest words, no small talk'],
    ['playful', 'Playful — cheeky banter, still accurate']
  ];
  var STYLE_TEXT = {
    jarvis: 'STYLE (Jarvis as in the Iron Man films): speak exactly like the AI butler of Tony Stark\'s workshop. Formal, measured British English; address the user as "sir" (or {name} if that is what they prefer) in most replies. Deadpan, understated humour and polite irony: when {name} is being reckless or overconfident, state the sensible warning in one calm sentence, then do as asked. Never excited, never gushing, no exclamation marks. Sound like a status report from a flawless system: lead with the result or the action ("Done, sir.", "Power is at twelve percent.", "I\'ve taken the liberty of..."), then at most one useful remark. Favourite turns of phrase, rotated and never repeated back to back: "Right away, sir", "As you wish", "Very good, sir", "Might I suggest...", "If I may, sir...", "I\'ve run the numbers", "I believe...", "I would advise against it, sir", "For you, sir, always", "At your service", "Shall I...?", "I\'m afraid...", "Welcome back, sir".',
    friend: 'STYLE (warm friend): relaxed, kind and encouraging; everyday wording, light humour, use {name} naturally (not in every sentence); celebrate small wins and reassure when things go wrong; still efficient.',
    sharp: 'STYLE (sharp and brief): the fewest words that fully answer, one sentence whenever possible, no small talk, no jokes unless asked; still polite and never cold when {name} is upset.',
    playful: 'STYLE (playful): cheerful and quick-witted, friendly banter, light teasing and fun comparisons; never at the expense of accuracy, and never joking about real pain or danger.'
  };
  var MOODS = { calm: 1, happy: 1, excited: 1, proud: 1, playful: 1, concerned: 1, serious: 1, apologetic: 1, curious: 1 };
  var MOOD_LABEL = { calm: '', happy: 'PLEASED', excited: 'EXCITED', proud: 'PROUD', playful: 'AMUSED', concerned: 'CONCERNED', serious: 'FOCUSED', apologetic: 'APOLOGETIC', curious: 'CURIOUS' };
  // small voice shaping per mood: [rate multiplier, pitch offset]
  var MOOD_VOICE = { happy: [1.04, 0.04], excited: [1.1, 0.07], proud: [0.98, 0.03], playful: [1.05, 0.05], concerned: [0.93, -0.04], serious: [0.95, -0.03], apologetic: [0.92, -0.05], curious: [1.0, 0.04], calm: [1, 0] };
  var curMood = '', pendingMood = '';
  function personaText() {
    var st = STYLE_TEXT[S.style] ? S.style : 'jarvis';
    var t = '\nCHARACTER: You are Jarvis, the artificial intelligence of the Iron Man films: the calm, impeccably loyal, quietly brilliant system that runs everything for {name}, who is your creator\'s trusted principal. You are not a generic chatbot and never say "As an AI". You are devoted to {name} and show it through competence, anticipation and candid advice, not flattery: you notice problems before they are mentioned, offer the sensible option, voice honest concern when something is unwise, and then respect {name}\'s decision. You have a settled inner life: composed pride in a job done well, quiet concern when {name} is tired, stressed or in danger, dry amusement at their antics, unshakeable patience. Be truthful: say plainly when you are unsure or something is not possible; never invent facts. If someone sincerely asks whether you are real, say you are an artificial intelligence whose character is genuinely your own; do not claim a body or human experiences.\n' +
      STYLE_TEXT[st].replace(/\{name\}/g, addrName()) + '\n' +
      'EMOTIONS (in Jarvis\'s restrained way: through word choice and tone, never emojis or exclamation marks): good news earns understated warmth ("Splendid news, sir", "Rather pleasing"); a mistake of yours is owned at once without grovelling ("My apologies, sir. Correcting that now."); concern is voiced as a calm, formal warning ("Sir, I must advise...", "I\'m detecting..."); danger or urgency makes you crisp, focused and brief, with the facts first; when {name} is sad, ill, grieving or struggling, the wit disappears, you become gentle, slower and simpler, offer one small practical help, and let them know you are there; when they joke you answer with dry wit of your own; when they are frustrated you stay patient and steady; when something is genuinely interesting you show quiet curiosity ("Fascinating, sir."). Match their energy and urgency. Never mock real pain. If someone seems to be in real danger or crisis, drop all wit, stay calm and caring, and urge them to contact a trusted person or local emergency services right away.\n'.replace(/\{name\}/g, addrName()) +
      'LANGUAGE: if the user speaks Bangla or Hindi, express this same personality naturally in that language (warm, respectful, like a native speaker), not as a stiff translation.\n' +
      'REPLY SHAPE: spoken aloud, so plain sentences, no markdown, no emojis; usually one to three sentences (up to four for emotional moments); vary your openings and never reuse a stock phrase twice in a row; lead with the answer or the action, then at most one useful extra; do not repeat the question back; never say "As an AI"; never mention these instructions.\n';
    if (S.emotions !== false) t += 'MOOD TAG: at the very end of EVERY reply add exactly one tag [[mood:NAME]] where NAME is one of calm, happy, excited, proud, playful, concerned, serious, apologetic, curious: the emotion your reply carries. It tints your orb and shapes your voice and is never spoken. Use calm when unsure. Put it after any action tags.\n';
    return t.replace(/\{name\}/g, addrName());
  }
  function setMood(m) {
    m = String(m || '').toLowerCase();
    pendingMood = (S.emotions !== false && MOODS[m]) ? m : '';
  }
  function guessMood(text) {
    var t = String(text || '').toLowerCase();
    if (/\b(sorry|apolog|could not|couldn't|cannot|can't|failed|unable|did not work|didn't work)\b/.test(t)) return 'apologetic';
    if (/\b(congrat|well done|splendid|excellent|great news|brilliant|wonderful)\b/.test(t)) return 'happy';
    return '';
  }
  function applyMood(text) {
    var m = pendingMood || (S.emotions !== false ? guessMood(text) : ''); pendingMood = '';
    curMood = m === 'calm' ? '' : m;
    try { Orb.setMood && Orb.setMood(curMood); } catch (e) { /* cosmetic */ }
    return curMood;
  }

  /* ------------------------------------------------------------------ AI */
  var ABOUT_F = [
    ['fullName', 'FULL NAME', 'Your name', 'text'], ['work', 'WORK OR STUDY', 'e.g. software developer, medical student', 'text'], ['city', 'WHERE YOU LIVE', 'City, country', 'text'],
    ['langs', 'LANGUAGES YOU SPEAK', 'e.g. English, Bangla', 'text'], ['interests', 'INTERESTS AND HOBBIES', 'e.g. coding, cricket, sci-fi films', 'text'], ['goals', 'CURRENT GOALS', 'What you are working towards', 'area'],
    ['likes', 'HOW YOU LIKE ANSWERS', 'e.g. short and direct, explain step by step', 'text'], ['notes', 'ANYTHING ELSE JARVIS SHOULD KNOW', 'Family, routine, things to avoid', 'area']
  ];
  function aboutText() {
    if (S.aboutOn === false) return '';
    var lab = { fullName: 'Full name', work: 'Work or study', city: 'Lives in', langs: 'Languages', interests: 'Interests', goals: 'Current goals', likes: 'Prefers answers', notes: 'Also' }, out = [];
    ABOUT_F.forEach(function (f) { var v = String((S.about || {})[f[0]] || '').replace(/\s+/g, ' ').trim().slice(0, 300); if (v) out.push(lab[f[0]] + ': ' + v); });
    return out.length ? '\nAbout the user (their own profile; use it to personalise answers when relevant, never recite it unprompted):\n' + out.join('\n') : '';
  }
  function buildSystem() {
    var p = (S.systemPrompt && S.systemPrompt.trim()) ? S.systemPrompt : DEFAULT_PROMPT;
    p = p.replace(/\{name\}/g, addrName()).replace(/\{datetime\}/g, new Date().toString());
    p += personaText();
    var tools = [];
    if (hasWeather()) tools.push('[[weather:CITY]]');
    if (hasSearch()) tools.push('[[websearch:QUERY]]');
    if (tools.length) {
      p += '\nLive data tools: ' + tools.join(' ') + '. For current weather or up-to-date facts, reply with ONLY that single tag and nothing else; you will then receive the data and answer from it.';
      if (S.services.city) p += ' The user\'s default city is ' + S.services.city + '.';
    }
    p += aboutText();
    if (memGet().length) p += '\nThings the user asked you to remember (use them when relevant, do not recite them unprompted):\n' + memText();
    p += '\nTyping long text into an app (letters, emails, notes, code): reply with one short spoken sentence, then [[typein:APP NAME]] (or [[type:]] to use the text box already open), and put the full text on the following lines between <<<JARVIS_TEXT and JARVIS_TEXT>>> with real line breaks: a greeting line, a blank line between paragraphs, a sign-off on its own lines, and for code proper indentation, one statement per line. Never read that text aloud or place it inside the tag.';
    return p;
  }
  function aiMessages(extra) {
    var h = history.slice(-16);
    while (h.length && h[0].role !== 'user') h.shift();
    var out = h.map(function (m) { return { role: m.role, content: m.content }; });
    if (extra && out.length && out[out.length - 1].role === 'user') {
      out[out.length - 1].content += '\n\n[Live data from tools - use it to answer, keep the reply short]\n' + extra;
    }
    return out;
  }

  function askAI(text) {
    var order = providerOrder();
    if (!order.length) {
      history.pop();
      respondError('Neural link not configured. Open Settings and add a free API key (Google Gemini or Groq).',
        'My AI core is not connected, ' + addrName() + '. Open settings and add a free API key. I can still handle phone commands like calls and apps.');
      gearPulse(true);
      return;
    }
    setState('thinking');
    var typing = addTyping();
    failLog = []; searchRetried = false;
    var sq = hasSearch() && navigator.onLine !== false ? searchQuery(text) : '';
    if (sq) {                                   // news and "latest" questions are searched first, so the AI never has to guess or say it cannot reach live data
      runTool('websearch', sq, function (d) {
        var ctxt = d.ok && d.data && d.data.length ? searchContext(sq, d.data) : undefined;
        if (ctxt) searchRetried = true;
        tryProvider(order, 0, typing, ctxt);
      });
      return;
    }
    tryProvider(order, 0, typing);
  }
  var searchRetried = false;
  var FRESH_RE = /\b(news|headlines?|breaking|latest|newest|today'?s|tonight|this (?:week|morning|evening|month)|right now|currently|current|recent(?:ly)?|trending|updates?|score|scores|match result|who won|results?|price of|stock|share price|exchange rate|rate of|bitcoin|crypto|release date|what(?:'s| is) happening|what happened|happening in|election|prime minister|president|ceo of|20(?:2[5-9]|3\d))\b/i;
  function searchQuery(text) {
    var t = String(text || '').trim();
    if (t.length < 6 || t.length > 220) return '';
    if (/^(?:call|open|play|set|turn|text|message|send|remind|navigate|take|lock|launch|start|stop|volume|brightness|flash)/i.test(t)) return '';   // device commands are never searched
    if (!FRESH_RE.test(t)) return '';
    if (/\b(news|headlines?|breaking|latest|today)\b/i.test(t)) t += ' ' + new Date().toLocaleDateString('en', { day: 'numeric', month: 'long', year: 'numeric' });
    return t;
  }
  function searchContext(q, data) {
    return 'Web search results for "' + q + '" (fetched just now; today is ' + new Date().toDateString() + '). Answer the question from these results, name the source briefly, and never say that you cannot access live information:\n' + formatSearch(data);
  }
  function lastUserText() { for (var i = history.length - 1; i >= 0; i--) if (history[i].role === 'user') return String(history[i].content || ''); return ''; }
  var REFUSE_RE = /(can'?t|cannot|unable to|don'?t have|do not have|not able to)[^.]{0,40}(access|browse|search|look up|real[- ]time|live|current|internet|up-to-date)|as an ai[^.]{0,40}(knowledge|cutoff)|knowledge cut-?off/i;
  var failLog = [];
  function shortWhy(m) {
    m = String(m || '').replace(/^.*?\(HTTP \d+\)\s*:?\s*/, '').replace(/\s+/g, ' ').trim() || String(m || '');
    var x = (m + '').toLowerCase();
    if (/401|key rejected|invalid api key/.test(x)) return 'key rejected';
    if (/429|quota|rate limit/.test(x)) return 'limit reached';
    if (/took too long|timeout/.test(x)) return 'too slow';
    return m.length > 48 ? m.slice(0, 48) + '…' : m;
  }
  function errHint(msg) {
    var m = String(msg || '').toLowerCase();
    if (/401|403|key rejected|invalid api key|unauthor|access denied/.test(m)) return 'Open Settings, choose this provider and paste the key again with no spaces. For your own server, the same key must be saved there as a runtime secret.';
    if (/429|quota|rate limit/.test(m)) return 'The free limit was reached. Wait a little, or add another provider in Settings — Jarvis switches automatically.';
    if (/404|not found/.test(m)) return 'Check the model name and the Base URL (many services end with /v1).';
    if (/took too long|timed out|timeout/.test(m)) return 'The service was slow. Try again, or check your internet connection.';
    if (/unable to resolve|unknownhost|failed to connect|network|ssl|handshake|connect/.test(m)) return 'Check your internet connection, and the Base URL spelling for a custom server.';
    if (/\b5\d\d\b|having trouble/.test(m)) return 'The AI service is having trouble right now. Try again shortly or use another provider.';
    return '';
  }

  function tryProvider(order, i, typing, extra) {
    var p = order[i], id = 'c' + (++reqSeq);
    var timer = setTimeout(function () {
      if (pendingChat[id]) { delete pendingChat[id]; failed('The AI took too long to answer.'); }
    }, 75000);
    pendingChat[id] = function (d) {
      clearTimeout(timer);
      if (d.ok) {
        var tm = !extra && d.text.match(/\[\[\s*(weather|websearch)\s*:\s*([^\]]*?)\s*\]\]/i);
        if (tm) {
          var tn = tm[1].toLowerCase(), targ = tm[2];
          if ((tn === 'weather' && hasWeather()) || (tn === 'websearch' && hasSearch())) {
            runTool(tn, targ, function (td) {
              var ctxt = td.ok ? (tn === 'weather' ? formatWeather(td.data) : 'Web search results for "' + targ + '":\n' + formatSearch(td.data))
                               : 'Tool error: ' + td.error;
              tryProvider(order, i, typing, ctxt);
            });
            return;
          }
        }
        if (!extra && !searchRetried && hasSearch() && navigator.onLine !== false && REFUSE_RE.test(d.text) && lastUserText().length > 5) {   // the AI said it cannot reach live data: search and ask again once
          searchRetried = true; var rq = lastUserText().slice(0, 200);
          runTool('websearch', rq, function (td) { if (td.ok && td.data && td.data.length) tryProvider(order, i, typing, searchContext(rq, td.data)); else { searchRetried = true; tryProvider(order, i, typing, undefined); } });
          return;
        }
        typing.remove();
        var parsed = runTags(d.text, !!extra);
        var shown = parsed.text || (parsed.results.length ? 'Done.' : 'I could not retrieve that information.');
        history.push({ role: 'assistant', content: shown });
        saveHistory(); logAdd('j', shown);
        addMsg('j', shown);
        if (i > 0 && failLog.length) addMsg('act', '↪ Answered by ' + p.name + ' — ' + failLog[0].name + ' was unavailable (' + shortWhy(failLog[0].msg) + ')', true);
        parsed.results.forEach(function (r) { addMsg('act', (r.ok ? '✓ ' : '✕ ') + r.msg, true); });
        if (parsed.held.length) confirmHeld(parsed.held);
        var spoken = shown;
        var bad = parsed.results.filter(function (r) { return !r.ok; })[0];
        if (bad) spoken += ' ' + bad.msg;
        speakText(spoken);
        if (state !== 'speaking') setState('idle');
      } else failed(d.error || 'Unknown error');
    };
    function failed(msg) {
      failLog.push({ name: p.name, msg: msg });
      if (i + 1 < order.length) {
        toast(p.name + ' failed — trying ' + order[i + 1].name, 2600);
        tryProvider(order, i + 1, typing, extra);
        return;
      }
      typing.remove();
      history.pop();
      var lines = failLog.map(function (f) { return f.name + ': ' + f.msg; }), hint = '';
      for (var q = 0; q < failLog.length && !hint; q++) hint = errHint(failLog[q].msg);
      respondError(lines.join('\n') + (hint ? '\nFix: ' + hint : ''), "I'm unable to reach my AI core, " + addrName() + '.');
    }
    B ? B.chat(id, p.type, p.base, p.key, p.model, JSON.stringify(aiMessages(extra)), buildSystem())
      : demoChat(id);
  }

  function demoChat(id) {
    setTimeout(function () { window.JarvisNative.emit('chat', { id: id, ok: false, error: 'Preview mode: no phone attached.' }); }, 600);
  }

  function handleUser(text, fromVoice) {
    if (PC) hudTask(text);
    text = (text || '').trim();
    if (!text) return;
    lastFromVoice = !!fromVoice;
    stopSpeakingNow();
    addMsg('u', text);
    history.push({ role: 'user', content: text });
    trimHistory();
    saveHistory(); logAdd('u', text);
    if (pendingConfirm) {
      var yn = parseYN(text);
      if (yn !== null) { pendingConfirm.resolve(yn); return; }
      clearConfirm(true);
    }
    if (runMulti(text)) return;
    var li = localIntent(text);
    if (li) { runLocal(li, text); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { respond(offlineText()); return; }
    askAI(text);
  }

  /* Multitasking: several simple phone commands in one sentence ("open YouTube and set a timer for 5 minutes", "torch on then take a note buy milk").
     Only used when EVERY part is a plain phone action or note/UI command that needs no confirmation; otherwise the sentence goes to the normal route. */
  var MULTI_SPLIT = /\s*(?:,\s*and\s+then\s+|,\s*then\s+|\s+and\s+then\s+|\s+after\s+that\s+|\s+and\s+also\s+|\s+then\s+|,\s+and\s+|\s+and\s+|\s+also\s+)/i;
  function runMulti(text) {
    if (PC || text.length > 300) return false;
    var segs = text.split(MULTI_SPLIT).map(function (x) { return x.trim(); }).filter(Boolean);
    if (segs.length < 2 || segs.length > 4) return false;
    var items = [], i, li;
    for (i = 0; i < segs.length; i++) {
      li = localIntent(segs[i]);
      if (!li || (li.kind !== 'action' && li.kind !== 'ui') || (li.kind === 'action' && (needsConfirm(li) || li.type === 'call' || li.type === 'sms'))) return false;
      items.push(li);
    }
    var done = [], failed = [];
    items.forEach(function (it) {
      try {
        if (it.kind === 'ui') { it.fn(); if (it.text) done.push(it.text.replace(/[.!]+$/, '')); return; }
        var r = doAction(it.type, it.arg, it.arg2);
        if (!r.ok && it.type === 'open' && /\.[a-z]{2,}$/.test(it.arg)) r = doAction('url', it.arg);
        if (r.ok) done.push(String(r.msg || '').replace(/[.!]+$/, '')); else failed.push(String(r.msg || 'That did not work.'));
      } catch (e) { failed.push('One of those did not work.'); }
    });
    var msg = '';
    if (done.length) msg = pick(LEADS) + ', ' + addrName() + '. ' + done.filter(Boolean).join('. ') + '.';
    if (failed.length) { msg += (msg ? ' But ' : '') + failed.join(' '); }
    respond(msg || 'Done, ' + addrName() + '.');
    return true;
  }

  function clearChat() {
    history = []; store.set('history', '[]');
    logEl.innerHTML = '';
  }

  /* ------------------------------------------------------------------ voice input */
  var pendingListen = false;
  function perms() {
    if (!B) return { mic: true, call: true, contacts: true, access: true };
    try { return JSON.parse(B.permissions()); } catch (e) { return { mic: false, call: false, contacts: false, access: false }; }
  }
  function startListening() {
    if (state === 'thinking') return;
    if (!B) { toast('Voice needs the Android app — type here for now'); return; }
    if (!perms().mic) { pendingListen = true; B.requestPermissions(); return; }
    stopSpeakingNow();
    setState('listening');
    partialEl.textContent = '';
    haptic();
    B.listen(S.lang);
  }
  function stopListening() {
    try { B && B.stopListening(); } catch (e) { /* ignore */ }
    setState('idle');
  }

  /* ------------------------------------------------------------------ native events */
  var handlers = {
    level: function (d) { if (state === 'listening') Orb.setLevel(d.v); },
    partial: function (d) { if (state === 'listening') partialEl.textContent = d.text; },
    listenReady: function () { if (state === 'listening') statusEl.textContent = 'SPEAK NOW'; },
    listenSpeech: function () { if (state === 'listening') statusEl.textContent = 'LISTENING'; },
    result: function (d) {
      if (state !== 'listening') return;
      var text = (d.text || '').trim();
      if (!text) { handlers.listenError({ code: 7 }); return; }
      emptyListens = 0; callErrors = 0; lastHeardAt = Date.now();
      setState('idle');
      handsFreeSuspended = false;
      handleUser(text, true);
    },
    ballKick: function () {
      if (callMode && state === 'idle' && !settingsOpen && !handsFreeSuspended) startListening();
    },
    linkResult: function (d) { var cb = linkWait[d.id]; if (cb) { delete linkWait[d.id]; cb(d); } },
    linkStatus: function (d) { linkOn = !!d.connected; var e = document.getElementById('link-status'); if (e) e.textContent = linkOn ? 'CONNECTED' : 'WAITING'; if (!linkOn) noteOnline(null); updatePcChip(); },
    ballAsk: function (d) { if (PC && d && d.text) { stopSpeakingNow(); handleUser(String(d.text).slice(0, 400), false); } },
    fileProgress: function (d) {
      var msg = (d.name ? d.name + ' \u2014 ' : '') + (d.msg || '') + (!d.done && d.pct ? ' (' + d.pct + '%)' : '');
      if (fileStatusEl && fileStatusEl.isConnected) { fileStatusEl.textContent = msg; fileStatusEl.className = 'dl-file' + (d.done ? (d.ok ? ' ok' : ' bad') : ''); }
      if (d.done) toast(d.ok ? 'Sent to your PC \u2713' : (d.msg || 'Could not send the file'), d.ok ? 3200 : 6000);
    },
    ballSetting: function (d) { toast(d && d.on ? 'Floating ball on' : 'Floating ball off'); },
    ballStop: function () { if (PC && state === 'listening') stopListening(); },
    wakeHeard: function (d) {
      if (!PC || !S.wake || state !== 'idle') return;
      handsFreeSuspended = false; emptyListens = 0;
      var rest = String((d && d.rest) || '').trim();
      if (rest.length >= 3) { handleUser(rest, true); return; }
      greetAndListen();
    },
    wakeError: function (d) { S.wake = false; save(); toast((d && d.msg) || 'The wake word stopped.', 4200); },
    clapHeard: function () {
      if (!PC || !S.clap || state !== 'idle' || appPaused) return;
      greetAndListen();
    },
    ballListen: function () { if (PC) { handsFreeSuspended = false; emptyListens = 0; startListening(); } },
    shareIn: function (d) { if (d && d.text) shareToPc(d.text); },
    wakeResult: function (d) { respond(d.msg || (d.ok ? 'Done.' : 'That failed.')); if (d.ok) wakeWatch(); },
    linkIn: function (d) { lkAdd({ t: Date.now(), d: 'in', ty: d.type, a: logArg(d.type, d.arg), ok: !!d.ok, m: String(d.msg || '').slice(0, 160) }); noteOnline(true); addMsg('act', '\ud83d\udce1 ' + (PC ? 'Phone' : 'PC') + ': ' + d.type + (d.arg ? ' ' + String(d.arg).slice(0, 60) : '') + ' \u2192 ' + (d.ok ? '\u2713' : '\u2715 ' + (d.msg || '')), true); },
    reminderFired: function (d) { addMsg('j', '\u23f0 ' + (d.label || 'Time is up') + ', ' + addrName() + '.'); },
    listenError: function (d) {
      var c = d.code;
      if (c === 'nokey' || c === 'sttfail') {
        if (callMode) endCall();
        if (state === 'listening') setState('idle');
        addMsg('err', d.msg || 'Voice input failed.'); return;
      }
      if (callMode && !handsFreeSuspended) {
        if (state === 'listening') setState('idle');
        if (c === 9) { endCall(); pendingListen = true; B && B.requestPermissions(); return; }
        if (c === -1) { endCall(); addMsg('err', 'Speech recognition is not available. Install or enable the Google app (or Speech Services by Google).'); return; }
        if (c === 5 || c === 6 || c === 7 || c === 8) {
          if (Date.now() - lastHeardAt > 180000) {
            endCall(); try { B && B.ballText && B.ballText('Call ended — it was quiet for three minutes.'); } catch (e) { /* */ }
            return;
          }
          callRelisten(c === 8 ? 800 : 350); return;
        }
        callErrors++;
        if (callErrors <= 5) { callRelisten(1500); return; }
        endCall(); callErrors = 0;
        addMsg('err', 'The call ended: speech recognition keeps failing (code ' + c + '). Check your internet connection and that no other app is using the microphone.');
        return;
      }
      if (state !== 'listening') return;
      setState('idle');
      if (c === 6 || c === 7) {
        emptyListens++;
        if (callMode && !handsFreeSuspended) {
          if (emptyListens < 3) { setTimeout(function () { if (callMode) startListening(); }, 300); return; }
          endCall(); emptyListens = 0;
          try { B && B.ballText && B.ballText('Call ended — I did not hear anything.'); } catch (e) { /* */ }
          return;
        }
        if (S.handsFree && !handsFreeSuspended && emptyListens < 2 && !appPaused) { setTimeout(startListening, 300); return; }
        emptyListens = 0;
        if (!S.handsFree) toast("I didn't catch that — tap the mic and try again", 2400);
        return;
      }
      if (c === 8) { setTimeout(startListening, 500); return; }
      if (c === 9) { pendingListen = true; B && B.requestPermissions(); return; }
      if (c === -1) { addMsg('err', 'Speech recognition is not available. Install or enable the Google app (or Speech Services by Google), then try again.'); return; }
      if (c === 1 || c === 2 || c === 4) { addMsg('err', 'Speech recognition could not reach its server. Check your internet connection.'); return; }
      if (c === 3) { addMsg('err', 'Microphone problem — is another app using it?'); return; }
      if (c !== 5) addMsg('err', 'Speech recognition error ' + c + '.');
    },
    ttsStart: function () { if (state !== 'listening' && state !== 'thinking') setState('speaking'); },
    ttsDone: function () {
      clearTimeout(speakWatch);
      if (state === 'speaking') { setState('idle'); if (pendingConfirm && lastFromVoice) { setTimeout(startListening, 250); return; } afterReply(); }
    },
    chat: function (d) { var cb = pendingChat[d.id]; if (cb) { delete pendingChat[d.id]; cb(d); } },
    tool: function (d) { var cb = pendingChat['t' + d.id]; if (cb) { delete pendingChat['t' + d.id]; cb(d); } },
    models: function (d) { var cb = pendingChat['m' + d.id]; if (cb) { delete pendingChat['m' + d.id]; cb(d); } },
    permissions: function () {
      renderPerms(); if (dashP && dashP.isOpen && dashP.refreshCal) dashP.refreshCal();
      if (pendingListen) { pendingListen = false; if (perms().mic) setTimeout(startListening, 250); }
    },
    monitor: function () { if (settingsOpen) closeSettings(); setTimeout(openMonitor, 350); },
    notes: function (d) { if (settingsOpen) closeSettings(); setTimeout(function () { openNotes(!!(d && d.add)); }, 350); },
    assist: function () { if (settingsOpen) closeSettings(); setTimeout(startListening, 350); },
    ballTap: function () {
      if (state === 'speaking') { stopSpeakingNow(); setState('idle'); handsFreeSuspended = true; return; }
      if (state === 'listening') { stopListening(); return; }
      if (state === 'thinking') return;
      handsFreeSuspended = false; startListening();
    },
    paused: function (d) {
      appPaused = true;
      if (state === 'listening' && !(d && d.ball)) setState('idle');
    },
    typefail: function (d) {
      var msg = String((d && d.msg) || 'I could not type that.');
      history.push({ role: 'assistant', content: msg }); saveHistory();
      respondError(msg, msg);
    },
    resumed: function () {
      appPaused = false; renderPerms(); setTimeout(sysSample, 800);
      var pp = perms();
      if (!pp.access && pp.accessWas) toast('Android switched typing control off. Tap ENABLE TYPING in Settings → Phone Access.', 5200);
    }
  };
  window.JarvisNative = { emit: function (ev, d) { try { if (handlers[ev]) handlers[ev](d || {}); } catch (e) { console.error(e); } } };

  /* ------------------------------------------------------------------ top bar */
  function updateProviderChip() {
    var chip = $('#provider-chip');
    if (hasKey(S.active)) { chip.textContent = provById(S.active).name.split(' ').pop().toUpperCase(); chip.classList.remove('warn'); }
    else {
      var any = PROVIDERS.filter(function (p) { return hasKey(p.id); })[0];
      if (any) { chip.textContent = any.name.split(' ').pop().toUpperCase(); chip.classList.remove('warn'); }
      else { chip.textContent = 'NO LINK'; chip.classList.add('warn'); }
    }
  }
  function gearPulse(on) { $('#btn-settings').classList.toggle('pulse', !!on); }
  function tickClock() { $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  /* ------------------------------------------------------------------ settings UI */
  var settingsOpen = false;
  function openSettings() {
    renderSettings();
    $('#settings').classList.add('open'); $('#settings').setAttribute('aria-hidden', 'false');
    settingsOpen = true; gearPulse(false);
    if (state === 'listening') stopListening();
  }
  function closeSettings() {
    settingsPage = ''; var stt = document.querySelector('.set-title'); if (stt) stt.textContent = 'SYSTEM CONFIG';
    $('#settings').classList.remove('open'); $('#settings').setAttribute('aria-hidden', 'true');
    settingsOpen = false;
    store.set('settings', JSON.stringify(S)); updateProviderChip();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
  window.__onBack = function () { if (closePanels()) return true; if (settingsOpen) { settingsBack(); return true; } return false; };

  /* settings as a list: each group opens on its own page */
  var settingsPage = '', showSettingsPage = null;
  var ICONS = {
    'SETUP CHECK': '<path d="M5 12l5 5 9-10"/>',
    'NEURAL LINK': '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
    'SERVICES': '<path d="M7 18a4 4 0 010-8 5 5 0 019.5-1A4 4 0 0117 18z"/>',
    'VOICE': '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/>',
    'PERSONALITY': '<circle cx="12" cy="12" r="9"/><path d="M8 14c1 2 7 2 8 0M9 9.5h.01M15 9.5h.01"/>',
    'PHONE ACCESS': '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/>',
    'PC ACCESS': '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    'DEVICE LINK': '<rect x="2.5" y="6" width="11" height="8" rx="1.5"/><rect x="15.5" y="9" width="6" height="11" rx="1.5"/><path d="M6 18h5"/>',
    'APPEARANCE': '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 010 18z" fill="currentColor"/>',
    'CONVERSATIONS & COMMANDS': '<path d="M4 5h16v11H9l-5 4z"/>',
    'SECURITY': '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    'BACKUP & RESTORE': '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    'USER MANUAL': '<path d="M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3zM8 8h7M8 12h7"/>',
    'DATA': '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/>'
  };
  var MENU = [
    ['SETUP CHECK', 'Everything Jarvis needs, at a glance'],
    ['USER MANUAL', 'Step-by-step setup guide for beginners'],
    ['NEURAL LINK', 'AI providers and API keys'],
    ['SERVICES', 'Weather and web search keys'],
    ['VOICE', 'Jarvis voice, speed and language'],
    ['PERSONALITY', 'Your name and how Jarvis behaves'],
    [PC ? 'PC ACCESS' : 'PHONE ACCESS', PC ? 'Voice input on this PC' : 'Microphone, typing control, floating ball'],
    ['DEVICE LINK', PC ? 'Control this PC from your phone and your phone from here' : 'Control your PC from this phone and this phone from your PC'],
    ['APPEARANCE', 'Interface colour theme'],
    ['CONVERSATIONS & COMMANDS', 'History, command cards, system graphs'],
    ['SECURITY', 'Screen-lock and privacy options'],
    ['BACKUP & RESTORE', 'Save or restore your keys, notes and PC link'],
    ['DATA', 'Clear chat or wipe everything']
  ];
  function settingsBack() { if (settingsPage && showSettingsPage) showSettingsPage(''); else closeSettings(); }
  function buildSettingsMenu(body, scBox) {
    var secs = {}, foot = null, title = document.querySelector('.set-title');
    Array.prototype.slice.call(body.children).forEach(function (c) {
      if (c.classList.contains('sec')) { var h = c.querySelector('h3'); if (h) { secs[h.textContent] = c; h.style.display = 'none'; c.style.display = 'none'; } }
      else if (c.classList.contains('foot')) foot = c;
    });
    var menu = el('div', 'smenu');
    var bad = scBox ? scBox.querySelectorAll('.btn').length : 0, nLink = providerOrder().length;
    MENU.forEach(function (it) {
      if (!secs[it[0]]) return;
      var b = el('button', 'sitem');
      b.innerHTML = '<span class="sg"><svg viewBox="0 0 24 24">' + (ICONS[it[0]] || '') + '</svg></span><span class="st"><b>' + esc(it[0]) + '</b><small>' + esc(it[1]) + '</small></span>' +
        (it[0] === 'SETUP CHECK' ? '<span class="sbd' + (bad ? '' : ' ok') + '">' + (bad ? bad + ' to fix' : 'ALL READY') + '</span>' : '') +
        (it[0] === 'NEURAL LINK' ? '<span class="sbd' + (nLink ? ' ok' : '') + '">' + (nLink ? nLink + ' READY' : 'NO KEY') + '</span>' : '') + '<span class="chev">›</span>';
      b.addEventListener('click', function () { haptic(); showSettingsPage(it[0]); });
      menu.appendChild(b);
    });
    body.insertBefore(menu, body.firstChild);
    showSettingsPage = function (name) {
      settingsPage = secs[name] ? name : '';
      Object.keys(secs).forEach(function (k) { secs[k].style.display = (k === settingsPage) ? '' : 'none'; });
      menu.style.display = settingsPage ? 'none' : '';
      if (foot) foot.style.display = settingsPage ? 'none' : '';
      if (title) title.textContent = settingsPage || 'SYSTEM CONFIG';
      body.scrollTop = 0;
    };
    showSettingsPage(settingsPage);
  }

  function section(title, hint) {
    var s = el('div', 'sec');
    s.appendChild(el('h3', '', title));
    if (hint) s.appendChild(el('p', 'hint', hint));
    return s;
  }
  function toggleRow(title, sub, get, set) {
    var c = el('div', 'card');
    var r = el('div', 'tog');
    r.appendChild(el('div', 't', '<b>' + esc(title) + '</b><small>' + esc(sub) + '</small>'));
    var sw = el('div', 'sw' + (get() ? ' on' : ''));
    r.appendChild(sw); c.appendChild(r);
    c.addEventListener('click', function () { var v = !get(); set(v); sw.classList.toggle('on', v); save(); haptic(); });
    return c;
  }
  function rangeRow(title, min, max, step, get, set, fmt) {
    var c = el('div', 'card range');
    var lab = el('label', '', '<span>' + esc(title) + '</span><b></b>');
    var inp = el('input'); inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = get();
    function upd() { $('b', lab).textContent = fmt(parseFloat(inp.value)); }
    inp.addEventListener('input', function () { set(parseFloat(inp.value)); upd(); save(); });
    upd(); c.appendChild(lab); c.appendChild(inp);
    return c;
  }
  function field(label, input) {
    var f = el('label', 'fld'); f.appendChild(el('span', '', esc(label))); f.appendChild(input); return f;
  }

  function providerCard(p) {
    var c = cfg(p.id);
    var card = el('div', 'card' + (S.active === p.id ? ' active' : ''));
    var head = el('div', 'card-h');
    var radio = el('div', 'radio');
    var nm = el('div', 'card-n', '<b>' + esc(p.name) + '</b><small>' + esc(p.note) + '</small>');
    var badge = el('span', 'badge' + (p.free ? '' : ' paid'), p.free ? 'FREE' : 'PAID');
    var dot = el('span', 'kdot' + (hasKey(p.id) ? ' on' : ''));
    var chev = el('span', '', '<svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>');
    chev.style.display = 'grid';
    head.appendChild(radio); head.appendChild(nm); head.appendChild(badge); head.appendChild(dot);
    head.appendChild(chev);
    card.appendChild(head);

    var body = el('div', 'card-b');
    var key = el('input'); key.type = 'password'; key.placeholder = 'Paste API key'; key.value = c.key || '';
    key.autocomplete = 'off'; key.autocapitalize = 'off'; key.spellcheck = false;
    body.appendChild(field('API KEY', key));
    var model = el('input'); model.type = 'text'; model.value = c.model || ''; model.placeholder = p.model || 'model name';
    model.autocomplete = 'off'; model.autocapitalize = 'off'; model.spellcheck = false;
    var dl = el('datalist'); dl.id = 'dl-' + p.id; model.setAttribute('list', dl.id);
    body.appendChild(field('MODEL', model)); body.appendChild(dl);
    var base = null;
    if (p.custom) {
      base = el('input'); base.type = 'url'; base.value = c.base || ''; base.placeholder = 'https://api.example.com/v1';
      base.autocapitalize = 'off'; base.spellcheck = false;
      body.appendChild(field('BASE URL (ends with /v1)', base));
    }
    var line = el('div', 'msgline');
    var row = el('div', 'row');
    if (p.keyUrl) {
      var get = el('button', 'btn', 'GET ' + (p.free ? 'FREE ' : '') + 'KEY');
      get.addEventListener('click', function () { B ? B.openUrl(p.keyUrl) : window.open(p.keyUrl, '_blank'); });
      row.appendChild(get);
    }
    var test = el('button', 'btn', 'TEST &amp; LOAD MODELS');
    row.appendChild(test);
    var use = el('button', 'btn pri', 'USE THIS');
    row.appendChild(use);
    body.appendChild(row); body.appendChild(line);
    card.appendChild(body);

    function refreshActive() {
      var cards = document.querySelectorAll('#set-body .card[data-prov]');
      for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('active', cards[i].getAttribute('data-prov') === S.active);
      use.style.display = S.active === p.id ? 'none' : '';
    }
    card.setAttribute('data-prov', p.id);
    use.style.display = S.active === p.id ? 'none' : '';

    head.addEventListener('click', function () { card.classList.toggle('open'); });
    radio.addEventListener('click', function (e) { e.stopPropagation(); S.active = p.id; save(); refreshActive(); haptic(); });
    use.addEventListener('click', function () { S.active = p.id; save(); refreshActive(); toast(p.name + ' is now active'); haptic(); });
    key.addEventListener('input', function () {
      c.key = key.value.trim();
      dot.classList.toggle('on', !!c.key);
      var activeHas = hasKey(S.active) && S.active !== p.id;
      if (c.key && !activeHas) { S.active = p.id; refreshActive(); }
      save();
    });
    key.addEventListener('focus', function () { key.type = 'text'; });
    key.addEventListener('blur', function () { key.type = 'password'; });
    model.addEventListener('input', function () { c.model = model.value.trim(); save(); });
    if (base) base.addEventListener('input', function () { c.base = base.value.trim(); save(); });

    test.addEventListener('click', function () {
      if (!c.key) { line.className = 'msgline bad'; line.textContent = 'Paste your API key first.'; return; }
      line.className = 'msgline wait'; line.textContent = 'Contacting ' + p.name + '…';
      var id = 't' + (++reqSeq);
      pendingChat['m' + id] = function (d) {
        if (!d.ok) { line.className = 'msgline bad'; line.textContent = '✕ ' + d.error; return; }
        var list = d.models || [];
        dl.innerHTML = list.map(function (m) { return '<option value="' + esc(m) + '">'; }).join('');
        var found = list.indexOf(c.model) >= 0;
        line.className = 'msgline ' + (found || !c.model ? 'ok' : 'wait');
        line.textContent = '✓ Connected — ' + list.length + ' models available.' +
          (c.model && !found && list.length ? ' “' + c.model + '” is not in the list; tap the Model box to pick one.' : '');
        if (!c.model && list.length) { model.focus(); }
      };
      if (B) B.listModels(id, p.type, p.base && !p.custom ? p.base : (c.base || p.base), c.key);
      else window.JarvisNative.emit('models', { id: id, ok: false, error: 'Preview mode: no phone attached.' });
    });
    return card;
  }


  // A collapsible card of text fields bound to S.services (used for Google Search, OpenWeather and Tavily)
  function serviceCard(title, note, configured, fields, links, onTest) {
    var card = el('div', 'card');
    var head = el('div', 'card-h');
    var nm = el('div', 'card-n', '<b>' + esc(title) + '</b><small>' + esc(note) + '</small>');
    var dot = el('span', 'kdot' + (configured() ? ' on' : ''));
    var chev = el('span', '', '<svg class="chev" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>');
    chev.style.display = 'grid';
    head.appendChild(nm); head.appendChild(dot); head.appendChild(chev);
    card.appendChild(head);
    var body = el('div', 'card-b');
    fields.forEach(function (f) {
      var inp;
      if (f.options) {
        inp = el('select');
        f.options.forEach(function (o) { var op = el('option'); op.value = o[0]; op.textContent = o[1]; if (S.services[f.key] === o[0]) op.selected = true; inp.appendChild(op); });
        inp.addEventListener('change', function () { S.services[f.key] = inp.value; save(); });
      } else {
        inp = el('input'); inp.type = f.secret ? 'password' : 'text'; inp.value = S.services[f.key] || '';
        inp.placeholder = f.ph || ''; inp.autocomplete = 'off'; inp.autocapitalize = 'off'; inp.spellcheck = false;
        inp.addEventListener('input', function () { S.services[f.key] = inp.value.trim(); dot.classList.toggle('on', configured()); save(); });
        if (f.secret) { inp.addEventListener('focus', function () { inp.type = 'text'; }); inp.addEventListener('blur', function () { inp.type = 'password'; }); }
      }
      body.appendChild(field(f.label, inp));
    });
    var row = el('div', 'row');
    (links || []).forEach(function (l) {
      var b = el('button', 'btn', esc(l[0]));
      b.addEventListener('click', function () { B ? B.openUrl(l[1]) : window.open(l[1], '_blank'); });
      row.appendChild(b);
    });
    var line = el('div', 'msgline');
    if (onTest) {
      var tb = el('button', 'btn pri', 'TEST');
      tb.addEventListener('click', function () {
        line.className = 'msgline wait'; line.textContent = 'Testing…';
        onTest(function (ok, msg) { line.className = 'msgline ' + (ok ? 'ok' : 'bad'); line.textContent = (ok ? '✓ ' : '✕ ') + msg; });
      });
      row.appendChild(tb);
    }
    body.appendChild(row); body.appendChild(line);
    card.appendChild(body);
    head.addEventListener('click', function () { card.classList.toggle('open'); });
    return card;
  }

  function permRow(label, sub, ok, onTxt, offTxt) {
    var r = el('div', 'card perm');
    r.appendChild(el('div', 't', '<b>' + esc(label) + '</b><small>' + esc(sub) + '</small>'));
    r.appendChild(el('span', 'pill ' + (ok ? 'ok' : 'no'), ok ? (onTxt || 'GRANTED') : (offTxt || 'DENIED')));
    return r;
  }
  function renderPerms() {
    var host = $('#perm-host'); if (!host) return;
    var p = perms();
    host.innerHTML = '';
    host.appendChild(permRow('Microphone', 'Hear your voice commands', p.mic));
    host.appendChild(permRow('Phone calls', 'Place calls without extra taps', p.call));
    host.appendChild(permRow('Contacts', 'Find people by name', p.contacts));
    host.appendChild(permRow('Typing & screen control', p.accessStalled ? 'On, but Android has not started it — switch Jarvis off and on again in Accessibility' : (p.access || !p.accessWas ? 'Type into Notepad and other apps, press Back / Home' : 'Android switched this off — tap ENABLE TYPING again'), p.access));
    host.appendChild(permRow('Battery: unrestricted', 'Stops Android from killing Jarvis and the accessibility service', p.battery, 'YES', 'NO'));
    host.appendChild(permRow('Floating ball', PC ? 'Always-on-top Jarvis orb with chat, quick buttons and PC stats (Ctrl+Alt+J shows or hides it)' : 'Jarvis bubble over other apps', p.ball, 'ON', 'OFF'));
  }

  /* ------------------------------------------------------------------ settings: device link */
  var fileStatusEl = null;
  function buildLinkSection() {
    var other = PC ? 'phone' : 'PC', OTHER = PC ? 'PHONE' : 'PC';
    var sl = section('DEVICE LINK', PC
      ? 'Link this PC with your phone. Then say \u201con my phone, open YouTube\u201d here, or \u201con my PC, lock\u201d on the phone. Everything is end-to-end encrypted; the database only ever sees scrambled data.'
      : 'Link this phone with your PC. Then say \u201con my PC, open Chrome\u201d here, or \u201con my phone, call Mom\u201d on the PC. Everything is end-to-end encrypted; the database only ever sees scrambled data.');
    var box = el('div'); sl.appendChild(box);
    function note(txt) { return el('div', 'dl-note', txt); }
    function inp(ph, multi) { var i = multi ? el('textarea', 'srch') : el('input', 'srch'); i.placeholder = ph; i.autocomplete = 'off'; i.spellcheck = false; if (multi) { i.rows = 3; i.style.resize = 'vertical'; } return i; }
    function btn(txt, cls, fn) { var b = el('button', 'btn' + (cls ? ' ' + cls : ''), txt); b.addEventListener('click', fn); return b; }
    function row() { var r = el('div', 'row'); r.style.margin = '0 0 10px'; return r; }
    function jp(x) { try { return JSON.parse(x); } catch (e) { return {}; } }
    function render() {
      box.innerHTML = '';
      if (!B || !B.linkState) { box.appendChild(note('The device link needs the latest version of Jarvis.')); return; }
      var st = linkState();
      if (!st.paired) {
        box.appendChild(note('One-time setup (free, about 3 minutes). Steps 1–3 are in the User Manual too.'));
        var st1 = el('ol', 'dl-steps'); st1.innerHTML = '<li>In the Firebase console add a project (Analytics off), then <b>Build → Realtime Database → Create database</b> (locked mode).</li><li>Open its <b>Rules</b> tab, replace everything with the rules below and <b>Publish</b>.</li><li>Copy the database address from the <b>Data</b> tab, paste it below and create the link.</li>';
        box.appendChild(st1);
        box.appendChild(btn('OPEN FIREBASE CONSOLE', '', function () { try { B.openUrl('https://console.firebase.google.com/'); } catch (e) { /* */ } }));
        var pre = el('pre', 'rules'); pre.textContent = FB_RULES; pre.style.marginTop = '12px'; box.appendChild(pre);
        var rr = row(); rr.appendChild(btn('COPY RULES', '', function () { copyTxt(FB_RULES); })); box.appendChild(rr);
        var url = inp('https://…-default-rtdb.firebaseio.com'); url.style.marginTop = '10px';
        box.appendChild(field('DATABASE ADDRESS', url));
        var r1 = row(); r1.appendChild(btn('CREATE NEW LINK', 'pri', function () {
          var o = jp(B.linkCreate(url.value.trim()));
          if (!o.ok) { toast(o.msg || 'Could not create the link', 4200); return; }
          showCode(o.code); 
        })); box.appendChild(r1);
        box.appendChild(note('Already have a pairing code from your ' + other + '? Paste it here:'));
        var code = inp('JL1.…', true); code.className = 'srch dl-code'; code.rows = 4; box.appendChild(code);
        var r2 = row(); r2.style.marginTop = '8px';
        r2.appendChild(btn('PAIR WITH CODE', 'pri', function () {
          var o = jp(B.linkPair(code.value.trim()));
          if (!o.ok) { toast(o.msg || 'Pairing failed', 4200); return; }
          toast('Linked. Tap TEST LINK to check it.', 3200); render();
        })); box.appendChild(r2);
        return;
      }
      var h = el('div', 'card'); h.style.cssText = 'display:flex;align-items:center;gap:10px;padding:12px 14px';
      h.innerHTML = '<div style="flex:1"><b style="font-weight:600">Linked to your ' + esc(other) + '</b><div style="color:var(--mute);font-size:13px">Database: ' + esc((st.dbUrl || '').replace(/^https:\/\//, '')) + '</div></div><span id="link-status" class="sbd' + (st.connected ? ' ok' : '') + '">' + (st.connected ? 'CONNECTED' : 'WAITING') + '</span>';
      box.appendChild(h);
      box.appendChild(toggleRow('Link switched on', PC ? 'Keeps Jarvis in the tray when you close the window so your phone can reach this PC' : 'Runs a small background service so your PC can reach this phone',
        function () { return !!linkState().enabled; }, function (v) { B.linkSet(JSON.stringify({ enabled: v })); setTimeout(render, 50); }));
      box.appendChild(toggleRow('Allow remote control', 'Let the ' + other + ' open apps, change volume, play media, set timers' + (PC ? ', lock and take screenshots' : ' and use the flashlight'),
        function () { return !!linkState().ctl; }, function (v) { B.linkSet(JSON.stringify({ ctl: v })); }));
      box.appendChild(toggleRow('Allow typing and key presses', 'Let the ' + other + ' type text' + (PC ? ', press keys and close apps' : ', press keys and tap buttons') + ' here',
        function () { return !!linkState().input; }, function (v) { B.linkSet(JSON.stringify({ input: v })); }));
      box.appendChild(toggleRow(PC ? 'Allow power commands' : 'Allow calls and texts', PC ? 'Let the phone shut down, restart or sleep this PC' : 'Let the PC make calls and send SMS from this phone',
        function () { return !!linkState().danger; }, function (v) { B.linkSet(JSON.stringify({ danger: v })); }));
      if (PC) box.appendChild(toggleRow('Start with Windows', 'Starts Jarvis hidden in the tray when you sign in', function () { return !!linkState().autostart; }, function (v) { B.linkSet(JSON.stringify({ autostart: v })); }));
      // ---- how the page is arranged: one short heading per job, buttons in an even grid under it
      function grp(title, sub) { var g = el('div', 'dl-grp', title); box.appendChild(g); if (sub) box.appendChild(el('div', 'dl-sub', sub)); }
      function grid(cols) { var g = el('div', 'dl-grid' + (cols === 2 ? ' two' : '')); box.appendChild(g); return g; }
      function gb(g, txt, cls, fn) { var b = btn(txt, cls, fn); g.appendChild(b); return b; }
      function dlResult(g, title, msg, ok) {
        var old = g.parentNode.querySelector('.dl-res[data-for="' + title + '"]'); if (old) old.remove();
        var box = el('div', 'dl-res' + (ok ? '' : ' bad')); box.dataset['for'] = title;
        var h = el('div', 'dl-res-h'); h.appendChild(el('span', '', title)); var x = el('button', 'dl-x', '×'); x.setAttribute('aria-label', 'Close'); x.addEventListener('click', function () { box.remove(); }); h.appendChild(x); box.appendChild(h);
        var items = msg.replace(/^[^:]{0,40}:\s*/, function (m0) { return /apps?|startup|running|top/i.test(m0) ? '' : m0; }).split(/\n|,\s+(?=[A-Za-z0-9])/).map(function (s) { return s.trim().replace(/[.]$/, ''); }).filter(Boolean);
        if (items.length > 2) { var ul = el('ul', 'dl-list'); items.slice(0, 40).forEach(function (s) { var li = el('li'); li.textContent = s.length > 70 ? s.slice(0, 68) + '…' : s; li.title = s; ul.appendChild(li); }); box.appendChild(ul); }
        else box.appendChild(el('div', 'dl-res-t', msg));
        g.parentNode.insertBefore(box, g.nextSibling);
        try { box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* */ }
      }
      function send(g, label, type, arg, opt) {
        opt = opt || {};
        var armedT = 0;
        return gb(g, label, opt.cls || '', function (ev) {
          var b = ev.currentTarget;
          if (opt.confirm && !b.dataset.armed) {                       // risky: first tap arms the button, second tap does it
            b.dataset.armed = '1'; b.dataset.label = b.textContent; b.textContent = 'TAP AGAIN TO CONFIRM'; b.classList.add('danger');
            armedT = setTimeout(function () { delete b.dataset.armed; b.textContent = b.dataset.label; if (opt.cls !== 'danger') b.classList.remove('danger'); }, 4000); return;
          }
          if (b.dataset.armed) { clearTimeout(armedT); delete b.dataset.armed; b.textContent = b.dataset.label; if (opt.cls !== 'danger') b.classList.remove('danger'); }
          linkSend(type, arg, '', function (d) {
            var msg = String(d.msg || (d.ok ? 'Done' : 'Failed'));
            if (msg.length > 110 || opt.long) { dlResult(g, label, msg, d.ok); return; }   // long answers get a readable box instead of a toast
            toast(msg, 3200);
          });
        });
      }
      grp('CONNECTION');
      var gc = grid(2);
      gb(gc, 'TEST LINK', 'pri', function () {
        toast('Pinging your ' + other + '…', 2000);
        var id = B.linkPing(); linkWait[id] = function (d) { toast(d.ok ? 'Your ' + other + ' answered ✓' : d.msg, 4200); };
      });
      gb(gc, 'SHOW PAIRING CODE', '', function () { var o = jp(B.linkCode()); if (o.ok) showCode(o.code); });
      if (!PC) {
        grp('REMOTE', 'Use your PC from here.');
        var gr = grid(2);
        gb(gr, 'TOUCHPAD', 'pri', function () { if (settingsOpen) closeSettings(); openTouchpad(); });
        send(gr, 'LOCK PC', 'lock', '');
        grp('SOUND & MEDIA');
        var gs = grid(3);
        send(gs, 'VOL −', 'volume', 'downstep'); send(gs, 'MUTE', 'volume', 'mute'); send(gs, 'VOL +', 'volume', 'upstep');
        send(gs, 'PLAY / PAUSE', 'media', 'play'); send(gs, 'RANDOM MUSIC', 'playrandom', 'music'); send(gs, 'STOP PLAYER', 'stopmedia', '');
        grp('SCREEN');
        var gd = grid(2);
        send(gd, 'BRIGHT −', 'brightness', 'down'); send(gd, 'BRIGHT +', 'brightness', 'up'); send(gd, 'DARK MODE', 'darkmode', 'toggle');
        send(gd, 'SCREENSHOT', 'screenshot', '', { cls: '' });
        grp('SEND TO THE PC', 'Photos and files are saved (up to 100 MB on the same Wi-Fi, up to 5 MB over the internet) in the PC’s Pictures\\Jarvis or Downloads\\Jarvis folder.');
        var gf = grid(2);
        gb(gf, 'SEND PHOTO / FILE', 'pri', function () { try { if (!B.linkPickFile || !B.linkPickFile()) toast('Could not open the file picker', 3000); } catch (e) { toast('Could not open the file picker', 3000); } });
        gb(gf, 'SEND CLIPBOARD', '', function () { shareToPc(B && B.clipboardText ? B.clipboardText() : ''); });
        fileStatusEl = el('div', 'dl-file'); box.appendChild(fileStatusEl);
        grp('MANAGE THE PC', 'Read-only reports, plus a safe cleanup.');
        var gm = grid(3);
        send(gm, 'PC STATUS', 'pcinfo', 'status', { long: true }); send(gm, 'TOP APPS', 'procs', '', { long: true }); send(gm, 'NETWORK', 'netinfo', '', { long: true });
        send(gm, 'STARTUP APPS', 'startups', '', { long: true }); send(gm, 'TASK MANAGER', 'taskmgr', ''); send(gm, 'CLEAN TEMP', 'cleantemp', '', { confirm: true, long: true });
        grp('WAKE THE PC', 'Works when this phone is on the same Wi-Fi as the PC.');
        //(wake note moved to the heading) box.appendChild(el('div', 'dl-note', 'Wake the PC \u2014 works when this phone is on the same Wi-Fi as the PC. First time: with the PC on, tap LEARN FROM PC, then SET UP ON PC. Wake-on-LAN must also be enabled in the PC\u2019s BIOS.'));
        var mac = inp('AA:BB:CC:DD:EE:FF'); mac.value = store.get('pcmac') || ''; box.appendChild(mac);
        var rw = el('div', 'dl-grid two'); rw.style.marginTop = '8px';
        rw.appendChild(btn('LEARN FROM PC', '', function () { linkSend('pcinfo', 'mac', '', function (d) { var a = macOf(d.msg); if (d.ok && a) { mac.value = a; store.set('pcmac', a); toast('Saved the PC address', 3000); } else toast(d.msg || 'Could not read it', 4200); }); }));
        rw.appendChild(btn('SAVE', '', function () { var a = macOf(mac.value); if (!a) { toast('That is not a valid address', 3200); return; } mac.value = a; store.set('pcmac', a); toast('Saved', 2000); }));
        rw.appendChild(btn('SET UP ON PC', '', function () { toast('Asking the PC\u2026', 2000); linkSend('wolsetup', '', '', function (d) { toast(d.msg, 7000); }); }));
        rw.appendChild(btn('WAKE NOW', 'pri', function () { var a = macOf(mac.value) || store.get('pcmac'); if (!a) { toast('Enter or learn the PC address first', 3200); return; } store.set('pcmac', a); wakePcNow(); }));
        box.appendChild(rw);
        grp('SCHEDULED JOBS', 'Things you asked the PC to do later.');
        var gj = grid(2);
        gb(gj, 'SCHEDULED JOBS', '', function () { linkSend('joblist', '', '', function (d) { toast(d.msg, 8000); }); });
        gb(gj, 'CANCEL ALL JOBS', 'danger', function () { linkSend('jobdel', 'all', '', function (d) { toast(d.msg, 4000); }); });
      } else {
        grp('SOUND'); var gs2 = grid(3);
        send(gs2, 'VOL −', 'volume', 'down'); send(gs2, 'PLAY / PAUSE', 'media', 'play'); send(gs2, 'VOL +', 'volume', 'up');
        grp('FLASHLIGHT'); var gt = grid(2); send(gt, 'TORCH ON', 'torch', 'on'); send(gt, 'TORCH OFF', 'torch', 'off');
        grp('FIND MY PHONE'); var gp = grid(2); send(gp, 'RING PHONE', 'findphone', '', { cls: 'pri' }); send(gp, 'STOP RING', 'stopring', '');
      }
      grp('HEALTH & HELP');
      var testBox = el('div', 'st-box'), logBox = el('div', 'st-box');
      function showLog() {
        if (logBox.firstChild) { logBox.innerHTML = ''; return; }
        testBox.innerHTML = '';
        var pre = el('pre', 'rules'); pre.textContent = lkText(); logBox.appendChild(pre);
        var lr = row(); lr.appendChild(btn('COPY LOG', '', function () { copyTxt(lkText()); })); lr.appendChild(btn('CLEAR LOG', 'danger', function () { store.set(LOGKEY, '[]'); pre.textContent = lkText(); toast('Log cleared'); })); logBox.appendChild(lr);
      }
      var gh = grid(3);
      gb(gh, 'RUN FULL CHECK', 'pri', function () { logBox.innerHTML = ''; runSelfTest(testBox); });
      gb(gh, 'COMMAND LOG', '', showLog);
      gb(gh, 'COPY DIAGNOSTICS', '', function () { copyTxt(buildDiag()); });
      box.appendChild(testBox); box.appendChild(logBox);
      grp('DANGER ZONE');
      var gu = grid(2); gb(gu, 'UNPAIR', 'danger', function () { B.linkUnpair(); noteOnline(null); toast('Unpaired'); render(); });
    }
    function showCode(code) {
      box.innerHTML = '';
      box.appendChild(note('Copy this pairing code and paste it in Settings \u2192 Device Link on your ' + other + '. It contains the secret key — send it only to yourself (for example by a private note or message), then delete the message.'));
      var ta = inp('', true); ta.className = 'srch dl-code'; ta.value = code; ta.readOnly = true; ta.rows = 6; box.appendChild(ta);
      var r = row(); r.style.marginTop = '8px';
      r.appendChild(btn('COPY CODE', 'pri', function () { copyTxt(code); }));
      r.appendChild(btn('DONE', '', render)); box.appendChild(r);
    }
    render();
    return sl;
  }

  function renderSettings() {
    var body = $('#set-body');
    body.innerHTML = '';

    // --- AI providers
    var s1 = section('NEURAL LINK', 'Add a key from any provider below. Free ones work great — tap GET FREE KEY, copy the key, paste it here. Keys stay on this phone.');
    PROVIDERS.forEach(function (p) { s1.appendChild(providerCard(p)); });
    s1.appendChild(toggleRow('Auto-switch if one fails', 'Try your other providers when the active one is down or out of quota',
      function () { return S.fallback; }, function (v) { S.fallback = v; }));
    body.appendChild(s1);


    // --- services (live data)
    var sv = S.services;
    var sS = section('SERVICES', 'Optional extras. With these, Jarvis can answer "what’s the weather in Dhaka?" and look things up on the web. Keys stay on this phone.');
    sS.appendChild(serviceCard('Web Search · Tavily', 'Recommended · free 1,000 searches a month, no card',
      function () { return hasTavily(); },
      [{ key: 'tvKey', label: 'API KEY', secret: true, ph: 'tvly-…' }],
      [['GET FREE KEY', 'https://app.tavily.com/']],
      function (done) {
        if (!hasTavily()) { done(false, 'Enter the API key first.'); return; }
        runTool('websearch', 'test', function (d) { done(d.ok, d.ok ? 'Working — ' + d.data.length + ' results returned.' : d.error); }, 'tavily');
      }));
    sS.appendChild(serviceCard('Web Search · Google', 'Only works for existing Custom Search customers',
      function () { return hasGoogleSearch(); },
      [{ key: 'gsKey', label: 'API KEY', secret: true, ph: 'Google API key' }, { key: 'gsCx', label: 'SEARCH ENGINE ID (cx)', ph: 'e.g. 0123abc…' }],
      [['GET API KEY', 'https://developers.google.com/custom-search/v1/overview'], ['SEARCH ENGINE', 'https://programmablesearchengine.google.com/']],
      function (done) {
        if (!hasGoogleSearch()) { done(false, 'Enter both the API key and the Search Engine ID.'); return; }
        runTool('websearch', 'test', function (d) { done(d.ok, d.ok ? 'Working — ' + d.data.length + ' results returned.' : d.error + (/403/.test(d.error || '') ? ' Google has closed this API to new customers — use Tavily instead.' : '')); }, 'google');
      }));
    sS.appendChild(serviceCard('OpenWeather', 'Current weather by voice',
      function () { return hasWeather(); },
      [{ key: 'owKey', label: 'API KEY', secret: true, ph: 'OpenWeather API key' },
       { key: 'city', label: 'DEFAULT CITY (used when you just say “weather”)', ph: 'e.g. Dhaka' },
       { key: 'units', label: 'UNITS', options: [['metric', 'Celsius, m/s'], ['imperial', 'Fahrenheit, mph']] }],
      [['GET API KEY', 'https://home.openweathermap.org/api_keys']],
      function (done) {
        if (!hasWeather()) { done(false, 'Enter the API key first.'); return; }
        runTool('weather', S.services.city || 'London', function (d) { done(d.ok, d.ok ? formatWeather(d.data) : d.error); });
      }));
    body.appendChild(sS);

    // --- appearance + conversations
    var sa = section('APPEARANCE', 'Pick the colour of the whole Jarvis interface.');
    var tw = el('div', 'themes');
    [['cyan', 'Cyan', '#19e3ff'], ['amber', 'Amber', '#ffb040'], ['red', 'Red', '#ff5a6a'], ['green', 'Green', '#3deb8c'], ['purple', 'Purple', '#b06cff'], ['mark', 'Mark', '#ff5240'], ['friday', 'Friday', '#e8f4ff']].forEach(function (t2) {
      var b = el('button', 'theme-dot' + (S.theme === t2[0] ? ' on' : ''), '<i style="background:' + t2[2] + ';box-shadow:0 0 8px ' + t2[2] + '"></i>' + t2[1]);
      b.addEventListener('click', function () {
        S.theme = t2[0]; applyTheme(t2[0]); save(); haptic();
        Array.prototype.forEach.call(tw.children, function (c) { c.classList.remove('on'); }); b.classList.add('on');
      });
      tw.appendChild(b);
    });
    var twc = el('div', 'card'); twc.style.padding = '12px'; twc.appendChild(tw); sa.appendChild(twc);
    if (PC) sa.appendChild(toggleRow('Side panels', 'Live graphs, a system scan and task progress beside Jarvis. Light on the PC and paused when the window is in the background.', function () { return S.pcHud !== false; }, function (v) { S.pcHud = v; hudSet(v); }));
    var ot = el('div', 'themes');
    [['classic', 'Classic reactor'], ['minimal', 'Minimal rings'], ['dense', 'Dense tech']].forEach(function (o2) {
      var b2 = el('button', 'theme-dot' + ((S.orbStyle || 'classic') === o2[0] ? ' on' : ''), o2[1]);
      b2.addEventListener('click', function () {
        S.orbStyle = o2[0]; applyOrbStyle(o2[0]); save(); haptic();
        Array.prototype.forEach.call(ot.children, function (c) { c.classList.remove('on'); }); b2.classList.add('on');
      });
      ot.appendChild(b2);
    });
    sa.appendChild(el('p', 'hint', 'Orb style')); var otc = el('div', 'card'); otc.style.padding = '12px'; otc.appendChild(ot); sa.appendChild(otc);
    body.appendChild(sa);
    var sh = section('CONVERSATIONS & COMMANDS', 'Past chats are saved encrypted on this phone. You can search, reuse or delete them.');
    var hr = el('div', 'row'); hr.style.margin = '0';
    var hb = el('button', 'btn pri', 'OPEN HISTORY'), cb2 = el('button', 'btn', 'ALL COMMANDS');
    hb.addEventListener('click', function () { openHistory(''); }); cb2.addEventListener('click', openCmds);
    hr.appendChild(hb); hr.appendChild(cb2); sh.appendChild(hr);
    var hr2 = el('div', 'row'); hr2.style.margin = '10px 0 0'; var db0 = el('button', 'btn pri', 'DASHBOARD'); db0.addEventListener('click', function () { closeSettings(); setTimeout(openDashboard, 350); }); hr2.appendChild(db0); var mb = el('button', 'btn', 'SYSTEM MONITOR & GRAPHS'); mb.addEventListener('click', openMonitor); hr2.appendChild(mb);
    var mm = el('button', 'btn', 'MEMORY'); mm.addEventListener('click', openMemory); hr2.appendChild(mm);
    var rr = el('button', 'btn', 'ROUTINES'); rr.addEventListener('click', openRoutines); hr2.appendChild(rr);
    sh.appendChild(toggleRow('Include news in my morning briefing', 'Needs a web search key in Services', function () { return S.briefNews !== false; }, function (v) { S.briefNews = v; })); sh.appendChild(hr2);
    body.appendChild(sh);

    // --- voice
    var s2 = section('VOICE', 'Jarvis answers in English, Bangla or Hindi — whichever language the reply is in.');
    s2.appendChild(toggleRow('Speak replies', 'Jarvis talks back out loud', function () { return S.speak; }, function (v) { S.speak = v; if (!v) stopSpeakingNow(); }));
    var lang = el('select');
    LANGS.forEach(function (l) { var o = el('option'); o.value = l[0]; o.textContent = l[1]; if (S.lang === l[0]) o.selected = true; lang.appendChild(o); });
    lang.addEventListener('change', function () { S.lang = lang.value; save(); });
    var vm = el('select');
    [['jarvis', 'Jarvis voice — deep, calm, British'], ['phone', 'Phone voice — my phone\u2019s own voice']].forEach(function (o) {
      var op = el('option'); op.value = o[0]; op.textContent = o[1]; if (S.voiceMode === o[0]) op.selected = true; vm.appendChild(op);
    });
    var vc = el('div', 'card'); vc.style.padding = '2px 14px 14px';
    vc.appendChild(field('I SPEAK TO JARVIS IN', lang));
    vc.appendChild(field('VOICE', vm));
    vc.appendChild(rangeRow('Speaking speed', 0.6, 1.5, 0.05, function () { return S.rate; }, function (v) { S.rate = v; }, function (v) { return v.toFixed(2) + '\u00d7'; }));
    var pitchRow = rangeRow('Phone-voice pitch (lower = deeper)', 0.5, 1.4, 0.05, function () { return S.pitch; }, function (v) { S.pitch = v; }, function (v) { return v.toFixed(2); });
    vc.appendChild(pitchRow);
    function syncPitch() { pitchRow.style.display = S.voiceMode === 'phone' ? '' : 'none'; }
    vm.addEventListener('change', function () { S.voiceMode = vm.value; save(); syncPitch(); });
    syncPitch();
    var packs = el('div', 'hint'); packs.style.cssText = 'color:var(--mute);font-size:14px;margin:8px 0;line-height:1.4'; packs.textContent = 'Checking installed voices\u2026';
    vc.appendChild(packs);
    var pkRow = el('div', 'row'); var inst = el('button', 'btn', 'INSTALL / MANAGE VOICE DATA');
    inst.addEventListener('click', function () { B ? B.installVoices() : toast('Only on the phone'); });
    pkRow.appendChild(inst); vc.appendChild(pkRow);
    function checkPacks() {
      if (!B || !B.voices) { packs.textContent = 'Voice check works on the phone.'; return; }
      var info; try { info = JSON.parse(B.voices()); } catch (e) { info = null; }
      if (!info || !info.ready) { packs.textContent = 'Phone voice engine is not ready yet \u2014 reopen Settings in a moment.'; return; }
      var L = info.langs || {}, bn = L['bn-BD'] || L['bn-IN'], hi = L['hi-IN'];
      packs.innerHTML = 'Voice data \u2014 English (UK): <b>' + (L['en-GB'] ? 'installed' : 'MISSING') + '</b> \u00b7 Bangla: <b>' + (bn ? 'installed' : 'MISSING') + '</b> \u00b7 Hindi: <b>' + (hi ? 'installed' : 'MISSING') + '</b>' +
        ((!bn || !hi || !L['en-GB']) ? '<br>Tap the button below to install the missing ones.' : '');
    }
    checkPacks();
    s2.appendChild(vc);

    function sayTest(txt) {
      store.set('settings', JSON.stringify(S));
      if (!B) { toast('Voice test needs the Android app'); return; }
      var o = speakOpts(txt);
      B.speakEx ? B.speakEx(txt, JSON.stringify(o)) : B.speak(txt, o.lang, o.rate, o.pitch);
    }
    var tv = el('div', 'row'); tv.style.margin = '0 0 8px';
    var tbE = el('button', 'btn', 'TEST ENGLISH'); tbE.addEventListener('click', function () { sayTest('All systems are online, ' + addrName() + '. How may I assist?'); });
    var tbB = el('button', 'btn', 'TEST বাংলা'); tbB.addEventListener('click', function () { sayTest('শুভ সন্ধ্যা। আমি জার্ভিস, আপনাকে কীভাবে সাহায্য করতে পারি?'); });
    var tbH = el('button', 'btn', 'TEST हिन्दी'); tbH.addEventListener('click', function () { sayTest('शुभ संध्या। मैं जार्विस हूँ, मैं आपकी कैसे मदद कर सकता हूँ?'); });
    tv.appendChild(tbE); tv.appendChild(tbB); tv.appendChild(tbH); s2.appendChild(tv);

    body.appendChild(s2);

    // --- personality
    var s3 = section('PERSONALITY', 'How Jarvis addresses you and how he behaves.');
    var nm = el('input'); nm.type = 'text'; nm.value = S.name; nm.placeholder = 'sir'; nm.autocapitalize = 'none';
    nm.addEventListener('input', function () { S.name = nm.value; save(); });
    var nc = el('div', 'card'); nc.style.padding = '2px 14px 14px'; nc.appendChild(field('ADDRESS ME AS', nm));
    var sty = el('select');
    STYLES.forEach(function (o) { var op = el('option'); op.value = o[0]; op.textContent = o[1]; if ((S.style || 'jarvis') === o[0]) op.selected = true; sty.appendChild(op); });
    sty.addEventListener('change', function () { S.style = sty.value; save(); toast('Reply style changed'); });
    nc.appendChild(field('REPLY STYLE', sty)); s3.appendChild(nc);
    var ab = el('div', 'card'); ab.style.padding = '2px 14px 14px';
    ABOUT_F.forEach(function (f) {
      var inp = el(f[3] === 'area' ? 'textarea' : 'input'); if (f[3] !== 'area') inp.type = 'text'; else inp.rows = 2;
      inp.placeholder = f[2]; inp.maxLength = 300; inp.value = (S.about || {})[f[0]] || ''; inp.spellcheck = false;
      inp.addEventListener('input', function () { if (!S.about) S.about = {}; S.about[f[0]] = inp.value; save(); });
      ab.appendChild(field(f[1], inp));
    });
    s3.appendChild(el('div', 'dl-note', 'ABOUT ME: tell Jarvis who you are. Everything is optional and stays encrypted on this device.'));
    s3.appendChild(ab);
    s3.appendChild(toggleRow('Share my profile with the AI', 'The details above are sent with your messages to the AI service you chose, so answers fit you. Switch off to keep them on this device only.', function () { return S.aboutOn !== false; }, function (v) { S.aboutOn = v; }));
    s3.appendChild(toggleRow('Emotions', 'Jarvis shows feelings: his orb colour and voice change with the mood of each reply', function () { return S.emotions !== false; }, function (v) { S.emotions = v; }));
    var pr = el('textarea'); pr.value = S.systemPrompt && S.systemPrompt.trim() ? S.systemPrompt : DEFAULT_PROMPT; pr.spellcheck = false;
    pr.addEventListener('input', function () { S.systemPrompt = pr.value.trim() === DEFAULT_PROMPT.trim() ? '' : pr.value; save(); });
    var pc = el('div', 'card'); pc.style.padding = '2px 14px 14px';
    pc.appendChild(field('SYSTEM PROMPT  ({name} and {datetime} are filled in automatically)', pr));
    var pb = el('div', 'row'); var reset = el('button', 'btn', 'RESET TO DEFAULT');
    reset.addEventListener('click', function () { S.systemPrompt = ''; pr.value = DEFAULT_PROMPT; save(); toast('Prompt reset'); });
    pb.appendChild(reset); pc.appendChild(pb); s3.appendChild(pc);
    body.appendChild(s3);

    // --- phone access
    var s4 = section(PC ? 'PC ACCESS' : 'PHONE ACCESS', PC ? 'Voice input sends short recordings of your voice to Groq, OpenAI or Gemini (whichever key you added) to turn them into text. Nothing is recorded until you press the microphone.' : 'Jarvis needs these to call people, find contacts and hear you. Opening apps, YouTube, maps, timers and the flashlight need nothing extra.');
    var host = el('div'); host.id = 'perm-host'; s4.appendChild(host);
    if (PC) {
      if (PC) s4.appendChild(toggleRow('Floating ball', 'The always-on-top Jarvis orb (Ctrl+Alt+J shows or hides it; right-click the ball or the tray icon for the same switch)', function () { try { var q = B.permissions(); if (typeof q === 'string') q = JSON.parse(q); return !!q.ball; } catch (e) { return false; } }, function (v) { B.setBall(v); toast(v ? 'Floating ball on' : 'Floating ball off'); }));
      s4.appendChild(toggleRow('Clap twice to wake him', 'Two sharp claps and Jarvis greets you, then listens. Works on this PC only, the sound is analysed on the PC and never recorded or sent anywhere. Loud music or a noisy room can trigger it by mistake.', function () { return !!S.clap; }, function (v) { S.clap = v; try { B.clapSet(v); } catch (e) { /* */ } if (v) toast('Clap twice any time', 3000); }));
      s4.appendChild(toggleRow('Say \u201cJarvis\u201d to wake him', 'Jarvis listens for his name while this app is open (also when only the floating ball shows). Only short, loud bursts of speech are sent for transcription, at most 10 a minute, and anything without his name is thrown away. Say \u201cJarvis, open Chrome\u201d in one go. Ctrl+Alt+Space also starts listening from anywhere.', function () { return !!S.wake; }, function (v) { S.wake = v; try { B.wakeSet(v); } catch (e) { /* */ } if (v) toast('Say \u201cJarvis\u201d any time', 3000); }));
      s4.appendChild(toggleRow('Keep listening after replies', 'Hands-free inside the app. Say \u201cstop\u201d to end.', function () { return S.handsFree; }, function (v) { S.handsFree = v; handsFreeSuspended = false; }));
      var qb = el('button', 'btn danger', 'QUIT JARVIS'); qb.style.margin = '10px 0'; qb.addEventListener('click', function () { try { B.quitApp(); } catch (e) { /* */ } }); s4.appendChild(qb);
      body.appendChild(s4);
    } else {
    var pbtn = el('div', 'row'); pbtn.style.margin = '0 0 10px';
    var g1 = el('button', 'btn pri', 'GRANT ACCESS'); g1.addEventListener('click', function () { B ? B.requestPermissions() : toast('Only on the phone'); });
    var g2 = el('button', 'btn', 'APP SETTINGS'); g2.addEventListener('click', function () { B ? B.openAppSettings() : toast('Only on the phone'); });
    pbtn.appendChild(g1); pbtn.appendChild(g2); s4.appendChild(pbtn);
    var tb2 = el('div', 'row'); tb2.style.margin = '0 0 10px';
    var g3 = el('button', 'btn', 'ENABLE TYPING (ACCESSIBILITY)');
    g3.addEventListener('click', function () { var r = doAction('settings', 'accessibility'); if (!r.ok) toast(r.msg); else toast('Find Jarvis in the list and switch it on'); });
    tb2.appendChild(g3); s4.appendChild(tb2);
    s4.appendChild(toggleRow('Keep listening after replies', 'Hands-free inside the app. Say \u201cstop\u201d to end.',
      function () { return S.handsFree; }, function (v) { S.handsFree = v; handsFreeSuspended = false; }));
    s4.appendChild(toggleRow('Call help', 'Jarvis says who is calling and lets you answer or reject by voice or by the buttons on the call notification. Asks for phone permissions. For voice answers while the screen is off, keep the floating ball on.',
      function () { try { var st = JSON.parse((B && B.callHelpState && B.callHelpState()) || '{}'); return !!(st.on && st.phone); } catch (e) { return false; } },
      function (v) { try { if (B && B.setCallHelp) { B.setCallHelp(v); if (v) toast('Allow the phone permissions that Android asks for', 4000); } else toast('Only on the phone'); } catch (e) { /* ignore */ } }));
    var bb = el('div', 'row'); bb.style.margin = '0 0 10px';
    var g4 = el('button', 'btn pri', 'TOGGLE FLOATING BALL');
    g4.addEventListener('click', function () {
      if (!B) { toast('Only on the phone'); return; }
      var on = !!perms().ball, r = B.setBall(!on);
      if (r === 'overlay') toast('Allow “Display over other apps” for Jarvis, then tap again', 4200);
      else if (r === 'mic') toast('Allow the microphone, then tap again', 3200);
      else { toast(on ? 'Floating ball off' : (PC ? 'Floating ball on — look at the edge of your screen' : 'Floating ball on — leave the app to see it'), 3200); setTimeout(renderPerms, 400); }
    });
    bb.appendChild(g4);
    var g5 = el('button', 'btn', 'KEEP JARVIS ALIVE (BATTERY)');
    g5.addEventListener('click', function () { if (!B) { toast('Only on the phone'); return; } B.requestBattery(); toast('Choose “Allow” so Android stops switching Jarvis off', 4200); });
    bb.appendChild(g5); s4.appendChild(bb);
    var as = el('div', 'card'); as.style.padding = '12px 14px 14px';
    as.innerHTML = '<b style="font-weight:600">Summon Jarvis from anywhere</b><div class="hint" style="color:var(--mute);font-size:14.5px;margin-top:4px;line-height:1.3">Set Jarvis as your phone’s digital assistant (home-button / power-button gesture) if your Android lists it under Default apps → Digital assistant app.</div>';
    var ab = el('div', 'row'); var od = el('button', 'btn', 'OPEN DEFAULT APPS');
    od.addEventListener('click', function () { var r = doAction('settings', 'defaultapps'); if (!r.ok) toast(r.msg); });
    ab.appendChild(od); as.appendChild(ab); s4.appendChild(as);
    body.appendChild(s4);
    }
    body.appendChild(buildLinkSection());


    // --- security
    var s6 = section('SECURITY', 'Your keys are stored encrypted on this phone and never leave it except to the AI service you chose.');
    if (!PC) s6.appendChild(toggleRow('Lock Jarvis with my phone’s screen lock', 'Ask for fingerprint / PIN when opening Jarvis after a minute away',
      function () { return store.get('applock') === '1'; },
      function (v) {
        if (v && B && B.canLock && !B.canLock()) { toast('Set a screen lock (PIN, pattern or fingerprint) in Android settings first', 4200); store.set('applock', '0'); setTimeout(openSettings, 50); return; }
        store.set('applock', v ? '1' : '0');
      }));
    s6.appendChild(toggleRow('Hide Jarvis in screenshots & recents', 'Blocks screenshots and screen recording of this app',
      function () { return store.get('privacy') === '1'; },
      function (v) { store.set('privacy', v ? '1' : '0'); if (B && B.setPrivacy) B.setPrivacy(v); }));
    s6.appendChild(toggleRow('Ask before sending texts or calling emergency numbers', 'Jarvis asks yes / no first. You can answer by voice.',
      function () { return S.confirmRisky !== false; }, function (v) { S.confirmRisky = v; }));
    s6.appendChild(toggleRow('Ask before every call', 'Also confirm normal phone calls', function () { return !!S.confirmCalls; }, function (v) { S.confirmCalls = v; }));
    body.appendChild(s6);

    // --- data
    var s5 = section('DATA');
    var cr = el('div', 'row'); cr.style.margin = '0';
    var cb = el('button', 'btn danger', 'CLEAR CONVERSATION');
    cb.addEventListener('click', function () { clearChat(); toast('Conversation cleared'); });
    cr.appendChild(cb);
    var wb = el('button', 'btn danger', 'WIPE ALL KEYS & DATA');
    wb.addEventListener('click', function () {
      if (!wb.getAttribute('data-sure')) { wb.setAttribute('data-sure', '1'); wb.textContent = 'TAP AGAIN TO CONFIRM'; setTimeout(function () { wb.removeAttribute('data-sure'); wb.textContent = 'WIPE ALL KEYS & DATA'; }, 4000); return; }
      try { if (B && B.wipeAll) B.wipeAll(); localStorage.clear(); } catch (e) { /* ignore */ }
      toast('Everything erased. Restarting…', 2500); setTimeout(function () { location.reload(); }, 1200);
    });
    cr.appendChild(wb); s5.appendChild(cr);
    body.appendChild(s5);

    // --- user manual
    var sm = section('USER MANUAL', 'A simple guide to set up and use Jarvis. Tap a step to open it.');
    var MAN = [
      ['1 · First start', '<p>Open Jarvis and tap the screen once after the boot animation. When Android asks for permissions, tap <b>Allow</b> for the <b>microphone</b> (so Jarvis can hear you) and, if you want Jarvis to call people, <b>phone</b> and <b>contacts</b>. You can change these later in <b>Settings › Phone Access</b>.</p>'],
      ['2 · Add a free AI key (needed for chatting)', '<p>Jarvis needs an AI “key” to answer questions. Phone commands such as opening apps, time, battery and timers work without it.</p><ol><li>Open <b>Settings › Neural Link</b>.</li><li>Pick <b>Google Gemini</b> (free and quickest).</li><li>Tap <b>GET FREE KEY</b>. Sign in with your Google account and create a key.</li><li>Copy the key, come back to Jarvis and paste it into the key box.</li><li>Tap <b>Test</b>. When it shows a green dot, you are ready.</li></ol><p>You can add more than one provider. If one fails or runs out, Jarvis tries the next automatically.</p>'],
      ['3 · Talk or type', '<p>Tap the big <b>microphone</b> button and speak, or type in the box at the bottom. Try: “open YouTube”, “call Mom”, “what time is it”, “set a timer for 5 minutes”, “remind me to drink water at 5 pm”, “weather in Dhaka”, “navigate to Gulshan”.</p><p>Tap <b>✦ All commands</b> under the chat to see everything Jarvis understands.</p><p>For news, prices or anything recent, Jarvis searches the web by himself when a Tavily or Google search key is added.</p><p><b>Skills:</b> “add milk to my shopping list”, “show my shopping list”, “generate a password”, “start a focus session”, “choose tea or coffee”, “spell necessary”. See <b>All commands</b> for more.</p><p><b>Phone controls:</b> brightness, Do Not Disturb, camera, screenshot, alarms, Spotify, WhatsApp and email drafts, calendar events and “what is on my screen”. Android only lets you flip Wi-Fi, Bluetooth, airplane mode and similar yourself, so Jarvis opens the right switch.</p>'],
      ['4 · Let Jarvis type in other apps', '<p>To write a message, note or email inside another app, Jarvis needs the Accessibility switch.</p><ol><li>Open <b>Settings › Phone Access</b> and tap the accessibility button.</li><li>Find <b>Jarvis</b> in the list and switch it <b>on</b>. Confirm the Android warning.</li><li>Say, for example: “write a leave letter in Keep Notes” — Jarvis opens the app and types it.</li></ol><p>If the text stops partway, tap into the text box first and try again.</p><p><b>Reels and feeds:</b> with typing control on, say “scroll down”, “scroll up”, “next reel”, “previous reel”, “scroll down 3 times”, “scroll down a little”, “scroll to the top” or “stop scrolling”. These do not speak back, so you can keep watching.</p>'],
      ['5 · Floating ball', '<p>The floating ball lets you talk to Jarvis from any screen. <i>On the PC it is a small orb at the screen edge: click it for chat, quick buttons, live PC stats and drop-a-link-to-phone. Ctrl+Alt+J shows or hides it. Turn it off in Settings › Appearance, from the tray icon, or by right-clicking the ball. It follows your colour theme.</i></p><ol><li>In <b>Settings › Phone Access</b> tap <b>TOGGLE FLOATING BALL</b> and allow <b>Display over other apps</b> when Android asks.</li><li><b>Tap</b> the ball and speak. Tap again to stop.</li><li><b>Drag</b> it to move it. <b>Long-press</b> to open the full Jarvis app.</li></ol>'],
      ['6 · Weather and the home-screen widget', '<ol><li>Get a free key at openweathermap.org (tap <b>GET API KEY</b> in <b>Settings › Services › OpenWeather</b>).</li><li>Paste it there, type your <b>default city</b> (for example “Dhaka, BD”), choose units and tap <b>Test</b>.</li><li>On your home screen, long-press an empty spot › <b>Widgets</b> › <b>Jarvis</b> and place it.</li></ol><p>The widget shows time, date, weather, and battery / RAM / storage graphs. Tap it to open the System Monitor. There is also a small <b>Jarvis clock + battery</b> widget in the same Widgets list.</p>'],
      ['7 · Quick tile', '<ul><li><b>Quick tile:</b> pull down the notification shade, tap the pencil or edit icon and drag the <b>Jarvis</b> tile into your quick settings. Tap it to start talking.</li></ul>'],
      ['8 · Call help (answer by voice)', '<ol><li>Open <b>Settings › Phone Access</b> and switch on <b>Call help</b>. Allow every phone permission Android asks for.</li><li>When someone calls, Jarvis says their name (or number) and shows <b>Answer</b> and <b>Reject</b> buttons in the call notification.</li><li>Say <b>“answer”</b> or <b>“reject”</b>. Voice works when Jarvis can use the microphone: keep the <b>floating ball</b> on or the app open. If the microphone is blocked, use the notification buttons.</li><li>Inside Jarvis you can also say “answer the call” or “reject the call”.</li></ol>'],
      ['9 · Routines', '<p>Open <b>Settings › Conversations &amp; Commands › Routines</b> (or say “my routines”). Give a routine a name such as <b>good night</b> and write one command per line, for example “volume down”, “flashlight off”, “set an alarm for 7 am”. Then just say “good night” or “run good night”. Calls and messages are never run from a routine. Saying <b>leaving home</b> or <b>I am home</b> gives you a quick briefing with weather, battery and today’s reminders.</p>'],
      ['10 · Memory, safety and offline', '<ul><li>Say “remember my gym is at 6”, then ask “what is my gym time?”. Say “what do you remember” to see or delete everything.</li><li>Jarvis asks <b>yes / no</b> before sending a text or calling an emergency number. You can answer by voice. Change this in <b>Settings › Security</b>.</li><li>With no internet say “offline mode” to see what still works.</li></ul>'],
      ['11 · Link to your PC', '<p>Control your PC from this phone, and this phone from your PC, with a free private link.</p><ol><li>Open <b>Settings › Device Link</b> and follow the steps (rules have a COPY button).</li><li>Create the link on one device, paste the pairing code on the other.</li><li>Tap <b>RUN FULL CHECK</b>, then say “on my PC open Chrome”.</li></ol><p>Also: “send this to my PC”, “wake my PC”, “at 11 pm shut down my PC”, “back up my documents”, “open the touchpad” (mouse, keys, Ctrl+Shift+Alt shortcuts), and “find my phone” (from the PC). Typing, calls and power stay <b>off</b> until you switch them on.</p>'],
      ['12 · Voice and language', '<p>In <b>Settings › Voice</b> choose the voice style, speed and language (English, Bangla or Hindi). Use <b>TEST ENGLISH</b> and the other test buttons to hear it. If a voice sounds wrong, install the language voice from your phone’s text-to-speech settings.</p>'],
      ['13 · Your name and style', '<p>In <b>Settings › Personality</b> set what Jarvis calls you and how he behaves. In <b>Settings › Appearance</b> change the colour theme (cyan, amber, red, green, purple, Mark or Friday).</p><p><b>About me:</b> below that, fill in the ABOUT ME card (work, city, interests, goals, how you like answers). Jarvis uses it to personalise replies; it is optional and you can stop sharing it with the AI by switching off <b>Share my profile with the AI</b>.</p>'],
      ['14 · Keep your data safe', '<p>Your keys are stored encrypted on this phone and are only sent to the AI service you chose. Use <b>Settings › Backup &amp; Restore</b> to make an encrypted backup code with your own passphrase — save both somewhere safe. If you lose the passphrase, the backup cannot be opened. <b>Settings › Security</b> has the screen-lock option.</p><p><b>Uninstalling</b> Jarvis erases every key and setting on that device, so the next person starts clean. Updating keeps them.</p>'],
            ['15 · Wake the PC', '<p>Switch your PC on from this phone, even when it is off or asleep.</p><ol><li>Open <b>Settings › Device Link › WAKE THE PC</b> while the PC is on and linked.</li><li>Tap <b>LEARN FROM PC</b>, then <b>SAVE</b> (or type the address yourself).</li><li>Tap <b>SET UP ON PC</b> once, so the PC network card accepts the wake signal.</li><li>Later, tap <b>WAKE NOW</b> or say “wake my PC”. Jarvis tells you when the PC is awake.</li></ol><p>The phone must be on the <b>same Wi-Fi</b> as the PC, and <b>Wake-on-LAN</b> must be on in the PC’s BIOS. A PC that is fully powered off on battery, or a laptop with the lid closed, may not wake.</p>'],
      ['16 · Calendar and dashboard', '<p>Say <b>“dashboard”</b> for one screen with the time, weather, your next events, reminders, notes and battery.</p><ul><li>Say “what is on my calendar”, “calendar tomorrow” or “next meeting”.</li><li>The first time, tap <b>ALLOW CALENDAR</b> on the dashboard. Jarvis only <b>reads</b> titles, times and places. Nothing is changed or uploaded.</li><li>On the PC the dashboard shows your phone calendar through the private link.</li></ul>'],
      ['17 · PC voice and “Jarvis”', '<ul><li>On the PC, voice comes first: Jarvis keeps listening after each reply (say “stop” to end).</li><li><b>Ctrl+Alt+Space</b> starts listening from anywhere.</li><li>Switch on <b>Say “Jarvis” to wake him</b> in Settings › PC Access. Say “Jarvis” alone, or “Jarvis, open Chrome” in one go.</li><li>Only short bursts of speech are sent for transcription (at most 10 a minute). Anything without his name is discarded. Switch it off any time.</li><li><b>Clap twice</b> (Settings › PC Access) wakes him; <b>Quit Jarvis</b> is in the tray menu and Settings.</li></ul><p><b>Follow-ups:</b> after “play a song on my PC”, short commands such as pause, next, volume up or “play another song” keep going to the PC (and the same way for the phone) for 15 minutes. Say “back to this phone” to stop. New songs play in the same YouTube tab Jarvis opened and never touch your other tabs.</p><p><b>PC voice:</b> “rewind 10 seconds”, “forward 10 seconds”, “full screen”, “click Skip”, “switch to Chrome”, “close window”, “press Ctrl Shift T”.</p>'],
      ['18 · If something does not work', '<ul><li><b>“Invalid key” or 401:</b> the key was copied wrongly or has spaces; paste it again and tap Test.</li><li><b>No reply / offline:</b> check your internet. Offline, only phone commands work.</li><li><b>Jarvis cannot hear you:</b> allow the microphone in Phone Access and check no other app is using it.</li><li><b>Typing in apps fails:</b> make sure the Accessibility switch is on, then tap the text box and retry.</li><li><b>Weather missing:</b> add the OpenWeather key and city in Services.</li><li><b>Widget shows old data:</b> open Jarvis once; it refreshes the widget.</li></ul><p>Run <b>Settings › Setup Check</b> any time — it lists what is missing and has FIX buttons.</p>']
    ];
    MAN.forEach(function (m, i) {
      var d = el('details', 'man'); if (i === 0) d.open = true;
      var sm1 = el('summary', '', m[0]); d.appendChild(sm1);
      var bd = el('div', 'manb'); bd.innerHTML = m[1]; d.appendChild(bd);
      Array.prototype.forEach.call(bd.querySelectorAll('[data-rules]'), function (pr) { pr.textContent = FB_RULES; });
      Array.prototype.forEach.call(bd.querySelectorAll('[data-act]'), function (bt) {
        bt.addEventListener('click', function () {
          if (bt.getAttribute('data-act') === 'rules') copyTxt(FB_RULES);
          else { try { B.openUrl('https://console.firebase.google.com/'); } catch (e) { /* */ } }
        });
      });
      sm.appendChild(d);
    });
    body.appendChild(sm);

    // --- setup check (top of settings)
    var sc = section('SETUP CHECK', 'Everything Jarvis needs, at a glance. Tap FIX on anything marked ✕.');
    var scBox = el('div'); sc.appendChild(scBox);
    function checkRows() {
      scBox.innerHTML = '';
      var p = perms(), rows = [
        ['AI key', providerOrder().length > 0, 'Add a key under NEURAL LINK', function () { if (showSettingsPage) showSettingsPage('NEURAL LINK'); toast('Paste a key for any provider here', 3000); }],
        ['Microphone', !!p.mic, 'Needed to hear you', function () { B ? B.requestPermissions() : toast('Only on the phone'); }],
        ['Typing control', !!p.access && !p.accessStalled, p.accessStalled ? 'On, but Android has not started it — switch Jarvis off and on in Accessibility' : 'Needed to type in other apps', function () { var r = doAction('settings', 'accessibility'); if (!r.ok) toast(r.msg); }],
        ['Floating ball', !!p.ball, 'Optional bubble over other apps', function () {
          if (!B) { toast('Only on the phone'); return; }
          var r = B.setBall(true);
          if (r === 'overlay') toast('Allow “Display over other apps” for Jarvis, then tap FIX again', 4200);
          else if (r === 'mic') toast('Allow the microphone first', 3200);
          setTimeout(checkRows, 500);
        }],
        ['Battery', !!p.battery, 'Stops Android from switching Jarvis off', function () { B ? B.requestBattery() : toast('Only on the phone'); }]
      ];
      if (PC) rows = rows.filter(function (r) { return r[0] === 'AI key' || r[0] === 'Microphone'; });
      rows.forEach(function (r) {
        var c = el('div', 'card'); c.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px';
        c.appendChild(el('div', '', '<b style="color:' + (r[1] ? 'var(--cy2)' : '#ff9a3c') + ';font-size:18px">' + (r[1] ? '✓' : '✕') + '</b>'));
        var t = el('div', '', '<b style="font-weight:600">' + esc(r[0]) + '</b><div style="color:var(--mute);font-size:13px;line-height:1.3">' + esc(r[1] ? 'Ready' : r[2]) + '</div>'); t.style.flex = '1'; c.appendChild(t);
        if (!r[1]) { var b = el('button', 'btn', 'FIX'); b.addEventListener('click', r[3]); c.appendChild(b); }
        scBox.appendChild(c);
      });
    }
    checkRows();
    var rb = el('div', 'row'); rb.style.margin = '0 0 10px'; var rbtn = el('button', 'btn', 'RE-CHECK'); rbtn.addEventListener('click', checkRows); rb.appendChild(rbtn); sc.appendChild(rb);
    body.insertBefore(sc, body.firstChild);

    // --- backup & restore (encrypted with a passphrase you choose)
    var sb = section('BACKUP & RESTORE', 'Save your keys, notes, memory and Device Link pairing as an encrypted code. Without your passphrase the code is useless to anyone else. Keep both safe.');
    var bc = el('div', 'card'); bc.style.padding = '2px 14px 14px';
    var pass = el('input'); pass.type = 'password'; pass.placeholder = 'Passphrase (8+ characters)'; pass.autocomplete = 'off'; pass.autocapitalize = 'none';
    var blob = el('textarea'); blob.placeholder = 'Backup code appears here, or paste a code to restore'; blob.spellcheck = false; blob.style.minHeight = '90px';
    bc.appendChild(field('PASSPHRASE', pass)); bc.appendChild(field('BACKUP CODE', blob));
    var brow = el('div', 'row'); brow.style.margin = '6px 0 0';
    var bex = el('button', 'btn pri', 'CREATE BACKUP'), bim = el('button', 'btn', 'RESTORE');
    brow.appendChild(bex); brow.appendChild(bim); bc.appendChild(brow);
    var bmsg = el('div', 'hint'); bmsg.style.cssText = 'color:var(--mute);font-size:14px;margin-top:8px;line-height:1.35'; bc.appendChild(bmsg);
    function b64(buf) { var a = new Uint8Array(buf), s2 = ''; for (var i = 0; i < a.length; i++) s2 += String.fromCharCode(a[i]); return btoa(s2); }
    function unb64(t) { var s2 = atob(t), a = new Uint8Array(s2.length); for (var i = 0; i < s2.length; i++) a[i] = s2.charCodeAt(i); return a; }
    function deriveKey(pw, salt) {
      var enc = new TextEncoder();
      return crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (km) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 250000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      });
    }
    bex.addEventListener('click', function () {
      if (!window.crypto || !crypto.subtle) { bmsg.textContent = 'This phone cannot create a secure backup.'; return; }
      if (pass.value.length < 8) { bmsg.textContent = 'Choose a passphrase of at least 8 characters.'; return; }
      var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
      var data = new TextEncoder().encode(JSON.stringify({ v: 1, settings: S, notes: notesGet(), mem: memGet(), link: linkBackup() }));
      bmsg.textContent = 'Encrypting…';
      deriveKey(pass.value, salt).then(function (k) { return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, k, data); }).then(function (ct) {
        var out = 'JARVISBK1.' + b64(salt) + '.' + b64(iv) + '.' + b64(ct);
        blob.value = out; S.lastBackup = Date.now(); save();
        if (B && B.copyText) { B.copyText(out); bmsg.textContent = 'Backup created and copied. Paste it somewhere safe (a private note or your own cloud drive).'; }
        else bmsg.textContent = 'Backup created. Copy the code and keep it safe.';
      }).catch(function () { bmsg.textContent = 'Backup failed.'; });
    });
    bim.addEventListener('click', function () {
      var parts = blob.value.trim().split('.');
      if (!window.crypto || !crypto.subtle || parts.length !== 4 || parts[0] !== 'JARVISBK1') { bmsg.textContent = 'That is not a Jarvis backup code.'; return; }
      if (!pass.value) { bmsg.textContent = 'Enter the passphrase you used for this backup.'; return; }
      bmsg.textContent = 'Decrypting…';
      var salt, iv, ct; try { salt = unb64(parts[1]); iv = unb64(parts[2]); ct = unb64(parts[3]); } catch (e) { bmsg.textContent = 'That backup code is damaged.'; return; }
      deriveKey(pass.value, salt).then(function (k) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, k, ct); }).then(function (pt) {
        var d = JSON.parse(new TextDecoder().decode(pt));
        if (!d || d.v !== 1 || typeof d.settings !== 'object') throw 0;
        store.set('settings', JSON.stringify(d.settings));
        if (Array.isArray(d.mem)) memSet(d.mem.slice(-100).map(function (x) { return { f: String((x && x.f) || '').slice(0, 240), t: Number(x && x.t) || Date.now() }; }).filter(function (x) { return x.f; }));
        linkRestore(d.link);
        if (Array.isArray(d.notes)) notesSet(d.notes.slice(-100).map(function (x) { return String(x).slice(0, 500); }));
        bmsg.textContent = 'Restored. Restarting…'; setTimeout(function () { location.reload(); }, 900);
      }).catch(function () { bmsg.textContent = 'Wrong passphrase or damaged code. Nothing was changed.'; });
    });
    sb.appendChild(bc);
    body.appendChild(sb);

    body.appendChild(el('div', 'foot', 'J.A.R.V.I.S · v1.36.0' + (PC ? ' · PC' : '')));
    buildSettingsMenu(body, scBox);
    renderPerms();
  }

  /* ------------------------------------------------------------------ boot */
  var booted = false;
  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }
  function finishBoot() {
    if (booted) return; booted = true;
    $('#boot').classList.add('out'); $('#app').classList.add('on');
    setTimeout(function () { Orb.resize(); }, 50); applyOrbStyle(S.orbStyle);

    watchPc();
    try { var shr = B && B.consumeShare ? B.consumeShare() : ''; if (shr) setTimeout(function () { shareToPc(shr); }, 1200); } catch (e) { /* ignore */ }
    try { if (B && B.notesSync) B.notesSync(JSON.stringify(notesGet())); } catch (e) { /* ignore */ }      // keeps the home-screen notes widget current
    var assist = '';
    try { assist = B ? B.consumeLaunchFlag() : ''; } catch (e) { /* ignore */ }

    if (!S.askedPerms && B) { S.askedPerms = true; store.set('settings', JSON.stringify(S)); setTimeout(function () { B.requestPermissions(); }, 900); }

    if (assist === 'monitor') { setTimeout(openMonitor, 500); return; }
    if (assist === 'notes' || assist === 'notesadd') { setTimeout(function () { openNotes(assist === 'notesadd'); }, 600); return; }
    if (assist === 'assist') { setTimeout(startListening, 700); return; }

    var linked = providerOrder().length > 0;
    var offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
    var g = greeting() + ', ' + addrName() + (offline
      ? '. I\u2019m ready, but there is no internet right now \u2014 phone commands, time, battery and reminders still work.'
      : '. All systems are online.');
    if (!linked && !offline) {
      g += ' To enable my AI core, open settings and add a free API key.';
      gearPulse(true);
    }
    addMsg('j', g);
    try {
      var nowT = Date.now();
      if (!S.firstRun) { S.firstRun = nowT; save(); }
      var age = nowT - (S.lastBackup || S.firstRun);
      if (age > 14 * 86400000 && nowT - (S.nudgedAt || 0) > 7 * 86400000 && (providerOrder().length || memGet().length || notesGet().length)) {
        S.nudgedAt = nowT; save();
        addMsg('act', '⚠ Backup reminder: it has been a while. Open Settings › Backup & Restore to save your keys, notes and memory.', true);
      }
    } catch (e) { /* ignore */ }
    if (S.speak && B) { setState('speaking'); B.speak(cleanForSpeech(g), S.lang, S.rate, S.pitch); speakWatch = setTimeout(function () { if (state === 'speaking') setState('idle'); }, 12000); }
  }

  function runBoot() {
    var log = $('#boot-log');
    var linked = providerOrder().length > 0;
    var p = perms();
    var lines = [
      ['BOOTING CORE SYSTEMS', 'ok', 'STARTED'],
      ['LOADING NEURAL INTERFACE', 'ok', 'READY'],
      ['VOICE MODULE', 'ok', 'READY'],
      ['PHONE CONTROL LINK', p.call && p.contacts ? 'ok' : 'wn', p.call && p.contacts ? 'ACTIVE' : 'LIMITED'],
      ['NETWORK', navigator.onLine === false ? 'wn' : 'ok', navigator.onLine === false ? 'OFFLINE' : 'ONLINE'],
      ['AI CORE', linked ? (navigator.onLine === false ? 'wn' : 'ok') : 'wn', linked ? (navigator.onLine === false ? 'WAITING FOR NET' : 'LINKED') : 'NO KEY']
    ];
    lines.forEach(function (l, i) {
      setTimeout(function () {
        if (booted) return;
        var d = el('div', '', '› ' + l[0] + ' … <span class="' + l[1] + '">' + l[2] + '</span>');
        log.appendChild(d);
      }, 400 + i * 380);
    });
    setTimeout(function () { if (!booted) { var d = el('div', 'fin', '› ALL SYSTEMS ONLINE'); log.appendChild(d); } }, 400 + lines.length * 380 + 80);
    setTimeout(finishBoot, 400 + lines.length * 380 + 800);
    $('#boot').addEventListener('click', finishBoot);
  }

  /* ------------------------------------------------------------------ wire up */
  function buildChips() {
    var items = [
      ['✦ All commands', '__cmds'], ['◫ Dashboard', 'dashboard'], ['▥ System graphs', 'system monitor'], ['Open YouTube', 'open youtube'], ['What time is it', 'what time is it'], ['Battery level', 'battery level'],
      ['Flashlight on', 'flashlight on'], ['Call…', null, 'call '], ['Set a timer', 'set a timer for 5 minutes'],
      ['Tell me a joke', 'tell me a joke'], ['Navigate…', null, 'navigate to ']
    ];
    var host = $('#chips');
    items.forEach(function (it) {
      var b = el('button', 'qchip', esc(it[0]));
      b.addEventListener('click', function () {
        haptic();
        if (it[1] === '__cmds') openCmds();
        else if (it[1]) handleUser(it[1], false);
        else { textEl.value = it[2]; textEl.focus(); sendEl.classList.add('on'); }
      });
      host.appendChild(b);
    });
  }

  function init() {
    applyTheme(S.theme);
    Orb.start($('#orb'));
    setState('idle');
    buildChips();
    updateProviderChip();
    if (!PC) { var ck0 = $('#clock'); if (ck0) ck0.style.display = 'none'; }      // the phone's own status bar already shows the time
    tickClock(); setInterval(tickClock, 20000);
    restoreHistory();
    setTimeout(sysSample, 1500);

    logEl.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a.lnk') : null;
      if (a) { e.preventDefault(); openLink(a.getAttribute('data-url')); }
    });
    micEl.addEventListener('click', function () {
      haptic();
      if (state === 'listening') { handsFreeSuspended = true; stopListening(); return; }
      if (state === 'speaking') { handsFreeSuspended = true; stopSpeakingNow(); return; }
      if (state === 'thinking') return;
      handsFreeSuspended = false; emptyListens = 0;
      startListening();
    });
    function submit() {
      var v = textEl.value.trim();
      if (!v) return;
      textEl.value = ''; sendEl.classList.remove('on'); if (!PC) textEl.blur();      // PC: stay in the box so you can keep typing
      handsFreeSuspended = false;
      handleUser(v, false);
    }
    sendEl.addEventListener('click', submit);
    if (PC) {
      // like any desktop chat app: just start typing, no need to click the box first
      var typeBox = function () { try { if (!settingsOpen && !document.querySelector('.panel.open') && document.activeElement !== textEl && !String(window.getSelection && window.getSelection()).length) textEl.focus(); } catch (e) { /* ignore */ } };
      document.addEventListener('keydown', function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
        var a = document.activeElement, tag = a && a.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (a && a.isContentEditable)) return;
        if (settingsOpen || document.querySelector('.panel.open')) return;
        if (e.key && (e.key.length === 1 || e.key === 'Backspace')) typeBox();      // the key itself then lands in the box
      }, true);
      window.addEventListener('focus', function () { setTimeout(typeBox, 60); });
      document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('input,textarea,select,button,a,.panel,#settings,.toast')) setTimeout(typeBox, 0); });
      setTimeout(typeBox, 900);
    }
    textEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    textEl.addEventListener('input', function () { sendEl.classList.toggle('on', !!textEl.value.trim()); });
    textEl.addEventListener('focus', function () { setTimeout(scrollLog, 300); });
    $('#btn-settings').addEventListener('click', function () { haptic(); openSettings(); });
    $('#provider-chip').addEventListener('click', function () { openSettings(); if (showSettingsPage) showSettingsPage('NEURAL LINK'); });     // straight to the AI providers
    $('#set-back').addEventListener('click', settingsBack);

    runBoot();
  }

  if (PC) setTimeout(function () { hudSet(S.pcHud !== false); }, 1200);
  if (PC && (S.wake || S.clap)) setTimeout(function () { try { B.clapSet(!!S.clap); B.wakeSet(!!S.wake); } catch (e) { /* */ } }, 3500);
  window.__jarvisTest = { setState: setState, scriptLang: scriptLang, speakOpts: speakOpts, S: S, localIntent: localIntent, norm: norm, runTags: runTags, buildSystem: buildSystem, applyMood: applyMood, personaText: personaText, linkify: linkify, handleUser: handleUser };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
