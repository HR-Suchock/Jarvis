'use strict';
// Runs the extra PC actions on a worker thread: (1) local commands get a real reply even though the page asks
// synchronously (main.js blocks on a shared flag while this thread works), (2) the media index stays cached,
// (3) the scheduler for "at 11 pm shut down" style jobs lives here. Things only the main process can do
// (run a normal PC action, tell the phone) are asked of it with small messages.
const { workerData, parentPort } = require('worker_threads');
const tiers = { ctl: false, input: false, danger: false };
let rpcSeq = 0; const pending = new Map();
function rpc(kind, payload) {
  return new Promise((resolve) => {
    const id = ++rpcSeq; pending.set(id, resolve);
    parentPort.postMessage(Object.assign({ rpc: kind, id }, payload));
    setTimeout(() => { if (pending.delete(id)) resolve({ ok: false, msg: 'The PC did not answer.' }); }, 60000).unref();
  });
}
// the worker has no Electron 'shell', so opening files/links is asked of the main process (opens with the default app, no PowerShell start-up)
const shell = {
  openPath: async (p) => { const r = await rpc('openpath', { p: String(p) }); return r && r.ok ? '' : 'failed'; },
  openExternal: async (u) => { const r = await rpc('openext', { u: String(u) }); if (!(r && r.ok)) throw new Error('failed'); },
};
const extra = require('./pc-extra-actions')({
  shell,
  getPath: (n) => (workerData.paths && workerData.paths[n]) || '',
  userData: workerData.userData,
  run: (type, arg, arg2) => rpc('run', { type, arg, arg2 }),
  tierOn: (t) => tiers[t] === true,
  notifyPhone: (text) => { parentPort.postMessage({ rpc: 'notify', text: String(text).slice(0, 300) }); },
});
extra.startScheduler();
parentPort.on('message', async (m) => {
  if (m.rpcRes) { const f = pending.get(m.rpcRes); if (f) { pending.delete(m.rpcRes); f(m.r); } return; }
  if (m.tiers) { tiers.ctl = !!m.tiers.ctl; tiers.input = !!m.tiers.input; tiers.danger = !!m.tiers.danger; }
  if (m.warm) { try { await extra.refreshMediaIndex(); } catch (e) { /* ignore */ } return; }
  if (!m.type) return;
  let r;
  try { r = await extra.run(m.type, m.arg, m.arg2); } catch (e) { r = { ok: false, msg: 'That did not work.' }; }
  m.port.postMessage(r);
  if (m.sab) { Atomics.store(new Int32Array(m.sab), 0, 1); Atomics.notify(new Int32Array(m.sab), 0); }
});
