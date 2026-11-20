/* Jarvis Tools: small helpers that run on the device and use NO AI tokens.
   Shared by the phone and the PC. host = { PC, makePanel, toast, copy, net(kind,arg)->Promise, act(type,arg,arg2)->Promise, screenQr()->Promise, scanImage()->Promise, flash(on) } */
(function () {
  'use strict';
  var host = null, panel = null, current = null, tick = null, abort = false;

  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function btn(label, fn, cls) { var b = h('button', 'btn' + (cls ? ' ' + cls : ''), esc(label)); b.addEventListener('click', fn); return b; }
  function fld(label, input) { var l = h('label', 'fld'); l.appendChild(h('span', '', esc(label))); l.appendChild(input); return l; }
  function inp(type, ph, val) { var i = h('input'); i.type = type || 'text'; if (ph) i.placeholder = ph; if (val != null) i.value = val; i.autocomplete = 'off'; i.spellcheck = false; return i; }
  function sel(opts, val) { var s = h('select'); opts.forEach(function (o) { var op = h('option', '', esc(Array.isArray(o) ? o[1] : o)); op.value = Array.isArray(o) ? o[0] : o; s.appendChild(op); }); if (val != null) s.value = val; return s; }
  function out(cls) { var d = h('div', 'card tl-out' + (cls ? ' ' + cls : '')); d.style.cssText = 'padding:12px 14px;white-space:pre-wrap;word-break:break-word;user-select:text;-webkit-user-select:text'; return d; }
  function row() { var r = h('div'); r.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:6px 0'; return r; }
  function fmt(n, d) { if (!isFinite(n)) return '—'; var a = Math.abs(n); d = d == null ? (a >= 100 ? 2 : a >= 1 ? 4 : 6) : d; return String(+n.toFixed(d)); }
  function copyBtn(getText) { return btn('COPY', function () { host.copy(getText()); host.toast('Copied', 1200); }); }

  /* ------------------------------------------------ hashes (so no secure-context API is needed) */
  function utf8(s) { return unescape(encodeURIComponent(s)); }
  function rol(n, b) { return (n << b) | (n >>> (32 - b)); }
  function hex32(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }
  function sha1(str) {
    var m = utf8(str), l = m.length, w = [], i, j, H = [0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0];
    for (i = 0; i < l; i++) w[i >> 2] |= m.charCodeAt(i) << (24 - (i % 4) * 8);
    w[l >> 2] |= 0x80 << (24 - (l % 4) * 8); w[(((l + 8) >> 6) << 4) + 15] = l * 8;
    for (i = 0; i < w.length; i += 16) {
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], x = [];
      for (j = 0; j < 80; j++) {
        x[j] = j < 16 ? (w[i + j] | 0) : rol(x[j - 3] ^ x[j - 8] ^ x[j - 14] ^ x[j - 16], 1);
        var f = j < 20 ? (b & c) | (~b & d) : j < 40 ? b ^ c ^ d : j < 60 ? (b & c) | (b & d) | (c & d) : b ^ c ^ d;
        var k = j < 20 ? 0x5A827999 : j < 40 ? 0x6ED9EBA1 : j < 60 ? 0x8F1BBCDC : 0xCA62C1D6;
        var t = (rol(a, 5) + f + e + k + x[j]) | 0; e = d; d = c; c = rol(b, 30); b = a; a = t;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0;
    }
    return H.map(hex32).join('');
  }
  var K256 = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(str) {
    var m = utf8(str), l = m.length, w = [], i, j, H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    function ror(n, b) { return (n >>> b) | (n << (32 - b)); }
    for (i = 0; i < l; i++) w[i >> 2] |= m.charCodeAt(i) << (24 - (i % 4) * 8);
    w[l >> 2] |= 0x80 << (24 - (l % 4) * 8); w[(((l + 8) >> 6) << 4) + 15] = l * 8;
    for (i = 0; i < w.length; i += 16) {
      var x = [], v = H.slice();
      for (j = 0; j < 64; j++) {
        if (j < 16) x[j] = w[i + j] | 0;
        else { var s0 = ror(x[j - 15], 7) ^ ror(x[j - 15], 18) ^ (x[j - 15] >>> 3), s1 = ror(x[j - 2], 17) ^ ror(x[j - 2], 19) ^ (x[j - 2] >>> 10); x[j] = (x[j - 16] + s0 + x[j - 7] + s1) | 0; }
        var S1 = ror(v[4], 6) ^ ror(v[4], 11) ^ ror(v[4], 25), ch = (v[4] & v[5]) ^ (~v[4] & v[6]), t1 = (v[7] + S1 + ch + K256[j] + x[j]) | 0;
        var S0 = ror(v[0], 2) ^ ror(v[0], 13) ^ ror(v[0], 22), mj = (v[0] & v[1]) ^ (v[0] & v[2]) ^ (v[1] & v[2]), t2 = (S0 + mj) | 0;
        v = [(t1 + t2) | 0, v[0], v[1], v[2], (v[3] + t1) | 0, v[4], v[5], v[6]];
      }
      for (j = 0; j < 8; j++) H[j] = (H[j] + v[j]) | 0;
    }
    return H.map(hex32).join('');
  }

  /* ------------------------------------------------ calculator (no eval) */
  function calc(src) {
    var s = String(src).toLowerCase().replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '').replace(/,/g, '.'), p = 0;
    var F = { sqrt: Math.sqrt, abs: Math.abs, sin: function (x) { return Math.sin(x * Math.PI / 180); }, cos: function (x) { return Math.cos(x * Math.PI / 180); }, tan: function (x) { return Math.tan(x * Math.PI / 180); }, log: Math.log10, ln: Math.log, round: Math.round, floor: Math.floor, ceil: Math.ceil };
    function peek() { return s.charAt(p); }
    function expr() { var v = term(); while (peek() === '+' || peek() === '-') { var o = s.charAt(p++); var r = term(); v = o === '+' ? v + r : v - r; } return v; }
    function term() { var v = pow(); while (peek() === '*' || peek() === '/' || peek() === '%') { var o = s.charAt(p++); var r = pow(); v = o === '*' ? v * r : o === '/' ? v / r : v % r; } return v; }
    function pow() { var b = unary(); if (peek() === '^') { p++; return Math.pow(b, pow()); } return b; }
    function unary() { if (peek() === '-') { p++; return -unary(); } if (peek() === '+') { p++; return unary(); } return atom(); }
    function atom() {
      var m;
      if (peek() === '(') { p++; var v = expr(); if (peek() !== ')') throw 0; p++; return v; }
      if ((m = /^\d*\.?\d+(e[+-]?\d+)?/.exec(s.slice(p)))) { p += m[0].length; var n = parseFloat(m[0]); if (peek() === '%') { p++; n /= 100; } return n; }
      if ((m = /^[a-z]+/.exec(s.slice(p)))) {
        p += m[0].length; if (m[0] === 'pi') return Math.PI; if (m[0] === 'e') return Math.E;
        if (F[m[0]] && peek() === '(') { p++; var a = expr(); if (peek() !== ')') throw 0; p++; return F[m[0]](a); }
      }
      throw 0;
    }
    if (!s || s.length > 200) return NaN;
    try { var r = expr(); return p === s.length ? r : NaN; } catch (e) { return NaN; }
  }

  /* ------------------------------------------------ units */
  var UNITS = {
    Length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mile: 1609.344, yard: 0.9144, foot: 0.3048, inch: 0.0254 },
    Weight: { kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.0283495231, tonne: 1000 },
    Volume: { litre: 1, ml: 0.001, gallon: 3.785411784, cup: 0.2365882365, tbsp: 0.0147867648, tsp: 0.0049289216 },
    Speed: { 'km/h': 1, 'm/s': 3.6, mph: 1.609344, knot: 1.852 },
    Area: { 'm²': 1, 'km²': 1e6, hectare: 1e4, acre: 4046.8564224, 'ft²': 0.09290304, katha: 66.89, bigha: 1337.8 },
    Data: { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 },
    Temperature: { '°C': 1, '°F': 1, K: 1 }
  };
  var ALIAS = { kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km', kms: 'km', meter: 'm', meters: 'm', metre: 'm', metres: 'm', mile: 'mile', miles: 'mile', foot: 'foot', feet: 'foot', ft: 'foot', inch: 'inch', inches: 'inch', yard: 'yard', yards: 'yard', kilogram: 'kg', kilograms: 'kg', kgs: 'kg', gram: 'g', grams: 'g', pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz', liter: 'litre', liters: 'litre', litres: 'litre', l: 'litre', gallons: 'gallon', celsius: '°C', c: '°C', fahrenheit: '°F', f: '°F', kelvin: 'K', kph: 'km/h', kmh: 'km/h', knots: 'knot', acres: 'acre', hectares: 'hectare', cups: 'cup', centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm', millimeter: 'mm', millimeters: 'mm' };
  function unitCat(u) { for (var c in UNITS) if (UNITS[c][u] != null) return c; return null; }
  function convertUnit(v, from, to) {
    var cat = unitCat(from); if (!cat || unitCat(to) !== cat) return NaN;
    if (cat === 'Temperature') { var c = from === '°C' ? v : from === '°F' ? (v - 32) * 5 / 9 : v - 273.15; return to === '°C' ? c : to === '°F' ? c * 9 / 5 + 32 : c + 273.15; }
    return v * UNITS[cat][from] / UNITS[cat][to];
  }
  function normUnit(u) { u = String(u || '').toLowerCase().replace(/^degrees? /, '').replace(/^°/, ''); if (ALIAS[u]) return ALIAS[u]; for (var c in UNITS) for (var k in UNITS[c]) if (k.toLowerCase() === u) return k; return null; }

  /* ------------------------------------------------ morse */
  var MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-', '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', '_': '..--.-', '"': '.-..-.', '@': '.--.-.', "'": '.----.' };
  var UNMORSE = {}; Object.keys(MORSE).forEach(function (k) { UNMORSE[MORSE[k]] = k; });
  function toMorse(t) { return String(t).toLowerCase().split(/\s+/).filter(Boolean).map(function (w) { return w.split('').map(function (c) { return MORSE[c] || ''; }).filter(Boolean).join(' '); }).join(' / '); }
  function fromMorse(m) { return String(m).trim().split(/\s*\/\s*|\s{3,}/).map(function (w) { return w.split(/\s+/).map(function (c) { return UNMORSE[c] || '?'; }).join(''); }).join(' ').toUpperCase(); }
  var audioCtx = null;
  function beepMorse(morse, wpm, onOn, onDone) {
    var unit = 1200 / (wpm || 15), seq = [], i;                       // ms per dot
    String(morse).split('').forEach(function (c) { if (c === '.') seq.push([1, true], [1, false]); else if (c === '-') seq.push([3, true], [1, false]); else if (c === ' ') seq.push([2, false]); else if (c === '/') seq.push([4, false]); });
    try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    var osc = null, g = null, t = audioCtx ? audioCtx.currentTime + 0.05 : 0;
    if (audioCtx) { osc = audioCtx.createOscillator(); g = audioCtx.createGain(); osc.frequency.value = 650; g.gain.value = 0; osc.connect(g); g.connect(audioCtx.destination); osc.start(t); }
    var at = 0, timers = [];
    seq.forEach(function (s) { var d = s[0] * unit; if (s[1]) { if (g) { g.gain.setValueAtTime(0.4, t + at / 1000); g.gain.setValueAtTime(0, t + (at + d) / 1000); } timers.push(setTimeout(function () { onOn(true); }, at)); timers.push(setTimeout(function () { onOn(false); }, at + d)); } at += d; });
    timers.push(setTimeout(function () { if (osc) try { osc.stop(); } catch (e) { /* */ } onDone(); }, at + 100));
    return function stop() { timers.forEach(clearTimeout); if (osc) try { osc.stop(); } catch (e) { /* */ } onOn(false); onDone(); };
  }

  /* ------------------------------------------------ URL check (local rules, no network, no tokens) */
  var BRANDS = { paypal: 'paypal.com', google: 'google.com', facebook: 'facebook.com', instagram: 'instagram.com', whatsapp: 'whatsapp.com', bkash: 'bkash.com', nagad: 'nagad.com.bd', apple: 'apple.com', icloud: 'icloud.com', microsoft: 'microsoft.com', amazon: 'amazon.com', netflix: 'netflix.com', binance: 'binance.com', telegram: 'telegram.org', youtube: 'youtube.com', github: 'github.com', dropbox: 'dropbox.com', linkedin: 'linkedin.com', twitter: 'twitter.com', gmail: 'gmail.com' };
  var SHORT = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'ow.ly', 'rebrand.ly', 'cutt.ly', 'buff.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'lnkd.in', 'wa.me'];
  var BADTLD = ['zip', 'mov', 'xyz', 'top', 'tk', 'ml', 'ga', 'cf', 'gq', 'click', 'link', 'work', 'rest', 'country', 'cyou', 'icu', 'buzz', 'monster', 'cam', 'sbs'];
  var SLD = ['co.uk', 'com.bd', 'org.bd', 'net.bd', 'gov.bd', 'edu.bd', 'com.au', 'co.in', 'co.jp', 'com.br'];
  function urlCheck(raw) {
    var u = String(raw || '').trim(), why = [], score = 0, good = [];
    if (!u) return { score: 0, level: 'none', why: ['Paste a link first.'], good: [] };
    if (/^(javascript|data|vbscript|file):/i.test(u)) return { score: 9, level: 'bad', why: ['This is not a web link. It can run code on your device.'], good: [], host: '' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
    var a; try { a = new URL(u); } catch (e) { return { score: 5, level: 'bad', why: ['This is not a valid web address.'], good: [], host: '' }; }
    var host = a.hostname.toLowerCase(), labels = host.split('.'), reg = labels.slice(-2).join('.');
    if (labels.length >= 3 && SLD.indexOf(labels.slice(-2).join('.')) >= 0) reg = labels.slice(-3).join('.');
    if (a.protocol === 'http:') { score += 1; why.push('Not encrypted (http). Never type passwords or card numbers on it.'); } else good.push('Uses an encrypted connection (https).');
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\[/.test(a.host)) { score += 2; why.push('The address is a raw number, not a name. Real sites rarely do this.'); }
    if (/@/.test(a.href.split('?')[0].replace(/^[a-z]+:\/\//i, '').split('/')[0])) { score += 3; why.push('There is an “@” in the address, a trick used to hide the real site.'); }
    if (/xn--/.test(host) || /[^\x00-\x7f]/.test(a.hostname)) { score += 2; why.push('The name uses look-alike international letters (“punycode”).'); }
    if (SHORT.indexOf(reg) >= 0) { score += 1; why.push('A short link hides where it goes. Open it only if you trust who sent it.'); }
    if (BADTLD.indexOf(labels[labels.length - 1]) >= 0) { score += 1; why.push('The “.' + labels[labels.length - 1] + '” ending is often used for scams.'); }
    if (labels.length >= 5) { score += 1; why.push('Many sub-parts in the name. Scam links stack names to look real.'); }
    if ((host.match(/-/g) || []).length >= 3) { score += 1; why.push('Lots of hyphens in the name.'); }
    if (a.href.length > 120) { score += 1; why.push('The link is very long.'); }
    if (a.port && a.port !== '80' && a.port !== '443') { score += 1; why.push('It uses an unusual port (' + a.port + ').'); }
    Object.keys(BRANDS).forEach(function (b) { if (host.indexOf(b) >= 0 && reg !== BRANDS[b] && labels.slice(-2).join('.') !== BRANDS[b] && host.slice(-BRANDS[b].length - 1) !== '.' + BRANDS[b] && host !== BRANDS[b]) { score += 3; why.push('The name contains “' + b + '” but the real site is ' + BRANDS[b] + '. This looks like an imitation.'); } });
    if (/(login|signin|verify|update|secure|account|password|wallet|prize|free|gift|bonus|claim|suspend)/i.test(a.pathname + a.search) && score >= 1) { score += 1; why.push('Words like login, verify or prize in the link, a common trick to hurry you.'); }
    var level = score >= 4 ? 'bad' : score >= 2 ? 'warn' : 'ok';
    return { score: score, level: level, why: why, good: good, host: reg };
  }
  function urlSummary(r) {
    if (r.level === 'none') return r.why[0];
    var head = r.level === 'bad' ? 'Danger: this link looks unsafe.' : r.level === 'warn' ? 'Careful: this link looks suspicious.' : 'No warning signs found.';
    return head + (r.why.length ? ' ' + r.why.slice(0, 2).join(' ') : '') + (r.level === 'ok' ? ' This is a quick check, not a guarantee.' : '');
  }

  /* ------------------------------------------------ passwords */
  var COMMON = ['password', '123456', '12345678', 'qwerty', 'abc123', 'letmein', 'iloveyou', 'admin', 'welcome', 'monkey', 'dragon', 'football', 'login', 'passw0rd', '111111', '000000', '123123', 'bangladesh', 'jarvis', 'sunshine'];
  function rnd(n) { var a = new Uint32Array(1), lim = Math.floor(4294967296 / n) * n, v; do { crypto.getRandomValues(a); v = a[0]; } while (v >= lim); return v % n; }
  function genPass(len, o) {
    var sets = []; if (o.lower) sets.push('abcdefghijkmnopqrstuvwxyz'); if (o.upper) sets.push('ABCDEFGHJKLMNPQRSTUVWXYZ'); if (o.digit) sets.push('23456789'); if (o.sym) sets.push('!@#$%^&*-_=+?');
    if (!sets.length) sets.push('abcdefghijkmnopqrstuvwxyz');
    var all = sets.join(''), p = sets.map(function (s) { return s.charAt(rnd(s.length)); });
    while (p.length < len) p.push(all.charAt(rnd(all.length)));
    for (var i = p.length - 1; i > 0; i--) { var j = rnd(i + 1), t = p[i]; p[i] = p[j]; p[j] = t; }
    return p.slice(0, len).join('');
  }
  function strength(pw) {
    if (!pw) return { bits: 0, label: '', tips: [] };
    var pool = 0; if (/[a-z]/.test(pw)) pool += 26; if (/[A-Z]/.test(pw)) pool += 26; if (/\d/.test(pw)) pool += 10; if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
    var bits = pw.length * Math.log2(pool || 1), tips = [];
    if (COMMON.indexOf(pw.toLowerCase()) >= 0 || COMMON.some(function (c) { return pw.toLowerCase().indexOf(c) === 0 && pw.length < c.length + 4; })) { bits = Math.min(bits, 10); tips.push('This is a very common password.'); }
    if (/(.)\1{2,}/.test(pw)) { bits -= 8; tips.push('Repeated characters weaken it.'); }
    if (/(abc|bcd|cde|123|234|345|456|567|678|789|qwe|wer|ert|asd|sdf)/i.test(pw)) { bits -= 10; tips.push('Easy patterns like 123 or qwe weaken it.'); }
    if (pw.length < 12) tips.push('Use 12 or more characters.');
    if (!/[^a-zA-Z0-9]/.test(pw)) tips.push('Add a symbol.');
    bits = Math.max(0, bits);
    return { bits: bits, label: bits < 28 ? 'Very weak' : bits < 45 ? 'Weak' : bits < 60 ? 'Okay' : bits < 80 ? 'Strong' : 'Very strong', tips: tips };
  }

  /* ------------------------------------------------ views */
  function view(title, build) {
    stopTick(); abort = false; var b = panel.body; b.innerHTML = ''; current = title;
    var top = h('div'); top.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:10px';
    top.appendChild(btn('‹ ALL TOOLS', function () { home(); })); top.appendChild(h('div', '', '<b style="letter-spacing:.12em;color:var(--cy2)">' + esc(title.toUpperCase()) + '</b>'));
    b.appendChild(top); build(b); b.scrollTop = 0;
  }
  function stopTick() { if (tick) { clearInterval(tick); tick = null; } abort = true; if (panel && panel.cleanup) { try { panel.cleanup(); } catch (e) { /* */ } panel.cleanup = null; } }

  var TOOLS = [];
  function reg(id, icon, name, desc, pcOnly, build) { TOOLS.push({ id: id, icon: icon, name: name, desc: desc, pcOnly: pcOnly, build: build }); }

  /* speed */
  reg('speed', '⚡', 'Network speed', 'Download, upload and ping', false, function (b) {
    var big = h('div'); big.style.cssText = 'text-align:center;margin:14px 0'; big.innerHTML = '<div id="tl-sp" style="font-family:Orbitron,sans-serif;font-size:44px;color:var(--cy2)">—</div><div id="tl-sl" style="color:var(--mute)">Tap START</div>';
    var res = out(); res.innerHTML = '<small style="color:var(--mute)">Uses about 40 MB of data. Do it on Wi-Fi or a plan you can spare.</small>';
    var go = btn('START SPEED TEST', run, 'pri'); b.appendChild(big); b.appendChild(go); b.appendChild(res);
    function set(v, l) { big.querySelector('#tl-sp').textContent = v; big.querySelector('#tl-sl').textContent = l; }
    function mbps(d) { return d.bytes * 8 / (d.ms / 1000) / 1e6; }
    async function run() {
      go.disabled = true; var r = { ping: [], down: 0, up: 0 };
      try {
        set('…', 'Checking response time'); for (var i = 0; i < 4 && !abort; i++) r.ping.push((await host.net('ping', '')).ms);
        var minP = Math.min.apply(null, r.ping), jit = Math.max.apply(null, r.ping) - minP; set(fmt(minP, 0) + ' ms', 'Ping');
        var sizes = [1000000, 4000000, 12000000, 25000000], t0 = Date.now();
        for (i = 0; i < sizes.length && !abort; i++) { var d = await host.net('down', String(sizes[i])); var m = mbps(d); r.down = Math.max(r.down, m); set(fmt(m, 1) + ' Mbps', 'Download…'); if (d.ms > 3500 || Date.now() - t0 > 12000) break; }
        sizes = [500000, 2000000, 6000000]; t0 = Date.now();
        for (i = 0; i < sizes.length && !abort; i++) { d = await host.net('up', String(sizes[i])); m = mbps(d); r.up = Math.max(r.up, m); set(fmt(m, 1) + ' Mbps', 'Upload…'); if (d.ms > 3500 || Date.now() - t0 > 10000) break; }
        if (abort) return;
        set(fmt(r.down, 1) + ' Mbps', 'Download speed');
        var q = r.down >= 25 ? 'Great for video calls and HD streaming.' : r.down >= 8 ? 'Fine for browsing and video.' : r.down >= 2 ? 'Slow: browsing works, video may buffer.' : 'Very slow connection.';
        res.innerHTML = '<b>Download</b> ' + fmt(r.down, 1) + ' Mbps<br><b>Upload</b> ' + fmt(r.up, 1) + ' Mbps<br><b>Ping</b> ' + fmt(minP, 0) + ' ms · jitter ' + fmt(jit, 0) + ' ms<br><span style="color:var(--mute)">' + q + '</span>';
        host.remember && host.remember('speed', 'Download ' + fmt(r.down, 1) + ' Mbps, upload ' + fmt(r.up, 1) + ' Mbps, ping ' + fmt(minP, 0) + ' ms.');
      } catch (e) { set('—', 'Test failed'); res.textContent = (e && e.message) || (typeof e === 'string' ? e : 'The test could not finish. Check your internet connection.'); }
      go.disabled = false;
    }
  });

  /* url */
  reg('url', '🛡', 'Link safety check', 'Is this link a scam?', false, function (b) {
    var i = inp('text', 'Paste a link, e.g. bit.ly/…'), o = out(); o.textContent = 'Paste a link and tap CHECK. Nothing is opened and nothing is sent anywhere.';
    b.appendChild(fld('LINK', i)); var r = row(); r.appendChild(btn('CHECK', function () { show(urlCheck(i.value)); }, 'pri')); r.appendChild(btn('PASTE', function () { if (host.paste) host.paste().then(function (t) { if (t) { i.value = t; show(urlCheck(t)); } }); })); b.appendChild(r); b.appendChild(o);
    function show(x) {
      var col = x.level === 'bad' ? 'var(--bad)' : x.level === 'warn' ? 'var(--am)' : 'var(--ok)';
      o.innerHTML = '<b style="color:' + col + '">' + esc(urlSummary(x).split('. ')[0]) + '</b>' + (x.host ? '<br><span style="color:var(--mute)">Real site name: ' + esc(x.host) + '</span>' : '') + '<ul style="margin:8px 0 0 18px">' + x.why.concat(x.good).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul><small style="color:var(--mute)">A quick check of the address only, not a guarantee. When unsure, do not enter passwords or payment details.</small>';
    }
  });

  /* qr */
  function drawQr(text, cv) {
    var qr = qrcode(0, 'M'); qr.addData(text, 'Byte'); qr.make(); var n = qr.getModuleCount(), px = Math.max(3, Math.floor(280 / (n + 8))), size = (n + 8) * px;
    cv.width = cv.height = size; var c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, size, size); c.fillStyle = '#000';
    for (var r = 0; r < n; r++) for (var q = 0; q < n; q++) if (qr.isDark(r, q)) c.fillRect((q + 4) * px, (r + 4) * px, px, px);
  }
  reg('qr', '▦', 'QR codes', 'Make a QR and check scanned ones', false, function (b) {
    var tabs = row(), body = h('div'); b.appendChild(tabs); b.appendChild(body);
    var t1 = btn('MAKE', function () { make(); }, 'pri'), t2 = btn('WI-FI QR', function () { wifi(); }), t3 = btn('SCAN MY SCREEN', function () { scan(); });
    tabs.appendChild(t1); tabs.appendChild(t2); if (host.PC) tabs.appendChild(t3);
    function mark(t) { [t1, t2, t3].forEach(function (x) { x.classList.toggle('pri', x === t); }); body.innerHTML = ''; }
    function show(text) { var cv = h('canvas'); cv.style.cssText = 'max-width:100%;background:#fff;display:block;margin:10px auto;image-rendering:pixelated'; try { drawQr(text, cv); body.appendChild(cv); } catch (e) { body.appendChild(out()).textContent = 'That text is too long for a QR code.'; } }
    function make() { mark(t1); var i = h('textarea'); i.placeholder = 'Text or link'; i.style.minHeight = '80px'; body.appendChild(fld('TEXT OR LINK', i)); var holder = h('div'); body.appendChild(btn('MAKE QR', function () { holder.innerHTML = ''; if (!i.value.trim()) return; var save = body; body = holder; show(i.value.trim().slice(0, 1200)); body = save; }, 'pri')); body.appendChild(holder); }
    function wifi() {
      mark(t2); var s = inp('text', 'Wi-Fi name'), p = inp('text', 'Password'), t = sel([['WPA', 'WPA / WPA2 / WPA3'], ['WEP', 'WEP'], ['nopass', 'No password']]); body.appendChild(fld('NETWORK NAME', s)); body.appendChild(fld('PASSWORD', p)); body.appendChild(fld('SECURITY', t));
      var holder = h('div'); body.appendChild(btn('MAKE WI-FI QR', function () { holder.innerHTML = ''; if (!s.value) return; var q = function (x) { return x.replace(/([\;,:"])/g, '\\$1'); }; var save = body; body = holder; show('WIFI:T:' + t.value + ';S:' + q(s.value) + ';P:' + q(p.value) + ';;'); body = save; }, 'pri')); body.appendChild(holder);
      body.appendChild(h('small', '', 'Friends scan it with their camera to join your Wi-Fi. Nothing is stored.'));
    }
    function result(text) {
      var o = out(); body.appendChild(o); var isUrl = /^(https?:\/\/|www\.)/i.test(text), x = isUrl ? urlCheck(text) : null;
      var col = x ? (x.level === 'bad' ? 'var(--bad)' : x.level === 'warn' ? 'var(--am)' : 'var(--ok)') : 'var(--cy2)';
      o.innerHTML = '<b>Contents</b><br>' + esc(text.slice(0, 600)) + '<br><br>' + (x ? '<b style="color:' + col + '">' + esc(urlSummary(x)) + '</b>' : /^WIFI:/i.test(text) ? '<b>This QR joins a Wi-Fi network.</b>' : /^(tel|sms|smsto|mailto|upi|bitcoin):/i.test(text) ? '<b>This QR starts an action (call, message or payment). Check it before you accept.</b>' : '<span style="color:var(--mute)">Plain text, nothing is opened.</span>');
      var r = row(); r.appendChild(copyBtn(function () { return text; })); body.appendChild(r);
    }
    function scan() {
      mark(t3); var o = out(); o.textContent = host.PC ? 'Looking for a QR code on your screen…' : 'Choose a photo or screenshot that shows the QR code.'; body.appendChild(o);
      var p = host.PC ? host.screenQr() : (host.scanImage ? host.scanImage() : Promise.resolve({ ok: false, msg: 'Scanning needs the latest phone app.' }));
      Promise.resolve(p).then(function (r) { o.remove(); if (r && r.ok) result(r.text); else { var e = out(); e.textContent = (r && r.msg) || 'No QR code found.'; body.appendChild(e); } }, function () { o.textContent = 'Could not scan.'; });
    }
    make();
    panel.scanFromHome = scan;
  });

  /* passwords */
  reg('pass', '🔐', 'Passwords', 'Make, test and leak-check', false, function (b) {
    var len = inp('number', '', '16'); len.min = 8; len.max = 64; var o = out(); o.style.fontFamily = 'monospace'; o.style.fontSize = '18px'; o.textContent = '—';
    var opts = { lower: true, upper: true, digit: true, sym: true }, r1 = row();
    [['lower', 'abc'], ['upper', 'ABC'], ['digit', '123'], ['sym', '#$!']].forEach(function (k) { var bt = btn(k[1], function () { opts[k[0]] = !opts[k[0]]; bt.classList.toggle('pri', opts[k[0]]); }, 'pri'); r1.appendChild(bt); });
    b.appendChild(fld('LENGTH (8–64)', len)); b.appendChild(r1);
    var r2 = row(); r2.appendChild(btn('GENERATE', function () { var n = Math.max(8, Math.min(64, parseInt(len.value, 10) || 16)); o.textContent = genPass(n, opts); }, 'pri')); r2.appendChild(copyBtn(function () { return o.textContent; })); b.appendChild(r2); b.appendChild(o);
    b.appendChild(h('div', '', '<br><b style="color:var(--cy2);letter-spacing:.1em">TEST A PASSWORD</b>'));
    var t = inp('text', 'Type a password to test'), so = out(), lo = out(); so.textContent = 'Tested here on your device only.'; lo.style.display = 'none';
    t.addEventListener('input', function () { var s = strength(t.value); so.innerHTML = t.value ? '<b>' + s.label + '</b> · about ' + Math.round(s.bits) + ' bits<br><span style="color:var(--mute)">' + esc(s.tips.join(' ')) + '</span>' : 'Tested here on your device only.'; });
    b.appendChild(fld('PASSWORD', t)); b.appendChild(so);
    var chk = btn('HAS IT LEAKED?', async function () {
      if (!t.value) return; lo.style.display = ''; lo.textContent = 'Checking…';
      try { var hs = sha1(t.value).toUpperCase(), d = await host.net('hibp', hs.slice(0, 5)), m = new RegExp('^' + hs.slice(5) + ':(\\d+)', 'mi').exec(d.text);
        lo.innerHTML = m && +m[1] > 0 ? '<b style="color:var(--bad)">Found in ' + (+m[1]).toLocaleString() + ' known leaks.</b> Do not use it anywhere.' : '<b style="color:var(--ok)">Not found in known leaks.</b> That is good, but still use a different password for every account.';
      } catch (e) { lo.textContent = (e && e.message) || 'Could not check. Try again with internet.'; }
    }); b.appendChild(chk); b.appendChild(lo);
    b.appendChild(h('small', '', 'Only the first 5 letters of a one-way hash are sent (k-anonymity), never your password.'));
  });

  /* calculator */
  reg('calc', '🧮', 'Calculator', 'Maths, percentages, brackets', false, function (b) {
    var i = inp('text', 'e.g. (12+8)*3 or 15% of 240 or sqrt(81)'), o = out(), hist = [];
    o.style.fontSize = '24px'; o.textContent = '0'; i.setAttribute('inputmode', 'text');
    function go() { var v = calcLine(i.value); if (v == null) { o.textContent = 'Not a valid sum'; return; } o.textContent = v; hist.unshift(i.value + ' = ' + v); hl.innerHTML = hist.slice(0, 8).map(function (x) { return '<div>' + esc(x) + '</div>'; }).join(''); }
    i.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    b.appendChild(fld('SUM', i)); var r = row(); r.appendChild(btn('=', go, 'pri')); ['+', '-', '×', '÷', '(', ')', '%', '^'].forEach(function (k) { r.appendChild(btn(k, function () { i.value += k; i.focus(); })); }); r.appendChild(btn('C', function () { i.value = ''; o.textContent = '0'; })); b.appendChild(r); b.appendChild(o);
    var hl = h('div'); hl.style.cssText = 'color:var(--mute);font-size:15px;margin-top:8px'; b.appendChild(hl);
  });
  function calcLine(t) {                       // understands "15% of 240", "20 percent of 50", then plain sums
    var s = String(t).toLowerCase().trim(), m;
    if ((m = /^([\d.]+)\s*(?:%|percent)\s*of\s*([\d.]+)$/.exec(s))) return fmt(+m[1] * +m[2] / 100);
    if ((m = /^([\d.]+)\s*(?:is what percent of|as a percent of|\/)\s*([\d.]+)\s*%?$/.exec(s)) && /percent/.test(s)) return fmt(+m[1] / +m[2] * 100) + '%';
    var v = calc(s.replace(/(\d)\s*x\s*(\d)/g, '$1*$2').replace(/\btimes\b/g, '*').replace(/\bplus\b/g, '+').replace(/\bminus\b/g, '-').replace(/\bdivided by\b/g, '/').replace(/\bover\b/g, '/').replace(/\bto the power of\b/g, '^').replace(/\bsquared\b/g, '^2').replace(/\bcubed\b/g, '^3'));
    return isNaN(v) || !isFinite(v) ? null : fmt(v);
  }

  /* converter */
  var rates = null;
  reg('convert', '⇄', 'Converter', 'Units and currency', false, function (b) {
    var cats = Object.keys(UNITS).concat(['Currency']), cs = sel(cats), v = inp('number', 'Amount', '1'), f = sel([]), t = sel([]), o = out(), st = h('small', '', '');
    v.setAttribute('inputmode', 'decimal'); b.appendChild(fld('TYPE', cs)); b.appendChild(fld('AMOUNT', v)); var rw = row(); rw.style.alignItems = 'flex-end'; var f1 = fld('FROM', f), t1 = fld('TO', t); f1.style.flex = t1.style.flex = '1'; rw.appendChild(f1); rw.appendChild(btn('⇅', function () { var x = f.value; f.value = t.value; t.value = x; calcNow(); })); rw.appendChild(t1); b.appendChild(rw); b.appendChild(o); b.appendChild(st);
    function fill() {
      var list = cs.value === 'Currency' ? ['USD', 'EUR', 'GBP', 'BDT', 'INR', 'PKR', 'SAR', 'AED', 'JPY', 'CNY', 'AUD', 'CAD', 'MYR', 'SGD', 'TRY', 'RUB'] : Object.keys(UNITS[cs.value]);
      [f, t].forEach(function (s) { s.innerHTML = ''; list.forEach(function (u) { var op = h('option', '', esc(u)); op.value = u; s.appendChild(op); }); }); f.selectedIndex = 0; t.selectedIndex = Math.min(1, list.length - 1);
      if (cs.value === 'Currency') { f.value = 'USD'; t.value = 'BDT'; }
      calcNow();
    }
    async function calcNow() {
      var n = parseFloat(v.value); if (isNaN(n)) { o.textContent = '—'; return; }
      if (cs.value === 'Currency') {
        try {
          if (!rates || Date.now() - rates.t > 6 * 3600e3) { st.textContent = 'Getting today’s rates…'; var d = await host.net('rates', ''); var j = JSON.parse(d.text); if (!j.rates) throw 0; rates = { t: Date.now(), r: j.rates, d: j.time_last_update_utc || '' }; }
          var r = n / rates.r[f.value] * rates.r[t.value]; o.innerHTML = '<b>' + fmt(n) + ' ' + f.value + ' = ' + fmt(r, 2) + ' ' + t.value + '</b>'; st.textContent = 'Rates are a guide, not what a bank gives you. ' + String(rates.d).slice(0, 16);
        } catch (e) { o.textContent = 'Could not get rates. Check your internet.'; st.textContent = ''; }
      } else { st.textContent = ''; o.innerHTML = '<b>' + fmt(n) + ' ' + f.value + ' = ' + fmt(convertUnit(n, f.value, t.value)) + ' ' + t.value + '</b>'; }
    }
    cs.addEventListener('change', fill); [v, f, t].forEach(function (x) { x.addEventListener('input', calcNow); x.addEventListener('change', calcNow); }); fill();
  });

  /* morse */
  reg('morse', '•–', 'Morse code', 'Translate and play', false, function (b) {
    var tx = h('textarea'), mo = h('textarea'); tx.placeholder = 'Type text'; mo.placeholder = 'Morse: . - with spaces, / between words'; tx.style.minHeight = mo.style.minHeight = '70px';
    var dot = h('div'); dot.style.cssText = 'height:70px;margin:10px 0;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;color:var(--mute);letter-spacing:.2em;transition:background .05s'; dot.textContent = 'PLAYS HERE';
    var stopFn = null;
    tx.addEventListener('input', function () { mo.value = toMorse(tx.value); }); mo.addEventListener('input', function () { tx.value = fromMorse(mo.value); });
    b.appendChild(fld('TEXT', tx)); b.appendChild(fld('MORSE', mo)); b.appendChild(dot);
    var r = row(); r.appendChild(btn('▶ PLAY SOUND + SCREEN', function () { if (stopFn) stopFn(); var m = mo.value.trim(); if (!m) return; stopFn = beepMorse(m, 15, function (on) { dot.style.background = on ? 'var(--cy)' : 'transparent'; dot.style.color = on ? '#02121a' : 'var(--mute)'; if (host.flash && flashOn.on) host.flash(on); }, function () { stopFn = null; }); }, 'pri'));
    r.appendChild(btn('■ STOP', function () { if (stopFn) stopFn(); })); r.appendChild(copyBtn(function () { return mo.value; })); b.appendChild(r);
    var flashOn = { on: false };
    if (host.flash) { var fb = btn('FLASHLIGHT: OFF', function () { flashOn.on = !flashOn.on; fb.textContent = 'FLASHLIGHT: ' + (flashOn.on ? 'ON' : 'OFF'); fb.classList.toggle('pri', flashOn.on); }); b.appendChild(fb); b.appendChild(h('small', '', 'Switch the flashlight on to blink the Morse with the phone light. For emergencies use Settings › Emergency.')); }
    panel.cleanup = function () { if (stopFn) stopFn(); };
  });

  /* life calculators */
  reg('life', '🧾', 'Daily calculators', 'Tip split, BMI, age, loan, discount', false, function (b) {
    var kinds = [['tip', 'Tip and split'], ['bmi', 'BMI'], ['age', 'Age and dates'], ['loan', 'Loan (EMI)'], ['disc', 'Discount'], ['fuel', 'Fuel cost']], k = sel(kinds), box = h('div'); b.appendChild(fld('CALCULATOR', k)); b.appendChild(box);
    function form(fields, go) {
      box.innerHTML = ''; var ins = fields.map(function (f) { var i = f[2] === 'date' ? inp('date') : inp('number', f[1], f[2] || ''); if (f[2] === 'date') i.value = ''; i.setAttribute('inputmode', 'decimal'); box.appendChild(fld(f[0], i)); return i; }), o = out(); box.appendChild(btn('CALCULATE', function () { var x = go(ins.map(function (i) { return i.type === 'date' ? i.value : parseFloat(i.value); })); o.innerHTML = x; }, 'pri')); box.appendChild(o);
    }
    function draw() {
      var v = k.value;
      if (v === 'tip') form([['BILL', 'Amount'], ['TIP %', '10', '10'], ['PEOPLE', '1', '1']], function (a) { if (!(a[0] >= 0) || !(a[2] >= 1)) return 'Enter the bill and number of people.'; var tip = a[0] * (a[1] || 0) / 100, tot = a[0] + tip; return '<b>Tip</b> ' + fmt(tip, 2) + '<br><b>Total</b> ' + fmt(tot, 2) + '<br><b>Each person pays</b> ' + fmt(tot / a[2], 2); });
      else if (v === 'bmi') form([['WEIGHT (kg)', ''], ['HEIGHT (cm)', '']], function (a) { if (!(a[0] > 0) || !(a[1] > 0)) return 'Enter weight and height.'; var m = a[1] / 100, b2 = a[0] / (m * m), c = b2 < 18.5 ? 'Underweight' : b2 < 25 ? 'Normal' : b2 < 30 ? 'Overweight' : 'Obese'; return '<b>BMI ' + fmt(b2, 1) + '</b> · ' + c + '<br><span style="color:var(--mute)">A rough guide only. A doctor can say what is right for you.</span>'; });
      else if (v === 'age') form([['DATE OF BIRTH / START DATE', '', 'date'], ['END DATE (empty = today)', '', 'date']], function (a) { if (!a[0]) return 'Pick a date.'; var s = new Date(a[0]), e = a[1] ? new Date(a[1]) : new Date(); if (isNaN(s) || isNaN(e)) return 'Pick a date.'; if (s > e) { var t = s; s = e; e = t; } var y = e.getFullYear() - s.getFullYear(), m = e.getMonth() - s.getMonth(), d = e.getDate() - s.getDate(); if (d < 0) { m--; d += new Date(e.getFullYear(), e.getMonth(), 0).getDate(); } if (m < 0) { y--; m += 12; } var days = Math.round((e - s) / 864e5); return '<b>' + y + ' years, ' + m + ' months, ' + d + ' days</b><br>' + days.toLocaleString() + ' days in total · ' + Math.floor(days / 7).toLocaleString() + ' weeks'; });
      else if (v === 'loan') form([['LOAN AMOUNT', ''], ['YEARLY INTEREST %', ''], ['YEARS', '']], function (a) { if (!(a[0] > 0) || !(a[1] >= 0) || !(a[2] > 0)) return 'Fill all three.'; var n = a[2] * 12, r = a[1] / 1200, emi = r ? a[0] * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : a[0] / n; return '<b>Monthly payment ' + fmt(emi, 2) + '</b><br>Total paid ' + fmt(emi * n, 2) + '<br>Interest ' + fmt(emi * n - a[0], 2); });
      else if (v === 'disc') form([['PRICE', ''], ['DISCOUNT %', '']], function (a) { if (!(a[0] >= 0) || !(a[1] >= 0)) return 'Enter price and discount.'; var s = a[0] * a[1] / 100; return '<b>You pay ' + fmt(a[0] - s, 2) + '</b><br>You save ' + fmt(s, 2); });
      else form([['DISTANCE (km)', ''], ['KM PER LITRE', ''], ['PRICE PER LITRE', '']], function (a) { if (!(a[0] > 0) || !(a[1] > 0) || !(a[2] >= 0)) return 'Fill all three.'; var l = a[0] / a[1]; return '<b>' + fmt(l, 2) + ' litres</b><br>Cost ' + fmt(l * a[2], 2); });
    }
    k.addEventListener('change', draw); draw();
  });

  /* clocks */
  var ZONES = [['Dhaka', 'Asia/Dhaka'], ['Delhi', 'Asia/Kolkata'], ['Karachi', 'Asia/Karachi'], ['Dubai', 'Asia/Dubai'], ['Riyadh', 'Asia/Riyadh'], ['Istanbul', 'Europe/Istanbul'], ['London', 'Europe/London'], ['Paris', 'Europe/Paris'], ['Moscow', 'Europe/Moscow'], ['New York', 'America/New_York'], ['Chicago', 'America/Chicago'], ['Los Angeles', 'America/Los_Angeles'], ['Toronto', 'America/Toronto'], ['Singapore', 'Asia/Singapore'], ['Kuala Lumpur', 'Asia/Kuala_Lumpur'], ['Tokyo', 'Asia/Tokyo'], ['Sydney', 'Australia/Sydney']];
  function zoneTime(z, d) { try { return new Intl.DateTimeFormat([], { timeZone: z, hour: '2-digit', minute: '2-digit', hour12: false }).format(d); } catch (e) { return '—'; } }
  function zoneOffsetMin(z, d) { try { var p = new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(d), o = {}; p.forEach(function (x) { o[x.type] = +x.value; }); return (Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute, o.second) - d.getTime()) / 60000; } catch (e) { return 0; } }
  reg('clocks', '🕒', 'World clock', 'Time in other cities', false, function (b) {
    var list = h('div'); b.appendChild(list);
    function draw() { var now = new Date(), me = -now.getTimezoneOffset(); list.innerHTML = ''; ZONES.forEach(function (z) { var df = Math.round((zoneOffsetMin(z[1], now) - me) / 60 * 10) / 10, c = h('div', 'card'); c.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:10px 14px'; c.innerHTML = '<div><b>' + esc(z[0]) + '</b><br><small style="color:var(--mute)">' + (df === 0 ? 'Same as you' : (df > 0 ? '+' : '') + df + ' h from you') + '</small></div><div style="font-family:Orbitron,sans-serif;font-size:22px;color:var(--cy2)">' + zoneTime(z[1], now) + '</div>'; list.appendChild(c); }); }
    draw(); tick = setInterval(draw, 20000);
  });

  /* timer + stopwatch */
  reg('timer', '⏱', 'Stopwatch and timer', 'Laps and countdown', false, function (b) {
    var disp = h('div'); disp.style.cssText = 'text-align:center;font-family:Orbitron,sans-serif;font-size:42px;color:var(--cy2);margin:14px 0'; disp.textContent = '00:00.0'; b.appendChild(disp);
    var mode = 'sw', t0 = 0, acc = 0, run = false, laps = [], total = 0, lapsEl = h('div'); lapsEl.style.cssText = 'color:var(--mute);font-size:15px;margin-top:8px';
    function ms(x) { var m = Math.floor(x / 60000), s = Math.floor(x / 1000) % 60, t = Math.floor(x / 100) % 10; return ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2) + '.' + t; }
    var minIn = inp('number', 'Minutes', '5'); minIn.setAttribute('inputmode', 'decimal');
    var rows = row(), go = btn('START', toggle, 'pri'), lap = btn('LAP', function () { if (mode === 'sw' && run) { laps.unshift(ms(acc + Date.now() - t0)); lapsEl.innerHTML = laps.slice(0, 10).map(function (x, i) { return '<div>Lap ' + (laps.length - i) + ': ' + x + '</div>'; }).join(''); } }), rst = btn('RESET', reset), md = btn('SWITCH TO COUNTDOWN', function () { mode = mode === 'sw' ? 'cd' : 'sw'; md.textContent = mode === 'sw' ? 'SWITCH TO COUNTDOWN' : 'SWITCH TO STOPWATCH'; minIn.parentNode.style.display = mode === 'cd' ? '' : 'none'; lap.style.display = mode === 'sw' ? '' : 'none'; reset(); });
    var minF = fld('COUNTDOWN MINUTES', minIn); minF.style.display = 'none'; b.appendChild(minF); [go, lap, rst, md].forEach(function (x) { rows.appendChild(x); }); b.appendChild(rows); b.appendChild(lapsEl);
    function show() { var e = acc + (run ? Date.now() - t0 : 0); if (mode === 'cd') { var left = Math.max(0, total - e); disp.textContent = ms(left); if (left <= 0 && run) { fin(); } } else disp.textContent = ms(e); }
    function fin() { run = false; go.textContent = 'START'; clearInterval(tick); tick = null; host.toast('Time is up!', 4000); try { var m = beepMorse('... ...', 20, function () { }, function () { }); } catch (e) { /* */ } if (navigator.vibrate) navigator.vibrate([300, 150, 300]); }
    function toggle() { if (!run) { if (mode === 'cd' && !acc) { total = Math.max(1, parseFloat(minIn.value) || 1) * 60000; } t0 = Date.now(); run = true; go.textContent = 'PAUSE'; tick = setInterval(show, 100); } else { acc += Date.now() - t0; run = false; go.textContent = 'RESUME'; clearInterval(tick); tick = null; show(); } }
    function reset() { run = false; acc = 0; laps = []; lapsEl.innerHTML = ''; go.textContent = 'START'; clearInterval(tick); tick = null; disp.textContent = mode === 'cd' ? ms((parseFloat(minIn.value) || 5) * 60000) : '00:00.0'; }
  });

  /* random */
  reg('random', '🎲', 'Coin, dice, picker', 'Flip, roll or choose', false, function (b) {
    var o = out(); o.style.cssText += ';font-size:30px;text-align:center;font-family:Orbitron,sans-serif;color:var(--cy2)'; o.textContent = '?'; b.appendChild(o);
    var r = row(); r.appendChild(btn('FLIP A COIN', function () { o.textContent = rnd(2) ? 'HEADS' : 'TAILS'; }, 'pri')); [6, 20].forEach(function (n) { r.appendChild(btn('ROLL D' + n, function () { o.textContent = String(1 + rnd(n)); })); }); b.appendChild(r);
    var lo = inp('number', 'From', '1'), hi = inp('number', 'To', '100'); var rr = row(); lo.style.width = hi.style.width = '100px'; rr.appendChild(lo); rr.appendChild(hi); rr.appendChild(btn('RANDOM NUMBER', function () { var a = parseInt(lo.value, 10), z = parseInt(hi.value, 10); if (isNaN(a) || isNaN(z)) return; if (a > z) { var t = a; a = z; z = t; } o.textContent = String(a + rnd(z - a + 1)); })); b.appendChild(rr);
    var ta = h('textarea'); ta.placeholder = 'One option per line'; ta.style.minHeight = '90px'; b.appendChild(fld('PICK ONE FROM A LIST', ta)); var r3 = row(); r3.appendChild(btn('PICK ONE', function () { var l = ta.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); if (l.length) o.textContent = l[rnd(l.length)]; })); r3.appendChild(btn('SHUFFLE', function () { var l = ta.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); for (var i = l.length - 1; i > 0; i--) { var j = rnd(i + 1), t = l[i]; l[i] = l[j]; l[j] = t; } o.style.fontSize = '18px'; o.textContent = l.map(function (x, i) { return (i + 1) + '. ' + x; }).join('\n'); })); b.appendChild(r3);
  });

  /* text tools */
  reg('text', 'Aa', 'Text tools', 'Count, convert, hash', false, function (b) {
    var ta = h('textarea'); ta.style.minHeight = '120px'; ta.placeholder = 'Paste or type text'; var o = out(); o.textContent = '—'; b.appendChild(fld('TEXT', ta));
    var r = row();
    function put(s) { o.textContent = s; }
    [['COUNT', function () { var t = ta.value, w = t.trim() ? t.trim().split(/\s+/).length : 0; put(w + ' words · ' + t.length + ' characters · ' + (t.trim() ? t.split(/[.!?]+\s/).filter(Boolean).length : 0) + ' sentences · about ' + Math.max(1, Math.round(w / 200)) + ' min to read'); }],
      ['UPPER', function () { put(ta.value.toUpperCase()); }], ['lower', function () { put(ta.value.toLowerCase()); }], ['Title', function () { put(ta.value.toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); })); }],
      ['REVERSE', function () { put(Array.from(ta.value).reverse().join('')); }], ['SORT LINES', function () { put(ta.value.split('\n').sort(function (a, c) { return a.localeCompare(c); }).join('\n')); }],
      ['UNIQUE LINES', function () { var s = {}; put(ta.value.split('\n').filter(function (x) { if (s[x]) return false; s[x] = 1; return true; }).join('\n')); }], ['CLEAN SPACES', function () { put(ta.value.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()); }],
      ['BASE64 ENCODE', function () { try { put(btoa(utf8(ta.value))); } catch (e) { put('Could not encode.'); } }], ['BASE64 DECODE', function () { try { put(decodeURIComponent(escape(atob(ta.value.trim())))); } catch (e) { put('That is not valid Base64.'); } }],
      ['SHA-256', function () { put(sha256(ta.value)); }]].forEach(function (x) { r.appendChild(btn(x[0], x[1])); });
    b.appendChild(r); b.appendChild(o); var r2 = row(); r2.appendChild(copyBtn(function () { return o.textContent; })); r2.appendChild(btn('USE RESULT AS TEXT', function () { ta.value = o.textContent; })); b.appendChild(r2);
  });

  /* PC only */
  function pcBtn(label, type, arg, note, confirmMsg, o) {
    return btn(label, async function () {
      if (confirmMsg && !window.confirm(confirmMsg)) return; o.textContent = 'Working…';
      try { var r = await host.act(type, arg || '', ''); o.textContent = (r && r.msg) || (r && r.ok ? 'Done.' : 'That did not work.'); } catch (e) { o.textContent = 'That did not work.'; }
    });
  }
  reg('pc', '🖥', 'PC tools', 'Health, clean-up, power', true, function (b) {
    var o = out(); o.textContent = 'Pick a tool.'; var g = h('div'); g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px';
    [['SYSTEM HEALTH', 'pcinfo', 'status'], ['BIGGEST PROGRAMS', 'procs'], ['NETWORK INFO', 'netinfo'], ['STARTUP APPS', 'startups'], ['TASK MANAGER', 'taskmgr'], ['LOCK PC', 'lock'],
      ['TIDY DOWNLOADS (PREVIEW)', 'tidydl', 'preview'], ['TIDY DOWNLOADS NOW', 'tidydl', 'run', 'Move loose files from your Downloads folder into tidy sub-folders (Images, Documents, Videos…)? Nothing is deleted.'],
      ['CLEAN TEMP FILES', 'cleantemp', '', 'Delete temporary files that Windows no longer needs?'], ['EMPTY RECYCLE BIN', 'emptybin', '', 'Empty the Recycle Bin? This cannot be undone.']].forEach(function (x) { var bt = pcBtn(x[0], x[1], x[2], null, x[3], o); g.appendChild(bt); });
    var tx = btn('COPY TEXT FROM MY SCREEN', async function () { o.textContent = 'Reading the screen…'; try { var r = await host.screenText(); o.textContent = r && r.ok && r.text ? 'Copied ' + r.text.length + ' characters from the screen:\n\n' + r.text.slice(0, 600) : (r && r.msg) || 'I found no readable text.'; if (r && r.ok && r.text) host.copy(r.text); } catch (e) { o.textContent = 'Could not read the screen.'; } }); g.appendChild(tx);
    b.appendChild(g); b.appendChild(o);
  });

  /* ------------------------------------------------ home */
  function home() {
    stopTick(); current = null; var b = panel.body; b.innerHTML = '';
    b.appendChild(h('div', '', '<small style="color:var(--mute)">Small helpers that run on this ' + (host.PC ? 'PC' : 'phone') + '. None of them use your AI keys or tokens.</small>'));
    var g = h('div'); g.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px';
    TOOLS.forEach(function (t) {
      if (t.pcOnly && !host.PC) return; var c = h('button', 'card'); c.style.cssText = 'text-align:left;padding:14px;min-height:92px;display:flex;flex-direction:column;gap:4px;margin:0'; c.innerHTML = '<span style="font-size:24px;color:var(--cy2)">' + t.icon + '</span><b>' + esc(t.name) + '</b><small style="color:var(--mute)">' + esc(t.desc) + '</small>';
      c.addEventListener('click', function () { view(t.name, t.build); }); g.appendChild(c);
    });
    b.appendChild(g);
  }

  /* ------------------------------------------------ voice / typed commands (no tokens) */
  function intent(text) {
    var t = String(text || '').toLowerCase().trim().replace(/[?!.]+$/, ''), m;
    if (/^(?:open |show |what are )?(?:the |my )?(?:tools|toolbox|utilities)$/.test(t)) return { text: 'Opening your tools.', run: function () { api.open(); } };
    if (/^(?:run |do |start |check )?(?:a |an |my |the )?(?:internet |network |wi-?fi |connection )?speed(?: ?test| check)?$|^(?:how fast is|test) (?:my )?(?:internet|network|wi-?fi|connection)(?: speed)?$/.test(t)) return { text: 'Starting the speed test.', run: function () { api.open('speed', true); } };
    if (/^(?:flip|toss)(?: a)? coin$/.test(t)) return { text: rnd(2) ? 'Heads.' : 'Tails.' };
    if ((m = /^(?:roll|throw)(?: a| an)?(?: d| dice ?d?)?\s*(\d+)?(?: sided)? ?(?:dice|die)?$/.exec(t)) && /(roll|throw)/.test(t) && /(dice|die|d\d)/.test(t)) { var n = Math.max(2, Math.min(1000, +m[1] || 6)); return { text: 'You rolled a ' + (1 + rnd(n)) + '.' }; }
    if ((m = /^(?:random number|pick a number|give me a number) (?:between|from) (-?\d+) (?:and|to) (-?\d+)$/.exec(t))) { var a = +m[1], z = +m[2]; if (a > z) { var tt = a; a = z; z = tt; } return { text: 'Your number is ' + (a + rnd(z - a + 1)) + '.' }; }
    if ((m = /^(?:convert|how many|what is|what's)\s+(-?[\d.]+)\s*([a-z°²/ ]+?)\s+(?:to|in|into|is how many)\s+([a-z°²/ ]+)$/.exec(t))) { var fu = normUnit(m[2].trim()), tu = normUnit(m[3].trim()); if (fu && tu && unitCat(fu) === unitCat(tu)) return { text: fmt(+m[1]) + ' ' + fu + ' is ' + fmt(convertUnit(+m[1], fu, tu)) + ' ' + tu + '.' }; }
    if ((m = /^(?:calculate|calc|compute|what is|what's|how much is)\s+(.+)$/.exec(t)) && /[\d]/.test(m[1]) && /[-+*/^x%×÷]|times|plus|minus|divided|percent|sqrt|squared|cubed|over/.test(m[1])) { var v = calcLine(m[1]); if (v != null) return { text: m[1].replace(/\s+/g, ' ') + ' = ' + v + '.' }; }
    if ((m = /^(?:is |check |scan )(?:this |the )?(?:link |url |website )?(\S+\.\S+)(?: (?:safe|a scam|legit|ok))?$/.exec(t)) && /(safe|scam|legit|check|scan|ok)/.test(t)) { var x = urlCheck(m[1]); return { text: urlSummary(x) }; }
    if ((m = /^(?:morse(?: code)?(?: for| of)?|translate (.+) to morse)\s*(.*)$/.exec(t)) && (m[1] || m[2])) { var s = m[1] || m[2]; return { text: toMorse(s) ? 'In Morse, ' + s + ' is: ' + toMorse(s).replace(/\./g, 'dot ').replace(/-/g, 'dash ').replace(/\s+/g, ' ').trim() + '.' : 'I could not turn that into Morse.', show: toMorse(s) }; }
    if (/^(?:qr code|make a qr|scan (?:a |the )?qr(?: code)?)$/.test(t)) return { text: 'Opening the QR tool.', run: function () { api.open('qr'); } };
    if (/^(?:password (?:strength|check)|(?:is )?my password (?:safe|leaked)|has my password leaked)$/.test(t)) return { text: 'Opening the password tool. Type it there, not here, so it stays out of the chat.', run: function () { api.open('pass'); } };
    if (/^(?:stopwatch|start (?:a )?stopwatch)$/.test(t)) return { text: 'Opening the stopwatch.', run: function () { api.open('timer'); } };
    if (/^(?:world clock|time zones?|what time is it (?:around|across) the world)$/.test(t)) return { text: 'Opening the world clock.', run: function () { api.open('clocks'); } };
    if ((m = /^(?:what(?:'s| is)(?: the)? time in|time in) ([a-z ]+)$/.exec(t))) { var city = m[1].trim(), z2 = ZONES.filter(function (q) { return q[0].toLowerCase() === city; })[0]; if (z2) return { text: 'It is ' + zoneTime(z2[1], new Date()) + ' in ' + z2[0] + '.' }; }
    if ((m = /^(?:currency|convert) ?(?:rates?)?$/.exec(t))) return { text: 'Opening the converter.', run: function () { api.open('convert'); } };
    return null;
  }

  var api = {
    init: function (h0) {
      host = h0; panel = host.makePanel('tools', 'TOOLS'); panel.root.addEventListener('transitionend', function () { if (!panel.isOpen) { stopTick(); } });
      var close = panel.close; panel.close = function () { stopTick(); close(); };
      return api;
    },
    open: function (id, autostart) {
      if (!panel) return; panel.open(); var t = TOOLS.filter(function (x) { return x.id === id && (!x.pcOnly || host.PC); })[0];
      if (t) { view(t.name, t.build); if (autostart) { var go = panel.body.querySelector('.btn.pri'); if (go) setTimeout(function () { go.click(); }, 350); } } else home();
    },
    intent: intent,
    calc: calcLine, urlCheck: urlCheck, urlSummary: urlSummary, toMorse: toMorse, fromMorse: fromMorse, strength: strength, sha1: sha1, sha256: sha256, convertUnit: convertUnit, normUnit: normUnit, genPass: genPass, beepMorse: beepMorse
  };
  window.JarvisTools = api;
})();
