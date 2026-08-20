/**
 * Sample the logo motion frame by frame and print what it ACTUALLY does.
 *
 * Every motion bug on this project so far has been invisible in the source and
 * obvious in the numbers: a petal drawn at ten times size and upside down, a veil
 * that finished its reveal at 500ms while the petal it was supposed to be following
 * was still travelling. So: measure, do not read.
 *
 * What it prints, per sample:
 *   t       ms since the animations were armed
 *   x,y     the petal's real position in the header, in px, from getBoundingClientRect
 *   vx      px/s since the previous sample — the column that exposes a stutter,
 *           because a stiff animation is one whose velocity keeps dropping to near
 *           zero and climbing back
 *   rot     the composed Z rotation, in degrees
 *   drot    degrees/s — a petal that stops rotating mid-flight reads as a sticker
 *   op      opacity
 *
 *   node tools/motion.mjs --base http://localhost:3111 [--el .petal--lead]
 */
import { chromium } from "playwright-core";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const base = arg("base", "http://localhost:3111");
const sel = arg("el", ".petal--lead");
const dur = Number(arg("dur", 3000));
const step = Number(arg("step", 60));

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(base + "/demo", { waitUntil: "load" });

// Restart every animation from zero so t=0 is a real origin rather than "whenever
// the page happened to finish loading".
await p.evaluate((s) => {
  document.querySelectorAll(".breeze").forEach((n) => n.classList.remove("is-blowing"));
  void document.querySelector(s)?.offsetWidth;
  document.querySelectorAll(".breeze").forEach((n) => n.classList.add("is-blowing"));
}, sel);

const rows = [];
const t0 = Date.now();
while (Date.now() - t0 < dur) {
  const r = await p.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    /*
      Measure the INNERMOST element, not the outer one. The motion is composed
      across three nested elements — drift on the outer, float on the middle, turn
      on the inner — so the outer element's own rect only ever reports the X leg.
      Measuring it made a full arc look like a perfectly flat 0.6px of vertical
      travel, which is a lie about the animation and not a fact about it.
    */
    const box = (el.querySelector(".petal-turn") ?? el).getBoundingClientRect();
    // Compose the whole chain so the number is what the eye sees, not what one
    // element's own matrix says.
    let rot = 0;
    for (const n of [el, el.querySelector(".petal-float"), el.querySelector(".petal-turn")]) {
      if (!n) continue;
      const m = new DOMMatrixReadOnly(getComputedStyle(n).transform);
      rot += (Math.atan2(m.b, m.a) * 180) / Math.PI;
    }
    return {
      x: +box.x.toFixed(1),
      y: +box.y.toFixed(1),
      rot: +rot.toFixed(1),
      op: +getComputedStyle(el).opacity,
    };
  }, sel);
  if (r) rows.push({ t: Date.now() - t0, ...r });
  await p.waitForTimeout(step);
}

console.log("   t     x      y     vx      rot   drot    op");
let prev = null;
let minV = Infinity, maxV = 0, stalls = 0, rotStalls = 0;
for (const r of rows) {
  let vx = "", drot = "";
  if (prev) {
    const dt = (r.t - prev.t) / 1000;
    const v = (r.x - prev.x) / dt;
    const dr = (r.rot - prev.rot) / dt;
    vx = v.toFixed(0);
    drot = dr.toFixed(0);
    if (r.op > 0.05 && prev.op > 0.05) {
      minV = Math.min(minV, Math.abs(v));
      maxV = Math.max(maxV, Math.abs(v));
      if (Math.abs(v) < 40) stalls++;
      if (Math.abs(dr) < 3) rotStalls++;
    }
  }
  console.log(
    `${String(r.t).padStart(4)}  ${String(r.x).padStart(6)} ${String(r.y).padStart(6)} ` +
      `${String(vx).padStart(6)}  ${String(r.rot).padStart(6)} ${String(drot).padStart(6)}  ${r.op.toFixed(2)}`,
  );
  prev = r;
}
console.log(
  `\nwhile visible: vx ${minV === Infinity ? "-" : minV.toFixed(0)}..${maxV.toFixed(0)} px/s` +
    ` | near-stationary samples: ${stalls} | rotation-stalled samples: ${rotStalls}`,
);
await b.close();
