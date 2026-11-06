'use strict';
// UI of the PC floating ball (a Jarvis HUD). It talks to the main process only through window.jarvisBall (ball-preload.js).
// Nothing here animates by itself: the graphs are redrawn once per stats message (every 3 s, only while the panel is open).
(function () {
  var J = window.jarvisBall, $ = function (id) { return document.getElementById(id); };
  var wrap = $('wrap'), orb = $('orb'), status = $('status'), reply = $('reply'), q = $('q'), card = $('card'), cv = $('core'), cx = cv.getContext('2d');
  var CY = '25,227,255', AM = '255,176,64', RD = '255,90,90', last = null, focusEnd = 0, focusTick = null;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = 316 * dpr; cv.height = 118 * dpr; cx.scale(dpr, dpr);

  function theme(name) {
    var r = document.documentElement; if (/^(amber|red|purple|mark|friday|green)$/.test(name || '')) r.setAttribute('data-theme', name); else r.removeAttribute('data-theme');
    CY = (getComputedStyle(r).getPropertyValue('--cyrgb') || '25,227,255').trim(); if (last) draw(last);
  }
  function say(t) { status.textContent = String(t || '').slice(0, 60); }
  function setExpanded(on) { wrap.classList.toggle('collapsed', !on); if (on) setTimeout(function () { q.focus(); }, 80); }
  function setState(s) { orb.className = 'orb' + (s && s !== 'idle' ? ' ' + s : ''); $('mic').classList.toggle('on', s === 'listening'); if (s) say(s === 'idle' ? 'ready' : s); }
  function col(p, a) { return 'rgba(' + (p >= 90 ? RD : p >= 75 ? AM : CY) + ',' + (a == null ? 1 : a) + ')'; }

  // ---- graphs: triple ring (CPU / RAM / DISK) with the health score, two live traces, battery bar
  function ring(r, p, label) {
    cx.lineWidth = 6; cx.lineCap = 'round';
    cx.strokeStyle = 'rgba(' + CY + ',.13)'; cx.beginPath(); cx.arc(59, 59, r, 0, 6.2832); cx.stroke();
    if (p > 0) { cx.strokeStyle = col(p); cx.shadowColor = col(p, .8); cx.shadowBlur = 6; cx.beginPath(); cx.arc(59, 59, r, -1.5708, -1.5708 + 6.2832 * Math.min(1, p / 100)); cx.stroke(); cx.shadowBlur = 0; }
  }
  function trace(x, y, w, h, arr, p, name) {
    cx.fillStyle = 'rgba(' + CY + ',.75)'; cx.font = '600 10px "Segoe UI",sans-serif'; cx.textAlign = 'left'; cx.fillText(name, x, y + 9);
    cx.textAlign = 'right'; cx.fillStyle = col(p); cx.fillText(p + '%', x + w, y + 9);
    var top = y + 14, bh = h - 14; cx.strokeStyle = 'rgba(' + CY + ',.12)'; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(x, top + bh); cx.lineTo(x + w, top + bh); cx.moveTo(x, top + bh / 2); cx.lineTo(x + w, top + bh / 2); cx.stroke();
    var n = arr.length; if (n < 2) return;
    var step = w / 59, px = function (i) { return x + w - (n - 1 - i) * step; }, py = function (v) { return top + bh - bh * Math.max(0, Math.min(100, v)) / 100; };
    cx.beginPath(); cx.moveTo(px(0), py(arr[0])); for (var i = 1; i < n; i++) cx.lineTo(px(i), py(arr[i]));
    cx.strokeStyle = col(p); cx.lineWidth = 1.6; cx.lineJoin = 'round'; cx.stroke();
    cx.lineTo(px(n - 1), top + bh); cx.lineTo(px(0), top + bh); cx.closePath(); cx.fillStyle = col(p, .12); cx.fill();
  }
  function draw(s) {
    cx.clearRect(0, 0, 316, 118);
    ring(52, s.cpu); ring(42, s.ram); ring(32, s.disk >= 0 ? s.disk : 0);
    cx.textAlign = 'center'; cx.fillStyle = '#e7f6ff'; cx.font = '600 21px "Segoe UI",sans-serif'; cx.fillText(s.ins ? s.ins.score : '–', 59, 63);
    cx.fillStyle = 'rgba(' + CY + ',.7)'; cx.font = '600 7.5px "Segoe UI",sans-serif'; cx.fillText('HEALTH', 59, 74);
    var h = s.hist || { cpu: [], ram: [] };
    trace(128, 0, 188, 46, h.cpu, s.cpu, 'CPU');
    trace(128, 50, 188, 46, h.ram, s.ram, 'MEMORY' + (s.disk >= 0 ? '  ·  DRIVE ' + s.disk + '%' : ''));
    var b = s.batt, bp = b ? b.pct : 100;
    cx.textAlign = 'left'; cx.fillStyle = 'rgba(' + CY + ',.75)'; cx.font = '600 10px "Segoe UI",sans-serif'; cx.fillText(b ? 'BATTERY' : 'POWER', 128, 112);
    cx.textAlign = 'right'; cx.fillStyle = b && !b.charging && bp <= 20 ? 'rgb(' + RD + ')' : '#e7f6ff'; cx.fillText(b ? bp + '%' + (b.charging ? ' ⚡' : '') : 'AC', 316, 112);
    cx.fillStyle = 'rgba(' + CY + ',.13)'; cx.fillRect(176, 104, 96, 5); cx.fillStyle = b && !b.charging && bp <= 20 ? 'rgb(' + RD + ')' : 'rgb(' + CY + ')'; cx.fillRect(176, 104, 96 * bp / 100, 5);
  }
  function chipsUI(list) {
    var box = $('chips'), key = JSON.stringify(list || []); if (box.dataset.k === key) return; box.dataset.k = key; box.textContent = '';
    (list || []).forEach(function (c) {
      var b = document.createElement('button'); b.className = 'chip' + (c.id === 'clip' ? ' clip' : ''); b.textContent = '◈ ' + c.label;
      b.addEventListener('click', function () { run(c.id, b); }); box.appendChild(b);
    });
  }
  function stats(s) {
    document.documentElement.style.setProperty('--ring', s.level === 'bad' ? 'var(--bad)' : s.level === 'warn' ? 'var(--am)' : 'var(--ac)');
    if (wrap.classList.contains('collapsed') || !s.hist) return;
    last = s; draw(s);
    if (s.ins) { $('ins').className = 'ins ' + s.ins.tone; $('ins-v').textContent = s.ins.verdict; $('ins-n').textContent = s.ins.note; }
    chipsUI(s.chips);
    $('hint').textContent = s.me ? 'Jarvis itself: ' + s.me.cpu + '% CPU · ' + s.me.mb + ' MB   —   drop a link or text here to send it to your phone' : 'Drop a link, text or picture here to send it to your phone';
  }
  // ---- focus ring
  function focusUI() {
    var left = focusEnd - Date.now(), m = $('m-focus');
    if (focusEnd && left > 0) {
      var s = Math.ceil(left / 1000); $('focus-l').textContent = ('0' + Math.floor(s / 60)).slice(-2) + ':' + ('0' + s % 60).slice(-2);
      $('focus-b').style.width = Math.round(100 * (1 - left / 1500000)) + '%'; m.classList.add('run');
    } else { focusEnd = 0; $('focus-l').textContent = 'FOCUS'; $('focus-b').style.width = '0'; m.classList.remove('run'); }
  }
  function setFocus(end) {
    focusEnd = end || 0; clearInterval(focusTick); focusTick = null; focusUI();
    if (focusEnd && !wrap.classList.contains('collapsed')) focusTick = setInterval(focusUI, 1000);
  }
  function run(id, btn) {
    if (btn.classList.contains('busy')) return; btn.classList.add('busy'); say('working…');
    J.tile(id).then(function (r) {
      say(r && r.msg ? r.msg : (r && r.ok ? 'done' : 'failed'));
      if (r && r.text) { reply.textContent = r.text; reply.scrollTop = 0; }
    }, function () { say('failed'); }).then(function () { btn.classList.remove('busy'); });
  }
  Array.prototype.forEach.call(document.querySelectorAll('.mod'), function (b) { b.addEventListener('click', function () { run(b.dataset.id, b); }); });
  J.on(function (ev, d) {
    if (ev === 'init') { wrap.className = 'wrap side-' + d.side + ' v-' + (d.vside || 'top') + (d.expanded ? '' : ' collapsed'); if (d.expanded) setExpanded(true); setFocus(focusEnd); }
    else if (ev === 'stats') stats(d);
    else if (ev === 'reply') { reply.textContent = d.text; reply.scrollTop = 0; if (wrap.classList.contains('collapsed')) say(''); }
    else if (ev === 'state') setState(d.state);
    else if (ev === 'status') say(d.text);
    else if (ev === 'theme') theme(d.name);
    else if (ev === 'focus') setFocus(d.end);
    else if (ev === 'ring') { $('find-l').textContent = d.on ? 'STOP RINGING' : 'LOCATE PHONE'; $('m-find').classList.toggle('run', !!d.on); }
    else if (ev === 'inputfocus') { setTimeout(function () { q.focus(); }, 40); }
  });
  // click = open/close, drag = move (a 5 px threshold tells them apart)
  var drag = null;
  function onDown(e) { if (e.button !== 0) return; drag = { sx: e.screenX, sy: e.screenY, moved: false }; J.dragStart(e.screenX, e.screenY); e.preventDefault(); }
  orb.addEventListener('mousedown', onDown);
  wrap.querySelector('.title').addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.screenX - drag.sx) + Math.abs(e.screenY - drag.sy) < 5) return;
    drag.moved = true; J.dragMove(e.screenX, e.screenY);
  });
  window.addEventListener('mouseup', function () {
    if (!drag) return; var d = drag; drag = null; J.dragEnd(d.moved);
    if (!d.moved) { var open = wrap.classList.contains('collapsed'); J.toggle(open); setTimeout(function () { setFocus(focusEnd); }, 120); }
  });
  $('x').addEventListener('click', function () { J.toggle(false); clearInterval(focusTick); focusTick = null; });
  function ask() { var v = q.value.trim(); if (!v) return; q.value = ''; reply.textContent = '…'; setState('thinking'); J.ask(v); }
  $('go').addEventListener('click', ask);
  q.addEventListener('keydown', function (e) { if (e.key === 'Enter') ask(); else if (e.key === 'Escape') J.toggle(false); });
  $('mic').addEventListener('click', function () { if ($('mic').classList.contains('on')) { J.stopListen(); say('stopped listening'); } else J.listen(); });   // tap to start, tap to stop (it also stops by itself when you finish speaking)
  // drop a link / text on the ball or the panel -> phone
  function over(on) { orb.classList.toggle('over', on); card.classList.toggle('over', on && !wrap.classList.contains('collapsed')); }
  ['dragenter', 'dragover'].forEach(function (n) { document.addEventListener(n, function (e) { e.preventDefault(); over(true); }); });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) over(false); });
  document.addEventListener('drop', function (e) {
    e.preventDefault(); over(false);
    var dt = e.dataTransfer; if (!dt) return;
    var t = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
    if (!t && dt.files && dt.files.length) {
      var f = dt.files[0];
      if (f.size > 12000000) { say('too big — the limit is 3 MB'); return; }
      if (f.size > 3000000 && !/^image\//i.test(f.type)) { say('too big — the limit is 3 MB'); return; }
      say('sending ' + f.name.slice(0, 24) + '…');
      f.arrayBuffer().then(function (buf) { return J.dropFile(f.name, f.type, buf); }).then(function (r) { say(r && r.msg ? r.msg : 'sent'); }, function () { say('failed'); });
      return;
    }
    if (!t) return; say('sending to phone…');
    J.drop(t).then(function (r) { say(r && r.msg ? r.msg : 'sent'); }, function () { say('failed'); });
  });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); J.menu(); });
})();
