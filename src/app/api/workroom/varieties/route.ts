import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, normalizeVariety, type Variety } from "@/lib/workroom/store";
import { varietySeed } from "@/lib/workroom/inventory-seed";

/**
 * The master stem list. GET lists it; POST upserts one variety; PUT with
 * {seed: true} loads her laminated lists ADDITIVELY (existing names are
 * never touched, so re-seeding cannot undo her edits); DELETE removes a
 * mis-added name.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const varieties = await store.listVarieties();
  return NextResponse.json({ varieties, backend: store.backend });
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
};

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ error: "Malformed." }, { status: 400 });

  const name = normalizeVariety(typeof p.name === "string" ? p.name.slice(0, 80) : "");
  if (!name) return NextResponse.json({ error: "A variety needs a name." }, { status: 400 });

  const store = getStore();
  const existing = (await store.listVarieties()).find((v) => v.name === name);
  const spb = Math.round(Number(p.stemsPerBunch));
  const variety: Variety = {
    name,
    kind: p.kind === "green" ? "green" : "flower",
    sellStem: num(p.sellStem),
    sellBunch: num(p.sellBunch),
    stemsPerBunch: Number.isFinite(spb) && spb >= 1 && spb <= 1000 ? spb : null,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await store.upsertVariety(variety);
  return NextResponse.json({ ok: true, variety });
}

export async function PUT(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as { seed?: unknown } | null;
  if (!p?.seed) return NextResponse.json({ error: "Malformed." }, { status: 400 });

  const store = getStore();
  const have = new Set((await store.listVarieties()).map((v) => v.name));
  let added = 0;
  for (const s of varietySeed) {
    const name = normalizeVariety(s.name);
    if (have.has(name)) continue;
    await store.upsertVariety({
      name,
      kind: s.kind,
      sellStem: s.sellStem,
      sellBunch: s.sellBunch,
      stemsPerBunch: null,
      createdAt: Date.now(),
    });
    added++;
  }
  return NextResponse.json({ ok: true, added, skipped: varietySeed.length - added });
}

export async function DELETE(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = normalizeVariety(typeof p.name === "string" ? p.name : "");
  if (!name) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  await getStore().deleteVariety(name);
  return NextResponse.json({ ok: true });
}
