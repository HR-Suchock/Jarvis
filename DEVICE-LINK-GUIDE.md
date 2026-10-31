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

> The same rules are in `firebase-rules.json`, and in the app under **Settings › User Manual › 11** and **Settings › Device Link** with a **COPY RULES** button.

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

### More PC commands (v1.20.0 — needs the updated PC app)
Say these from the phone with "on my PC …" (or just say/type them on the PC where it makes sense):

| Say | What happens | Switch needed on the PC |
|---|---|---|
| "on my PC status" · "cpu usage" · "ram" · "disk space" · "uptime" · "battery" · "ip address" · "what is running" | PC reads the answer back to your phone | remote control |
| "on my PC brightness 40" · "brightness up" · "dim the brightness" | laptop screen brightness | remote control |
| "on my PC turn on dark mode" · "toggle dark mode" · "light mode" | Windows theme | remote control |
| "on my PC open wifi settings" (bluetooth, display, sound, update, apps, battery, storage, network, privacy, personalization, notifications, power, about…) | opens that Windows Settings page | remote control |
| "on my PC copy hello there to clipboard" · "read the clipboard" | write / read the PC clipboard | typing and key presses |
| "on my PC switch window" · "close window" · "maximise" · "minimise" · "snap left/right" · "task view" · "new tab" · "close tab" · "next/previous tab" · "refresh" · "full screen" · "scroll up/down" | window and browser keys | typing and key presses |
| "sign out of my PC" · "on my PC empty the recycle bin" | asks yes/no on the phone first | power commands |

The phone app also has quick buttons for PC STATUS, BRIGHT +/−, DARK MODE in Settings › Device Link.

### Movies, music and YouTube on the PC (v1.21.0 — needs the updated PC app)
| Say | What happens | Switch needed on the PC |
|---|---|---|
| "on my PC play movie Spiderman" · "play the movie The Dark Knight on my PC" | finds the movie file by name on the PC and plays it in the default player | remote control |
| "on my PC play song Shape of You" · "play music Believer" | finds the song file and plays it | remote control |
| "open Marvel Studios file" · "open the Iron Man movie" · "play Shape of You song" (typed or spoken on the PC itself too) | same: finds it by name and plays it | remote control |
| "on my PC play despacito" | plays a matching local file; if there is none it finds the first YouTube result and plays it | remote control |
| "on my PC open YouTube and play Believer" · "play Shape of You on YouTube on my PC" | opens the first matching YouTube video (autoplay) in the PC browser | remote control |
| "on my PC play some music" · "shuffle my music" · "play a random movie" | random song or big video from the PC library | remote control |
| "on my PC pause the music" · "resume" · "next song" · "previous song" | media keys | remote control |
| "on my PC stop the movie" · "stop the music" · "close VLC" | closes the local media player (the "off" switch) | typing and key presses |
| "on my PC find movie Inception" · "list my movies" · "show my songs" | tells you how many it found and the best names | remote control |
| "on my PC open downloads" · "open music folder" · "open the recycle bin" | opens the folder on the PC | remote control |

**Photos, documents and drives (v1.22.0).** The PC now searches **every drive (C: to Z:)** — your whole PC, not just a few folders:

| Say | What happens |
|---|---|
| "on my PC open photo Beach Holiday" · "show me picture Eid family" · "open the beach holiday photo" | opens the photo in the default viewer |
| "on my PC open document Budget" · "open my CV pdf" · "open budget excel file" | opens the PDF / Word / Excel / PowerPoint / text file |
| "on my PC open my latest photo" · "play the latest movie" · "play the newest song" · "open my latest download" | the most recently changed file of that kind |
| "on my PC list my photos" · "list my documents" · "find photo holiday" · "find document budget" | how many it found, and the best names |
| "on my PC open D drive" · "open drive E" | opens that drive in File Explorer |

It searches movies and videos, songs, photos (jpg, png, heic…) and documents (pdf, docx, xlsx, pptx, txt…) on every fixed drive, skipping Windows, Program Files, AppData, temp and cache folders. Programs and scripts (.exe, .bat, .ps1, .lnk, …) are never opened. The first search after starting Jarvis builds an index in the background (large disks can take a minute); it refreshes every 10 minutes, and a missing file triggers an immediate re-scan.


## Safety notes
* Hostile web text can't trigger shutdown/restart/sleep/close — those only come from your own spoken/typed command (or the quick-control buttons), never from the AI's action tags.
* Unknown actions are refused; commands are rate limited (30/min); every remote command is shown in the chat.
* "Unpair" on either side wipes the secret. To rotate the key, unpair and create a new link.
* Windows-only actions (volume, media keys, lock, sleep, typing, closing apps) call PowerShell with the input passed as an environment variable, never pasted into a command line.

## What was verified, and what was not
Verified here: the link protocol (Node ⇄ Java byte-exact, tamper/replay/forgery rejection, reconnects), the full PC app launching and driving its UI, phone ⇄ PC routing and permission switches end-to-end against a simulated database.
**Not run here** (no Windows / Android SDK / microphone available): the Windows-only PowerShell actions, real microphone speech recognition, building the .apk and .exe, and the Android service on a physical phone. Expect to report small issues on first run.
