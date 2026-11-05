import "server-only";
import { categories as seedCategories, products as seedProducts, type Category, type Product } from "@/lib/catalog";
import { getStore } from "@/lib/workroom/store";

/**
 * THE CATALOG THE SITE ACTUALLY READS (Kevin, 2026-11-05: "can we make some
 * sort of admin panel thing where they can do this themselves?"). Every price,
 * description, shelf and photograph used to live in lib/catalog.ts, so every
 * email from the shop became a commit from us. Now that file is the SEED:
 * the first read copies anything it has that the database lacks (so a design
 * added in code still appears), and from then on the rows are the truth and
 * the workroom's Products tab edits them. AN EDIT TO AN EXISTING DESIGN IN
 * THE FILE NO LONGER REACHES THE SITE: the row wins. Change it on the tab.
 *
 * Same shape as the static module's helpers, so a page swaps
 * `import { inCategory } from "@/lib/catalog"` for
 * `const { inCategory } = await getCatalog()` and changes nothing else.
 *
 * Cached a few seconds per server instance: the shop renders on demand and a
 * burst of page views must not become a burst of catalog queries. Concurrent
 * reads share one query. Writes from the Products tab read fresh and call
 * forgetCatalog(), so the owner sees her change at once on the instance that
 * took it; other instances catch up within the TTL.
 *
 * THE SHOP STAYS UP WITHOUT THE DATABASE. Before this, no public page touched
 * the store; now every one reads the catalog. If the read fails or takes
 * more than three seconds (the database asleep, unreachable, hanging, out of
 * connections) the public pages are served from the seed file, prices as of
 * the last deploy, and the failure is logged.
 *
 * BUT A PRICE THAT WILL BE CHARGED NEVER COMES FROM THE FILE. Web checkout,
 * a workroom write-up and the Square sync read `strict`: the owner's rows or
 * an error. A write path reads `fresh`: strict, and past the cache.
 *
 * ONLY PRODUCTION SEEDS. Previews share the production database here, so a
 * branch whose file carries a new design would otherwise put it on the live
 * menu before it merged; so would a laptop running `next dev` against the
 * production URL. Anywhere but production the missing rows are merged in
 * memory for that response and written nowhere.
 */

export type LiveCatalog = {
  products: Product[];
  categories: Category[];
  /** On the menu: not offMenu. What the shop sells. */
  menu: Product[];
  /** The shelves the shop shows: not hidden, and not empty. */
  shopCategories: Category[];
  bySlug: Map<string, Product>;
  catBySlug: Map<string, Category>;
  shopCatBySlug: Map<string, Category>;
  inCategory(catSlug: string): Product[];
  priceRange(catSlug: string): [number, number];
};

const TTL_MS = 5000;
/** How long a public page waits on the catalog before it is served from the seed. */
const DISPLAY_WAIT_MS = 3000;
type Cached = { at: number; value: LiveCatalog; fallback: boolean };
const g = globalThis as typeof globalThis & {
  __devineCatalog?: Cached | null;
  __devineCatalogGen?: number;
  __devineCatalogInflight?: Promise<LiveCatalog> | null;
};

const seedIndex = new Map(seedProducts.map((p, i) => [p.slug, i]));

function build(products: Product[], allCategories: Category[]): LiveCatalog {
  // A shelf removed on the Products tab keeps its row (so the seed cannot
  // bring it back) and is out of the catalog here.
  const categories = allCategories.filter((c) => !c.removed);
  // Seed order first (the file's merchandising order), then anything the
  // owner added, by name; the shop sorts shelves by price anyway.
  const sorted = [...products].sort((a, b) => {
    const ia = seedIndex.get(a.slug) ?? Number.MAX_SAFE_INTEGER;
    const ib = seedIndex.get(b.slug) ?? Number.MAX_SAFE_INTEGER;
    return ia !== ib ? ia - ib : a.name.localeCompare(b.name);
  });
  const menu = sorted.filter((p) => !p.offMenu);
  const inCategory = (catSlug: string) => menu.filter((p) => p.cats.includes(catSlug)).sort((a, b) => a.price - b.price);
  // AN EMPTY SHELF IS NOT A SHELF YET: a shelf added on the tab shows on the
  // shop, the footer and the sitemap once a design is on it, not before
  // ("0 designs, $0 to $0" was what the first cut published the moment she
  // typed a name).
  const shopCategories = categories.filter((c) => !c.hidden && menu.some((p) => p.cats.includes(c.slug)));
  const priceRange = (catSlug: string): [number, number] => {
    const ps = inCategory(catSlug).map((p) => p.price);
    if (ps.length === 0) return [0, 0];
    return [Math.min(...ps), Math.max(...ps)];
  };
  return {
    products: sorted,
    categories,
    menu,
    shopCategories,
    bySlug: new Map(sorted.map((p) => [p.slug, p])),
    catBySlug: new Map(categories.map((c) => [c.slug, c])),
    shopCatBySlug: new Map(shopCategories.map((c) => [c.slug, c])),
    inCategory,
    priceRange,
  };
}

/**
 * May this process write the seed into the database? Production only. By
 * Vercel's own variable when the project exposes it; when it does not, by
 * the host (a preview answers on *.vercel.app, production on the shop's own
 * domain). `next dev` never seeds a real database. The in-memory store has
 * nothing to protect and always seeds itself.
 */
async function maySeed(): Promise<boolean> {
  if (getStore().backend === "memory") return true;
  if (process.env.NODE_ENV !== "production") return false;
  const env = process.env.VERCEL_ENV;
  if (env) return env === "production";
  try {
    const { headers } = await import("next/headers");
    return !/\.vercel\.app$/i.test((await headers()).get("host") ?? "");
  } catch {
    return false;
  }
}

async function readAndSeed(): Promise<LiveCatalog> {
  const store = getStore();
  let [rows, catRows] = await Promise.all([store.listCatalogProducts(), store.listCatalogCategories()]);
  // SEED WHAT IS MISSING, never overwrite: a product the file knows and the
  // database does not was added in code after the rows existed (or this is
  // the first read ever); a category likewise, appended after hers.
  const have = new Set(rows.map((p) => p.slug));
  const missing = seedProducts.filter((p) => !have.has(p.slug));
  const haveCat = new Set(catRows.map((r) => r.category.slug));
  let position = catRows.length ? Math.max(...catRows.map((r) => r.position)) + 1 : 0;
  const missingCats = seedCategories.filter((c) => !haveCat.has(c.slug)).map((category) => ({ category, position: position++ }));
  if (missing.length || missingCats.length) {
    if (await maySeed()) {
      await store.seedCatalogProducts(missing);
      await store.seedCatalogCategories(missingCats);
      [rows, catRows] = await Promise.all([store.listCatalogProducts(), store.listCatalogCategories()]);
    } else {
      // Shown here, written nowhere (see the note above).
      rows = [...rows, ...missing];
      catRows = [...catRows, ...missingCats];
    }
  }
  return build(rows, catRows.map((r) => r.category));
}

/** One read at a time per instance: a page render asks for the catalog from
    its layout, its metadata, its body and its footer at once. */
function sharedRead(): Promise<LiveCatalog> {
  if (!g.__devineCatalogInflight) {
    g.__devineCatalogInflight = readAndSeed().finally(() => {
      g.__devineCatalogInflight = null;
    });
  }
  return g.__devineCatalogInflight;
}

/**
 * The catalog.
 *
 * (no option): for DISPLAY. Cached; on a failed or slow read, the seed file.
 *
 * `strict`: the owner's rows or an error, never the seed file. For every
 * path that puts a PRICE somewhere it will be charged or synced (web
 * checkout, a workroom write-up, the Square sync): a customer must not pay
 * the file's $115 because the database blinked while the owner's row says
 * $125. A strict read also refuses a cached fallback.
 *
 * `fresh`: strict, and past the cache too. For the write paths, which must
 * edit the row as it is now or fail.
 */
export async function getCatalog(opts: { fresh?: boolean; strict?: boolean } = {}): Promise<LiveCatalog> {
  const strict = !!(opts.strict || opts.fresh);
  const hit = g.__devineCatalog;
  if (!opts.fresh && hit && Date.now() - hit.at < TTL_MS && !(strict && hit.fallback)) return hit.value;
  // A write that lands while this read is in flight bumps the generation;
  // the read then returns what it found but does not cache it, so a
  // pre-write answer cannot sit in the cache for the next five seconds.
  const gen = g.__devineCatalogGen ?? 0;
  let value: LiveCatalog;
  let fallback = false;
  try {
    if (opts.fresh) value = await readAndSeed();
    else if (strict) value = await sharedRead();
    else {
      // A database that hangs rather than refuses must not hold the shop.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const slow = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`catalog read took over ${DISPLAY_WAIT_MS}ms`)), DISPLAY_WAIT_MS);
      });
      try {
        value = await Promise.race([sharedRead(), slow]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  } catch (err) {
    if (strict) throw err;
    console.error("[devine] the catalog could not be read; serving the seed file:", err);
    value = build(seedProducts, seedCategories);
    fallback = true;
    // Cached like any other read, so a database that is down is asked
    // again in five seconds, not on every page view.
  }
  if ((g.__devineCatalogGen ?? 0) === gen) g.__devineCatalog = { at: Date.now(), value, fallback };
  return value;
}

/** After a write from the Products tab: the next read goes to the store. */
export function forgetCatalog(): void {
  g.__devineCatalog = null;
  g.__devineCatalogInflight = null;
  g.__devineCatalogGen = (g.__devineCatalogGen ?? 0) + 1;
}

/**
 * A HARD-CODED LINK, CHECKED AGAINST THE CATALOG AS IT IS NOW. The holiday
 * band and a few pages name a shelf or a design in code ("/shop/plants",
 * "/product/dozen-roses"). The owner can hide that shelf or take that
 * design off the menu on the Products tab, and the link would then lead
 * to a 404; it leads to the shop instead.
 */
export function livePath(cat: LiveCatalog, path: string): string {
  const shelf = path.match(/^\/shop\/([a-z0-9-]+)$/)?.[1];
  if (shelf) return cat.shopCatBySlug.has(shelf) ? path : "/shop";
  const design = path.match(/^\/product\/([a-z0-9-]+)$/)?.[1];
  if (design) {
    const p = cat.bySlug.get(design);
    return p && !p.offMenu ? path : "/shop";
  }
  return path;
}

/** A slug from a name, unique against what exists: "Baby's Breath" becomes
    babys-breath, and a second one babys-breath-2. */
export function slugFor(name: string, taken: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "design";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
