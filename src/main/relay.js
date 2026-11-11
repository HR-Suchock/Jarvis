'use strict';
/**
 * Relay client: talks to a Firebase Realtime Database over its plain REST + server-sent-events API.
 * No SDK, no login. Layout:  <db>/jarvis/<room>/inbox/<pc|phone>/<pushId> = envelope
 */
const crypto = require('crypto');
const { EventEmitter } = require('events');
const proto = require('./link-protocol');

const ME = 'pc', PEER = 'phone';

class Relay extends EventEmitter {
  /**
   * @param {() => ({enabled:boolean, dbUrl:string, secret:string})} getCfg
   * @param {(cmd:{type:string,arg:string,arg2:string}) => Promise<{ok:boolean,msg:string}>} onCommand
   * @param {{me?:string, peer?:string, fetchImpl?:Function}} [opts]
   */
  constructor(getCfg, onCommand, opts) {
    super();
    opts = opts || {};
    this.me = opts.me || ME;
    this.peer = opts.peer || PEER;
    this.fetch = opts.fetchImpl || ((...a) => fetch(...a));
    this.getCfg = getCfg;
    this.onCommand = onCommand;
    this.connected = false;
    this.seen = new Set();            // message keys already handled
    this.waiters = new Map();         // id -> {resolve, timer}
    this._run = 0;
    this._abort = null;
  }

  _ctx() {
    const c = this.getCfg();
    if (!c || !c.enabled || !c.dbUrl || !c.secret) return null;
    const d = proto.derive(c.secret);
    return { base: c.dbUrl + '/jarvis/' + d.room + '/inbox', key: d.key };
  }

  start() {
    this.stop();
    const ctx = this._ctx();
    if (!ctx) { this._setConnected(false); return; }
    const run = ++this._run;
    this._loop(run, ctx);
  }

  stop() {
    this._run++;
    if (this._abort) { try { this._abort.abort(); } catch (e) { /* ignore */ } this._abort = null; }
    clearTimeout(this._retry);
    this._setConnected(false);
  }

  _setConnected(v) {
    if (this.connected !== v) { this.connected = v; this.emit('status', { connected: v }); }
  }

  async _loop(run, ctx) {
    let delay = 1000, upSince = 0;
    while (run === this._run) {
      upSince = 0;
      const ac = new AbortController();
      this._abort = ac;
      let watchdog = null;
      const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ac.abort(), 75000); };
      try {
        arm();
        const res = await this.fetch(ctx.base + '/' + this.me + '.json', { headers: { Accept: 'text/event-stream' }, signal: ac.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        this._setConnected(true);
        upSince = Date.now();
        const dec = new TextDecoder();
        let buf = '';
        for await (const chunk of res.body) {
          arm();
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i); buf = buf.slice(i + 2);
            this._event(block, ctx);
          }
        }
      } catch (e) {
        if (run !== this._run) return;
        this.emit('error-soft', e);
      } finally {
        clearTimeout(watchdog);
      }
      if (run !== this._run) return;
      this._setConnected(false);
      // a connection that held for a while was healthy: start over gently; one that keeps dropping backs off up to 60 s
      // (so a flapping network can never turn into a reconnect storm that re-downloads the inbox every second)
      if (upSince && Date.now() - upSince > 30000) delay = 1000;
      await new Promise((r) => { this._retry = setTimeout(r, delay); });
      if (!(upSince && Date.now() - upSince > 30000)) delay = Math.min(delay * 2, 60000);
    }
  }

  _event(block, ctx) {
    let ev = '', data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) ev = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (ev !== 'put' && ev !== 'patch') return;
    let o;
    try { o = JSON.parse(data); } catch (e) { return; }
    if (!o || typeof o.path !== 'string') return;
    if (o.path === '/') {
      const map = o.data && typeof o.data === 'object' ? o.data : {};
      for (const k of Object.keys(map)) this._incoming(k, map[k], ctx);
    } else if (/^\/[^/]+$/.test(o.path) && o.data) {
      this._incoming(o.path.slice(1), o.data, ctx);
    }
  }

  _incoming(key, env, ctx) {
    if (this.seen.has(key)) return;
    this.seen.add(key);
    if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
    this._delete(ctx, key);                           // consumed (or garbage): either way it should not linger
    const msg = proto.open(ctx.key, env, this.me);
    if (!msg) return;
    this._handle(msg, ctx).catch((e) => this.emit('error-soft', e));
  }

  async _handle(m, ctx) {
    if (m.k === 'res' || m.k === 'pong') {
      const w = this.waiters.get(m.re);
      if (w) { clearTimeout(w.timer); this.waiters.delete(m.re); w.resolve({ ok: m.ok !== false, msg: String(m.msg || '') }); }
      return;
    }
    if (m.k === 'ping') { await this._post(ctx, this.peer, { k: 'pong', re: m.id, ok: true, msg: 'Online.' }); return; }
    if (m.k === 'cmd') {
      let r;
      try { r = await this.onCommand({ type: String(m.type || ''), arg: String(m.arg || ''), arg2: String(m.arg2 || '') }); }
      catch (e) { r = { ok: false, msg: 'That failed: ' + (e && e.message ? e.message : e) }; }
      if (m.nr === true) return;                      // fire-and-forget (touchpad moves): no reply, halves the traffic
      await this._post(ctx, this.peer, { k: 'res', re: m.id, ok: !!(r && r.ok), msg: String((r && r.msg) || '').slice(0, 500) });
    }
  }

  async _post(ctx, to, body) {
    const id = crypto.randomBytes(9).toString('base64url');
    const msg = Object.assign({ id, ts: Date.now(), from: this.me }, body);
    const res = await this.fetch(ctx.base + '/' + to + '.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proto.seal(ctx.key, msg, to)), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error('Database write failed (HTTP ' + res.status + ')');
    return id;
  }

  _delete(ctx, key) {
    this.fetch(ctx.base + '/' + this.me + '/' + encodeURIComponent(key) + '.json', { method: 'DELETE', signal: AbortSignal.timeout(10000) }).catch(() => {});
  }

  /** Send a command to the other device and wait for its answer. */
  async send(type, arg, arg2, timeoutMs) {
    const ctx = this._ctx();
    if (!ctx) return { ok: false, msg: 'Device link is not set up. Open Settings → Device Link.' };
    try {
      const id = await this._post(ctx, this.peer, { k: 'cmd', type: String(type), arg: String(arg || ''), arg2: String(arg2 || '') });
      return await this._await(id, timeoutMs || 35000);
    } catch (e) {
      return { ok: false, msg: 'Could not reach the link database: ' + (e && e.message ? e.message : e) };
    }
  }

  async ping() {
    const ctx = this._ctx();
    if (!ctx) return { ok: false, msg: 'Device link is not set up.' };
    try {
      const id = await this._post(ctx, this.peer, { k: 'ping' });
      return await this._await(id, 12000);
    } catch (e) {
      return { ok: false, msg: 'Could not reach the link database: ' + (e && e.message ? e.message : e) };
    }
  }

  _await(id, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id);
        resolve({ ok: false, msg: 'No answer — the other device may be offline, asleep, or has the link switched off.' });
      }, ms);
      this.waiters.set(id, { resolve, timer });
    });
  }
}

module.exports = { Relay };
