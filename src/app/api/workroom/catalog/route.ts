import { NextResponse } from "next/server";
import { isWorkroomOwner } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";
import { forgetCatalog, getCatalog, slugFor } from "@/lib/catalog-live";
import type { Category, Product } from "@/lib/catalog";

/**
 * THE PRODUCTS TAB'S ROUTE (Kevin, 2026-11-05: "so they can do more of this
 * themselves, rather than writing an email"). Owner's PIN on every verb.
 *
 *   GET            the whole catalog, off-menu and hidden included
 *   POST   product a new design (slug minted from the name, unique)
 *   PATCH  product edit one: name, price, was-price, description, shelves, on/off
 *   PUT    category add or edit a shelf; or { order: [slugs] } to reorder
 *   DELETE category an empty shelf only; a shelf with designs stays
 *
 * Every verb reads the catalog FRESH, past the five-second cache: an edit
 * is made to the row as it is now (a photo stamped a second ago by another
 * instance must not be dropped by a PATCH built from a stale copy), and a
 * database that cannot be read fails the write rather than falling back to
 * the seed file.
 *
 * Validation is the route's, not the form's: a price is a number above 0 up
 * to 10000 (a blank is not zero), a name is 1 to 80 characters, a
 * description up to 1200, shelves are slugs the catalog knows. The slug of
 * a design never changes once minted: orders, recipes and register SKUs
 * hang off it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const PRICE_ERROR = "The price did not read as a number above zero (up to 10,000).";

function readPrice(v: unknown): number | null {
  if (typeof v === "string" && !v.trim()) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  if (!Number.isFinite(n)) return null;
  // To the cent FIRST, then the range: 0.004 is above zero as typed and
  // zero as saved, and a design must never be saved at a price of 0.
  const cents = Math.round(n * 100) / 100;
  if (cents <= 0 || cents > 10000) return null;
  return cents;
}

/** THE WAS-PRICE (the owner's Sale switch): shown struck through beside the
    price. Absent means no change; null, "" or 0 clears it; a number has to
    be more than the price, or it is not a sale. */
function readWas(v: unknown, price: number): { set: number | null } | { error: string } | null {
  if (v === undefined) return null;
  if (v === null || v === "" || v === 0 || v === "0") return { set: null };
  const n = readPrice(v);
  if (n === null) return { error: "The was-price did not read as a number." };
  if (n <= price) return { error: "The was-price has to be more than the price; that is what makes it a sale." };
  return { set: n };
}

function readCats(v: unknown, known: Set<string>): string[] | null {
  if (!Array.isArray(v)) return null;
  return [...new Set(v.filter((c): c is string => typeof c === "string" && known.has(c)))];
}

export async function GET() {
  if (!(await isWorkroomOwner())) return bad("The owner's PIN opens this.", 403);
  const cat = await getCatalog({ fresh: true });
  return NextResponse.json({ products: cat.products, categories: cat.categories, backend: getStore().backend });
}

export async function POST(req: Request) {
  if (!(await isWorkroomOwner())) return bad("The owner's PIN opens this.", 403);
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return bad("Malformed.");
  const cat = await getCatalog({ fresh: true });
  const name = str(p.name, 80);
  if (!name) return bad("Give the design a name.");
  const price = readPrice(p.price);
  if (price === null) return bad(PRICE_ERROR);
  const cats = readCats(p.cats, new Set(cat.categories.map((c) => c.slug)));
  if (!cats) return bad("Malformed shelves.");
  const was = readWas(p.regularPrice, price);
  if (was && "error" in was) return bad(was.error);
  const fields = {
    name,
    price,
    ...(was && was.set !== null ? { regularPrice: was.set } : {}),
    cats,
    desc: str(p.desc, 1200),
    img: "",
    ...(p.noSubs === true ? { noSubs: true } : {}),
    ...(p.offMenu === true ? { offMenu: true } : {}),
  };
  // THE SLUG IS MINTED FROM A READ, SO THE WRITE HAS TO BE INSERT-ONLY. Two
  // adds of the same name at once both read "free" and both mint the same
  // slug; with an upsert the second silently replaced the first. The insert
  // refuses a slug that is taken, and the loser mints the next one and goes
  // again. Each refusal is one more design that exists, so the loop ends;
  // the cap is only there so a broken database cannot spin a request.
  const store = getStore();
  const taken = new Set(cat.products.map((x) => x.slug));
  for (let attempt = 0; attempt < 25; attempt++) {
    const product: Product = { slug: slugFor(name, taken), ...fields };
    if (await store.insertCatalogProduct(product)) {
      forgetCatalog();
      return NextResponse.json({ ok: true, product });
    }
    taken.add(product.slug);
  }
  return bad("That name is being added from somewhere else right now. Try again in a moment.", 409);
}

export async function PATCH(req: Request) {
  if (!(await isWorkroomOwner())) return bad("The owner's PIN opens this.", 403);
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return bad("Malformed.");
  const cat = await getCatalog({ fresh: true });
  const slug = str(p.slug, 80);
  const existing = cat.bySlug.get(slug);
  if (!existing) return bad("No such design.", 404);
  const next: Product = { ...existing };
  if (p.name !== undefined) {
    const name = str(p.name, 80);
    if (!name) return bad("Give the design a name.");
    next.name = name;
  }
  if (p.price !== undefined) {
    const price = readPrice(p.price);
    if (price === null) return bad(PRICE_ERROR);
    next.price = price;
  }
  const was = readWas(p.regularPrice, next.price);
  if (was && "error" in was) return bad(was.error);
  if (was) {
    if (was.set === null) delete next.regularPrice;
    else next.regularPrice = was.set;
  } else if (next.regularPrice !== undefined && next.regularPrice <= next.price) {
    // The price rose to meet an old was-price: no longer a sale.
    delete next.regularPrice;
  }
  if (p.desc !== undefined) next.desc = str(p.desc, 1200);
  if (p.cats !== undefined) {
    const cats = readCats(p.cats, new Set(cat.categories.map((c) => c.slug)));
    if (!cats) return bad("Malformed shelves.");
    next.cats = cats;
  }
  if (p.offMenu !== undefined) {
    if (p.offMenu === true) next.offMenu = true;
    else delete next.offMenu;
  }
  // Old (catalog.ts retired): always off the website as well, and a design
  // put back on the website is not old any more.
  if (p.retired === true) {
    next.retired = true;
    next.offMenu = true;
  } else if (p.retired === false || p.offMenu === false) delete next.retired;
  if (p.noSubs !== undefined) {
    if (p.noSubs === true) next.noSubs = true;
    else delete next.noSubs;
  }
  await getStore().upsertCatalogProduct(next);
  forgetCatalog();
  return NextResponse.json({ ok: true, product: next });
}

export async function PUT(req: Request) {
  if (!(await isWorkroomOwner())) return bad("The owner's PIN opens this.", 403);
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return bad("Malformed.");
  const store = getStore();
  const rows = await store.listCatalogCategories();
  // REORDER: the whole list of slugs in the new order. Unknown slugs are
  // ignored; shelves left out keep their place after the named ones.
  if (Array.isArray(p.order)) {
    const want = p.order.filter((s): s is string => typeof s === "string");
    const bySlug = new Map(rows.map((r) => [r.category.slug, r]));
    let position = 0;
    for (const s of want) {
      const r = bySlug.get(s);
      if (!r) continue;
      await store.upsertCatalogCategory(r.category, position++);
      bySlug.delete(s);
    }
    for (const r of [...bySlug.values()].sort((a, b) => a.position - b.position)) await store.upsertCatalogCategory(r.category, position++);
    forgetCatalog();
    return NextResponse.json({ ok: true });
  }
  // ADD OR EDIT one shelf.
  const name = str(p.name, 60);
  const slugIn = str(p.slug, 80);
  let existing = slugIn ? rows.find((r) => r.category.slug === slugIn) : undefined;
  if (!existing && !name) return bad("Give the shelf a name.");
  // A SHELF REMOVED EARLIER AND ADDED AGAIN BY THE SAME NAME COMES BACK AS
  // ITSELF, same slug, rather than as "seasonal-2": the page titles, the
  // photo list's tiers and the add-on strip are keyed on the first slug.
  if (!existing) {
    const base = slugFor(name, new Set());
    existing = rows.find((r) => r.category.slug === base && r.category.removed);
  }
  const category: Category = existing
    ? { ...existing.category }
    : { slug: slugFor(name, new Set(rows.map((r) => r.category.slug))), name, blurb: "" };
  if (category.removed) {
    // Revived: back in the catalog, and visible unless this edit says otherwise.
    delete category.removed;
    delete category.hidden;
  }
  if (name) category.name = name;
  if (p.blurb !== undefined) category.blurb = str(p.blurb, 240);
  if (p.hidden !== undefined) {
    if (p.hidden === true) category.hidden = true;
    else delete category.hidden;
  }
  const position = existing ? existing.position : rows.length ? Math.max(...rows.map((r) => r.position)) + 1 : 0;
  await store.upsertCatalogCategory(category, position);
  forgetCatalog();
  return NextResponse.json({ ok: true, category });
}

export async function DELETE(req: Request) {
  if (!(await isWorkroomOwner())) return bad("The owner's PIN opens this.", 403);
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = str(p?.slug, 80);
  if (!slug) return bad("Malformed.");
  const cat = await getCatalog({ fresh: true });
  if (!cat.catBySlug.has(slug)) return bad("No such shelf.", 404);
  const still = cat.products.filter((x) => x.cats.includes(slug));
  if (still.length) return bad(`${still.length} design${still.length === 1 ? " is" : "s are"} on that shelf. Move them first, or hide the shelf instead.`, 409);
  // A TOMBSTONE, NOT A DELETE: a shelf the seed file knows would otherwise
  // be put back on the next read. The row stays, marked removed, and the
  // live catalog leaves it out. Adding a shelf by the same name revives it.
  const store = getStore();
  const row = (await store.listCatalogCategories()).find((r) => r.category.slug === slug);
  await store.upsertCatalogCategory({ ...(row?.category ?? cat.catBySlug.get(slug)!), hidden: true, removed: true }, row?.position ?? 0);
  forgetCatalog();
  return NextResponse.json({ ok: true });
}
