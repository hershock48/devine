/**
 * Per-product link cards, for the products that have real photographs.
 *
 * The proposal promises "a real photograph, sized right, on every page a customer
 * might text to somebody," and the page a customer actually texts is a product
 * page: "look at this one." A site-wide card on those pages sends the shop's brand
 * where it should send the arrangement.
 *
 * So: every photographed product gets its own 1200x630 JPEG, centre-covered from
 * its real photo, written to public/og/product/<slug>.jpg — JPEG rather than the
 * site's webp because webp support in link scrapers is still patchy, and a card
 * that fails to parse fails to a bare text row. A manifest is written beside them
 * so generateMetadata can know which products have one WITHOUT touching the
 * filesystem at render time.
 *
 * Products without a photograph fall back to the site card. Their Bloom art is an
 * inline SVG composed in the browser; there is no file to point a scraper at, and
 * screenshotting generated placeholder art into a card would put our stand-in
 * artwork where the letter promises their flowers.
 *
 *   node tools/og-products.mjs
 */
import { readdirSync, mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const SRC = "public/img/product";
const OUT = "public/og/product";
mkdirSync(OUT, { recursive: true });

// The -sm files are the 400px card renditions; the full files are the source.
const slugs = readdirSync(SRC)
  .filter((f) => f.endsWith(".webp") && !f.endsWith("-sm.webp"))
  .map((f) => f.replace(/\.webp$/, ""));

const made = [];
for (const slug of slugs) {
  await sharp(`${SRC}/${slug}.webp`)
    .resize(1200, 630, { fit: "cover", position: "attention" })
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(`${OUT}/${slug}.jpg`);
  made.push(slug);
}

writeFileSync("src/lib/og-manifest.json", JSON.stringify(made.sort(), null, 1));
console.log(`${made.length} product cards -> ${OUT}, manifest -> src/lib/og-manifest.json`);
