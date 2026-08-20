/**
 * A contact sheet of the logo motion: N crops of the header, evenly spaced across
 * the flight, stacked into one image so the whole arc can be looked at at once.
 *
 * The numbers in tools/motion.mjs catch stalls and lurches. They do not catch a
 * petal drawn upside down at ten times size, or one passing through the middle of
 * the wordmark. Both of those happened. Measure AND look.
 *
 *   node tools/filmstrip.mjs --base http://localhost:3111 --out /tmp/strip.png
 */
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const base = arg("base", "http://localhost:3111");
const out = arg("out", "/tmp/strip.png");
const frames = Number(arg("frames", 12));
const span = Number(arg("span", 3200));

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1440, height: 400 } });
const shots = [];

// One page load per frame, each paused at a different offset. Pausing a running
// animation from script drifts; restarting and waiting a fixed time does not.
for (let i = 0; i < frames; i++) {
  const t = Math.round((span / (frames - 1)) * i);
  await p.goto(base + "/demo", { waitUntil: "load" });
  await p.evaluate(() => {
    document.querySelectorAll(".breeze").forEach((n) => n.classList.remove("is-blowing"));
    void document.body.offsetWidth;
    document.querySelectorAll(".breeze").forEach((n) => n.classList.add("is-blowing"));
  });
  await p.waitForTimeout(t);
  shots.push({ t, buf: await p.screenshot({ clip: { x: 60, y: 0, width: 460, height: 64 } }) });
}
await b.close();

// Stack them with sharp if it is here, otherwise write the frames out separately.
let sharp = null;
try { sharp = (await import("sharp")).default; } catch {}
if (!sharp) {
  shots.forEach((s) => writeFileSync(out.replace(/\.png$/, `-${s.t}.png`), s.buf));
  console.log(`wrote ${shots.length} frames beside ${out} (sharp not installed)`);
} else {
  const H = 64, W = 460;
  await sharp({ create: { width: W, height: H * frames, channels: 3, background: "#faf7f1" } })
    .composite(shots.map((s, i) => ({ input: s.buf, top: i * H, left: 0 })))
    .png()
    .toFile(out);
  console.log(`${out} — ${frames} frames, ${shots.map((s) => s.t).join("/")}ms`);
}
