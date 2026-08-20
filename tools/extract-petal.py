#!/usr/bin/env python3
"""
Lifts one petal out of DeVine's own logo, so the petal that blows across the header
is theirs rather than a drawing that resembles theirs. glaze.md: "If the real asset
exists, use the real asset."

HOW, and why each step is there:

1. Extract the ink. Their file is "white-bg-fade": black artwork over a white oval at
   alpha 174. Alpha becomes the original alpha scaled by darkness, so the line work
   survives and the white fill goes.

2. Dilate before filling. The drawing is deliberately sketchy and half its strokes
   have gaps in them. Flood filling the raw ink leaks straight out through every gap
   and swallows the whole image. Three passes of a 5px max filter close them.

3. Flood fill the petal interior from a seed point. This is what makes the boundary
   theirs: the fill stops where their stroke is, so the shape is whatever they drew.

4. Grow the filled region back past the stroke that bounds it, then mask the original
   ink with it. Without this you get a silhouette with a cut edge. With it, the petal
   arrives carrying its own outline.

5. Re-trace just that. 2.8KB of path data instead of the 41KB the whole lily costs,
   which is what makes it affordable to inline in a header on every page.

REJECTED: clipping an ellipse over the flower and taking what fell inside. It cut
three strokes mid-line and looked like a torn sticker. Rendered it, looked at it,
threw it away. Also rejected: cropping a rectangle out of the raster, which cannot
work on overlapping line art, for the same reason.

The seed below is the lower-left petal. Two other seeds fill cleanly if a different
petal is ever wanted: (0.132, 0.515) is a thin sliver of the left petal and
(0.292, 0.505) is the right one, which is partly hidden behind the flower's centre.
"""
import pathlib, subprocess, sys
from collections import deque
from PIL import Image, ImageFilter

SRC = sys.argv[1] if len(sys.argv) > 1 else "DeVine_Logo-white-bg-fade.png"
SEED_FRAC = (0.168, 0.628)   # lower-left petal
OUT = pathlib.Path("petal.svg")

im = Image.open(SRC).convert("RGBA")
px = im.load(); W, H = im.size
for y in range(H):
    for x in range(W):
        r, g, b, a = px[x, y]
        if a:
            lum = (r * 299 + g * 587 + b * 114) // 1000
            px[x, y] = (17, 17, 17, int(a * (255 - lum) / 255))

flat = Image.new("RGB", im.size, (255, 255, 255))
flat.paste(im, mask=im.split()[-1])
ink = flat.convert("L").point(lambda v: 255 if v < 160 else 0)
for _ in range(3):
    ink = ink.filter(ImageFilter.MaxFilter(5))
ip = ink.load()

seed = (int(SEED_FRAC[0] * W), int(SEED_FRAC[1] * H))
if ip[seed]:
    sys.exit(f"seed {seed} landed on ink")

seen, q, n = set(), deque([seed]), 0
while q:
    x, y = q.popleft()
    if (x, y) in seen:
        continue
    seen.add((x, y)); n += 1
    if n > 900_000:
        sys.exit("fill leaked: the dilation did not close every gap")
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        nx, ny = x + dx, y + dy
        if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen and not ip[nx, ny]:
            q.append((nx, ny))

mask = Image.new("L", im.size, 0)
mp = mask.load()
for p in seen:
    mp[p] = 255
for _ in range(4):
    mask = mask.filter(ImageFilter.MaxFilter(9))
mask = mask.filter(ImageFilter.GaussianBlur(1.2)).point(lambda v: 255 if v > 40 else 0)

petal = Image.new("RGBA", im.size, (0, 0, 0, 0))
petal.paste(im, mask=mask)
petal = petal.crop(petal.getbbox())
flat2 = Image.new("RGB", petal.size, (255, 255, 255))
flat2.paste(petal, mask=petal.split()[-1])
flat2.convert("L").filter(ImageFilter.GaussianBlur(0.5)).point(lambda v: 0 if v < 170 else 255, "1").save("petal.pbm")
subprocess.run(["potrace", "-s", "-o", str(OUT), "--flat", "-t", "6", "-O", "0.8", "petal.pbm"], check=True)

print(f"petal {petal.size} -> {OUT} ({OUT.stat().st_size/1024:.1f}KB)")
print("NOTE: potrace path data is in tenth-points with Y up. It needs the group")
print('transform "translate(0,H*10) scale(1,-1)" or it draws 10x and upside down.')
