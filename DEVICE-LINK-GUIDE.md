# Jarvis for PC + Device Link — setup guide

This package contains
* the **phone app** source (updated to **v1.19.0**: new *Device Link* page + background link service), and
* the **Windows app** (`pc/`, Electron) that reuses the exact same UI, your same AI keys, and adds PC control.

## 1. Build the Windows app (.exe)

**Easiest – let GitHub build it**
1. Put this whole folder in a GitHub repository (the `pc` folder must stay next to `assets`).
2. On GitHub: **Actions → "Build Jarvis for Windows" → Run workflow**.
3. When it finishes, download the **Jarvis-Windows** artifact: `Jarvis-Setup-1.0.0.exe` (installer) and `Jarvis-Portable-1.0.0.exe` (no install).

**Or on your own Windows PC** (needs Node.js 20+):
```
cd pc
npm install
npm run dist        # exe files appear in pc\dist
npm start           # run without building
```

## 2. Build the phone app
Same as before (`bash build.sh`). Version 1.19.0 adds `RelayService`, `LinkBootReceiver`, `LinkCore`, `LinkClient`, `LinkJson`.

## 3. First run on the PC
Open **Jarvis → Settings → Neural Link** and paste the same API keys you use on the phone (they are stored encrypted by Windows, per user).
Voice input on the PC uses a **Groq**, **OpenAI** or **Gemini** key you already added (Groq is free) — Chrome's built-in recogniser does not exist inside desktop apps.

## 4. Link phone ⇄ PC (one-time, free, ~3 minutes)
The two apps talk through a small free **Firebase Realtime Database** that you own. Everything sent is **AES-256-GCM encrypted** with a secret that exists only on your two devices, so the database (and Google) only see scrambled bytes.

1. Go to <https://console.firebase.google.com> → **Add project** (turn Analytics off) → **Build → Realtime Database → Create database** (any region, *locked mode*).
2. Open the **Rules** tab, replace everything with the rules below, **Publish**:
```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "jarvis": {
      "$room": {
        ".read": true,
        ".write": true,
        "inbox": {
          "$box": {
            "$msg": { ".validate": "newData.hasChildren(['v','n','c']) && newData.child('c').val().length < 20000" }
          }
        }
      }
    }
  }
}
```
   Nobody can list or guess the `$room` name (it is derived from your secret), and without the secret nobody can read or forge a command.
3. Copy the database address shown at the top of the Data tab, e.g. `https://my-jarvis-default-rtdb.firebaseio.com`.
4. **On the PC:** Settings → **Device Link** → paste the address → **CREATE NEW LINK** → **COPY CODE**.
5. Send that code to your phone privately (note-to-self, then delete it). **On the phone:** Settings → **Device Link** → paste → **PAIR WITH CODE**.
6. Tap **TEST LINK** on either side. 

> Do not use Firebase "test mode" rules — they expire and are wide open. Use the rules above.
> Keep both devices' clocks on **automatic time** (messages older than 2 minutes are rejected, which also blocks replays).

## 5. Using it
From the phone (or typing/speaking on the PC):

| Say | Happens on |
|---|---|
| "on my PC open Chrome" / "open Chrome on my PC" | PC |
| "lock my PC" · "on my PC volume 40" · "on my PC play next song" | PC |
| "shut down my PC" · "restart my PC" · "cancel shutdown" | PC (asks you to confirm first; 20 s delay) |
| "on my PC type hello world" · "on my PC screenshot" | PC (typing needs the *typing* switch) |
| "on my phone call Mom" · "on my phone open YouTube" · "tell my phone to turn on the flashlight" | phone |

On the PC itself you can also just say/type "open notepad", "volume up", "lock", "screenshot", "close chrome", "timer 5 minutes"…

**Permission switches** (Settings → Device Link, on the *receiving* device, independent on each side):
* **Allow remote control** – open apps/links, search, volume, media, timers (PC also: lock, screenshot; phone also: flashlight)
* **Allow typing and key presses** – default **off**
* **Allow power commands** (PC) / **Allow calls and texts** (phone) – default **off**

Phone → PC: keep Jarvis running on the PC; closing the window sends it to the tray (switch on *Start with Windows* to have it ready after every boot).
PC → phone: the phone runs a small "linked" notification service; on Android 10+ opening apps from the background works once Jarvis has **Display over other apps** (the same permission as the floating ball). Typing/tapping from the PC needs the accessibility service as before.

## Safety notes
* Hostile web text can't trigger shutdown/restart/sleep/close — those only come from your own spoken/typed command (or the quick-control buttons), never from the AI's action tags.
* Unknown actions are refused; commands are rate limited (30/min); every remote command is shown in the chat.
* "Unpair" on either side wipes the secret. To rotate the key, unpair and create a new link.
* Windows-only actions (volume, media keys, lock, sleep, typing, closing apps) call PowerShell with the input passed as an environment variable, never pasted into a command line.

## What was verified, and what was not
Verified here: the link protocol (Node ⇄ Java byte-exact, tamper/replay/forgery rejection, reconnects), the full PC app launching and driving its UI, phone ⇄ PC routing and permission switches end-to-end against a simulated database.
**Not run here** (no Windows / Android SDK / microphone available): the Windows-only PowerShell actions, real microphone speech recognition, building the .apk and .exe, and the Android service on a physical phone. Expect to report small issues on first run.
