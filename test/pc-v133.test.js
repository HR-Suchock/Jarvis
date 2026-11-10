'use strict';
const make = require('../src/main/pc-extra-actions.js');
let bad = 0; const ck = (n, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x))); if (!c) bad++; };
(async () => {
  const writes = [], scripts = [];
  let ytOut = 'OK', focused = false;
  const exec = (f, a, o, cb) => { const sc = a[a.length - 1]; scripts.push({ sc, env: o && o.env }); cb(null, /clickname|UIAutomation/.test(sc) ? 'OK' : ytOut, ''); };
  const spawn = () => ({ stdin: { write: (x) => writes.push(x), end() {} }, on() {} });
  const x = make({ exec, platform: 'win32', spawn, jarvisFocused: () => focused, shell: { openExternal: async () => { scripts.push({ opened: true }); } } });
  ck('tiers', x.TIER.ytkey === 'input' && x.TIER.clickname === 'input' && x.TIER.focusapp === 'ctl', x.TIER);
  // ---- combos
  let r = await x.run('mouse', 'combo', 'ctrl+shift+alt+t');
  ck('ctrl+shift+alt+t pressed in order, released in reverse', r.ok && writes[writes.length - 1] === ['k 17 0', 'k 16 0', 'k 18 0', 'k 84 0', 'k 84 2', 'k 18 2', 'k 16 2', 'k 17 2'].join('\n') + '\n', writes[writes.length - 1]);
  ck('label', /Ctrl\+Shift\+Alt\+T/.test(r.msg), r);
  r = await x.run('mouse', 'combo', 'alt+f4'); ck('alt+f4', r.ok && /k 115 0\nk 115 2/.test(writes[writes.length - 1]), writes[writes.length - 1]);
  r = await x.run('mouse', 'combo', 'win+left'); ck('arrows are extended keys', r.ok && /k 37 1\nk 37 3/.test(writes[writes.length - 1]), writes[writes.length - 1]);
  r = await x.run('mouse', 'combo', 'win'); ck('modifier alone', r.ok && writes[writes.length - 1] === 'k 91 0\nk 91 2\n', writes[writes.length - 1]);
  r = await x.run('mouse', 'combo', 'ctrl+a+b'); ck('two main keys refused', !r.ok, r);
  r = await x.run('mouse', 'combo', 'ctrl+banana'); ck('unknown key refused', !r.ok, r);
  r = await x.run('mouse', 'combo', ''); ck('empty refused', !r.ok, r);
  r = await x.run('mouse', 'combo', 'ctrl+shift+alt+win+ctrl+t+x+y'); ck('too long refused', !r.ok, r);
  r = await x.run('mouse', 'combo', 'ctrl+f12'); ck('function keys', r.ok && /k 123 0/.test(writes[writes.length - 1]), writes[writes.length - 1]);
  // ---- same-tab YouTube: only after Jarvis opened one
  const n0 = scripts.length;
  r = await x.run('ytkey', 'fwd10');
  ck('ytkey sends keys through PowerShell', scripts.length > n0 && /JARVIS_YT/.test(scripts[scripts.length - 1].sc) && scripts[scripts.length - 1].env.JARVIS_YT === 'l', scripts[scripts.length - 1]);
  ytOut = 'NONE'; r = await x.run('ytkey', 'mute'); ck('no tab -> honest message', !r.ok && /no YouTube tab|YouTube/.test(r.msg), r);
  r = await x.run('ytkey', 'nonsense'); ck('unknown key refused', !r.ok, r);
  ytOut = 'OK';
  // ---- clickname / focusapp
  r = await x.run('clickname', 'Skip'); ck('click by name', r.ok && /Clicked Skip/.test(r.msg), r);
  ck('name passed by env, not in the script text', scripts[scripts.length - 1].env.JARVIS_NAME === 'Skip' && !/"Skip"/.test(scripts[scripts.length - 1].sc.replace(/Skip/g, '')), 1);
  r = await x.run('clickname', 'a\nb'); ck('control chars refused', !r.ok, r);
  r = await x.run('focusapp', 'chrome; calc'); ck('shell characters refused', !r.ok, r);
  r = await x.run('focusapp', 'spotify'); ck('focus app runs', scripts[scripts.length - 1].env.JARVIS_APP === 'spotify', scripts[scripts.length - 1]);
  // ---- same tab: first play opens a tab, the next one reuses it
  const sx = scripts.length; ytOut = 'OK';
  r = await x.run('ytplay', 'old hindi songs'); const opened1 = scripts.slice(sx).some((s) => s.opened);
  const sy = scripts.length;
  r = await x.run('ytplay', 'kishore kumar'); const nav = scripts.slice(sy).find((s) => s.env && s.env.JARVIS_URL);
  ck('first play opens YouTube (new tab)', opened1, scripts.slice(sx));
  ck('second play reuses the same tab (navigates, opens nothing new)', !!nav && /youtube\.com/.test(nav.env.JARVIS_URL) && !scripts.slice(sy).some((s) => s.opened) && /same/.test(r.msg), { r, nav });
  ytOut = 'NONE'; const sz = scripts.length; r = await x.run('ytplay', 'another song');
  ck('tab gone -> falls back to a new tab', scripts.slice(sz).some((s) => s.opened), scripts.slice(sz));
  // ---- Jarvis in front: step away first
  focused = true; const n1 = scripts.length;
  await x.run('mouse', 'combo', 'ctrl+c'); ck('focus leaves Jarvis before keys', scripts.length > n1 && /JW/.test(scripts[n1].sc), scripts[n1]);
  const lin = make({ platform: 'linux' }); r = await lin.run('ytkey', 'mute'); ck('windows-only', !r.ok, r);
  console.log('bad', bad); process.exit(bad ? 1 : 0);
})();
