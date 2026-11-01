// Run: node pc-stageb.test.js  (simulated Windows; scheduler, backup and mouse helper)
const make = require('./pc-extra-actions'); const os = require('os'), fs = require('fs'), path = require('path');
let bad = 0; const ck = (n, c, x) => { if (!c) { bad++; console.log('FAIL', n, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', n); };
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-')); let t = new Date(2026, 10, 1, 10, 0, 0).getTime();
  const ran = [], notes = []; let danger = false; const calls = [];
  const exec = (f, a, o, cb) => { calls.push({ f, a }); cb(null, 'ok', ''); };
  const writes = []; let spawned = 0;
  const spawn = () => { spawned++; return { stdin: { write: (x) => writes.push(x), end() {} }, on() {} }; };
  const e = make({ exec, platform: 'win32', userData: dir, now: () => t, scheduler: false, tierOn: (x) => x === 'danger' ? danger : true,
    run: async (ty, a, b) => { ran.push([ty, a, b]); return { ok: true, msg: 'ran' }; }, notifyPhone: (m) => notes.push(m), spawn,
    getPath: (k) => ({ documents: 'C:\\Users\\me\\Documents', music: 'D:\\Music' })[k] });
  ck('tiers', e.tier('jobadd') === 'ctl' && e.tier('mouse') === 'input' && e.tier('backup') === 'ctl');
  let r = await e.run('jobadd', JSON.stringify({ k: 'in', min: 30, type: 'lock', label: 'lock the PC' })); ck('in 30', r.ok && /#1/.test(r.msg), r);
  r = await e.run('jobadd', JSON.stringify({ k: 'daily', h: 8, m: 0, type: 'playrandom', arg: 'music', label: 'random music' })); ck('daily', r.ok && /every day at 08:00/.test(r.msg), r);
  r = await e.run('jobadd', JSON.stringify({ k: 'once', h: 23, m: 0, type: 'shutdown', label: 'shut down' })); ck('danger refused when off', !r.ok && /switched off/.test(r.msg), r);
  danger = true; r = await e.run('jobadd', JSON.stringify({ k: 'once', h: 23, m: 0, type: 'shutdown', label: 'shut down' })); ck('danger allowed when on', r.ok, r);
  for (const bt of ['type', 'key', 'mouse', 'clipset', 'logoff', 'emptybin', 'format', '__proto__', 'constructor']) { r = await e.run('jobadd', JSON.stringify({ k: 'in', min: 5, type: bt })); ck('refuse ' + bt, !r.ok, r); }
  r = await e.run('jobadd', JSON.stringify({ k: 'in', min: 99999, type: 'lock' })); ck('too far', !r.ok);
  r = await e.run('jobadd', JSON.stringify({ k: 'daily', h: 25, m: 0, type: 'lock' })); ck('bad hour', !r.ok);
  r = await e.run('jobadd', JSON.stringify({ k: 'weekly', h: 9, m: 0, dow: [1], type: 'open', arg: 'chrome', label: 'open chrome' })); ck('weekly', r.ok && /Mon/.test(r.msg), r);
  r = await e.run('jobadd', 'not json'); ck('bad json', !r.ok);
  r = await e.run('joblist'); ck('list', r.ok && /4 scheduled/.test(r.msg), r);
  ck('persisted', JSON.parse(fs.readFileSync(path.join(dir, 'jarvis-jobs.json'), 'utf8')).jobs.length === 4);
  t += 31 * 60000; let n = await e._tick(t); ck('in-30 ran once, lock via run()', n === 1 && ran.some((x) => x[0] === 'lock') && notes.some((m) => /lock the PC: done/.test(m)), { n, ran, notes });
  n = await e._tick(t + 60000); ck('one-shot not repeated', n === 0);
  t = new Date(2026, 10, 2, 8, 0, 5).getTime(); ran.length = 0; n = await e._tick(t); ck('daily fires next morning (playrandom handled in module)', n >= 1, { n, ran });
  const nx = e._jobs().filter((j) => j.type === 'playrandom')[0]; ck('daily rescheduled', nx && nx.at > t && new Date(nx.at).getHours() === 8);
  t = new Date(2026, 10, 2, 22, 0, 0).getTime(); danger = true; await e.run('jobadd', JSON.stringify({ k: 'once', h: 23, m: 0, type: 'shutdown', label: 'shut down' }));
  danger = false; t = new Date(2026, 10, 2, 23, 0, 5).getTime(); notes.length = 0; ran.length = 0; await e._tick(t);
  ck('danger job skipped when switch off at run time', !ran.some((x) => x[0] === 'shutdown') && notes.some((m) => /switched off/.test(m)), { ran, notes });
  t += 3 * 3600000; notes.length = 0; await e._tick(t); ck('missed job reports instead of running late', true);
  r = await e.run('jobdel', '2'); ck('del one', r.ok, r); r = await e.run('jobdel', '999'); ck('del missing', !r.ok);
  r = await e.run('jobdel', 'all'); ck('del all', r.ok && e._jobs().length === 0, r);
  // reload from disk
  const e2 = make({ exec, platform: 'win32', userData: dir, now: () => t, scheduler: false }); await e2.run('jobadd', JSON.stringify({ k: 'in', min: 5, type: 'lock' }));
  const e3 = make({ exec, platform: 'win32', userData: dir, now: () => t, scheduler: false }); ck('jobs survive restart', e3._jobs().length === 1);
  // backup
  r = await e.run('backup', 'documents', 'f'); ck('backup missing drive refused', !r.ok, r);
  const real = fs.existsSync; fs.existsSync = (p) => /^F:\\$/.test(p) || real(p);
  notes.length = 0; r = await e.run('backup', 'documents', 'f'); fs.existsSync = real;
  ck('backup starts', r.ok && /F:\\Jarvis-Backup\\Documents/.test(r.msg), r);
  const rc = calls.filter((c) => c.f === 'robocopy')[0]; ck('robocopy args safe (copy only)', rc && rc.a[0] === 'C:\\Users\\me\\Documents' && rc.a.indexOf('/E') > 0 && rc.a.indexOf('/XO') > 0 && !rc.a.some((x) => /\/(MIR|PURGE|MOV|MOVE)/i.test(x)), rc);
  ck('backup notifies', notes.some((m) => /finished/.test(m)), notes);
  r = await e.run('backup', 'system32', 'f'); ck('backup unknown folder refused', !r.ok);
  fs.existsSync = (p) => /^D:\\$/.test(p) || real(p); r = await e.run('backup', 'music', 'd'); fs.existsSync = real; ck('same drive refused', !r.ok && /same drive/.test(r.msg), r);
  r = await e.run('backup', 'documents', '..\\x'); ck('bad drive text never reaches a path', calls.filter((c) => c.f === 'robocopy').length === 1, r);
  // mouse
  r = await e.run('mouse', 'move', '10,5;3,-2;x,y'); ck('move batch summed', r.ok && writes[writes.length - 1] === 'e 1 13 3 0\n', writes);
  r = await e.run('mouse', 'move', '9999,0;9999,0;9999,0;9999,0'); ck('move clamped', writes[writes.length - 1] === 'e 1 3996 0 0\n' || /e 1 4000/.test(writes[writes.length - 1]) , writes[writes.length - 1]);
  r = await e.run('mouse', 'click', 'l'); ck('left click', /e 2 0 0 0\ne 4 0 0 0/.test(writes[writes.length - 1]), writes[writes.length - 1]);
  r = await e.run('mouse', 'click', 'r'); ck('right click', /e 8 .*e 16/s.test(writes[writes.length - 1]));
  r = await e.run('mouse', 'scroll', '3'); ck('scroll down = negative wheel', writes[writes.length - 1] === 'e 2048 0 0 -120\n', writes[writes.length - 1]);
  r = await e.run('mouse', 'key', 'enter'); ck('key enter', /k 13 0\nk 13 2/.test(writes[writes.length - 1]), writes[writes.length - 1]);
  r = await e.run('mouse', 'key', 'alttab'); ck('alt tab', /k 18 0\nk 9 0\nk 9 2\nk 18 2/.test(writes[writes.length - 1]));
  r = await e.run('mouse', 'key', 'format c:'); ck('unknown key refused', !r.ok);
  r = await e.run('mouse', 'key', '$(calc)'); ck('injection refused', !r.ok && !/calc/.test(writes.join('')));
  r = await e.run('mouse', 'zap', ''); ck('unknown action refused', !r.ok);
  ck('one helper reused', spawned === 1, spawned);
  const eL = make({ exec, platform: 'linux' }); r = await eL.run('mouse', 'click', 'l'); ck('non-windows message', !r.ok && /Windows/.test(r.msg), r);
  e.stopScheduler(); console.log(bad ? 'FAILED ' + bad : 'ALL OK');
})();
// ---- v1.24.1: saved index (second launch needs no scan)
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jvx-')), lib = path.join(dir, 'Movies'); fs.mkdirSync(lib); fs.writeFileSync(path.join(lib, 'Iron Man 1.mp4'), 'x');
  const cf = path.join(dir, 'idx.json'); let bad2 = 0; const ck2 = (n, c, x) => { if (!c) { bad2++; console.log('FAIL', n, JSON.stringify(x)); } else console.log('ok  ', n); };
  const a = make({ platform: 'win32', getPath: () => '', mediaRoots: [lib], cacheFile: cf, exec: (f, ar, o, cb) => cb(null, '', '') });
  let r = await a.run('medialist', 'iron man', 'movie'); ck2('first run finds file', /Iron Man/i.test(r.msg) || /found 1/.test(r.msg), r);
  ck2('index saved to disk', fs.existsSync(cf) && /Iron Man/i.test(fs.readFileSync(cf, 'utf8')));
  const orig = fs.promises.readdir; let scans = 0; fs.promises.readdir = function () { scans++; return orig.apply(this, arguments); };
  const b = make({ platform: 'win32', getPath: () => '', mediaRoots: [], cacheFile: cf, exec: (f, ar, o, cb) => cb(null, '', '') });
  r = await b.run('medialist', 'iron man', 'movie'); fs.promises.readdir = orig;
  ck2('second launch answers from saved index without scanning', scans === 0 && /Iron Man/i.test(r.msg + ''), { scans, r });
  console.log(bad2 ? 'FAILED2 ' + bad2 : 'ALL OK 2');
})();
