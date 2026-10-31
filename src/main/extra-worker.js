'use strict';
// Runs the extra PC actions on a worker thread so the page's synchronous action calls get a real reply
// (main.js blocks on a shared flag while this thread does the work). Keeps the media index cached between commands.
const { workerData, parentPort } = require('worker_threads');
const extra = require('./pc-extra-actions')({ getPath: (n) => (workerData.paths && workerData.paths[n]) || '' });
parentPort.on('message', async (m) => {
  if (m.warm) { try { await extra.refreshMediaIndex(); } catch (e) { /* ignore */ } return; }
  let r;
  try { r = await extra.run(m.type, m.arg, m.arg2); } catch (e) { r = { ok: false, msg: 'That did not work.' }; }
  m.port.postMessage(r);
  Atomics.store(new Int32Array(m.sab), 0, 1);
  Atomics.notify(new Int32Array(m.sab), 0);
});
