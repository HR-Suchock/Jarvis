'use strict';
// Copies the shared UI (../assets, the same files the Android app uses) into ./renderer so it is packaged with the app.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', '..', 'assets');
const dst = path.join(__dirname, '..', 'renderer');
if (!fs.existsSync(path.join(src, 'index.html'))) { console.error('Cannot find ../assets/index.html — keep the pc folder next to the assets folder.'); process.exit(1); }
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('UI synced to', dst);
