# Jarvis for Windows (PC app)

Electron app that runs the same Jarvis UI as the phone app, in a normal resizable desktop window (wide layout; it switches to the phone layout if you make the window narrow), plus PC control and the encrypted phone <-> PC link.

## Get the .exe without a strong PC (GitHub builds it)
1. Create a repository on github.com and upload everything in this folder.
2. **Actions -> Build Jarvis for Windows -> Run workflow** (about 5 minutes).
3. Download **Jarvis-Windows** from the run: `Jarvis-Setup-1.27.0.exe` — the only file; run it to install Jarvis (it has its own install wizard).

## Or build locally (Windows, Node.js 20+)
```
npm install
npm run dist      # exe in .\dist
npm start         # run without building
npm test
```

The shared UI lives in `assets/` (a copy from the phone project). If you change the phone UI, copy its `assets/` folder over this one.
Linking with the phone app: see `DEVICE-LINK-GUIDE.md` (Firebase setup, pairing, what you can say).
