/* J.A.R.V.I.S arc-reactor orb — canvas 2D, state + audio-level driven */
(function () {
  'use strict';
  var TAU = Math.PI * 2;
  var COLORS = {
    idle:      [25, 227, 255],
    listening: [120, 244, 255],
    thinking:  [255, 176, 64],
    speaking:  [40, 215, 255]
  };
  var canvas, ctx, W = 0, H = 0, dpr = 1, running = false, raf = 0;
  var state = 'idle', target = 0, level = 0, speakSeed = 0;
  var col = COLORS.idle.slice();
  var spin = 1, spinT = 1, bright = 0.6, brightT = 0.6;
  var rot = 0, rot2 = 0, rot3 = 0, last = 0, t = 0;
  var BARS = 72;
  var barVals = new Float32Array(BARS);

  function lerp(a, b, k) { return a + (b - a) * k; }
  function rgba(a) { return 'rgba(' + (col[0] | 0) + ',' + (col[1] | 0) + ',' + (col[2] | 0) + ',' + a + ')'; }

  function resize() {
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  function setState(s) {
    state = s;
    if (s === 'idle')           { spinT = 0.7; brightT = 0.55; }
    else if (s === 'listening') { spinT = 1.4; brightT = 1.0; }
    else if (s === 'thinking')  { spinT = 4.2; brightT = 0.9; }
    else if (s === 'speaking')  { spinT = 1.8; brightT = 0.95; }
  }
  function setLevel(v) { target = Math.max(0, Math.min(1, v)); }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    var dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now; t += dt;

    // ease colour / speed / brightness toward the current state
    var tc = COLORS[state] || COLORS.idle;
    for (var i = 0; i < 3; i++) col[i] = lerp(col[i], tc[i], Math.min(1, dt * 5));
    spin = lerp(spin, spinT, Math.min(1, dt * 3));
    bright = lerp(bright, brightT, Math.min(1, dt * 3));

    // audio-ish level
    var lv = target;
    if (state === 'speaking') {
      speakSeed += dt * 9;
      lv = 0.38 + 0.28 * Math.sin(speakSeed) * Math.sin(speakSeed * 0.37 + 1.3) + 0.2 * Math.sin(speakSeed * 2.3 + 0.4);
      lv = Math.max(0.12, Math.min(1, lv));
    } else if (state === 'idle') {
      lv = 0.06 + 0.03 * Math.sin(t * 1.6);
    } else if (state === 'thinking') {
      lv = 0.18;
    }
    level = lerp(level, lv, Math.min(1, dt * 14));

    rot += dt * spin * 0.35;
    rot2 -= dt * spin * 0.55;
    rot3 += dt * spin * 0.9;

    draw();
  }

  function ring(cx, cy, r, w, a) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU);
    ctx.lineWidth = w; ctx.strokeStyle = rgba(a); ctx.stroke();
  }
  function arc(cx, cy, r, a0, a1, w, a) {
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1);
    ctx.lineWidth = w; ctx.strokeStyle = rgba(a); ctx.stroke();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var HH = H - (H > 180 ? 36 : 0);          // leave room for the status label under the orb
    var cx = W / 2, cy = HH / 2;
    var R = Math.min(W, HH * 1.04) / 2 * 0.94;
    if (R < 20) return;
    var b = bright;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // ambient glow
    var g = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R * 1.05);
    g.addColorStop(0, rgba(0.30 * b + level * 0.25));
    g.addColorStop(0.55, rgba(0.08 * b + level * 0.10));
    g.addColorStop(1, rgba(0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.05, 0, TAU); ctx.fill();

    // outer thin ring + ticks
    ring(cx, cy, R * 0.985, 1, 0.35 * b);
    var ticks = style === 'minimal' ? 0 : style === 'dense' ? 150 : 90;
    for (var i = 0; i < ticks; i++) {
      var a = rot * 0.4 + i * TAU / ticks;
      var major = i % 5 === 0;
      var r1 = R * 0.90, r2 = R * (major ? 0.955 : 0.93);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.lineWidth = major ? 1.8 : 1;
      ctx.strokeStyle = rgba((major ? 0.85 : 0.4) * b);
      ctx.stroke();
    }

    // thinking: fast sweeping arc
    if (state === 'thinking') {
      for (var k = 0; k < 3; k++) {
        var s0 = rot3 * 1.4 + k * TAU / 3;
        arc(cx, cy, R * 0.98, s0, s0 + 0.55, 4, 0.95);
      }
    }

    // segmented dashed ring (counter rotating)
    for (var s = 0; s < 3; s++) {
      var a0 = rot2 + s * TAU / 3;
      arc(cx, cy, R * 0.82, a0, a0 + TAU / 3 * 0.68, 3.2, 0.85 * b);
    }
    // secondary dotted ring
    var dots = style === 'minimal' ? 0 : style === 'dense' ? 72 : 40;
    for (var d = 0; d < dots; d++) {
      var da = rot * 1.2 + d * TAU / dots;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(da) * R * 0.72, cy + Math.sin(da) * R * 0.72, 1.3, 0, TAU);
      ctx.fillStyle = rgba(0.55 * b); ctx.fill();
    }
    // small notch triangles
    for (var n = 0; n < (style === 'minimal' ? 0 : 4); n++) {
      var na = rot * 0.8 + n * TAU / 4;
      var rr = R * 0.66;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(na) * rr, cy + Math.sin(na) * rr);
      ctx.lineTo(cx + Math.cos(na + 0.05) * (rr - 9), cy + Math.sin(na + 0.05) * (rr - 9));
      ctx.lineTo(cx + Math.cos(na - 0.05) * (rr - 9), cy + Math.sin(na - 0.05) * (rr - 9));
      ctx.closePath(); ctx.fillStyle = rgba(0.9 * b); ctx.fill();
    }

    // radial bars (voice spectrum)
    var base = R * 0.46, maxLen = R * 0.17;
    for (var j = 0; j < BARS; j++) {
      var ang = j * TAU / BARS - Math.PI / 2;
      var wob = 0.5 + 0.5 * Math.sin(t * 5 + j * 0.9) * Math.sin(t * 2.3 + j * 0.37 + 1.1);
      var v;
      if (state === 'thinking') {
        var sweep = (Math.sin(t * 6 - j * 0.35) + 1) / 2;
        v = 0.12 + 0.55 * Math.pow(sweep, 3);
      } else {
        v = 0.08 + level * (0.35 + 0.65 * wob);
      }
      barVals[j] = lerp(barVals[j], v, 0.35);
      var len = 2 + barVals[j] * maxLen;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * base, cy + Math.sin(ang) * base);
      ctx.lineTo(cx + Math.cos(ang) * (base + len), cy + Math.sin(ang) * (base + len));
      ctx.lineWidth = Math.max(1.4, R * 0.014);
      ctx.strokeStyle = rgba(0.35 + barVals[j] * 0.65);
      ctx.stroke();
    }

    // inner reactor ring + coil blocks
    ring(cx, cy, R * 0.42, 2, 0.8 * b);
    var coils = 10;
    for (var c = 0; c < coils; c++) {
      var ca = rot * 0.5 + c * TAU / coils;
      var w = TAU / coils * 0.55;
      arc(cx, cy, R * 0.355, ca, ca + w, R * 0.07, 0.55 * b + level * 0.35);
    }
    ring(cx, cy, R * 0.28, 1.6, 0.9 * b);

    // triangle (iron-man style)
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(-rot * 0.6);
    ctx.beginPath();
    for (var p = 0; p < 3; p++) {
      var pa = -Math.PI / 2 + p * TAU / 3;
      var rx = Math.cos(pa) * R * 0.2, ry = Math.sin(pa) * R * 0.2;
      if (p === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
    }
    ctx.closePath(); ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(0.85 * b); ctx.stroke();
    ctx.restore();

    // core
    var pulse = 1 + 0.08 * Math.sin(t * (state === 'thinking' ? 9 : 2.4)) + level * 0.35;
    var cr = R * 0.12 * pulse;
    var cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr * 2.6);
    cg.addColorStop(0, 'rgba(255,255,255,' + (0.9 * Math.min(1, b + 0.2)) + ')');
    cg.addColorStop(0.28, rgba(0.95));
    cg.addColorStop(1, rgba(0));
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, cr * 2.6, 0, TAU); ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
  }

  function start(c) {
    canvas = c; ctx = canvas.getContext('2d');
    resize();
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize);
    if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  }

  var style = 'classic';
  function setStyle(n) { style = n === 'minimal' || n === 'dense' ? n : 'classic'; }

  function setTheme(c) {
    if (!c || c.length !== 3) return;
    COLORS.idle = c.slice();
    COLORS.listening = [Math.min(255, c[0] + 95), Math.min(255, c[1] + 17), Math.min(255, c[2])];
    COLORS.speaking = [Math.max(0, c[0] + 15), Math.max(0, c[1] - 12), Math.min(255, c[2])];
    // "thinking" stays warm amber, except in the amber theme where it turns cool so the change is still visible
    COLORS.thinking = (c[0] > 200 && c[1] > 150 && c[2] < 120) ? [90, 200, 255] : [255, 176, 64];
  }

  window.Orb = { start: start, setState: setState, setLevel: setLevel, resize: resize, setTheme: setTheme, setStyle: setStyle };
})();
