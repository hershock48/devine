#!/usr/bin/env python3
"""
Draw the hero photograph by hand.

WHY. Their mark is an ink line drawing of a lily. The photography is photography.
Nothing on the site connected the two. This traces a few of the real blooms out of the
real hero photograph so the page can draw them on, hold them a beat, and let them go —
the same hand that drew the logo, passing over the picture.

WHY THE BLOOMS ARE NAMED BY HAND AND NOT FOUND AUTOMATICALLY. The first version
segmented the whole frame by colour and kept the biggest, most solid blobs. It
returned three strokes, two of which were sprawling outlines around patches of fern,
because a colour mask cannot tell a flower from a well-lit leaf. A botanical
illustrator does not outline everything in the vase; they choose four things and leave
the rest to the eye. Choosing them here is not a shortcut around the hard part, it IS
the part — and it is stable, which a threshold sweep over a photograph is not.

Re-point it at a different photograph by editing BLOOMS. Each entry is a box known to
contain one flower, and everything inside the box is measured from the pixels.

WHAT MAKES THE LINE READ AS DRAWN, in the order the operations matter:

  1. AN OUTLINE ALONE IS A BLOB. A flower drawn as one closed contour reads as a
     silhouette, not a drawing. What makes a botanical line read is the INTERIOR — the
     two or three lines where one petal folds behind another. Those come from a Canny
     edge map inside the bloom, longest chains first.
  2. SIMPLIFY HARD. A drawn line holds far fewer decisions than a segmentation mask.
  3. DISPLACE ALONG A SMOOTH FIELD, never per-point. Per-point jitter is the classic
     mistake and reads as a shaky line — a bad fax. A hand wobbles slowly: the error at
     one point is close to the error at the next, so the offsets are low-frequency
     noise and the line waves rather than vibrates.
  4. A PEN LIFTS. Closed machine contours meet themselves exactly. These are left
     open, with a few points dropped at one end.

    python3 tools/trace-hero.py --img public/img/shop/shop-4.webp \\
        --out src/lib/hero-trace.json --preview /tmp/preview.svg
"""
import argparse
import json
import math
import random

import cv2
import numpy as np

# x0, y0, x1, y1 in the source image, one box per flower. Verified by cropping each
# one and looking at it; see the note above on why these are chosen rather than found.
BLOOMS = [
    ("liso-top", 372, 158, 578, 340),
    ("liso-mid", 362, 320, 618, 512),
    ("alst-up", 452, 548, 706, 752),
    ("liso-low", 104, 742, 306, 932),
    # DROPPED: the lower alstroemeria cluster. Three blooms overlap there and no
    # threshold separates one from its neighbours — it traced as a scribble every
    # time. Four flowers drawn well is a drawing; five with one wrong is a mistake
    # someone will notice before they notice the other four.
]

# A box is a hint, not a crop. If the flower runs past its edge, the contour follows
# the BOX instead of the bloom and you get a straight machine line down one side —
# which is exactly what the first pass produced on three of five blooms, and the
# single most obvious tell that nothing here was drawn by hand.
EDGE_TOL = 3
MAX_EDGE_FRACTION = 0.10


def smooth_noise(n, rng, octaves=(2, 5, 11), amps=(1.0, 0.4, 0.16)):
    """Low-frequency noise along a path. See note 3: a hand wobbles slowly."""
    out = np.zeros(n)
    t = np.linspace(0, 2 * math.pi, n, endpoint=False)
    for o, a in zip(octaves, amps):
        out += a * np.sin(o * t + rng.uniform(0, 2 * math.pi))
    return out / sum(amps)


def resample(pts, n, closed=True):
    """Even spacing, so the wobble has a constant wavelength in real distance rather
    than bunching wherever the mask happened to be detailed."""
    p = np.vstack([pts, pts[:1]]) if closed else pts
    d = np.sqrt((np.diff(p, axis=0) ** 2).sum(1))
    s = np.concatenate([[0], np.cumsum(d)])
    if s[-1] <= 0:
        return pts
    want = np.linspace(0, s[-1], n, endpoint=not closed)
    return np.stack([np.interp(want, s, p[:, 0]), np.interp(want, s, p[:, 1])], axis=1)


def to_bezier(pts, tension=0.36):
    """Catmull-Rom through the points as cubic beziers. Forty points read as a polygon
    however well placed; the curve is what makes it a stroke."""
    n = len(pts)
    if n < 3:
        return ""
    d = [f"M{pts[0][0]:.1f},{pts[0][1]:.1f}"]
    for i in range(n - 1):
        p0 = pts[max(i - 1, 0)]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[min(i + 2, n - 1)]
        c1 = p1 + (p2 - p0) * tension / 2
        c2 = p2 - (p3 - p1) * tension / 2
        d.append(f"C{c1[0]:.1f},{c1[1]:.1f} {c2[0]:.1f},{c2[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}")
    return " ".join(d)


def hand(pts, amp, rng, drop=(1, 4), closed=True):
    """Steps 2-4: resample, wave the line off the boundary, then lift the pen."""
    n = max(22, min(46, len(pts)))
    pts = resample(pts, n, closed=closed)
    centre = pts.mean(0)
    radial = pts - centre
    radial /= np.linalg.norm(radial, axis=1, keepdims=True) + 1e-6
    pts = pts + radial * (smooth_noise(n, rng) * amp)[:, None]
    if closed:
        pts = np.roll(pts, -rng.randrange(n), axis=0)
        pts = pts[: n - rng.randint(*drop)]
    return pts


def bloom_mask(bgr):
    """The flower's own colour, sampled from the middle of its own box rather than
    from a hue table. Petals in shade are the same hue and a lot darker, so the
    tolerance on value is wide and the tolerance on hue is tight."""
    hsv = cv2.cvtColor(cv2.bilateralFilter(bgr, 9, 90, 90), cv2.COLOR_BGR2HSV)
    h, w = hsv.shape[:2]
    core = hsv[int(h * .3):int(h * .7), int(w * .3):int(w * .7)].reshape(-1, 3)
    hue = np.median(core[:, 0])
    sat = np.median(core[:, 1])
    lo = (max(hue - 13, 0), max(sat * .35, 45), 35)
    hi = (min(hue + 13, 179), 255, 255)
    m = cv2.inRange(hsv, lo, hi)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k, iterations=3)
    return cv2.morphologyEx(m, cv2.MORPH_OPEN, k, iterations=1)


def interior_lines(bgr, mask, rng, want=3):
    """The lines that make it a drawing rather than a silhouette: where one petal
    folds behind another. Canny inside the bloom, eroded off the silhouette edge so
    the outline is not simply traced a second time, longest chains kept."""
    g = cv2.cvtColor(cv2.bilateralFilter(bgr, 9, 110, 110), cv2.COLOR_BGR2GRAY)
    g = cv2.createCLAHE(3.0, (8, 8)).apply(g)  # petal folds are low contrast in shade
    e = cv2.Canny(g, 26, 68)
    inner = cv2.erode(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)), iterations=2)
    e = cv2.bitwise_and(e, inner)
    e = cv2.dilate(e, np.ones((2, 2), np.uint8))
    cs, _ = cv2.findContours(e, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    out = []
    for c in sorted(cs, key=cv2.arcLength.__call__ if False else (lambda c: -cv2.arcLength(c, False))):
        pts = c.reshape(-1, 2).astype(float)
        # findContours walks an open ridge out and back; the first half is the ridge
        if len(pts) > 14:
            pts = pts[: len(pts) // 2]
        if len(pts) < 9:
            continue
        span = np.linalg.norm(pts[0] - pts[-1])
        if span < 0.22 * max(bgr.shape[:2]):
            continue  # a scribble, not a fold
        eps = 0.014 * cv2.arcLength(pts.astype(np.float32), False)
        pts = cv2.approxPolyDP(pts.astype(np.float32), eps, False).reshape(-1, 2).astype(float)
        if len(pts) < 4:
            continue
        if any(np.linalg.norm(pts.mean(0) - o.mean(0)) < 0.18 * max(bgr.shape[:2]) for o in out):
            continue
        out.append(hand(pts, 0.9, rng, closed=False))
        if len(out) >= want:
            break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--img", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--preview")
    ap.add_argument("--seed", type=int, default=11)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    img = cv2.imread(args.img, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"could not read {args.img}")
    H, W = img.shape[:2]

    strokes = []
    for name, x0, y0, x1, y1 in BLOOMS:
        roi = img[y0:y1, x0:x1]
        mask = bloom_mask(roi)
        cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cs:
            print(f"  ! {name}: no contour")
            continue
        c = max(cs, key=cv2.contourArea)
        if cv2.contourArea(c) < 0.16 * roi.shape[0] * roi.shape[1]:
            print(f"  ! {name}: contour too small, skipped")
            continue

        # Reject a bloom that is leaning on its own box. Widen the box and re-run
        # rather than shipping a flower with one ruled edge.
        rh, rw = roi.shape[:2]
        pc = c.reshape(-1, 2)
        on_edge = (
            (pc[:, 0] <= EDGE_TOL) | (pc[:, 0] >= rw - 1 - EDGE_TOL)
            | (pc[:, 1] <= EDGE_TOL) | (pc[:, 1] >= rh - 1 - EDGE_TOL)
        ).mean()
        if on_edge > MAX_EDGE_FRACTION:
            print(f"  ! {name}: {on_edge:.0%} of the outline is on the box edge — widen the box")
            continue

        eps = 0.010 * cv2.arcLength(c, True)
        outer = cv2.approxPolyDP(c, eps, True).reshape(-1, 2).astype(float)
        outer = hand(outer, 0.020 * math.sqrt(cv2.contourArea(c)), rng, closed=True)
        strokes.append({"kind": "outer", "bloom": name,
                        "d": to_bezier(outer + [x0, y0]),
                        "len": round(float(cv2.arcLength(outer.astype(np.float32), False)), 1)})

        for line in interior_lines(roi, mask, rng):
            strokes.append({"kind": "inner", "bloom": name,
                            "d": to_bezier(line + [x0, y0]),
                            "len": round(float(cv2.arcLength(line.astype(np.float32), False)), 1)})
        print(f"  {name}: outer + {sum(1 for s in strokes if s['bloom'] == name) - 1} inner")

    keep = [s for s in strokes if s["d"]]
    # Relative length, so a long outline can be given longer to draw than a short
    # petal fold. Every path also carries pathLength="1" in the markup, which is what
    # lets one dash rule cover paths of wildly different real lengths; this ratio is
    # only used to scale the DURATION so the pen appears to move at one speed.
    longest = max((s["len"] for s in keep), default=1) or 1
    for s in keep:
        s["rel"] = round(max(0.42, s["len"] / longest), 3)
        del s["len"]

    data = {"w": W, "h": H, "strokes": keep}
    with open(args.out, "w") as f:
        json.dump(data, f, indent=1)
    print(f"{len(data['strokes'])} strokes -> {args.out}  (frame {W}x{H})")

    if args.preview:
        paths = "\n".join(
            f'<path d="{s["d"]}" fill="none" stroke="#fff" stroke-width="{3.4 if s["kind"] == "outer" else 2.2}"'
            f' stroke-linecap="round" stroke-linejoin="round" opacity="{.95 if s["kind"] == "outer" else .8}"/>'
            for s in data["strokes"]
        )
        with open(args.preview, "w") as f:
            f.write(
                f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
                f'<image href="{args.img.split("/")[-1]}" width="{W}" height="{H}"/>{paths}</svg>'
            )
        print("preview ->", args.preview)


if __name__ == "__main__":
    main()
