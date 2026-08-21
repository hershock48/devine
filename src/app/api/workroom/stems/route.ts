import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, newId, normalizeVariety, SHRINK_REASONS, type StemEvent } from "@/lib/workroom/store";

/**
 * Stem events: purchases and shrink. GET hands back 90 days of events plus
 * every recipe — the tracker computes its numbers in the browser from raw
 * rows, because the whole quarter of a flower shop's entries is smaller than
 * one product photo. DELETE removes a mis-keyed row.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const [events, recipes, orders] = await Promise.all([
    store.listStemEvents(90),
    store.listRecipes(),
    store.listOrders(90),
  ]);
  return NextResponse.json({ events, recipes, orders, backend: store.backend });
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ error: "Malformed." }, { status: 400 });

  const kind = p.kind === "shrink" ? "shrink" : "purchase";
  const variety = normalizeVariety(str(p.variety, 80));
  const stems = Math.round(Number(p.stems));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(p.date, 10)) ? str(p.date, 10) : "";
  if (!variety || !date || !Number.isFinite(stems) || stems < 1 || stems > 100_000) {
    return NextResponse.json({ error: "A variety, a date and a stem count are required." }, { status: 400 });
  }

  const cost = kind === "purchase" ? Math.round((Number(p.cost) || 0) * 100) / 100 : 0;
  if (kind === "purchase" && (cost <= 0 || cost > 100_000)) {
    return NextResponse.json({ error: "A purchase needs what was paid for it." }, { status: 400 });
  }
  const reason = kind === "shrink" ? str(p.reason, 40) : "";
  if (kind === "shrink" && !(SHRINK_REASONS as readonly string[]).includes(reason)) {
    return NextResponse.json({ error: "Pick a shrink reason." }, { status: 400 });
  }

  const event: StemEvent = { id: newId("st"), kind, date, variety, stems, cost, reason, createdAt: Date.now() };
  await getStore().addStemEvent(event);
  return NextResponse.json({ ok: true, event });
}

export async function DELETE(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof p.id !== "string" || !p.id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  await getStore().deleteStemEvent(p.id);
  return NextResponse.json({ ok: true });
}
