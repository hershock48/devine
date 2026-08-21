/**
 * Render the demo's link card from the real /og-card route and write public/og.jpg.
 *
 * link-cards.md's checklist, checked here rather than trusted:
 *   1200x630, under 1MB, and the CENTRE 630x630 CROP still carries the headline.
 *
 * That last one is the one that bites. Newer iOS crops link previews toward
 * square, so the outer 285px on each side can vanish and a card that reads
 * perfectly in a browser can lose its own headline in Messages. This writes the
 * crop out beside the card so it can actually be looked at, rather than asserted.
 *
 *   node tools/og.mjs --base http://localhost:3111
 */
import { chromium } from "playwright-core";
import { statSync } from "node:fs";
import sharp from "sharp";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const base = arg("base", "http://localhost:3111");
const out = arg("out", "public/og.jpg");

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
// deviceScaleFactor 1: the card IS 1200x630, not a 2x render of a 600x315 one.
const p = await b.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await p.goto(`${base}/og-card`, { waitUntil: "networkidle" });
await p.waitForTimeout(500);
const png = await p.screenshot({ clip: { x: 0, y: 0, width: 1200, height: 630 } });
await b.close();

// quality 86: link-cards.md says 82-88 lands well under the 1MB bar at this size.
await sharp(png).jpeg({ quality: 86, mozjpeg: true }).toFile(out);
const bytes = statSync(out).size;

// The safe band, written out so it can be looked at rather than assumed.
await sharp(out).extract({ left: 285, top: 0, width: 630, height: 630 }).toFile("/tmp/og-centre-crop.jpg");

const meta = await sharp(out).metadata();
console.log(`${out}  ${meta.width}x${meta.height}  ${(bytes / 1024).toFixed(1)}KB`);
console.log(`  1200x630 : ${meta.width === 1200 && meta.height === 630 ? "PASS" : "FAIL"}`);
console.log(`  under 1MB: ${bytes < 1024 * 1024 ? "PASS" : "FAIL"}`);
console.log(`  centre 630 crop written to /tmp/og-centre-crop.jpg — LOOK AT IT`);
