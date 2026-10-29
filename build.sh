#!/usr/bin/env bash
# Builds Jarvis.apk without Gradle: aapt2 -> javac -> dx -> zipalign -> apksigner
# Needs: JDK 17+, aapt2, dalvik-exchange (dx), zipalign, apksigner, and an android.jar (API 34)
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_JAR="${ANDROID_JAR:?set ANDROID_JAR to the path of android.jar (API 34)}"
AAPT2="${AAPT2:-aapt2}"
DX="${DX:-dalvik-exchange}"
OUT=build
KEYSTORE="${KEYSTORE:-jarvis-release.keystore}"
if [ -z "${KS_PASS:-}" ]; then echo "Set KS_PASS (your keystore password) first, e.g.  KS_PASS=... bash build.sh" >&2; exit 1; fi

rm -rf "$OUT" && mkdir -p "$OUT/classes" "$OUT/res"

echo "[1/6] fonts + icons"
python3 make_fonts_css.py
[ -f res/mipmap-xxxhdpi/ic_launcher.png ] || python3 make_icons.py

echo "[2/6] aapt2 compile + link"
"$AAPT2" compile --dir res -o "$OUT/res.zip"
"$AAPT2" link -o "$OUT/base.apk" -I "$ANDROID_JAR" --manifest AndroidManifest.xml \
  -R "$OUT/res.zip" -A assets --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 46 --version-name 1.19.0 --auto-add-overlay

echo "[3/6] javac"
javac --release 8 -Xlint:-options -encoding UTF-8 -cp "$ANDROID_JAR" -d "$OUT/classes" $(find src -name '*.java')

echo "[4/6] dex"
"$DX" --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/classes"

echo "[5/6] package + align"
cp "$OUT/base.apk" "$OUT/unaligned.apk"
( cd "$OUT" && zip -q -j unaligned.apk classes.dex )
zipalign -f -p 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

echo "[6/6] sign"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias jarvis -keyalg RSA -keysize 2048 -validity 36500 \
    -dname "CN=Jarvis, O=Suchock, C=BD" >/dev/null 2>&1
fi
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --ks-key-alias jarvis --out "$OUT/Jarvis.apk" "$OUT/aligned.apk"
apksigner verify --verbose "$OUT/Jarvis.apk" | head -8
ls -la "$OUT/Jarvis.apk"
