'use strict';
// Sandboxed preload: the only door between the page and the system. Everything is validated again in main.js.
const { contextBridge, ipcRenderer } = require('electron');
const sync = (ch, ...a) => ipcRenderer.sendSync(ch, ...a);

contextBridge.exposeInMainWorld('jarvisPC', {
  platform: process.platform,
  getPref: (k) => sync('pref:get', k),
  setPref: (k, v) => sync('pref:set', k, v),
  wipe: () => sync('wipe'),
  action: (t, a, b) => sync('action', t, a, b),
  actionAsync: (t, a, b) => ipcRenderer.invoke('action:async', t, a, b),
  sysInfo: () => sync('sysinfo'),
  appInfo: () => sync('appinfo'),
  reportBattery: (b) => ipcRenderer.send('battery', b),
  openUrl: (u) => sync('openurl', u),
  copy: (t) => sync('copy', t),
  minimize: () => sync('minimize'),
  quitApp: () => sync('quitapp'),
  privacy: (v) => sync('privacy', !!v),
  chat: (p) => ipcRenderer.send('chat', p),
  models: (p) => ipcRenderer.send('models', p),
  search: (p) => ipcRenderer.send('search', p),
  lsearch: (p) => ipcRenderer.send('lsearch', p),
  tavily: (p) => ipcRenderer.send('tavily', p),
  weather: (p) => ipcRenderer.send('weather', p),
  stt: (buf, lang) => ipcRenderer.invoke('stt', buf, lang),
  link: {
    state: () => sync('link:state'),
    set: (o) => sync('link:set', o),
    create: (u) => sync('link:create', u),
    pair: (c) => sync('link:pair', c),
    code: () => sync('link:code'),
    unpair: () => sync('link:unpair'),
    send: (t, a, b) => sync('link:send', t, a, b),
    ping: () => sync('link:ping'),
  },
  ballText: (t) => ipcRenderer.send('ball:text', String(t || '')),
  ballState: (st) => ipcRenderer.send('ball:state', String(st || '')),
  ballTheme: (n) => ipcRenderer.send('ball:theme', String(n || '')),
  ballGet: () => sync('ball:get') === '1',
  ballSet: (v) => sync('ball:set', !!v),
  onNative: (cb) => ipcRenderer.on('native', (_e, ev, data) => cb(ev, data)),
});
