/* Jarvis Emergency mode v2 (phone only). Red theme. Every control is a toggle: tap to start, tap again to stop.
   Works with no internet and uses no AI tokens (local survival book). When online and a key exists, Jarvis can also reason
   about the situation, but only about emergencies.
   host = { panel, act(type,arg,arg2)->{ok,msg}, perms(), requestLocation(), toast, copy, store, shareToPc?, confirm, speak, stopSpeak, ask, online, name } */
(function () {
  'use strict';
  var host, P, built = false, strobeEl = null, poll = null, morseKind = '', greetedAt = 0;
  var G = function () { return window.JarvisGuide; };
  var els = {};

  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function head(t) { return h('div', 'em-h', esc(t)); }
  function note(t) { return h('div', 'em-note', t); }
  function act(t, a, b) { try { return host.act(t, a || '', b || ''); } catch (e) { return { ok: false, msg: 'That did not work.' }; } }

  /* ---------------------------------------------------------------- toggles */
  var tiles = {};
  function tile(key, label, subOff, fn) {
    var t = h('button', 'em-tile'); t.type = 'button';
    t.innerHTML = '<b>' + esc(label) + '</b><small>' + esc(subOff) + '</small>';
    t.dataset.off = subOff;
    t.addEventListener('click', function () { fn(); setTimeout(refresh, 250); });
    tiles[key] = t; return t;
  }
  function setTile(key, on, onText) {
    var t = tiles[key]; if (!t) return;
    t.classList.toggle('on', !!on);
    t.setAttribute('aria-pressed', on ? 'true' : 'false');
    t.querySelector('small').textContent = on ? (onText || 'ON. Tap to stop') : t.dataset.off;
  }
  var cur = { s: '', m: 0, t: 0 };
  function refresh() {
    var r = act('emstate'), p = String((r && r.msg) || '').split('|');
    if (r && r.ok && p.length >= 3) cur = { s: p[0], m: +p[1], t: +p[2] };
    setTile('siren', cur.s === 'siren', 'ON. Tap to stop');
    setTile('whistle', cur.s === 'whistle', 'ON. Tap to stop');
    setTile('sos', cur.m && morseKind === 'sos', 'FLASHING. Tap to stop');
    setTile('morse', cur.m && morseKind === 'msg', 'FLASHING. Tap to stop');
    setTile('strobe', !!strobeEl, 'ON. Tap to stop');
    setTile('track', cur.t, 'TRACKING. Tap to stop');
    if (cur.t) showFix();
    if (!cur.m) morseKind = '';
  }
  function startPoll() { stopPoll(); refresh(); poll = setInterval(function () { if (P && P.isOpen) refresh(); }, 2000); }
  function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

  function toggleSound(kind) {
    if (cur.s === kind) { act('emsound', 'off'); cur.s = ''; host.toast('Stopped', 1500); return; }
    var r = act('emsound', kind); if (!r.ok) host.toast(r.msg, 3500); else cur.s = kind;
  }
  function toggleSos() {
    if (cur.m && morseKind === 'sos') { act('morse', 'stop'); morseKind = ''; cur.m = 0; host.toast('Stopped', 1500); return; }
    if (cur.m) act('morse', 'stop');
    var r = act('morse', 'sos'); if (!r.ok) host.toast(r.msg, 3500); else { morseKind = 'sos'; cur.m = 1; }
  }
  function toggleMorse() {
    if (cur.m && morseKind === 'msg') { act('morse', 'stop'); morseKind = ''; cur.m = 0; host.toast('Stopped', 1500); return; }
    var m = window.JarvisTools ? window.JarvisTools.toMorse(els.mtx.value) : '';
    if (!m) { host.toast('Type the message below the tiles first', 2600); els.mtx.focus(); return; }
    if (cur.m) act('morse', 'stop');
    var r = act('morse', m, 'loop'); if (!r.ok) host.toast(r.msg, 3500); else { morseKind = 'msg'; cur.m = 1; }
  }
  function toggleStrobe() { if (strobeEl) stopStrobe(); else startStrobe(); }
  function startStrobe() {
    strobeEl = h('div'); strobeEl.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;align-items:flex-end;justify-content:center;padding-bottom:40px;color:#000;font:700 16px sans-serif';
    strobeEl.textContent = 'TAP ANYWHERE TO STOP'; document.body.appendChild(strobeEl);
    var on = true; strobeEl.timer = setInterval(function () { on = !on; strobeEl.style.background = on ? '#fff' : '#000'; strobeEl.style.color = on ? '#000' : '#fff'; }, 180);
    strobeEl.addEventListener('click', function () { stopStrobe(); refresh(); });
  }
  function stopStrobe() { if (strobeEl) { clearInterval(strobeEl.timer); strobeEl.remove(); strobeEl = null; } }
  function toggleTrack() {
    if (cur.t) { act('emtrack', 'off'); cur.t = 0; els.fix.textContent = 'Location tracking is off.'; delete els.fix.dataset.ll; return; }
    var p = host.perms ? host.perms() : {};
    if (!p.loc) { host.requestLocation(); host.toast('Allow location, then tap LOCATION again', 4200); return; }
    var r = act('emtrack', 'on'); host.toast(r.msg, 3000); els.fix.textContent = 'Searching for a fix. This can take up to a minute outdoors.';
  }
  function showFix() {
    var r = act('where'), m = String((r && r.msg) || '');
    var mm = /Phone location: ([-\d.]+,[-\d.]+) \(accuracy (\d+) m, (\d+) s ago\)/.exec(m);
    if (mm) { els.fix.dataset.ll = mm[1]; els.fix.innerHTML = '<b style="color:#fff;font-size:18px">' + esc(mm[1]) + '</b><br><small>accuracy ' + esc(mm[2]) + ' m, ' + esc(mm[3]) + ' s ago</small>'; }
    else if (/permission/i.test(m)) els.fix.textContent = 'Location is not allowed yet.';
    else els.fix.textContent = 'Searching for a fix. Go outside or near a window if it takes long.';
  }
  function stopAll() { act('emstop'); stopStrobe(); morseKind = ''; cur = { s: '', m: 0, t: 0 }; refresh(); }

  /* ---------------------------------------------------------------- talk to Jarvis (emergency only) */
  var URGENT = /bleed|not breathing|unconscious|choking|chok|heart|chest pain|drown|snake|poison|burn|seizure|fit |stroke|collapse|faint|attack|fire|trapped|accident|overdose|electric/i;
  var SYSTEM = 'You are Jarvis in EMERGENCY MODE: a calm, serious, caring friend who stays with the person. Answer ONLY about emergencies, first aid, safety, survival, disasters, getting help and keeping a phone alive. ' +
    'If the question is not about that, reply in one short kind sentence that in emergency mode you only help with emergencies, and ask what is happening. ' +
    'Style: plain English, no emojis, no markdown symbols. First line: if life is at risk, tell them to call 999 (Bangladesh) or 112 now and put the phone on speaker. Then at most 6 short numbered steps, the most important first. ' +
    'End with one short question or reassurance. Never diagnose, never invent doses or facts, say when something needs a doctor. Use the reference notes if they are given, they are reliable.';

  function say(cls, html) { var d = h('div', 'em-m ' + cls, html); els.chat.appendChild(d); els.chat.scrollTop = els.chat.scrollHeight; return d; }
  function topicHtml(t, n) {
    var s = '<b>' + esc(t.title) + '</b><ol>' + t.steps.slice(0, n || 5).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>';
    if (t.dont && t.dont.length) s += '<div class="dn">Do not: ' + esc(t.dont[0]) + '</div>';
    return s;
  }
  function jarvisSay(spoken, html) {
    var d = say('j', html || esc(spoken).replace(/\n/g, '<br>'));
    talking(true); try { host.speak(spoken); } catch (e) { /* ignore */ }
    setTimeout(function () { talking(false); }, Math.min(12000, 1500 + spoken.length * 55));
    return d;
  }
  function talking(on) { if (els.orb) els.orb.classList.toggle('talk', !!on); }

  function quick(q) {
    var t = q.toLowerCase().trim();
    if (/^(?:stop|stop all|off|cancel|stop everything|stop alarm|stop siren)$/.test(t)) { stopAll(); return 'Everything is off.'; }
    if (/^(?:siren|loud siren|alarm)$/.test(t)) { if (cur.s !== 'siren') toggleSound('siren'); setTimeout(refresh, 250); return 'Siren on at full volume. Say stop to end it.'; }
    if (/^(?:whistle)$/.test(t)) { if (cur.s !== 'whistle') toggleSound('whistle'); setTimeout(refresh, 250); return 'Whistle on. Say stop to end it.'; }
    if (/^(?:sos|sos light|flash sos|flash light|flashlight)$/.test(t)) { if (!(cur.m && morseKind === 'sos')) toggleSos(); setTimeout(refresh, 250); return 'Flashing S O S. Say stop to end it.'; }
    if (/^(?:where am i|my location|location|track me|track my location)$/.test(t)) { if (!cur.t) toggleTrack(); setTimeout(refresh, 400); return 'I am finding your position. It will show in the location panel below.'; }
    return null;
  }

  function ask(q) {
    q = String(q || '').trim(); if (!q) return;
    say('u', esc(q)); els.inp.value = '';
    var qk = quick(q); if (qk) { jarvisSay(qk); return; }
    var g = G(), hits = g ? g.find(q, 3) : [], top = hits[0];
    var online = host.online && host.online();
    var urgent = URGENT.test(q);
    var pre = urgent ? 'If anyone is in danger, call 999 or 112 now and put the phone on speaker. ' : '';
    function local() {
      if (top && top.score >= 3) {
        var d = jarvisSay(pre + g.plain(top.t, 4), (urgent ? '<div class="dn"><b>If anyone is in danger, call 999 or 112 now.</b></div>' : '') + topicHtml(top.t, 6));
        var more = h('button', 'em-btn', 'OPEN FULL GUIDE PAGE'); more.style.marginTop = '6px'; more.addEventListener('click', function () { openTopic(top.t.id, true); }); d.appendChild(more);
        if (hits[1] && hits[1].score >= 3) { var o = h('div', 'em-note', 'Related: ' + esc(hits[1].t.title)); d.appendChild(o); }
      } else {
        jarvisSay('I do not have a stored guide for that while offline. Stay calm. If life is at risk call 999 or 112 now. Tell me one of these: bleeding, burn, choking, snake bite, fire, flood, earthquake, lost, no water, or open the Survival Book below.');
      }
    }
    if (!online) { local(); return; }
    var wait = say('j', '<i>Thinking</i>'); talking(true);
    var ctx = hits.filter(function (x) { return x.score >= 3; }).slice(0, 2).map(function (x) { return x.t.title + ': ' + x.t.steps.slice(0, 5).join(' '); }).join('\n');
    host.ask(SYSTEM, (ctx ? 'Reference notes:\n' + ctx + '\n\n' : '') + 'Situation: ' + q, function (r) {
      wait.remove(); talking(false);
      if (r && r.ok && r.text) {
        var tx = r.text.replace(/[*#`_]{1,3}/g, '').trim();
        jarvisSay(tx);
      } else local();
    });
  }

  /* ---------------------------------------------------------------- survival book */
  function flat() { var o = []; G().book.forEach(function (c) { c.topics.forEach(function (t) { o.push({ c: c, t: t }); }); }); return o; }
  function shelf() {
    var b = els.book; b.innerHTML = '';
    var s = h('input', 'em-inp'); s.placeholder = 'Search the book: fire, water, snake, flood…'; s.type = 'search';
    s.addEventListener('input', function () { var v = s.value.trim(); if (v.length < 2) { shelf2(); return; } results(v); });
    b.appendChild(s); els.shelfBody = h('div'); b.appendChild(els.shelfBody); shelf2();
  }
  function shelf2() {
    var w = els.shelfBody; w.innerHTML = '';
    G().book.forEach(function (c, i) {
      var r = h('button', 'em-ch'); r.type = 'button';
      r.innerHTML = '<span>' + String(i + 1).padStart(2, '0') + '</span><div><b>' + esc(c.title) + '</b><small>' + esc(c.note) + ' · ' + c.topics.length + ' pages</small></div>';
      r.addEventListener('click', function () { chapter(c.id); }); w.appendChild(r);
    });
  }
  function results(v) {
    var w = els.shelfBody; w.innerHTML = '';
    var rs = G().find(v, 12);
    if (!rs.length) { w.appendChild(note('Nothing found for “' + esc(v) + '”. Try another word.')); return; }
    rs.forEach(function (x) { var r = h('button', 'em-ch'); r.type = 'button'; r.innerHTML = '<span>›</span><div><b>' + esc(x.t.title) + '</b><small>' + esc(x.c.title) + '</small></div>'; r.addEventListener('click', function () { openTopic(x.t.id, true); }); w.appendChild(r); });
  }
  function chapter(id) {
    var c = G().book.filter(function (x) { return x.id === id; })[0]; if (!c) return;
    var b = els.book; b.innerHTML = '';
    var back = h('button', 'em-btn', 'ALL CHAPTERS'); back.addEventListener('click', function () { shelf(); }); b.appendChild(back);
    var t = h('div', 'em-pg'); t.innerHTML = '<h3>' + esc(c.title.toUpperCase()) + '</h3><div class="em-note">' + esc(c.note) + '</div>'; b.appendChild(t);
    c.topics.forEach(function (tp, i) { var r = h('button', 'em-ch'); r.type = 'button'; r.innerHTML = '<span>' + (i + 1) + '</span><div><b>' + esc(tp.title) + '</b></div>'; r.addEventListener('click', function () { openTopic(tp.id, false); }); b.appendChild(r); });
  }
  function openTopic(id, scroll) {
    var list = flat(), i = -1; list.forEach(function (e, k) { if (e.t.id === id) i = k; }); if (i < 0) return;
    var e = list[i], t = e.t, b = els.book; b.innerHTML = '';
    var top = h('div', 'em-row'); top.style.marginTop = '0';
    var back = h('button', 'em-btn', 'CHAPTER'); back.addEventListener('click', function () { chapter(e.c.id); });
    var all = h('button', 'em-btn', 'ALL'); all.addEventListener('click', function () { shelf(); });
    top.appendChild(back); top.appendChild(all); b.appendChild(top);
    var pg = h('div', 'em-pg');
    pg.innerHTML = '<div class="em-note" style="margin-top:10px">' + esc(e.c.title.toUpperCase()) + ' · PAGE ' + (i + 1) + ' OF ' + list.length + '</div><h3>' + esc(t.title.toUpperCase()) + '</h3><h4>STEPS</h4><ol>' + t.steps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' +
      (t.dont && t.dont.length ? '<h4>DO NOT</h4><ul class="dn">' + t.dont.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + (t.tip ? '<div class="tp"><b>TIP</b> ' + esc(t.tip) + '</div>' : '');
    b.appendChild(pg);
    var rd = h('button', 'em-btn', 'READ ALOUD'); rd.style.marginTop = '10px';
    var reading = false; rd.addEventListener('click', function () { if (reading) { host.stopSpeak(); reading = false; rd.textContent = 'READ ALOUD'; return; } reading = true; rd.textContent = 'STOP READING'; host.speak(G().plain(t, 12)); });
    b.appendChild(rd);
    var nav = h('div', 'em-nav'), pv = h('button', '', 'PREVIOUS'), nx = h('button', '', 'NEXT');
    if (i > 0) pv.addEventListener('click', function () { host.stopSpeak(); openTopic(list[i - 1].t.id, true); }); else pv.disabled = true, pv.style.opacity = .35;
    if (i < list.length - 1) nx.addEventListener('click', function () { host.stopSpeak(); openTopic(list[i + 1].t.id, true); }); else nx.disabled = true, nx.style.opacity = .35;
    nav.appendChild(pv); nav.appendChild(nx); b.appendChild(nav);
    b.appendChild(note('General guidance only. Real training saves lives. In real danger call emergency services.'));
    if (scroll) setTimeout(function () { try { els.bookHead.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (x) { /* ignore */ } }, 60);
  }

  /* ---------------------------------------------------------------- build */
  function build() {
    var b = P.body; b.innerHTML = ''; P.root.classList.add('em');
    var hero = h('div', 'em-hero');
    els.orb = h('div', 'em-orb', '<i></i><i></i><b></b>'); hero.appendChild(els.orb);
    hero.appendChild(h('p', '', '<b style="letter-spacing:.14em;color:#ff7b7b">EMERGENCY MODE</b><small>I am here with you. Everything works offline. If anyone is in danger, call 999 or 112 first.</small>'));
    b.appendChild(hero);

    var call = h('div', 'em-grid');
    [['CALL 999', '999'], ['CALL 112', '112']].forEach(function (c) { var x = h('button', 'em-btn sol', c[0]); x.addEventListener('click', function () { host.confirm('Call ' + c[1] + ' now?', function () { act('call', c[1]); }); }); call.appendChild(x); });
    b.appendChild(call);

    b.appendChild(head('SIGNALS  ·  TAP TO START, TAP AGAIN TO STOP'));
    var g = h('div', 'em-grid');
    g.appendChild(tile('siren', 'SIREN', 'Loud wail, full volume', function () { toggleSound('siren'); }));
    g.appendChild(tile('whistle', 'WHISTLE', '3 sharp blasts', function () { toggleSound('whistle'); }));
    g.appendChild(tile('sos', 'SOS LIGHT', 'Flashlight S O S', toggleSos));
    g.appendChild(tile('strobe', 'STROBE', 'Bright screen flash', toggleStrobe));
    g.appendChild(tile('morse', 'MORSE', 'Flash your message', toggleMorse));
    g.appendChild(tile('track', 'LOCATION', 'Live GPS tracking', toggleTrack));
    b.appendChild(g);
    els.mtx = h('input', 'em-inp'); els.mtx.placeholder = 'Message to flash in Morse, then tap MORSE'; els.mtx.style.marginTop = '8px';
    var mo = h('div'); mo.style.cssText = 'font-family:monospace;color:#ff8f8f;word-break:break-word;margin:6px 0;min-height:18px;font-size:14px';
    els.mtx.addEventListener('input', function () { mo.textContent = window.JarvisTools ? window.JarvisTools.toMorse(els.mtx.value) : ''; });
    b.appendChild(els.mtx); b.appendChild(mo);
    b.appendChild(note('The siren plays at full volume even on silent and stops by itself after 5 minutes. Flashing and tracking stop by themselves after 10 and 30 minutes. Do not shine the light at close range into eyes.'));

    b.appendChild(head('YOUR POSITION'));
    els.fix = h('div', 'em-book', 'Tap LOCATION above to start tracking.'); els.fix.style.wordBreak = 'break-word'; b.appendChild(els.fix);
    var g2 = h('div', 'em-grid'); g2.style.marginTop = '8px';
    var mp = h('button', 'em-btn', 'OPEN MAP'); mp.addEventListener('click', function () { var ll = els.fix.dataset.ll; if (ll) act('map', ll); else host.toast('Start LOCATION first', 2000); });
    var cp = h('button', 'em-btn', 'COPY / SEND TO PC'); cp.addEventListener('click', function () { var m = msg(); if (!m) { host.toast('Start LOCATION first', 2000); return; } host.copy(m); if (host.shareToPc) host.shareToPc(m); });
    g2.appendChild(mp); g2.appendChild(cp); b.appendChild(g2);
    var num = h('input', 'em-inp'); num.type = 'tel'; num.placeholder = 'Phone number or contact name'; num.style.marginTop = '8px'; b.appendChild(num);
    function msg() { var ll = els.fix.dataset.ll; return ll ? 'I need help. My location: https://maps.google.com/?q=' + ll : ''; }
    var tx = h('button', 'em-btn', 'WRITE THE TEXT WITH MY LOCATION'); tx.style.marginTop = '8px';
    tx.addEventListener('click', function () { var m = msg(); if (!m) { host.toast('Start LOCATION first', 2200); return; } var r = act('sms', num.value.trim(), m); host.toast(r.msg, 3500); });
    b.appendChild(tx); b.appendChild(note('Jarvis opens the message ready. You tap send. Nothing goes out by itself.'));

    b.appendChild(head('TALK TO JARVIS'));
    els.chat = h('div', 'em-chat'); b.appendChild(els.chat);
    var ch = h('div', 'em-chips');
    ['Bleeding', 'Burn', 'Choking', 'Not breathing', 'Snake bite', 'Fire', 'Flood', 'Earthquake', 'I am lost', 'No water', 'Low battery'].forEach(function (c) {
      var x = h('button', '', esc(c)); x.type = 'button'; x.addEventListener('click', function () { ask(c === 'I am lost' ? 'I am lost' : c === 'No water' ? 'I have no water' : c === 'Low battery' ? 'my phone battery is low' : 'help with ' + c.toLowerCase()); }); ch.appendChild(x);
    });
    b.appendChild(ch);
    var row = h('div', 'em-row'); els.inp = h('input'); els.inp.placeholder = 'Tell me what is happening'; els.inp.setAttribute('enterkeyhint', 'send');
    var sb = h('button', 'em-btn sol', 'SEND'); sb.style.width = 'auto';
    sb.addEventListener('click', function () { ask(els.inp.value); }); els.inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ask(els.inp.value); } });
    row.appendChild(els.inp); row.appendChild(sb); b.appendChild(row);
    b.appendChild(note('Here I only answer emergencies and survival. The guide below works with no internet. With internet and an AI key I can think through your exact situation.'));

    els.bookHead = head('SURVIVAL BOOK  ·  ' + (G() ? G().count() : 0) + ' PAGES'); b.appendChild(els.bookHead);
    els.book = h('div', 'em-book'); b.appendChild(els.book); if (G()) shelf(); else els.book.textContent = 'The survival book did not load.';

    b.appendChild(head('MY EMERGENCY CARD'));
    var card = h('textarea', 'em-inp'); card.placeholder = 'Blood group, allergies, medicines, emergency contact. Stays on this phone only.'; card.style.minHeight = '90px';
    try { card.value = host.store.get('emcard') || ''; } catch (e) { /* */ }
    card.addEventListener('input', function () { try { host.store.set('emcard', card.value.slice(0, 600)); } catch (e) { /* */ } });
    b.appendChild(card);
    var big = h('button', 'em-btn', 'SHOW BIG ON SCREEN'); big.style.marginTop = '8px';
    big.addEventListener('click', function () { var t = card.value.trim() || 'No details saved yet.'; var o = h('div'); o.style.cssText = 'position:fixed;inset:0;z-index:99998;background:#fff;color:#000;padding:28px 22px;font:600 22px/1.4 sans-serif;white-space:pre-wrap;overflow:auto'; o.textContent = t + '\n\n(tap to close)'; o.addEventListener('click', function () { o.remove(); }); document.body.appendChild(o); });
    b.appendChild(big);
    var bs = h('button', 'em-btn', 'OPEN BATTERY SAVER'); bs.style.marginTop = '8px'; bs.addEventListener('click', function () { act('settings', 'batterysaver'); }); b.appendChild(bs);
    var st = h('button', 'em-btn sol', 'STOP EVERYTHING'); st.style.marginTop = '14px'; st.addEventListener('click', function () { stopAll(); host.toast('All signals off', 1800); }); b.appendChild(st);
    b.appendChild(note('General guidance only. In real danger, call emergency services.'));
  }

  function greet() {
    if (Date.now() - greetedAt < 60000) return; greetedAt = Date.now();
    var n = ''; try { n = host.name ? host.name() : ''; } catch (e) { /* */ }
    var t = 'Emergency mode is on' + (n ? ', ' + n : '') + '. I am here with you. If anyone is in danger, call 999 or 112 first. Then tell me what is happening and I will guide you step by step.';
    els.chat.innerHTML = ''; jarvisSay(t);
  }

  window.JarvisEmergency = {
    init: function (h0) {
      host = h0; P = host.panel; var c = P.close;
      P.close = function () { stopStrobe(); stopPoll(); try { host.stopSpeak(); } catch (e) { /* */ } c(); };
      return this;
    },
    open: function () { if (!built) { build(); built = true; } P.open(); startPoll(); greet(); }
  };
})();
// CRB-MARK bd30e38c1abe
