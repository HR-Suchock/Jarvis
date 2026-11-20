'use strict';
// Sandboxed preload for the floating-ball window: only these calls reach the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('jarvisBall', {
  dragStart: (x, y) => ipcRenderer.send('ball:drag-start', x, y),
  dragMove: (x, y) => ipcRenderer.send('ball:drag-move', x, y),
  dragEnd: (moved) => ipcRenderer.send('ball:drag-end', !!moved),
  toggle: (open) => ipcRenderer.send('ball:toggle', !!open),
  ask: (text) => ipcRenderer.send('ball:ask', String(text || '')),
  listen: () => ipcRenderer.send('ball:listen'),
  menu: () => ipcRenderer.send('ball:menu'),
  stopListen: () => ipcRenderer.send('ball:stoplisten'),
  dropPath: (file, name, mime) => { let p = ''; try { p = webUtils.getPathForFile(file); } catch (e) { /* */ } return p ? ipcRenderer.invoke('ball:dropfilepath', p, String(name || ''), String(mime || '')) : Promise.resolve({ ok: false, msg: 'could not read that file' }); },
  dropFile: (name, mime, data) => ipcRenderer.invoke('ball:dropfile', String(name || ''), String(mime || ''), data),
  tile: (id) => ipcRenderer.invoke('ball:tile', String(id || '')),
  drop: (text) => ipcRenderer.invoke('ball:drop', String(text || '')),
  on: (cb) => ipcRenderer.on('ball:ev', (_e, ev, d) => cb(ev, d || {})),
});
