'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const llm = require('../src/main/llm.js');

function server(handler) { return new Promise((res) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => res(s)); }); }

test('an HTML 403 gets a plain-language explanation, not raw HTML', async () => {
  const s = await server((q, r) => { r.writeHead(403, { 'content-type': 'text/html' }); r.end('<html><body><h1>403 Forbidden</h1></body></html>'); });
  try {
    await assert.rejects(llm.__http('POST', 'http://127.0.0.1:' + s.address().port + '/x', {}, { a: 1 }, 5000), (e) => /firewall|VPN/i.test(e.message) && !/<html>/i.test(e.message));
  } finally { s.close(); }
});

test('a JSON answer passes through', async () => {
  const s = await server((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"ok":true}'); });
  try { assert.strictEqual(await llm.__http('GET', 'http://127.0.0.1:' + s.address().port + '/', {}, null, 5000), '{"ok":true}'); } finally { s.close(); }
});
