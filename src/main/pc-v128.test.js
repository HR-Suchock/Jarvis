
'use strict';
const assert = require('assert');
const make = require('./pc-extra-actions.js');
let bad = 0; const ck = (n, c, x) => { console.log((c ? 'ok   ' : 'FAIL ') + n + (c ? '' : ' ' + JSON.stringify(x))); if (!c) bad++; };
(async () => {
  const saved = [];
  const x = make({ platform: 'win32', saveFile: (n, m, d) => { saved.push([n, m, d.length]); return { ok: true, msg: 'Saved ' + n }; },
    exec: (cmd, args, o, cb) => { if (cmd === 'tasklist') cb(null, '"chrome.exe","1","Console","1","900,000 K"\r\n"chrome.exe","2","Console","1","300,000 K"\r\n"code.exe","3","Console","1","200,000 K"\r\n'); else if (cmd === 'netsh') cb(null, '    SSID                   : Home Net\r\n    Signal                 : 91%\r\n'); else cb(null, '', ''); } });
  ck('tiers', x.TIER.procs === 'ctl' && x.TIER.cleantemp === 'danger' && x.TIER.filepart === 'ctl' && x.TIER.netinfo === 'ctl', x.TIER);
  let r = await x.run('procs'); ck('procs lists biggest first', r.ok && /chrome 1\.1 GB, code 195 MB/.test(r.msg), r);
  r = await x.run('netinfo'); ck('netinfo shows wifi', r.ok && /Home Net/.test(r.msg) && /91%/.test(r.msg), r);
  const b64 = (n) => Buffer.alloc(n, 7).toString('base64');
  const meta = (i, n, size, name, mime) => JSON.stringify({ id: 'abcd1234', i, n, size, name: name || 'photo.jpg', mime: mime || 'image/jpeg' });
  r = await x.run('filepart', meta(0, 2, 100), b64(60)); ck('first piece ok', r.ok, r);
  r = await x.run('filepart', meta(1, 2, 100), b64(40)); ck('last piece saves the file', r.ok && saved.length === 1 && saved[0][0] === 'photo.jpg' && saved[0][2] === 100, { r, saved });
  r = await x.run('filepart', meta(1, 2, 100), b64(40)); ck('piece without start refused', !r.ok, r);
  r = await x.run('filepart', meta(0, 1, 10, 'virus.exe', 'application/octet-stream'), b64(10)); ck('program files refused', !r.ok && /do not accept/.test(r.msg), r);
  r = await x.run('filepart', meta(0, 1, 10, '..\\..\\Windows\\evil.txt', 'text/plain'), b64(10)); ck('path in name is cleaned', r.ok && saved[1][0] === 'evil.txt', { r, saved });
  r = await x.run('filepart', meta(0, 1, 4000000, 'big.bin'), b64(10)); ck('over 3 MB refused', !r.ok, r);
  r = await x.run('filepart', meta(0, 2, 100), b64(60)); r = await x.run('filepart', meta(1, 2, 100), b64(50)); ck('oversized pieces refused', !r.ok, r);
  r = await x.run('filepart', meta(0, 2, 100), b64(60)); r = await x.run('filepart', meta(1, 2, 100), b64(30)); ck('incomplete file refused', !r.ok, r);
  const lin = make({ platform: 'linux' }); r = await lin.run('procs'); ck('windows-only tools say so', !r.ok, r);
  console.log('bad', bad); process.exit(bad ? 1 : 0);
})();
