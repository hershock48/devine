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
 *   PATCH  product edit one: name, price, description, shelves, on/off
 *   PUT    category add or edit a shelf; or { order: [slugs] } to reorder
 *   DELETE category an empty shelf only; a shelf with designs stays
 *
 * Validation is the route's, not the form's: a price is a number from 0 to
 * 10000, a name is 1 to 80 characters, a description up to 1200, shelves
 * are slugs the catalog knows. The slug of a design never changes once
 * minted: orders, recipes and register SKUs hang off it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

function readPrice(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 10000) return null;
  return Math.round(n * 100) / 100;
}

function readCats(v: unknown, known: Set<string>): string[] | null {
  if (!Array.isArray(v)) return null;
  const cats = [...new Set(v.filter((c): c is string => typeof c === "string" && known.has(c)))];
  return cats;
}

export async function GET() {
  if (!(await isWorkroomOwner())) return bad("The owner's PIN opens this.", 403);
  const cat = await getCatalog();
  return NextResponse.json({ products: cat.products, categories: cat.categories });
}

export async function POST(req: Request) {
  if (!(await isWorkroomOwner())) return bad("The owner's PIN opens this.", 403);
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return bad("Malformed.");
  const cat = await getCatalog();
  const name = str(p.name, 80);
  if (!name) return bad("Give the design a name.");
  const price = readPrice(p.price);
  if (price === null) return bad("The price did not read as a number (0 to 10,000).");
  const cats = readCats(p.cats, new Set(cat.categories.map((c) => c.slug)));
  if (!cats) return bad("Malformed shelves.");
  const product: Product = {
    slug: slugFor(name, new Set(cat.products.map((x) => x.slug))),
    name,
    price,
    cats,
    desc: str(p.desc, 1200),
    img: "",
    ...(p.noSubs === true ? { noSubs: true } : {}),
    ...(p.offMenu === true ? { offMenu: true } : {}),
  };
  await getStore().upsertCatalogProduct(product);
  forgetCatalog();
  return NextResponse.json({ ok: true, product });
}

export async function PATCH(req: Request) {
  if (!(await isWorkroomOwner())) return bad("The owner's PIN opens this.", 403);
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return bad("Malformed.");
  const cat = await getCatalog();
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
    if (price === null) return bad("The price did not read as a number (0 to 10,000).");
    next.price = price;
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
  if (p.noSubs !== undefined) {
    if (p.noSubs === true) next.noSubs = true;
    else delete next.noSubs;
  }
  // A sale price is a code edit today (catalog.ts); the tab does not set one.
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
  const existing = rows.find((r) => r.category.slug === str(p.slug, 80));
  if (!existing && !name) return bad("Give the shelf a name.");
  const category: Category = existing
    ? { ...existing.category }
    : { slug: slugFor(name, new Set(rows.map((r) => r.category.slug))), name, blurb: "" };
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
  const cat = await getCatalog();
  if (!cat.catBySlug.has(slug)) return bad("No such shelf.", 404);
  const still = cat.products.filter((x) => x.cats.includes(slug));
  if (still.length) return bad(`${still.length} design${still.length === 1 ? " is" : "s are"} on that shelf. Move them first, or hide the shelf instead.`, 409);
  await getStore().deleteCatalogCategory(slug);
  forgetCatalog();
  return NextResponse.json({ ok: true });
}
