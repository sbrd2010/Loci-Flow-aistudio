"""Loci Focus icons v2 — bumpy brain silhouette + wordmark splash.

Regenerates all Android launcher icons and splash screens.
Requires Pillow (pip install Pillow). Run from anywhere:

    python3 web/android/scripts/gen-icons.py
"""
import os, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

_HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(_HERE, "..", "app", "src", "main", "res")

DARK = (11, 15, 20)
ACCENT = (72, 128, 255)
ACCENT2 = (109, 74, 255)
WHITE = (242, 245, 250)
RING = (150, 180, 255)

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i]-a[i])*t) for i in range(3))

def gradient_bg(size, top=ACCENT, bottom=ACCENT2):
    img = Image.new("RGB", (size, size), DARK)
    px = img.load()
    for y in range(size):
        c = lerp(top, bottom, y/max(1,size-1))
        for x in range(size):
            px[x, y] = c
    return img

def brain_blobs(d, cx, cy, r, color):
    bumps = []
    for side in (-1, 1):
        lobe_cx = cx + side * r * 0.34
        n = 7
        for i in range(n):
            ang = math.radians(-150 + i * (140/(n-1)))
            bx = lobe_cx + math.cos(ang) * r * 0.62
            by = cy + math.sin(ang) * r * 0.62 - r*0.05
            br = r * (0.30 - 0.015*abs(i-(n-1)/2))
            bumps.append((bx, by, br))
        for j in range(3):
            bx = lobe_cx + side * r * 0.12
            by = cy - r*0.05 + j * r * 0.22
            bumps.append((bx, by, r*0.42))
        bumps.append((lobe_cx, cy + r*0.55, r*0.30))
    for k in range(3):
        bx = cx + (k-1) * r * 0.18
        bumps.append((bx, cy - r*0.58, r*0.30))
    for j in range(5):
        by = cy - r*0.55 + j * r * 0.27
        bumps.append((cx, by, r*0.36))
    d.ellipse([cx-r*0.12, cy+r*0.55, cx+r*0.12, cy+r*0.92], fill=color)
    for (bx, by, br) in bumps:
        d.ellipse([bx-br, by-br, bx+br, by+br], fill=color)

def draw_brain(d, cx, cy, r, color, gyri_color, stroke_w):
    brain_blobs(d, cx, cy, r, color)
    d.line([cx, cy-r*0.85, cx, cy+r*0.70], fill=lerp(color, DARK, 0.55), width=max(2, int(stroke_w*0.7)))
    for side in (-1, 1):
        lx = cx + side*r*0.34
        for frac in (0.55, 0.34):
            arx = r*0.30*frac*1.6; ary = r*0.40*frac*1.6
            d.arc([lx-arx, cy-ary-r*0.1, lx+arx, cy+ary-r*0.1], 20, 160, fill=gyri_color, width=stroke_w)

def make_foreground(size):
    img = Image.new("RGBA", (size, size), (0,0,0,0))
    d = ImageDraw.Draw(img)
    r = size * 0.30
    draw_brain(d, size/2, size/2, r, WHITE, RING, max(2, int(r*0.045)))
    return img.filter(ImageFilter.SMOOTH_MORE)

def make_legacy(size):
    img = gradient_bg(size, ACCENT, ACCENT2).convert("RGBA")
    d = ImageDraw.Draw(img)
    r = size * 0.30
    draw_brain(d, size/2, size/2 - size*0.02, r, WHITE, lerp(ACCENT, DARK, 0.25), max(2, int(r*0.045)))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0,0,size,size], radius=int(size*0.22), fill=255)
    out = Image.new("RGBA", (size, size), (0,0,0,0)); out.paste(img, (0,0), mask)
    return out

def make_round(size):
    img = make_legacy(size)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0,0,size,size], fill=255)
    out = Image.new("RGBA", (size, size), (0,0,0,0)); out.paste(img, (0,0), mask)
    return out

def font(size):
    for p in ["/usr/share/fonts/truetype/noto/NotoSans-Black.ttf",
              "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def make_splash(w, h):
    img = Image.new("RGB", (w, h), DARK)
    d = ImageDraw.Draw(img)
    r = min(w, h) * 0.13
    cy = h*0.42
    draw_brain(d, w/2, cy, r, ACCENT, lerp(ACCENT, DARK, 0.5), max(2, int(r*0.05)))
    f = font(int(min(w,h)*0.085))
    txt = "Loci Focus"
    bbox = d.textbbox((0,0), txt, font=f)
    tw = bbox[2]-bbox[0]
    d.text((w/2 - tw/2, cy + r*1.5), txt, fill=WHITE, font=f)
    return img

LEGACY = {"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}
FG = {"mdpi":108,"hdpi":162,"xhdpi":216,"xxhdpi":324,"xxxhdpi":432}
PORT = {"mdpi":(320,480),"hdpi":(480,800),"xhdpi":(720,1280),"xxhdpi":(1080,1920),"xxxhdpi":(1280,1920)}
LAND = {"mdpi":(480,320),"hdpi":(800,480),"xhdpi":(1280,720),"xxhdpi":(1920,1080),"xxxhdpi":(1920,1280)}

for dens, sz in FG.items():
    make_foreground(sz).save(os.path.join(RES, f"mipmap-{dens}", "ic_launcher_foreground.png"))
for dens, sz in LEGACY.items():
    make_legacy(sz).save(os.path.join(RES, f"mipmap-{dens}", "ic_launcher.png"))
    make_round(sz).save(os.path.join(RES, f"mipmap-{dens}", "ic_launcher_round.png"))
make_splash(480,320).save(os.path.join(RES, "drawable", "splash.png"))
for dens,(w,h) in PORT.items(): make_splash(w,h).save(os.path.join(RES, f"drawable-port-{dens}", "splash.png"))
for dens,(w,h) in LAND.items(): make_splash(w,h).save(os.path.join(RES, f"drawable-land-{dens}", "splash.png"))
make_legacy(512).save(os.path.join(_HERE, "loci_icon_master.png"))
make_splash(1280,1920).save(os.path.join(_HERE, "loci_splash_master.png"))
print("Icons + splash generated.")
