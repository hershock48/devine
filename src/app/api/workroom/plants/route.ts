import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, type PlantItem } from "@/lib/workroom/store";
import { plantSeed } from "@/lib/workroom/inventory-seed";

/**
 * The plant par sheet, digitized. GET lists items; POST upserts one item
 * (name, prices, par); PUT is either {seed: true} (additive, same rule as
 * varieties) or {counts: [{slug, have}], date} — the weekly walk through
 * the shop, saved in one send. Need is never stored: par minus have,
 * computed wherever it is shown, so it cannot go stale.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const plants = await store.listPlantItems();
  return NextResponse.json({ plants, backend: store.backend });
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

const slugify = (name: string) =>
  name.toLowerCase().replace(/["']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ error: "Malformed." }, { status: 400 });

  const name = str(p.name, 80);
  if (!name) return NextResponse.json({ error: "A plant needs a name." }, { status: 400 });
  const par = Math.round(Number(p.par));
  if (!Number.isFinite(par) || par < 0 || par > 1000) {
    return NextResponse.json({ error: "A standard number to keep is required." }, { status: 400 });
  }

  const store = getStore();
  const slug = str(p.slug, 60) || slugify(name);
  if (!slug) return NextResponse.json({ error: "A plant needs a name." }, { status: 400 });
  const existing = (await store.listPlantItems()).find((x) => x.slug === slug);

  const item: PlantItem = {
    slug,
    name,
    retail: num(p.retail),
    cost: num(p.cost),
    par,
    have: existing?.have ?? null,
    countedAt: existing?.countedAt ?? "",
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await store.upsertPlantItem(item);
  return NextResponse.json({ ok: true, item });
}

export async function PUT(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const store = getStore();

  if (p.seed) {
    const have = new Set((await store.listPlantItems()).map((x) => x.slug));
    let added = 0;
    for (const s of plantSeed) {
      if (have.has(s.slug)) continue;
      await store.upsertPlantItem({
        slug: s.slug,
        name: s.name,
        retail: s.retail,
        cost: s.cost,
        par: s.par,
        have: null,
        countedAt: "",
        createdAt: Date.now(),
      });
      added++;
    }
    return NextResponse.json({ ok: true, added, skipped: plantSeed.length - added });
  }

  if (Array.isArray(p.counts)) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(p.date, 10)) ? str(p.date, 10) : "";
    if (!date) return NextResponse.json({ error: "A count needs its day." }, { status: 400 });
    const items = new Map((await store.listPlantItems()).map((x) => [x.slug, x]));
    let saved = 0;
    for (const c of p.counts as Record<string, unknown>[]) {
      const item = items.get(str(c?.slug, 60));
      const have = Math.round(Number(c?.have));
      if (!item || !Number.isFinite(have) || have < 0 || have > 10_000) continue;
      await store.upsertPlantItem({ ...item, have, countedAt: date });
      saved++;
    }
    return NextResponse.json({ ok: true, saved });
  }

  return NextResponse.json({ error: "Malformed." }, { status: 400 });
}

export async function DELETE(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { slug?: unknown };
  const slug = str(p.slug, 60);
  if (!slug) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  await getStore().deletePlantItem(slug);
  return NextResponse.json({ ok: true });
}
