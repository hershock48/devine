/**
 * Full-page screenshots, for looking at rather than for measuring.
 *
 * The scroll sweep is not optional. A full-page screenshot does not trigger lazy
 * loading, so every `loading="lazy"` image below the fold comes out blank and the
 * band sections look like empty grey slabs — which is exactly the wrong answer once,
 * on this project, and cost half an hour.
 *
 *   node tools/shots.mjs --base http://localhost:3111 --width 1440 --out /tmp/shots
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};

const base = arg("base", "http://localhost:3111");
const width = Number(arg("width", 1440));
const out = arg("out", "/tmp/shots");
const routes = arg(
  "routes",
  "/demo,/demo/shop,/demo/shop/plants,/demo/weddings,/demo/celebration-of-life,/demo/greening,/demo/delivery,/demo/workshops,/demo/about,/demo/product/eden",
).split(",");

mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width, height: 900 } });

for (const r of routes) {
  await page.goto(base + r, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await new Promise((res) => {
      let y = 0;
      const step = () => {
        y += window.innerHeight;
        window.scrollTo(0, y);
        if (y < document.body.scrollHeight) setTimeout(step, 90);
        else { window.scrollTo(0, 0); setTimeout(res, 300); }
      };
      step();
    });
  });
  await page.waitForTimeout(400);
  const name = (r.replace(/\//g, "_") || "_root") + `-${width}.png`;
  await page.screenshot({ path: `${out}/${name}`, fullPage: true });
  console.log(name);
}

await browser.close();
