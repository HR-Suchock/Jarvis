"""Inlines the HUD fonts as base64 so the WebView never has to fetch font files."""
import base64, os, sys

SRC = os.environ.get("FONT_DIR", "fonts")
faces = [
    ("Orbitron", 400, "orbitron-latin-400-normal.woff2"),
    ("Orbitron", 700, "orbitron-latin-700-normal.woff2"),
    ("Rajdhani", 500, "rajdhani-latin-500-normal.woff2"),
    ("Rajdhani", 600, "rajdhani-latin-600-normal.woff2"),
]
css = []
for fam, w, fn in faces:
    p = os.path.join(SRC, fn)
    if not os.path.exists(p):
        sys.exit("missing font " + p)
    b = base64.b64encode(open(p, "rb").read()).decode()
    css.append(
        "@font-face{font-family:'%s';font-weight:%d;font-style:normal;font-display:swap;"
        "src:url(data:font/woff2;base64,%s) format('woff2');}" % (fam, w, b)
    )
os.makedirs("assets/css", exist_ok=True)
open("assets/css/fonts.css", "w").write("\n".join(css))
print("fonts.css written", sum(len(c) for c in css) // 1024, "KB")
