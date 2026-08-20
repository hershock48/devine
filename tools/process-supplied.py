#!/usr/bin/env python3
"""
Processes the photographs and the logo Kevin supplied.

MATCHING IS DERIVED, NOT EYEBALLED. The uploads still carry their original
WordPress filenames (IMG_0688, Large-Dish-Garden, Untitled-design-1), and those
filenames are already in products.json from the catalog harvest. So each photo is
matched to a product by filename rather than by me looking at an arrangement and
guessing which of the 57 it is.

One wrinkle: the upload pipeline strips punctuation, so "Large-Dish-Garden.jpg"
arrives as "LargeDishGarden.webp". Both sides are therefore normalized to
lowercase alphanumerics before comparing. Without that, every hyphenated filename
silently fails to match and lands in the unmatched pile.

TWO WIDTHS per product: 400 for grid cards, 1000 for the detail page. A phone
loading a grid of twelve 750px photographs otherwise pays for all twelve.

THE LOGO arrives as "white-bg-fade": the artwork is black, but the oval interior is
white at alpha 174, so on the site's cream ground it renders as a milky patch with a
hard edge. Rather than ask for another export, the ink is lifted out: alpha becomes
the original alpha scaled by how dark each pixel is, so the black line work stays and
the white fill disappears, anti-aliased edges included. One mark that then sits
correctly on cream, on white, and on the dark footer.

The favicon is cropped to the lily alone. The full oval is 1.6:1 with a wordmark in
it, and at 16px that is a grey smudge.
"""
import json, pathlib, re, subprocess, sys
from PIL import Image

UP = pathlib.Path("/root/.claude/uploads/a306abbd-0c42-515d-9ac4-8322b2506bf8")
OUT = pathlib.Path("/root/devine/public/img")
SRC = pathlib.Path("/root/devine-src")

norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())

catalog = json.loads((SRC / "products.json").read_text())
# original filename stem -> product slug
by_key = {}
for p in catalog["products"]:
    stem = p["img"].split("/")[-1]
    stem = re.sub(r"\.(jpe?g|png|webp)$", "", stem, flags=re.I)
    stem = stem.replace("-scaled", "")
    by_key[norm(stem)] = p["slug"]

manifest = {}


def save(im, dest, widths):
    entry = {}
    for w, tag in widths:
        c = im.copy()
        if c.width > w:
            c = c.resize((w, round(c.height * w / c.width)), Image.LANCZOS)
        out = OUT / f"{dest}{'' if tag == 'lg' else '-' + tag}.webp"
        out.parent.mkdir(parents=True, exist_ok=True)
        c.save(out, "WEBP", quality=84, method=6)
        if tag == "lg":
            entry = {"w": c.width, "h": c.height}
    manifest[dest] = entry


def flatten(im):
    im = im.convert("RGBA") if im.mode in ("P", "LA") else im
    if im.mode == "RGBA":
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert("RGB")


lifestyle, matched, unmatched = [], [], []

for f in sorted(UP.iterdir()):
    name = f.name.split("-", 1)[1] if "-" in f.name else f.name
    stem = re.sub(r"\.(jpe?g|png|webp)$", "", name, flags=re.I)

    if "logo" in stem.lower():
        logo = Image.open(f).convert("RGBA")
        px = logo.load()
        w, h = logo.size
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a:
                    lum = (r * 299 + g * 587 + b * 114) // 1000
                    px[x, y] = (17, 17, 17, int(a * (255 - lum) / 255))
        save(logo, "brand/logo", [(1200, "lg"), (480, "sm")])
        lily = logo.crop((int(w * 0.05), int(h * 0.10), int(w * 0.37), int(h * 0.88)))
        side = max(lily.size)
        sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        sq.paste(lily, ((side - lily.width) // 2, (side - lily.height) // 2))
        sq.resize((180, 180), Image.LANCZOS).save(OUT / "brand/lily-icon.png")
        print(f"logo  ink extracted {logo.size}")
        continue

    k = norm(stem)
    slug = None
    for key, s in by_key.items():
        # the upload may carry extra WordPress size suffixes (…1024x923750x750)
        if k.startswith(key):
            slug = s
            break
    if slug:
        save(flatten(Image.open(f)), f"product/{slug}", [(400, "sm"), (1000, "lg")])
        matched.append(slug)
    else:
        lifestyle.append(f)
        unmatched.append(stem)

# Anything that is not a catalog product is shop atmosphere: the studio, the
# greening shelves, a close-up of somebody's work. Numbered rather than named,
# because we do not know what they are and will not pretend to.
for i, f in enumerate(lifestyle, 1):
    save(flatten(Image.open(f)), f"shop/shop-{i}", [(1400, "lg")])

path = SRC / "image-manifest.json"
existing = json.loads(path.read_text()) if path.exists() and path.read_text().strip() else {}
existing.update(manifest)
path.write_text(json.dumps(existing, indent=1, sort_keys=True))

total = sum(f.stat().st_size for f in OUT.rglob("*.webp"))
print(f"\nmatched to products : {len(matched)}")
print(f"  {', '.join(sorted(matched))}")
print(f"shop atmosphere     : {len(lifestyle)}  ({', '.join(unmatched)})")
print(f"total on disk       : {total/1024/1024:.1f}MB")

have = set(matched)
missing = [p["slug"] for p in catalog["products"] if p["slug"] not in have]
print(f"\nstill without a photograph: {len(missing)} of {len(catalog['products'])}")
print("  " + ", ".join(missing))
