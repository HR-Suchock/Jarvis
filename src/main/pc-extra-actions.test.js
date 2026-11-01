// Run: node pc-extra-actions.test.js   (uses a simulated PowerShell; real Windows behaviour must still be checked on the PC)
const make = require('./pc-extra-actions');
let bad = 0; const ck = (n, c, x) => { if (!c) { bad++; console.log('FAIL', n, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', n); };
(async () => {
  const calls = [];
  const exec = (file, args, opts, cb) => { calls.push({ file, args, env: opts.env }); const s = args[args.length - 1] || '';
    let out = ''; if (/Win32_Battery/.test(s)) out = '88% (charging)'; else if (/Get-PSDrive/.test(s)) out = 'C: 120 GB free of 476 GB'; else if (/MainWindowTitle/.test(s)) out = 'chrome\ncode\nspotify'; else if (/WmiSetBrightness/.test(s)) out = opts.env.JARVIS_LEVEL || '65'; else if (/AppsUseLightTheme/.test(s)) out = opts.env.JARVIS_MODE === 'off' ? 'light' : 'dark'; else out = 'ok';
    cb(null, out, ''); };
  const clipboard = { t: '', writeText(x) { this.t = x; }, readText() { return this.t; } };
  const opened = []; const shell = { openExternal: async (u) => { opened.push(u); } };
  const e = make({ exec, platform: 'win32', clipboard, shell });
  ck('handles known', ['pcinfo','brightness','darkmode','settingspage','clipset','clipget','pckey','logoff','emptybin'].every(t => e.handles(t)));
  ck('rejects unknown', !e.handles('format') && !e.handles('__proto__') && !e.handles('constructor'));
  ck('tiers', e.tier('pcinfo') === 'ctl' && e.tier('pckey') === 'input' && e.tier('clipget') === 'input' && e.tier('logoff') === 'danger' && e.tier('emptybin') === 'danger' && e.tier('x') === null);
  let r = await e.run('pcinfo', 'cpu'); ck('cpu', r.ok && /processor is at \d+%/.test(r.msg), r);
  r = await e.run('pcinfo', 'memory'); ck('memory', r.ok && /memory used/.test(r.msg), r);
  r = await e.run('pcinfo', 'uptime'); ck('uptime', r.ok && /been on for/.test(r.msg), r);
  r = await e.run('pcinfo', 'battery'); ck('battery', r.ok && /88%/.test(r.msg), r);
  r = await e.run('pcinfo', 'disk'); ck('disk', r.ok && /120 GB free/.test(r.msg), r);
  r = await e.run('pcinfo', 'apps'); ck('apps', r.ok && /chrome, code, spotify/.test(r.msg), r);
  r = await e.run('pcinfo', 'status'); ck('status', r.ok && /Processor/.test(r.msg) && /battery/.test(r.msg), r);
  r = await e.run('pcinfo', 'bogus'); ck('bad report refused', !r.ok);
  r = await e.run('brightness', 'up'); ck('brightness up', r.ok && calls[calls.length - 1].env.JARVIS_DELTA === '15', r);
  r = await e.run('brightness', 'down'); ck('brightness down', r.ok && calls[calls.length - 1].env.JARVIS_DELTA === '-15', r);
  r = await e.run('brightness', '40'); ck('brightness 40', r.ok && calls[calls.length - 1].env.JARVIS_LEVEL === '40' && /40%/.test(r.msg), r);
  for (const bad2 of ['101', '-5', '4;calc', 'abc', '']) { r = await e.run('brightness', bad2); ck('brightness refuses ' + JSON.stringify(bad2), !r.ok); }
  const before = calls.length; await e.run('brightness', '1; Remove-Item C:\\ -Recurse'); ck('no script ran for injection attempt', calls.length === before);
  r = await e.run('darkmode', 'on'); ck('dark on', r.ok && /dark/.test(r.msg), r);
  r = await e.run('darkmode', 'off'); ck('dark off', r.ok && /light/.test(r.msg), r);
  r = await e.run('darkmode', 'x'); ck('dark refuses', !r.ok);
  r = await e.run('settingspage', 'wifi'); ck('settings wifi', r.ok && opened[0] === 'ms-settings:network-wifi', opened);
  r = await e.run('settingspage', 'c:\\windows\\system32\\cmd.exe'); ck('settings refuses arbitrary', !r.ok && opened.length === 1);
  r = await e.run('clipset', 'hello world; rm -rf'); ck('clip set', r.ok && clipboard.t === 'hello world; rm -rf');
  r = await e.run('clipget'); ck('clip get', r.ok && /hello world/.test(r.msg), r);
  r = await e.run('clipset', ''); ck('clip empty refused', !r.ok);
  for (const k of Object.keys(e.KEYS)) { const rr = await e.run('pckey', k); ck('key ' + k, rr.ok && calls[calls.length - 1].env.JARVIS_KEYS === e.KEYS[k].join(','), rr); }
  r = await e.run('pckey', 'format c'); ck('key refuses unknown', !r.ok);
  r = await e.run('logoff'); ck('logoff', r.ok && calls[calls.length - 1].file === 'shutdown.exe' && calls[calls.length - 1].args.join() === '/l', calls[calls.length - 1]);
  r = await e.run('emptybin'); ck('emptybin', r.ok && /Recycle/.test(r.msg), r);
  r = await e.run('nonsense'); ck('unknown action', !r.ok);
  // scripts never contain user text
  ck('user text only via env', calls.every(c => !/hello world|Remove-Item/.test(c.args.join(' '))));
  // not windows
  const l = make({ exec, platform: 'linux' }); r = await l.run('pckey', 'refresh'); ck('non-windows message', !r.ok && /only works on Windows/.test(r.msg), r);
  // ---- v1.23.0
  r = await e.run('pcinfo', 'time'); ck('time', r.ok && /epoch \d{10,}/.test(r.msg), r);
  r = await e.run('pclink', 'https://example.com/a?b=1'); ck('pclink opens', r.ok && opened[opened.length - 1] === 'https://example.com/a?b=1', r);
  r = await e.run('pclink', 'javascript:alert(1)'); ck('pclink refuses non-http', !r.ok, r);
  r = await e.run('pclink', 'file:///c:/windows/system32/cmd.exe'); ck('pclink refuses file:', !r.ok, r);
  r = await e.run('pclink', 'https://a.com/ & calc'); ck('pclink refuses spaces', !r.ok, r);
  ck('v1.23 tiers', e.tier('pclink') === 'ctl' && e.tier('wolsetup') === 'ctl' && e.handles('wolsetup'));
  r = await e.run('wolsetup'); ck('wolsetup answers', typeof r.msg === 'string' && r.msg.length > 10, r);
  console.log('bad', bad); process.exit(bad ? 1 : 0);
})();
