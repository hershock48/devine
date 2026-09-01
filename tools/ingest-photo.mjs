/**
 * One command per photo from the drop to the site.
 *
 *   node tools/ingest-photo.mjs <file-or-directory> [...more]
 *
 * The photo drop (/photos) emails each shot as <slug>.jpg, so the filename IS
 * the match: save the attachment anywhere, point this tool at it (or at the
 * whole downloads folder), and every file whose basename is a catalog slug
 * becomes the product's photograph. No eyeballing, same rule as the original
 * harvest (tools/process-supplied.py): matching is derived, not guessed.
 *
 * Per file it reproduces that pipeline's exact output shape, because the site
 * reads it: public/img/product/<slug>.webp at 1000 wide (detail page),
 * <slug>-sm.webp at 400 (grid cards), webp quality 84, white-flattened; the
 * product's entry in src/lib/image-manifest.json (which is what makes
 * hasPhoto() true, pulls the row off /photos, and returns the card grid to a
 * category). Then og-products.mjs runs once at the end so the new photo also
 * becomes its product's 1200x630 link card.
 *
 * Files whose basename is not a catalog slug are skipped BY NAME, loudly: a
 * mistyped slug must not become a silent nothing. Nothing here deploys;
 * commit and push is still the human's move, with the printed checklist.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.join(import.meta.dirname, "..");
const catalog = JSON.parse(readFileSync(path.join(ROOT, "tools/products.json"), "utf8"));
const slugs = new Set(catalog.products.map((p) => p.slug));

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node tools/ingest-photo.mjs <file-or-directory> [...more]");
  process.exit(1);
}

const IMG_RE = /\.(jpe?g|png|webp)$/i;
const files = args.flatMap((a) => {
  const full = path.resolve(a);
  let st;
  try {
    st = statSync(full);
  } catch {
    console.error(`no such file or directory: ${a}`);
    process.exit(1);
  }
  if (st.isDirectory()) {
    return readdirSync(full)
      .filter((f) => IMG_RE.test(f))
      .map((f) => path.join(full, f));
  }
  return [full];
});

const manifestPath = path.join(ROOT, "src/lib/image-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const done = [];
const skipped = [];

for (const file of files) {
  const slug = path.basename(file).replace(IMG_RE, "");
  if (!slugs.has(slug)) {
    skipped.push(path.basename(file));
    continue;
  }
  const outDir = path.join(ROOT, "public/img/product");
  mkdirSync(outDir, { recursive: true });

  // flatten() from the python pipeline: any transparency lands on white,
  // because the site's grounds are light and a dark-mode-transparent webp
  // would ship someone's checkerboard.
  const base = sharp(file).rotate().flatten({ background: "#ffffff" });

  const lg = await base
    .clone()
    .resize({ width: 1000, withoutEnlargement: true })
    .webp({ quality: 84, effort: 6 })
    .toFile(path.join(outDir, `${slug}.webp`));
  await base
    .clone()
    .resize({ width: 400, withoutEnlargement: true })
    .webp({ quality: 84, effort: 6 })
    .toFile(path.join(outDir, `${slug}-sm.webp`));

  manifest[`product/${slug}`] = { w: lg.width, h: lg.height };
  done.push(slug);
  console.log(`${slug}  ->  ${lg.width}x${lg.height} + 400 card`);
}

if (done.length) {
  // sort_keys=True in the python writer; keep the file diff-stable. Plain
  // code-unit comparison, not localeCompare: locale collation varies by
  // machine, and a manifest that reorders itself per contributor is churn.
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(manifestPath, JSON.stringify(sorted, null, 1));
  execFileSync(process.execPath, [path.join(ROOT, "tools/og-products.mjs")], { cwd: ROOT, stdio: "inherit" });
}

if (skipped.length) {
  console.log(`\nskipped, basename is not a catalog slug: ${skipped.join(", ")}`);
}

const missing = catalog.products.filter((p) => !(`product/${p.slug}` in manifest)).map((p) => p.slug);
console.log(`\ningested ${done.length}; still without a photograph: ${missing.length} of ${catalog.products.length}`);
if (done.length) {
  console.log(`\nnext: git add public/img/product public/og/product src/lib/image-manifest.json src/lib/og-manifest.json`);
  console.log(`      commit + push; each ingested row leaves /photos on that deploy.`);
}
