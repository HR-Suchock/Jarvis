'use strict';
const test = require('node:test');
const assert = require('node:assert');
const proto = require('../src/main/link-protocol');
const { Relay } = require('../src/main/relay');
const fake = require('./fake-rtdb');

// The production code insists on https; the fake DB is http on localhost, so the tests build configs by hand.
const mk = (db, secret, me, peer, onCommand) =>
  new Relay(() => ({ enabled: true, dbUrl: db.url, secret }), onCommand, { me, peer });

test('pairing code round-trip and validation', () => {
  const s = proto.newSecret();
  const code = proto.makeCode('https://demo-default-rtdb.firebaseio.com', s);
  assert.deepStrictEqual(proto.parseCode(code), { dbUrl: 'https://demo-default-rtdb.firebaseio.com', secret: s });
  assert.throws(() => proto.parseCode('hello'));
  assert.throws(() => proto.parseCode(proto.makeCode('http://insecure.example.com', s)));
  assert.throws(() => proto.parseCode('JL1.' + proto.b64u.enc(JSON.stringify({ u: 'https://a.firebaseio.com', s: 'short' }))));
});

test('seal/open: wrong key, wrong direction, tampering and stale messages are rejected', () => {
  const a = proto.derive('secret-secret-secret-secret-1'), b = proto.derive('secret-secret-secret-secret-2');
  const m = { id: 'x', ts: Date.now(), from: 'phone', k: 'cmd', type: 'open', arg: 'chrome' };
  const env = proto.seal(a.key, m, 'pc');
  assert.deepStrictEqual(proto.open(a.key, env, 'pc'), m);
  assert.strictEqual(proto.open(b.key, env, 'pc'), null, 'wrong key');
  assert.strictEqual(proto.open(a.key, env, 'phone'), null, 'wrong direction (AAD)');
  const t = JSON.parse(JSON.stringify(env)); t.c = t.c.slice(0, -2) + (t.c.endsWith('AA') ? 'BB' : 'AA');
  assert.strictEqual(proto.open(a.key, t, 'pc'), null, 'tampered');
  assert.strictEqual(proto.open(a.key, proto.seal(a.key, { ...m, ts: Date.now() - 600000 }, 'pc'), 'pc'), null, 'stale');
  assert.notStrictEqual(a.room, b.room);
});

test('phone -> pc command and answer, pc -> phone command, ping', async () => {
  const db = await fake.start();
  const secret = proto.newSecret();
  const got = [];
  const pc = mk(db, secret, 'pc', 'phone', async (c) => { got.push(['pc', c]); return { ok: true, msg: 'Opened ' + c.arg + '.' }; });
  const phone = mk(db, secret, 'phone', 'pc', async (c) => { got.push(['phone', c]); return { ok: false, msg: 'nope' }; });
  pc.start(); phone.start();
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(pc.connected && phone.connected);

  assert.deepStrictEqual(await phone.send('open', 'notepad', ''), { ok: true, msg: 'Opened notepad.' });
  assert.deepStrictEqual(await pc.send('call', 'mom', ''), { ok: false, msg: 'nope' });
  assert.deepStrictEqual((await phone.ping()).ok, true);
  assert.deepStrictEqual(got, [['pc', { type: 'open', arg: 'notepad', arg2: '' }], ['phone', { type: 'call', arg: 'mom', arg2: '' }]]);

  // nothing readable is stored: the database only ever sees ciphertext
  const raw = JSON.stringify(db.data);
  assert.ok(!raw.includes('notepad') && !raw.includes('mom'), 'plaintext leaked to the database');
  // consumed messages are deleted
  await new Promise((r) => setTimeout(r, 200));
  for (const box of Object.values(db.data)) assert.strictEqual(Object.keys(box).length, 0);
  pc.stop(); phone.stop(); await db.close();
});

test('forged, foreign-room and replayed messages never execute', async () => {
  const db = await fake.start();
  const secret = proto.newSecret();
  let runs = 0;
  const pc = mk(db, secret, 'pc', 'phone', async () => { runs++; return { ok: true, msg: 'ran' }; });
  pc.start();
  await new Promise((r) => setTimeout(r, 200));
  const d = proto.derive(secret), evil = proto.derive('attacker-secret-attacker-secret');
  const post = (env) => fetch(db.url + '/jarvis/' + d.room + '/inbox/pc.json', { method: 'POST', body: JSON.stringify(env) });
  // attacker who found the room path but not the secret
  await post(proto.seal(evil.key, { id: 'a', ts: Date.now(), from: 'phone', k: 'cmd', type: 'shutdown' }, 'pc'));
  await post({ junk: true });
  // a genuine message captured earlier, replayed after it expired
  await post(proto.seal(d.key, { id: 'b', ts: Date.now() - 300000, from: 'phone', k: 'cmd', type: 'lock' }, 'pc'));
  // a genuine message addressed to the *phone* inbox, re-posted into the pc inbox
  await post(proto.seal(d.key, { id: 'c', ts: Date.now(), from: 'pc', k: 'cmd', type: 'lock' }, 'phone'));
  await new Promise((r) => setTimeout(r, 400));
  assert.strictEqual(runs, 0);
  pc.stop(); await db.close();
});

test('commands queued while the pc was offline arrive when it reconnects (if fresh)', async () => {
  const db = await fake.start();
  const secret = proto.newSecret();
  const got = [];
  const phone = mk(db, secret, 'phone', 'pc', async () => ({ ok: true, msg: '' }));
  phone.start();
  const p = phone.send('volume', 'up', '', 3000);       // pc is not running yet
  await new Promise((r) => setTimeout(r, 200));
  const pc = mk(db, secret, 'pc', 'phone', async (c) => { got.push(c.type); return { ok: true, msg: 'Volume up.' }; });
  pc.start();
  assert.deepStrictEqual(await p, { ok: true, msg: 'Volume up.' });
  assert.deepStrictEqual(got, ['volume']);
  pc.stop(); phone.stop(); await db.close();
});

test('reconnects after the stream drops', async () => {
  const db = await fake.start();
  const secret = proto.newSecret();
  const pc = mk(db, secret, 'pc', 'phone', async () => ({ ok: true, msg: 'ok' }));
  pc.start();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(pc.connected);
  pc._abort.abort();                                    // simulate a network drop
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!pc.connected);
  await new Promise((r) => setTimeout(r, 1300));
  assert.ok(pc.connected, 'should have reconnected');
  pc.stop(); await db.close();
});
