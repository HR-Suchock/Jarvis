'use strict';
// Direct Wi-Fi file transfer (same network only). The address and a one-time token travel through the encrypted Firebase link;
// the file itself goes straight over TCP, encrypted with AES-256-CTR keyed from that token, and checked with a SHA-256 trailer.
// Protocol: "JLAN1 <proof> <size> <name-b64url> <mime-b64url>\n" + ciphertext(file) + ciphertext(64 hex chars sha256); reply "OK <msg>\n" or "ERR <msg>\n".
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const keyOf = (t) => sha(String(t));
const ivOf = (t) => sha('iv' + t).subarray(0, 16);
const proofOf = (t) => sha('auth' + t).toString('hex');
const b64u = (s) => Buffer.from(String(s), 'utf8').toString('base64url');
const unb64u = (s) => Buffer.from(String(s), 'base64url').toString('utf8');

function lanIps() {
  const out = [];
  try {
    const ifs = os.networkInterfaces();
    for (const k of Object.keys(ifs)) for (const a of ifs[k] || []) {
      if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  } catch (e) { /* ignore */ }
  return out.slice(0, 3);
}

// receiving side: opens a one-shot server; onFile(name, mime, buffer) -> Promise<{ok,msg}>. Returns the offer text "LAN ip,ip port token".
function offer(onFile, opts) {
  opts = opts || {};
  const maxSize = opts.maxSize || 100000000;
  return new Promise((resolve) => {
    const ips = lanIps();
    if (!ips.length) { resolve(null); return; }
    const token = crypto.randomBytes(12).toString('hex');
    let done = false, srv = null;
    const close = () => { if (done) return; done = true; try { srv.close(); } catch (e) { /* ignore */ } };
    srv = net.createServer((sock) => {
      let head = Buffer.alloc(0), hdr = null, dec = null, got = 0, hash = crypto.createHash('sha256'), parts = [], tail = Buffer.alloc(0), file = '', fd = null, finished = false;
      sock.setTimeout(30000, () => sock.destroy());
      const fail = (m) => { if (finished) return; finished = true; try { sock.end('ERR ' + m + '\n'); } catch (e) { /* ignore */ } cleanup(); };
      const cleanup = () => { try { if (fd !== null) fs.closeSync(fd); } catch (e) { /* ignore */ } fd = null; try { if (file) fs.unlinkSync(file); } catch (e) { /* ignore */ } close(); };
      sock.on('error', () => { finished = true; cleanup(); });
      sock.on('data', (chunk) => {
        if (finished) return;
        try {
          if (!hdr) {
            head = Buffer.concat([head, chunk]);
            const nl = head.indexOf(10);
            if (nl < 0) { if (head.length > 2048) fail('bad header'); return; }
            const p = head.subarray(0, nl).toString('utf8').split(' ');
            chunk = head.subarray(nl + 1);
            if (p[0] !== 'JLAN1' || p[1] !== proofOf(token)) { fail('not allowed'); return; }
            const size = +p[2];
            if (!(size > 0) || size > maxSize) { fail('bad size'); return; }
            hdr = { size, name: unb64u(p[3] || ''), mime: unb64u(p[4] || '') };
            dec = crypto.createDecipheriv('aes-256-ctr', keyOf(token), ivOf(token));
            if (size > 4000000) { file = path.join(os.tmpdir(), 'jarvis-lan-' + token.slice(0, 8) + '.part'); fd = fs.openSync(file, 'w'); }
            if (!chunk.length) return;
          }
          const plain = dec.update(chunk);
          let body = plain;
          if (got + plain.length > hdr.size) { body = plain.subarray(0, hdr.size - got); tail = Buffer.concat([tail, plain.subarray(hdr.size - got)]); }
          if (body.length) { hash.update(body); got += body.length; if (fd !== null) fs.writeSync(fd, body); else parts.push(Buffer.from(body)); }
          if (got === hdr.size && tail.length >= 64) {
            finished = true;
            if (tail.subarray(0, 64).toString('utf8') !== hash.digest('hex')) { finished = false; fail('the file was damaged on the way'); return; }
            if (fd !== null) { fs.closeSync(fd); fd = null; }
            const data = file ? fs.readFileSync(file) : Buffer.concat(parts);
            if (file) { try { fs.unlinkSync(file); } catch (e) { /* ignore */ } file = ''; }
            Promise.resolve(onFile(hdr.name, hdr.mime, data)).then((r) => { try { sock.end((r && r.ok ? 'OK ' : 'ERR ') + String((r && r.msg) || '').slice(0, 200) + '\n'); } catch (e) { /* ignore */ } close(); },
              () => { try { sock.end('ERR could not save\n'); } catch (e) { /* ignore */ } close(); });
          }
        } catch (e) { fail('receive failed'); }
      });
    });
    srv.on('error', () => { done = true; resolve(null); });
    srv.listen(0, '0.0.0.0', () => {
      const t = setTimeout(close, 90000); if (t.unref) t.unref();
      resolve('LAN ' + ips.join(',') + ' ' + srv.address().port + ' ' + token);
    });
  });
}

// sending side: try each address from the offer; resolves {ok,msg} or null when the other device cannot be reached directly (use the slow route then)
function send(offerText, buf, name, mime) {
  const m = /^LAN ([0-9.,]+) (\d{2,5}) ([0-9a-f]{16,64})$/.exec(String(offerText || ''));
  if (!m) return Promise.resolve(null);
  const ips = m[1].split(','), port = +m[2], token = m[3];
  const tryIp = (ip) => new Promise((resolve) => {
    let settled = false; const fin = (v) => { if (!settled) { settled = true; try { sock.destroy(); } catch (e) { /* ignore */ } resolve(v); } };
    const sock = net.connect({ host: ip, port });
    sock.setTimeout(2000, () => fin(null));
    sock.on('error', () => fin(null));
    sock.on('connect', () => {
      sock.setTimeout(60000, () => fin({ ok: false, msg: 'Wi-Fi transfer timed out', partial: true }));
      const enc = crypto.createCipheriv('aes-256-ctr', keyOf(token), ivOf(token));
      sock.write('JLAN1 ' + proofOf(token) + ' ' + buf.length + ' ' + b64u(name) + ' ' + b64u(mime) + '\n');
      const CH = 256 * 1024; let off = 0;
      const pump = () => {
        while (off < buf.length) {
          const piece = buf.subarray(off, off + CH); off += piece.length;
          if (!sock.write(enc.update(piece))) { sock.once('drain', pump); return; }
        }
        sock.write(enc.update(Buffer.from(crypto.createHash('sha256').update(buf).digest('hex'))));
        sock.write(enc.final());
      };
      pump();
    });
    let reply = '';
    sock.on('data', (d) => { reply += d.toString('utf8'); if (reply.indexOf('\n') >= 0) { const ok = /^OK/.test(reply); fin({ ok, msg: reply.replace(/^(OK|ERR) ?/, '').trim() || (ok ? 'Sent over Wi-Fi.' : 'failed'), partial: !ok }); } });
    sock.on('close', () => fin({ ok: false, msg: 'connection closed', partial: true }));
  });
  return (async () => { for (const ip of ips) { const r = await tryIp(ip); if (r) return r; } return null; })();
}

module.exports = { offer, send, lanIps };
