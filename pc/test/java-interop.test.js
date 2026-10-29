'use strict';
// Proves the Android link core (Java) and the PC relay (Node) speak the same protocol.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawn } = require('child_process');
const proto = require('../src/main/link-protocol');
const { Relay } = require('../src/main/relay');
const fake = require('./fake-rtdb');

const SRC = path.join(__dirname, '..', '..', 'src', 'com', 'suchock', 'jarvis');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'jlink-'));
let haveJava = true;
try {
  execFileSync('javac', ['-J-Dfile.encoding=UTF-8', '--release', '8', '-Xlint:-options', '-d', OUT, ...['LinkJson', 'LinkCore', 'LinkClient'].map((f) => path.join(SRC, f + '.java')), path.join(__dirname, 'java', 'LinkTest.java')], { stdio: 'pipe' });
} catch (e) { haveJava = false; }
const java = (...args) => execFileSync('java', ['-Dfile.encoding=UTF-8', '-cp', OUT, 'com.suchock.jarvis.LinkTest', ...args], { encoding: 'utf8', env: { ...process.env, JAVA_TOOL_OPTIONS: '' } }).trim();

test('java: pairing code, room id and key derivation match node', { skip: !haveJava }, () => {
  const secret = proto.newSecret();
  assert.strictEqual(java('room', secret), proto.derive(secret).room);
  const code = proto.makeCode('https://demo-default-rtdb.firebaseio.com', secret);
  assert.strictEqual(java('code', code), 'https://demo-default-rtdb.firebaseio.com ' + secret + ' true');
});

test('java encrypts -> node decrypts (unicode, quotes, backslashes)', { skip: !haveJava }, () => {
  const secret = proto.newSecret();
  const env = java('encrypt', secret, 'pc');
  const m = proto.open(proto.derive(secret).key, JSON.parse(env), 'pc');
  assert.ok(m, 'node could not open the java envelope');
  assert.strictEqual(m.type, 'open');
  assert.strictEqual(m.arg, 'café "quoted" \\ 中文');
  assert.strictEqual(proto.open(proto.derive(secret).key, JSON.parse(env), 'phone'), null, 'direction binding');
});

test('node encrypts -> java decrypts', { skip: !haveJava }, () => {
  const secret = proto.newSecret(), d = proto.derive(secret);
  const msg = { id: 'n1', ts: Date.now(), from: 'pc', k: 'cmd', type: 'open', arg: 'émoji 😀 ünï', arg2: '' };
  const env = JSON.stringify(proto.seal(d.key, msg, 'phone'));
  assert.deepStrictEqual(JSON.parse(java('decrypt', secret, 'phone', env)), msg);
  assert.strictEqual(java('decrypt', secret, 'pc', env), 'NULL');
  assert.strictEqual(java('decrypt', proto.newSecret(), 'phone', env), 'NULL');
});

test('live: java "phone" client <-> node "pc" relay through the fake database', { skip: !haveJava }, async () => {
  const db = await fake.start();
  const secret = proto.newSecret();
  const got = [];
  const pc = new Relay(() => ({ enabled: true, dbUrl: db.url, secret }), async (c) => { got.push(c); return { ok: true, msg: 'pc opened ' + c.arg }; }, { me: 'pc', peer: 'phone' });
  pc.start();
  const child = spawn('java', ['-Dfile.encoding=UTF-8', '-cp', OUT, 'com.suchock.jarvis.LinkTest', 'phone', db.url, secret], { env: { ...process.env, JAVA_TOOL_OPTIONS: '' } });
  let out = '';
  child.stdout.on('data', (b) => (out += b));
  await new Promise((resolve) => { const t = setInterval(() => { if (out.includes('READY')) { clearInterval(t); resolve(); } }, 100); });
  const toPhone = await pc.send('torch', 'on', '', 8000);          // pc -> java
  await new Promise((r) => child.on('exit', r));
  assert.match(out, /JAVA_CONNECTED true/);
  assert.match(out, /JAVA_SEND true pc opened notepad/);          // java -> node -> answer
  assert.match(out, /JAVA_PING true/);
  assert.match(out, /JAVA_GOT torch on/);
  assert.deepStrictEqual(toPhone, { ok: true, msg: 'java handled torch' });
  assert.deepStrictEqual(got, [{ type: 'open', arg: 'notepad', arg2: '' }]);
  assert.ok(!JSON.stringify(db.data).includes('notepad'));
  pc.stop(); await db.close();
});
