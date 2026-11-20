/* Jarvis Emergency mode (phone only). Alarm, flashlight SOS / Morse, screen strobe, live location, survival guide.
   Works with no internet and uses no AI tokens. host = { panel, act(type,arg,arg2)->{ok,msg}, perms(), requestLocation(), toast, copy, store, shareToPc?, confirm }. */
(function () {
  'use strict';
  var host, P, built = false, strobeEl = null, timer = null;
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function btn(label, fn, cls) { var b = h('button', 'btn' + (cls ? ' ' + cls : ''), esc(label)); b.addEventListener('click', fn); return b; }
  function grid(n) { var g = h('div'); g.style.cssText = 'display:grid;grid-template-columns:repeat(' + n + ',1fr);gap:8px;margin:8px 0'; return g; }
  function head(t) { var d = h('div', '', esc(t)); d.style.cssText = 'margin:18px 0 6px;letter-spacing:.14em;color:var(--cy2);font-size:13px'; return d; }
  function note(t) { var d = h('div', '', t); d.style.cssText = 'color:var(--mute);font-size:14px;line-height:1.45;margin:4px 0'; return d; }

  var TIPS = [
    ['Get found first', ['Stay put unless the place is unsafe. Rescuers search where you were last seen.', 'Make yourself big and loud: bright clothes, a light at night, a whistle.', 'Three of anything is the world signal for help: 3 whistle blasts, 3 flashes, 3 fires, 3 shouts.', 'Tell someone your plan before you go. Share your location from here.']],
    ['Signalling (light, sound, mirror)', ['Use SOS LIGHT or the whistle. Whistle sound carries much farther than shouting and does not tire you.', 'Flash at night toward aircraft or roads. Save battery: signal in bursts, not all night.', 'A mirror, phone screen or shiny foil flashes a beam in sunlight. Aim it at the target through your fingers.', 'Write HELP or SOS large on open ground with rocks or branches.']],
    ['Phone battery', ['Turn on Battery Saver and lower brightness. Close apps. Flight mode saves most, but turn it off every 15 min to send your location.', 'Keep the phone warm, cold drains batteries fast. Body pocket is best.', 'Text messages need far less signal than calls. Try SMS when a call fails.', 'Emergency numbers can work even with weak signal: 999 (Bangladesh), 112 (works in most countries).']],
    ['Water', ['You can live about 3 days without water, 3 weeks without food. Water comes first.', 'Never drink sea water or urine. Rain, clear running water and dew are best.', 'Boil for 1 minute to make it safe. If you cannot boil, filter through cloth first and wait.', 'Ration sweat, not water: rest in the shade, move at dawn and dusk.']],
    ['Shelter and warmth', ['Rule of 3: 3 hours without shelter in harsh weather, 3 days without water.', 'Get off the ground. Use leaves, bags or clothes under you.', 'Keep clothes dry. Wet clothes steal heat. In heat, cover skin and head.', 'Stay out of dry river beds in rain and away from lone tall trees in storms.']],
    ['Flood and storm', ['Never walk or drive through moving water. 15 cm can knock you over.', 'Go up, to a strong building or high ground. Switch off power if water is near.', 'Keep phone, ID and medicine in a sealed bag.', 'Lightning: crouch low on the balls of your feet, away from trees, water and metal.']],
    ['Fire and smoke', ['Stay low, the cleanest air is near the floor. Cover nose and mouth with wet cloth.', 'Feel doors with the back of your hand. Hot means do not open.', 'Get out, stay out, then call 999. Never go back for things.', 'If clothes catch fire: stop, drop, cover face and roll.']],
    ['Earthquake', ['Drop, cover, hold on under a strong table. Stay away from windows.', 'Outside: move away from buildings, wires and trees.', 'After: expect aftershocks. Leave damaged buildings and check gas smell.']],
    ['First aid basics', ['Bleeding: press hard with clean cloth and keep pressing. Raise the limb. Do not remove soaked cloth, add more.', 'Burns: cool with clean running water for 10 minutes. No ice, no oil, no toothpaste.', 'Not breathing and unresponsive: call for help, push hard and fast in the centre of the chest, 100 to 120 per minute.', 'Snake bite: keep still and calm, keep the limb low, remove rings, get to hospital. Do not cut or suck.', 'This is basic guidance. Real training saves lives, take a first aid course.']],
    ['Lost or stranded', ['Stop, Think, Observe, Plan. Panic wastes energy.', 'Follow running water downhill, it usually leads to people.', 'Mark your path. Keep a fixed point in view.', 'If in a vehicle, stay with it. It is easier to find than you.']]
  ];

  function status(el) {
    var p = host.perms ? host.perms() : {};
    var r = host.act('where', '', '');
    var m = String((r && r.msg) || '');
    if (!p.loc && /permission/i.test(m)) { el.innerHTML = 'Location is not allowed yet.'; return; }
    var mm = /Phone location: ([-\d.]+,[-\d.]+) \(accuracy (\d+) m, (\d+) s ago\)/.exec(m);
    if (mm) { el.dataset.ll = mm[1]; el.innerHTML = '<b style="color:var(--ok)">' + esc(mm[1]) + '</b><br><small>accuracy ' + esc(mm[2]) + ' m · ' + esc(mm[3]) + ' s ago</small>'; }
    else el.innerHTML = esc(m.replace(/ Battery.*$/, '') || 'Searching for a fix…');
  }

  function strobe() {
    if (strobeEl) { stopStrobe(); return; }
    strobeEl = h('div'); strobeEl.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;display:flex;align-items:flex-end;justify-content:center;padding-bottom:40px;color:#000;font:700 16px sans-serif';
    strobeEl.textContent = 'TAP ANYWHERE TO STOP'; document.body.appendChild(strobeEl);
    var on = true; strobeEl.timer = setInterval(function () { on = !on; strobeEl.style.background = on ? '#fff' : '#000'; strobeEl.style.color = on ? '#000' : '#fff'; }, 180);
    strobeEl.addEventListener('click', stopStrobe);
  }
  function stopStrobe() { if (strobeEl) { clearInterval(strobeEl.timer); strobeEl.remove(); strobeEl = null; } }

  function build() {
    var b = P.body; b.innerHTML = '';
    var ban = h('div', 'card'); ban.style.cssText = 'border-color:var(--bad);padding:14px';
    ban.innerHTML = '<b style="color:var(--bad);letter-spacing:.16em">EMERGENCY MODE</b><br><span style="color:var(--mute);font-size:14px">Everything here works with no internet and uses no AI. If you are in danger, call <b>999</b> or <b>112</b> first.</span>';
    var call = grid(2); call.appendChild(btn('CALL 999', function () { host.confirm('Call 999 now?', function () { host.act('call', '999', ''); }); }, 'danger')); call.appendChild(btn('CALL 112', function () { host.confirm('Call 112 now?', function () { host.act('call', '112', ''); }); }, 'danger')); ban.appendChild(call); b.appendChild(ban);

    b.appendChild(head('MAKE NOISE'));
    var g1 = grid(2);
    g1.appendChild(btn('LOUD SIREN', function () { var r = host.act('emsound', 'siren', ''); host.toast(r.msg, 3500); }, 'pri'));
    g1.appendChild(btn('SURVIVAL WHISTLE', function () { var r = host.act('emsound', 'whistle', ''); host.toast(r.msg, 3500); }, 'pri'));
    b.appendChild(g1); b.appendChild(btn('STOP ALL SIGNALS', function () { host.act('emstop', '', ''); stopStrobe(); host.toast('All signals off', 2000); }, 'danger'));
    b.appendChild(note('The alarm plays at full volume even if the phone is silent, then stops by itself after 5 minutes. The whistle gives 3 sharp blasts, the world distress call. The same siren is used by Find my phone.'));

    b.appendChild(head('LIGHT SIGNALS'));
    var g2 = grid(2);
    g2.appendChild(btn('SOS FLASHLIGHT', function () { var r = host.act('morse', 'sos', ''); host.toast(r.msg, 3500); }, 'pri'));
    g2.appendChild(btn('SCREEN STROBE', strobe, 'pri'));
    b.appendChild(g2);
    var tx = h('textarea'); tx.placeholder = 'Type a message to send in Morse'; tx.style.cssText = 'width:100%;min-height:60px;margin-top:8px'; var lab = h('label', 'fld'); lab.appendChild(h('span', '', 'MORSE MESSAGE')); lab.appendChild(tx); b.appendChild(lab);
    var mo = h('div'); mo.style.cssText = 'font-family:monospace;color:var(--cy2);word-break:break-word;margin:6px 0;min-height:22px'; b.appendChild(mo);
    tx.addEventListener('input', function () { mo.textContent = window.JarvisTools ? window.JarvisTools.toMorse(tx.value) : ''; });
    var g3 = grid(2);
    g3.appendChild(btn('FLASH IT', function () { var m = window.JarvisTools ? window.JarvisTools.toMorse(tx.value) : ''; if (!m) { host.toast('Type something first', 2000); return; } var r = host.act('morse', m, ''); host.toast(r.msg, 3500); }, 'pri'));
    g3.appendChild(btn('FLASH AGAIN AND AGAIN', function () { var m = window.JarvisTools ? window.JarvisTools.toMorse(tx.value) : ''; if (!m) { host.toast('Type something first', 2000); return; } var r = host.act('morse', m, 'loop'); host.toast(r.msg, 3500); }));
    b.appendChild(g3); b.appendChild(btn('STOP FLASHING', function () { host.act('morse', 'stop', ''); }));
    b.appendChild(note('The flashlight is built for this and it is safe. A single message ends by itself; repeats stop after 10 minutes or when you tap STOP, so the LED never overheats. Stay away from people’s eyes at close range.'));

    b.appendChild(head('MY LOCATION'));
    var loc = h('div', 'card'); loc.style.cssText = 'padding:12px;word-break:break-word'; loc.textContent = 'Tap UPDATE to find your position.'; b.appendChild(loc);
    var g4 = grid(2);
    g4.appendChild(btn('UPDATE', function () { var p = host.perms ? host.perms() : {}; if (!p.loc) { host.requestLocation(); host.toast('Allow location, then tap UPDATE again', 4000); return; } loc.textContent = 'Searching…'; status(loc); }, 'pri'));
    g4.appendChild(btn('OPEN MAP', function () { var ll = loc.dataset.ll; if (ll) host.act('map', ll, ''); else host.toast('Tap UPDATE first', 2000); }));
    b.appendChild(g4);
    var num = h('input'); num.type = 'tel'; num.placeholder = 'Phone number, or a contact name'; var nl = h('label', 'fld'); nl.appendChild(h('span', '', 'TEXT MY LOCATION TO')); nl.appendChild(num); b.appendChild(nl);
    function msg() { var ll = loc.dataset.ll; return ll ? 'I need help. My location: https://maps.google.com/?q=' + ll : ''; }
    var g5 = grid(2);
    g5.appendChild(btn('WRITE THE TEXT', function () { var m = msg(); if (!m) { host.toast('Tap UPDATE first to get a fix', 2500); return; } var r = host.act('sms', num.value.trim(), m); host.toast(r.msg, 4000); }, 'pri'));
    g5.appendChild(btn('COPY / SEND TO PC', function () { var m = msg(); if (!m) { host.toast('Tap UPDATE first to get a fix', 2500); return; } host.copy(m); if (host.shareToPc) host.shareToPc(m); }));
    b.appendChild(g5);
    b.appendChild(note('Jarvis opens the message ready for you. You tap send, nothing goes out by itself. The same position can be seen from your PC (Device Link, Phone, PHONE LOCATION).'));

    b.appendChild(head('MY EMERGENCY CARD'));
    var card = h('textarea'); card.placeholder = 'Blood group, allergies, medicines, emergency contact. Stays on this phone only.'; card.style.cssText = 'width:100%;min-height:90px';
    try { card.value = host.store.get('emcard') || ''; } catch (e) { /* */ }
    card.addEventListener('input', function () { try { host.store.set('emcard', card.value.slice(0, 600)); } catch (e) { /* */ } });
    var cl = h('label', 'fld'); cl.appendChild(h('span', '', 'NOTES FOR RESCUERS')); cl.appendChild(card); b.appendChild(cl);
    b.appendChild(btn('SHOW BIG ON SCREEN', function () { var t = card.value.trim() || 'No details saved yet.'; var o = h('div'); o.style.cssText = 'position:fixed;inset:0;z-index:99998;background:#fff;color:#000;padding:28px 22px;font:600 22px/1.4 sans-serif;white-space:pre-wrap;overflow:auto'; o.textContent = t + '\n\n(tap to close)'; o.addEventListener('click', function () { o.remove(); }); document.body.appendChild(o); }));

    b.appendChild(head('SAVE THE BATTERY'));
    b.appendChild(btn('OPEN BATTERY SAVER', function () { host.act('settings', 'batterysaver', ''); }));
    b.appendChild(head('SURVIVAL GUIDE'));
    TIPS.forEach(function (t) {
      var d = h('details', 'man'); d.appendChild(h('summary', '', esc(t[0])));
      var body = h('div', 'manb'); body.innerHTML = '<ul style="margin:8px 0 0 18px;line-height:1.5">' + t[1].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; d.appendChild(body); b.appendChild(d);
    });
    b.appendChild(note('General guidance only. In real danger, call emergency services.'));
  }

  window.JarvisEmergency = {
    init: function (h0) { host = h0; P = host.panel; var c = P.close; P.close = function () { stopStrobe(); c(); }; return this; },
    open: function () { if (!built) { build(); built = true; } P.open(); }
  };
})();
