/* J.A.R.V.I.S — desktop bridge.
 * Inside the Windows app (Electron) this builds window.AndroidBridge from window.jarvisPC (see pc/src/main/preload.js),
 * so the very same UI runs on the phone and on the PC. On Android window.jarvisPC does not exist and this file does nothing. */
(function () {
  'use strict';
  var P = window.jarvisPC;
  if (!P) return;
  window.JARVIS_PLATFORM = 'pc';

  var queue = [];
  function emit(ev, d) {
    if (window.JarvisNative && window.JarvisNative.emit) window.JarvisNative.emit(ev, d || {});
    else queue.push([ev, d]);
  }
  window.addEventListener('load', function () { setTimeout(function () { while (queue.length) { var q = queue.shift(); emit(q[0], q[1]); } }, 0); });
  P.onNative(function (ev, d) { emit(ev, d); });

  /* ---------------------------------------------------------------- battery (the page is the only place that can see it) */
  var batt = null;
  try {
    navigator.getBattery().then(function (b) {
      function upd() { batt = { pct: Math.round(b.level * 100), charging: !!b.charging }; try { P.reportBattery(batt); } catch (e) { /* */ } }
      b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd); upd();
    }).catch(function () { /* no battery API */ });
  } catch (e) { /* ignore */ }

  /* ---------------------------------------------------------------- speech out */
  var synth = window.speechSynthesis, speakGen = 0;
  function voiceList() { try { return synth ? synth.getVoices() : []; } catch (e) { return []; } }
  if (synth && synth.addEventListener) synth.addEventListener('voiceschanged', function () { /* list refreshes on next call */ });
  function pickVoice(lang, mode) {
    var vs = voiceList(), l = String(lang || 'en-GB'), base = l.split('-')[0].toLowerCase(), best = null, score = -1;
    vs.forEach(function (v) {
      var vl = String(v.lang || '').replace('_', '-'), s = 0;
      if (vl.toLowerCase() === l.toLowerCase()) s += 6; else if (vl.toLowerCase().indexOf(base) === 0) s += 3; else return;
      if (mode !== 'phone') {
        if (/george|ryan|daniel|thomas|oliver|arthur|male/i.test(v.name)) s += 4;
        if (/natural|online/i.test(v.name)) s += 2;
      } else if (v.default) s += 4;
      if (s > score) { score = s; best = v; }
    });
    return best;
  }
  function chunks(text) {
    var out = [], parts = String(text).match(/[^.!?\n।]+[.!?\n।]*/g) || [String(text)], cur = '';
    parts.forEach(function (p) { if ((cur + p).length > 220 && cur) { out.push(cur); cur = p; } else cur += p; });
    if (cur.trim()) out.push(cur);
    return out;
  }
  /* Speech out, a sentence at a time: a short breath between sentences and a tiny, repeatable change of pace and pitch, so it flows like a person. The voice itself is never changed. */
  function sentenceParts(text) {
    var raw = String(text || '').replace(/\s+/g, ' ').trim(), out = [], re = /[^.!?]+(?:[.!?]+["')\]]?|$)\s*/g, m;
    while ((m = re.exec(raw)) !== null) {
      var s = m[0].trim(); if (!s) continue;
      while (s.length > 230) { var cut = Math.max(s.lastIndexOf(', ', 200), s.lastIndexOf('; ', 200)); if (cut < 60) cut = s.lastIndexOf(' ', 200); if (cut < 40) cut = 200; out.push({ t: s.slice(0, cut + 1).trim(), gap: 90 }); s = s.slice(cut + 1).trim(); }
      if (s) out.push({ t: s, gap: /[?:]$/.test(s) ? 300 : 170 });
    }
    return out.length ? out : [{ t: raw, gap: 0 }];
  }
  function hashStr(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function speakNow(text, lang, rate, pitch, mode) {
    if (!synth) { emit('ttsDone'); return; }
    var gen = ++speakGen; synth.cancel();
    var list = sentenceParts(text), i = 0, started = false, v = pickVoice(lang, mode), br = rate || 1, bp = pitch || 1;
    (function next() {
      if (gen !== speakGen) return;
      if (i >= list.length) { emit('ttsDone'); return; }
      var part = list[i++], last = i >= list.length, h = hashStr(part.t);
      var u = new SpeechSynthesisUtterance(part.t);
      var r = br * (1 + ((h >> 3) % 5 - 2) * 0.01), p = bp * (1 + (h % 7 - 3) * 0.008);
      if (/\?$/.test(part.t)) { p *= 1.05; r *= 0.98; } else if (/!$/.test(part.t)) { p *= 1.03; r *= 1.03; }
      if (last) { r *= 0.97; p *= 0.98; }
      u.lang = lang || 'en-GB'; if (v) u.voice = v;
      u.rate = Math.max(0.5, Math.min(2, r)); u.pitch = Math.max(0.5, Math.min(2, p));
      u.onstart = function () { if (!started) { started = true; emit('ttsStart'); } };
      var go = function () { if (gen !== speakGen) return; if (last) next(); else setTimeout(next, part.gap); };
      u.onend = go; u.onerror = function () { if (gen === speakGen) go(); };
      synth.speak(u);
    })();
  }

  /* ---------------------------------------------------------------- speech in: record, detect the end of the sentence, transcribe in the background */
  var rec = null;
  function stopRec(silent) {
    if (!rec) return; var r = rec; rec = null; r.dead = true;
    try { r.node.disconnect(); r.src.disconnect(); } catch (e) { /* */ }
    try { r.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* */ }
    try { r.ctx.close(); } catch (e) { /* */ }
  }
  function wavBytes(chunksArr, rate) {
    var n = 0; chunksArr.forEach(function (c) { n += c.length; });
    var buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    function w(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    var o = 44;
    chunksArr.forEach(function (c) { for (var i = 0; i < c.length; i++) { var x = Math.max(-1, Math.min(1, c[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; } });
    return buf;
  }
  function listen(lang) {
    stopRec();
    var AC = window.AudioContext || window.webkitAudioContext;
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var ctx = new AC(), src = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(4096, 1, 1);
      var r = rec = { stream: stream, ctx: ctx, src: src, node: node, dead: false };
      var rate = ctx.sampleRate, pre = [], got = [], speaking = false, floor = 0.004, quietSince = 0, t0 = Date.now(), tSpeech = 0, announced = false;
      var preMax = Math.ceil(0.4 * rate / 4096) + 1;
      node.onaudioprocess = function (e) {
        if (r.dead) return;
        var d = e.inputBuffer.getChannelData(0), copy = new Float32Array(d), sum = 0, i;
        for (i = 0; i < d.length; i++) sum += d[i] * d[i];
        var rms = Math.sqrt(sum / d.length), now = Date.now();
        emit('level', { v: Math.min(1, rms * 9) });
        if (!speaking) floor = floor * 0.95 + Math.min(rms, 0.03) * 0.05;
        var thr = Math.max(0.012, floor * 3.2);
        if (!speaking) {
          pre.push(copy); if (pre.length > preMax) pre.shift();
          if (rms > thr) { speaking = true; tSpeech = now; got = pre.slice(); pre = []; emit('listenSpeech'); }
          else if (now - t0 > 7000) { stopRec(); emit('listenError', { code: 7 }); }
          return;
        }
        got.push(copy);
        if (rms > thr) quietSince = 0; else if (!quietSince) quietSince = now;
        if ((quietSince && now - quietSince > 1000) || now - tSpeech > 20000) finish();
      };
      function finish() {
        if (r.dead) return;
        var chunksArr = got; stopRec();
        var total = 0; chunksArr.forEach(function (c) { total += c.length; });
        if (total < rate * 0.35) { emit('listenError', { code: 7 }); return; }
        // downsample to 16 kHz for a smaller upload
        var flat = new Float32Array(total), o = 0; chunksArr.forEach(function (c) { flat.set(c, o); o += c.length; });
        var ratio = rate / 16000, outLen = Math.floor(flat.length / ratio), out = new Float32Array(outLen);
        for (var i = 0; i < outLen; i++) out[i] = flat[Math.floor(i * ratio)];
        P.stt(wavBytes([out], 16000), lang || 'en-GB').then(function (res) {
          if (res && res.ok) { if (res.text) emit('result', { text: res.text }); else emit('listenError', { code: 7 }); }
          else if (res && res.code === 'nokey') emit('listenError', { code: 'nokey', msg: res.error });
          else emit('listenError', { code: 'sttfail', msg: (res && res.error) || 'Speech recognition failed.' });
        }, function () { emit('listenError', { code: 'sttfail', msg: 'Speech recognition failed.' }); });
      }
      src.connect(node); node.connect(ctx.destination);
      emit('listenReady');
    }, function (err) {
      emit('listenError', { code: err && err.name === 'NotFoundError' ? 3 : 9 });
    });
  }

  /* ---------------------------------------------------------------- "Jarvis" wake word (opt-in).
     Nothing leaves the PC until a short, loud burst of speech (0.3-3.5 s) is heard. Only that burst is sent to the speech key you already added,
     at most 10 times a minute. If the text contains "Jarvis" Jarvis wakes up; otherwise the text is thrown away. */
  var WAKE_RE = /\b(?:jarvis+|jarvus|jarvas|jarves|jervis|gervis|garvis|harvis|jarvice|jar vis|javis|jarwis|jarbis|yarvis|charvis|darvis|tarvis|jarvish|jarviz|jarvi|jarvik)\b[\s,.:;!?-]*/i;
  var sensF = 0.75;                                                   // detection strength: smaller = hears fainter / farther sounds (set from Settings)
  var wk = null, wakePaused = false, wakeCalls = [], wakeLang = 'en-GB', wakeOn = false, clapOn = false;
  function wakeStop() {
    if (!wk) return; var r = wk; wk = null; r.dead = true;
    try { r.node.disconnect(); r.src.disconnect(); } catch (e) { /* */ }
    try { r.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* */ }
    try { r.ctx.close(); } catch (e) { /* */ }
  }
  function wakeRefresh() { if (wakeOn || clapOn) wakeStart(); else wakeStop(); }
  function wakeStart() {
    if (wk) return; wk = { dead: false, starting: true };
    var AC = window.AudioContext || window.webkitAudioContext;
    navigator.mediaDevices.getUserMedia({ audio: clapOn ? { channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true } : { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }) /* clap detection needs the raw sound: the noise filter would smooth a clap away */.then(function (stream) {
      if (!wk || wk.dead) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      var ctx = new AC(), src = ctx.createMediaStreamSource(stream), node = ctx.createScriptProcessor(4096, 1, 1);
      var r = wk = { stream: stream, ctx: ctx, src: src, node: node, dead: false };
      var clapPrev = 0, clapLast = 0, clapCool = 0, quietBetween = false, clapPrevB = 0;
      var rate = ctx.sampleRate, floor = 0.004, pre = [], got = [], speaking = false, t0 = 0, quietSince = 0, voiced = 0, frames = 0, busy = false;
      node.onaudioprocess = function (e) {
        if (r.dead) return;
        var d = e.inputBuffer.getChannelData(0), sum = 0, i, now = Date.now();
        if (wakePaused || busy || rec) { speaking = false; got = []; pre = []; return; }
        var pk = 0, v0;
        for (i = 0; i < d.length; i++) { v0 = d[i]; sum += v0 * v0; if (v0 > pk) pk = v0; else if (-v0 > pk) pk = -v0; }
        var rms = Math.sqrt(sum / d.length), thr = Math.max(0.02 * sensF, floor * 4 * sensF + 0.002);
        if (clapOn) {                                   // two sharp, short sounds 0.15-1.0 s apart, with quiet in between; nothing is recorded or sent anywhere
          // looks at 512-sample slices (about 10 ms) so a clap is not smoothed away by the big audio buffer, and compares each slice with the room noise
          // measured a moment ago, so it works for quiet claps, far claps and noisy rooms alike
          var BL = 512, bj, bi, bs, brms, bpk, bv, hit = false, quietNow = true;
          for (bj = 0; bj + BL <= d.length; bj += BL) {
            bs = 0; bpk = 0;
            for (bi = bj; bi < bj + BL; bi++) { bv = d[bi]; bs += bv * bv; if (bv > bpk) bpk = bv; else if (-bv > bpk) bpk = -bv; }
            brms = Math.sqrt(bs / BL);
            var base = Math.max(0.004, floor), jump = brms > Math.max(0.025 * sensF, base * 7 * sensF) && brms > clapPrevB * 3.2 && bpk / (brms || 1) >= 2.0;
            if (jump) hit = true;
            if (brms > Math.max(0.03 * sensF, base * 5 * sensF)) quietNow = false;
            clapPrevB = clapPrevB * 0.6 + brms * 0.4;
          }
          if (hit && now - clapLast > 150 && now > clapCool) {
            if (clapPrev && now - clapPrev <= 1000 && quietBetween) { clapPrev = 0; clapCool = now + 3000; emit('clapHeard', {}); }
            else { clapPrev = now; quietBetween = false; }
            clapLast = now;
          } else if (!hit && clapPrev && quietNow && now - clapLast > 60) quietBetween = true;
          if (clapPrev && now - clapPrev > 1000) clapPrev = 0;
          if (hit) { return; }                          // a clap must not raise the measured room noise
        }
        if (!wakeOn) { floor = floor * 0.97 + Math.min(rms, 0.03) * 0.03; return; }
        if (!speaking) floor = floor * 0.97 + Math.min(rms, 0.03) * 0.03;
        var copy = new Float32Array(d);
        if (!speaking) {
          pre.push(copy); if (pre.length > 4) pre.shift();
          if (rms > thr) { speaking = true; t0 = now; got = pre.slice(); pre = []; quietSince = 0; voiced = 1; frames = 1; }
          return;
        }
        got.push(copy); frames++; if (rms > thr) { voiced++; quietSince = 0; } else if (!quietSince) quietSince = now;
        var len = now - t0;
        if (len > 3600) { speaking = false; got = []; return; }                 // a long sentence is not a wake word: drop it, send nothing
        if (quietSince && now - quietSince > 500) {
          var chunks = got; speaking = false; got = [];
          if (len < 350 || voiced / frames < 0.3) return;                      // a click or a cough
          send(chunks);
        }
      };
      function send(chunks) {
        var t = Date.now(); wakeCalls = wakeCalls.filter(function (x) { return t - x < 60000; });
        if (wakeCalls.length >= 10) return;                                    // protects your key and your internet
        if (navigator.onLine === false) return;
        wakeCalls.push(t); busy = true;
        var total = 0; chunks.forEach(function (c) { total += c.length; });
        var flat = new Float32Array(total), o = 0; chunks.forEach(function (c) { flat.set(c, o); o += c.length; });
        var ratio = rate / 16000, outLen = Math.floor(flat.length / ratio), out = new Float32Array(outLen);
        for (var i = 0; i < outLen; i++) out[i] = flat[Math.floor(i * ratio)];
        P.stt(wavBytes([out], 16000), 'en-GB').then(function (res) {
          busy = false;
          if (res && res.ok && res.text) {
            var m = WAKE_RE.exec(res.text);
            if (m && m.index < 14) emit('wakeHeard', { rest: res.text.slice(m.index + m[0].length).replace(/^[\s,.:;!?-]+|[\s]+$/g, '') });
          } else if (res && res.code === 'nokey') { emit('wakeError', { msg: res.error }); wakeStop(); }
        }, function () { busy = false; });
      }
      src.connect(node); node.connect(ctx.destination);
    }, function () { wk = null; emit('wakeError', { msg: 'I could not open the microphone for the wake word.' }); });
  }

  /* ---------------------------------------------------------------- the bridge */
  function J(o) { return JSON.stringify(o); }
  var B = {
    ready: function () { return true; },
    getPref: function (k) { return P.getPref(k); },
    setPref: function (k, v) { P.setPref(k, v); },
    wipeAll: function () { P.wipe(); },
    action: function (t, a, b) { return P.action(t, a, b); },
    // async twin used by the PC window so a slow command (first drive scan, PowerShell) never freezes the app
    actionAsync: function (t, a, b) { if (P.actionAsync) return P.actionAsync(t, a, b); try { return Promise.resolve(JSON.parse(P.action(t, a, b))); } catch (e) { return Promise.resolve({ ok: false, msg: 'That action failed.' }); } },
    appInfo: function () { return P.appInfo(); },
    permissions: function () { return J({ mic: true, call: true, contacts: true, access: true, accessStalled: false, ball: (function () { try { return !!(P.ballGet && P.ballGet()); } catch (e) { return false; } })(), accessWas: true, battery: true, overlay: true }); },
    requestPermissions: function () {
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { s.getTracks().forEach(function (t) { t.stop(); }); emit('permissions'); }, function () { emit('permissions'); });
    },
    // speech
    speak: function (text, lang, rate, pitch) { speakNow(text, lang, rate, pitch, 'jarvis'); },
    speakEx: function (text, opts) { var o = {}; try { o = JSON.parse(opts); } catch (e) { /* */ } speakNow(text, o.lang, o.rate, o.pitch, o.mode); },
    stopSpeaking: function () { speakGen++; try { synth.cancel(); } catch (e) { /* */ } },
    listen: function (lang) { listen(lang); },
    stopListening: function () { stopRec(); },
    wakeSet: function (on) { wakeOn = !!on; wakeRefresh(); },
    quitApp: function () { P.quitApp(); },
    clapSet: function (on) { var was = clapOn; clapOn = !!on; if (was !== clapOn) wakeStop(); wakeRefresh(); },
    detectSens: function (n) { n = Math.max(1, Math.min(5, n | 0)); sensF = [1.5, 1.2, 1.0, 0.75, 0.55][n - 1]; },
    wakePause: function (p) { wakePaused = !!p; },
    relisten: function (ms) { setTimeout(function () { emit('ballKick'); }, Math.max(0, ms | 0)); },
    voices: function () {
      var vs = voiceList(), langs = { 'en-GB': false, 'bn-BD': false, 'bn-IN': false, 'hi-IN': false };
      var arr = vs.map(function (v) { var l = String(v.lang || '').replace('_', '-'); Object.keys(langs).forEach(function (k) { if (l.toLowerCase().indexOf(k.split('-')[0]) === 0) langs[k] = true; }); return { name: v.name, locale: l, quality: 400, network: !v.localService }; });
      return J({ voices: arr, langs: langs, ready: vs.length > 0 });
    },
    installVoices: function () { try { P.action('settings', 'sound', ''); } catch (e) { /* */ } },
    // network services (answers come back as native events)
    chat: function (id, type, baseUrl, key, model, messagesJson, system) { P.chat({ id: id, type: type, baseUrl: baseUrl, key: key, model: model, messagesJson: messagesJson, system: system }); },
    listModels: function (id, type, baseUrl, key) { P.models({ id: id, type: type, baseUrl: baseUrl, key: key }); },
    search: function (id, key, cx, query) { P.search({ id: id, key: key, cx: cx, query: query }); },
    tavily: function (id, key, query) { P.tavily({ id: id, key: key, query: query }); },
    lsearch: function (id, provider, key, query) { P.lsearch({ id: id, provider: provider, key: key, query: query }); },
    weather: function (id, key, place, units) { P.weather({ id: id, key: key, place: place, units: units }); },
    // system
    batteryInfo: function () { return batt ? J(batt) : ''; },
    sysInfo: function () {
      var o = {}; try { o = JSON.parse(P.sysInfo()); } catch (e) { /* */ }
      if (batt) { o.batt = batt.pct; o.charging = batt.charging; }
      o.net = navigator.onLine === false ? 'offline' : 'wifi';
      return J(o);
    },
    openUrl: function (u) { P.openUrl(u); },
    copyText: function (t) { P.copy(t); },
    minimize: function () { P.minimize(); },
    setPrivacy: function (on) { P.privacy(on); },
    canLock: function () { return false; },
    haptic: function () { },
    consumeLaunchFlag: function () { return ''; },
    setWidgetTheme: function () { },
    // phone-only features: harmless no-ops here
    // floating ball: the PC has its own always-on-top ball window (see src/main/ball.js)
    setBall: function (on) { try { return P.ballSet ? P.ballSet(!!on) : 'ok'; } catch (e) { return 'ok'; } },
    ballTheme: function (n) { try { P.ballTheme && P.ballTheme(n); } catch (e) { /* */ } },
    ballState: function (st) { try { P.ballState && P.ballState(st); } catch (e) { /* */ } },
    ballText: function (t) { try { P.ballText && P.ballText(t); } catch (e) { /* */ } },
    ballCall: function () { },
    requestBattery: function () { }, openAppSettings: function () { }, setCallHelp: function () { }, callHelpState: function () { return '{}'; },
    // device link
    linkState: function () { return P.link.state(); },
    linkSet: function (json) { var o = {}; try { o = JSON.parse(json); } catch (e) { /* */ } return P.link.set(o); },
    linkCreate: function (url) { return P.link.create(url); },
    linkPair: function (code) { return P.link.pair(code); },
    linkCode: function () { return P.link.code(); },
    linkUnpair: function () { return P.link.unpair(); },
    linkSend: function (t, a, b) { return P.link.send(t, a, b); },
    linkPing: function () { return P.link.ping(); }
  };
  window.AndroidBridge = B;
})();
