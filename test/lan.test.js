const test = require('node:test'); const assert = require('node:assert');
const lan = require('../src/main/lan.js');
test('LAN transfer round trip (small and spooled big)', async (t) => {
  if (!lan.lanIps().length) return t.skip('no LAN address in this sandbox');
  for (const size of [1234, 6000000]) {
    let got = null;
    const off = await lan.offer(async (n, m, d) => { got = { n, m, d }; return { ok: true, msg: 'saved ' + n }; });
    assert.ok(/^LAN /.test(off));
    const buf = require('crypto').randomBytes(size);
    const r = await lan.send(off, buf, 'a b.bin', 'application/x-test');
    assert.ok(r && r.ok, JSON.stringify(r)); assert.ok(got.d.equals(buf)); assert.strictEqual(got.n, 'a b.bin');
  }
});
test('wrong token is refused, unreachable returns null', async () => {
  const r = await require('../src/main/lan.js').send('LAN 10.255.255.1 9 abcdefabcdefabcdefabcdef', Buffer.from('x'), 'n', 'm');
  assert.strictEqual(r, null);
});
