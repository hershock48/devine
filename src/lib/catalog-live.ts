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
 * the workroom's Products tab edits them.
 *
 * Same shape as the static module's helpers, so a page swaps
 * `import { inCategory } from "@/lib/catalog"` for
 * `const { inCategory } = await getCatalog()` and changes nothing else.
 *
 * Cached a few seconds per server instance: the shop renders on demand and a
 * burst of page views must not become a burst of catalog queries. Writes from
 * the Products tab call forgetCatalog() so the owner sees her change at once
 * on the instance that took it; other instances catch up within the TTL.
 */

export type LiveCatalog = {
  products: Product[];
  categories: Category[];
  /** On the menu: not offMenu. What the shop sells. */
  menu: Product[];
  /** The shelves the shop shows: not hidden. */
  shopCategories: Category[];
  bySlug: Map<string, Product>;
  catBySlug: Map<string, Category>;
  shopCatBySlug: Map<string, Category>;
  inCategory(catSlug: string): Product[];
  priceRange(catSlug: string): [number, number];
};

const TTL_MS = 5000;
type Cached = { at: number; value: LiveCatalog };
const g = globalThis as typeof globalThis & { __devineCatalog?: Cached | null };

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
  const shopCategories = categories.filter((c) => !c.hidden);
  const inCategory = (catSlug: string) => menu.filter((p) => p.cats.includes(catSlug)).sort((a, b) => a.price - b.price);
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

export async function getCatalog(): Promise<LiveCatalog> {
  const hit = g.__devineCatalog;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const store = getStore();
  let [rows, catRows] = await Promise.all([store.listCatalogProducts(), store.listCatalogCategories()]);
  // SEED WHAT IS MISSING, never overwrite: a product the file knows and the
  // database does not was added in code after the rows existed (or this is
  // the first read ever); a category likewise, appended after hers.
  const have = new Set(rows.map((p) => p.slug));
  const missing = seedProducts.filter((p) => !have.has(p.slug));
  await store.seedCatalogProducts(missing);
  const haveCat = new Set(catRows.map((r) => r.category.slug));
  let position = catRows.length ? Math.max(...catRows.map((r) => r.position)) + 1 : 0;
  const missingCats = seedCategories.filter((c) => !haveCat.has(c.slug)).map((category) => ({ category, position: position++ }));
  await store.seedCatalogCategories(missingCats);
  if (missing.length || missingCats.length) {
    [rows, catRows] = await Promise.all([store.listCatalogProducts(), store.listCatalogCategories()]);
  }
  const value = build(rows, catRows.map((r) => r.category));
  g.__devineCatalog = { at: Date.now(), value };
  return value;
}

/** After a write from the Products tab: the next read goes to the store. */
export function forgetCatalog(): void {
  g.__devineCatalog = null;
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
