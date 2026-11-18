# Signing the phone APK (same key every time)

Android only installs an update over an installed app when both APKs are signed with the SAME key. Keep one keystore forever.

## One-time: add 4 secrets to GitHub
Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret name         | Value |
|---------------------|-------|
| KEYSTORE_BASE64     | the text in `jarvis-release.keystore.base64.txt` (one long line) |
| KEYSTORE_PASSWORD   | the keystore password |
| KEY_ALIAS           | the key alias (default `jarvis`) |
| KEY_PASSWORD        | the key password |

Then: Actions → "Build Jarvis phone APK" → Run workflow → download `Jarvis-phone-apk` (Jarvis.apk).

## Make a brand-new keystore (only if you never had one)
    keytool -genkeypair -keystore jarvis-release.keystore -alias jarvis -keyalg RSA -keysize 2048 -validity 36500 -dname "CN=Jarvis, O=Suchock, C=BD"
    base64 -w0 jarvis-release.keystore > jarvis-release.keystore.base64.txt     (Windows: certutil -encodeHex is not needed; use  [Convert]::ToBase64String([IO.File]::ReadAllBytes("jarvis-release.keystore")) )

NEVER commit the keystore or its base64 to the repository, and keep a private backup copy of it.
Local build: `KS_PASS=... KS_ALIAS=jarvis KEY_PASS=... KEYSTORE=/path/to/jarvis-release.keystore bash build.sh` (needs ANDROID_JAR, AAPT2, DX).
