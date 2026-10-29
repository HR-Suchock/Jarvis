'use strict';
/**
 * Jarvis device-link protocol v1 (identical on the Android side: Link.java).
 *
 *   pairing code   "JL1." + base64url(JSON {u: databaseUrl, s: secret})
 *   room id        first 32 chars of base64url(HMAC-SHA256(secret, "jarvis-link/room/v1"))
 *   key            HMAC-SHA256(secret, "jarvis-link/key/v1")            (32 bytes, AES-256)
 *   envelope       {v:1, n: base64url(12-byte IV), c: base64url(ciphertext || 16-byte GCM tag)}
 *   AAD            "jl1:" + recipient ("pc" | "phone")   -> a message can't be replayed in the other direction
 *   plaintext      JSON {id, ts, from, k, type?, arg?, arg2?, re?, ok?, msg?}
 *
 * The secret never leaves the two devices; the database only ever holds ciphertext under an unguessable room id.
 */
const crypto = require('crypto');

const PREFIX = 'JL1.';
const MAX_AGE_MS = 120 * 1000;      // reject anything older / further in the future than this

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
};

function newSecret() {
  return b64u.enc(crypto.randomBytes(24));          // 192 bits of entropy
}

function normalizeDbUrl(u) {
  u = String(u || '').trim();
  // https only; plain http is accepted solely for loopback addresses (local testing)
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(u) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/.*)?$/i.test(u)) return '';
  return u.replace(/\/+$/, '');
}

function makeCode(dbUrl, secret) {
  return PREFIX + b64u.enc(JSON.stringify({ u: dbUrl, s: secret }));
}

function parseCode(code) {
  code = String(code || '').trim().replace(/\s+/g, '');
  if (!code.startsWith(PREFIX)) throw new Error('That is not a Jarvis pairing code.');
  let o;
  try { o = JSON.parse(b64u.dec(code.slice(PREFIX.length)).toString('utf8')); } catch (e) { throw new Error('The pairing code is damaged — copy it again.'); }
  const u = normalizeDbUrl(o && o.u);
  if (!u) throw new Error('The pairing code has no valid database address.');
  if (typeof o.s !== 'string' || o.s.length < 24) throw new Error('The pairing code is too weak or damaged.');
  return { dbUrl: u, secret: o.s };
}

function derive(secret) {
  const hm = (label) => crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(label).digest();
  return { room: b64u.enc(hm('jarvis-link/room/v1')).slice(0, 32), key: hm('jarvis-link/key/v1') };
}

function seal(key, obj, recipient) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from('jl1:' + recipient, 'utf8'));
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final(), c.getAuthTag()]);
  return { v: 1, n: b64u.enc(iv), c: b64u.enc(ct) };
}

/** Returns the decrypted object, or null if it is not ours / was tampered with / is too old. */
function open(key, env, recipient, now) {
  try {
    if (!env || env.v !== 1) return null;
    const iv = b64u.dec(env.n), all = b64u.dec(env.c);
    if (iv.length !== 12 || all.length < 17 || all.length > 64 * 1024) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(Buffer.from('jl1:' + recipient, 'utf8'));
    d.setAuthTag(all.subarray(all.length - 16));
    const pt = Buffer.concat([d.update(all.subarray(0, all.length - 16)), d.final()]).toString('utf8');
    const o = JSON.parse(pt);
    if (!o || typeof o.id !== 'string' || typeof o.ts !== 'number') return null;
    if (Math.abs((now || Date.now()) - o.ts) > MAX_AGE_MS) return null;
    return o;
  } catch (e) {
    return null;
  }
}

module.exports = { newSecret, normalizeDbUrl, makeCode, parseCode, derive, seal, open, b64u, MAX_AGE_MS };
