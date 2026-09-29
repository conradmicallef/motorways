"""Regenerate native icons/splash from ../pwa/icons. Requires Pillow. Run: python scripts/generate-icons.py"""
from pathlib import Path
from PIL import Image, ImageDraw
root = Path(__file__).resolve().parent.parent
icons = root / "../pwa/icons"
BG_ICON = (0xf3, 0xec, 0xdc)
BG_SPLASH = (0xef, 0xe8, 0xd8)
mask512 = Image.open(icons / "icon-maskable-512.png").convert("RGBA")
any512 = Image.open(icons / "icon-512.png").convert("RGBA")

res = root / "android/app/src/main/res"
dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for d, s in dens.items():
    out = res / f"mipmap-{d}"
    # adaptive foreground: 108dp canvas; maskable art scaled so its safe zone fits the 66dp visible area
    fp = round(108 * s)
    fg = Image.new("RGBA", (fp, fp), (0, 0, 0, 0))
    art = round(fp * 0.85)
    fg.paste(mask512.resize((art, art), Image.LANCZOS), ((fp - art) // 2,) * 2)
    fg.save(out / "ic_launcher_foreground.png")
    # legacy icons 48dp
    lp = round(48 * s)
    sq = Image.new("RGBA", (lp, lp), BG_ICON + (255,))
    sq.alpha_composite(any512.resize((lp, lp), Image.LANCZOS))
    m = Image.new("L", (lp * 4, lp * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, lp * 4 - 1, lp * 4 - 1), radius=lp * 4 * 0.18, fill=255)
    sq2 = sq.copy(); sq2.putalpha(m.resize((lp, lp), Image.LANCZOS)); sq2.save(out / "ic_launcher.png")
    c = Image.new("L", (lp * 4, lp * 4), 0)
    ImageDraw.Draw(c).ellipse((0, 0, lp * 4 - 1, lp * 4 - 1), fill=255)
    sq3 = sq.copy(); sq3.putalpha(c.resize((lp, lp), Image.LANCZOS)); sq3.save(out / "ic_launcher_round.png")

(res / "values/ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#F3ECDC</color>\n</resources>\n')
# solid-colour splash (replaces the default per-density splash PNGs)
for p in res.glob("drawable*/splash.png"):
    p.unlink()
(res / "drawable/splash.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n    <solid android:color="#EFE8D8"/>\n</shape>\n')

# iOS: 1024x1024, opaque RGB (no alpha)
ios = root / "ios/App/App/Assets.xcassets"
mask512.convert("RGB").resize((1024, 1024), Image.LANCZOS).save(ios / "AppIcon.appiconset/AppIcon-512@2x.png")
for p in (ios / "Splash.imageset").glob("*.png"):
    Image.new("RGB", (2732, 2732), BG_SPLASH).save(p, optimize=True)
print("done")
