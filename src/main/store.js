'use strict';
/** Key/value store in the user's profile folder. Values are encrypted with the OS (Windows DPAPI) when available. */
const fs = require('fs');
const path = require('path');

const PREFIX = 'enc1:';

class Store {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, 'jarvis-store.json');
    this.ss = safeStorage || null;
    this.map = {};
    try { this.map = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; } catch (e) { this.map = {}; }
    this._t = null;
  }
  _canEnc() { try { return !!(this.ss && this.ss.isEncryptionAvailable()); } catch (e) { return false; } }
  get(k) {
    const v = this.map[k];
    if (typeof v !== 'string' || !v) return '';
    if (!v.startsWith(PREFIX)) return v;
    try { return this.ss.decryptString(Buffer.from(v.slice(PREFIX.length), 'base64')); } catch (e) { return ''; }
  }
  set(k, v) {
    v = String(v == null ? '' : v);
    this.map[k] = v && this._canEnc() ? PREFIX + this.ss.encryptString(v).toString('base64') : v;
    this._flush();
  }
  clear() { this.map = {}; this._flush(true); }
  _flush(now) {
    clearTimeout(this._t);
    const write = () => {
      try {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.map), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
      } catch (e) { /* disk full / locked: keep running */ }
    };
    if (now) write(); else this._t = setTimeout(write, 150);
  }
  flushSync() { clearTimeout(this._t); this._flush(true); }
}

module.exports = { Store };
