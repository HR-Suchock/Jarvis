"""Generates the Jarvis arc-reactor launcher icons (legacy PNGs + adaptive foreground)."""
import math
from PIL import Image, ImageDraw, ImageFilter

CY = (25, 227, 255)
BG = (2, 7, 13)


def reactor(size, scale=1.0, with_bg=True):
    S = size * 4  # supersample
    img = Image.new("RGBA", (S, S), BG + (255,) if with_bg else (0, 0, 0, 0))
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    c = S / 2
    R = S / 2 * scale

    def ring(r, w, col=CY, a=255):
        d.ellipse([c - r, c - r, c + r, c + r], outline=col + (a,), width=int(w))

    ring(R * 0.92, S * 0.012, a=120)
    # tick marks
    for i in range(60):
        ang = i * 6 * math.pi / 180
        r1, r2 = R * 0.84, R * (0.90 if i % 5 else 0.93)
        d.line([c + r1 * math.cos(ang), c + r1 * math.sin(ang), c + r2 * math.cos(ang), c + r2 * math.sin(ang)],
               fill=CY + (200,), width=int(S * 0.006))
    # three arc segments
    for k in range(3):
        a0 = k * 120 + 10
        d.arc([c - R * 0.74, c - R * 0.74, c + R * 0.74, c + R * 0.74], a0, a0 + 80, fill=CY + (255,), width=int(S * 0.02))
    ring(R * 0.56, S * 0.012, a=200)
    # coil blocks
    for i in range(10):
        ang = i * 36 * math.pi / 180
        r1, r2 = R * 0.34, R * 0.50
        x1, y1 = c + r1 * math.cos(ang), c + r1 * math.sin(ang)
        x2, y2 = c + r2 * math.cos(ang), c + r2 * math.sin(ang)
        d.line([x1, y1, x2, y2], fill=CY + (255,), width=int(S * 0.028))
    ring(R * 0.30, S * 0.014)
    # core
    d.ellipse([c - R * 0.20, c - R * 0.20, c + R * 0.20, c + R * 0.20], fill=(190, 250, 255, 255))
    blur = glow.filter(ImageFilter.GaussianBlur(S * 0.012))
    img = Image.alpha_composite(img, blur)
    img = Image.alpha_composite(img, glow)
    return img.resize((size, size), Image.LANCZOS)


def save(path, im):
    im.save(path)


# legacy icons (full bleed dark square, rounded corners)
sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for name, px in sizes.items():
    im = reactor(px, 0.94)
    mask = Image.new("L", (px, px), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, px - 1, px - 1], radius=int(px * 0.22), fill=255)
    out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    save(f"res/mipmap-{name}/ic_launcher.png", out)

# adaptive foreground: 108dp canvas @4x = 432px, art inside the 66% safe zone
fg = reactor(432, 0.62, with_bg=False)
save("res/drawable-nodpi/ic_launcher_fg.png", fg)
print("icons ok")
