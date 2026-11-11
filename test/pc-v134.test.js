const test = require('node:test'); const assert = require('node:assert');
const mod = require('../src/main/pc-extra-actions.js');
test('big file arrives in pieces, repeated piece ignored', async () => {
  let saved = null;
  const make = mod;
  const x = make({ saveFile: async (name, mime, data) => { saved = data; return { ok: true, msg: 'saved' }; } });
  const CH = 36000, size = 5000000, n = Math.ceil(size / CH), buf = Buffer.alloc(size, 7);
  let last;
  for (let i = 0; i < n; i++) {
    const meta = JSON.stringify({ id: 'abcd1234', i, n, size, name: 'big.bin', mime: 'application/octet-stream' });
    const b = buf.subarray(i * CH, (i + 1) * CH).toString('base64');
    last = await x.run('filepart', meta, b);
    if (i === 3) { const dup = await x.run('filepart', meta, b); assert.ok(dup.ok); }
  }
  assert.ok(last.ok, last.msg); assert.strictEqual(saved.length, size);
});
