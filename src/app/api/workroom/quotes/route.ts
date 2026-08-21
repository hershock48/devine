import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, newId, normalizeVariety, type Quote, type QuotePiece } from "@/lib/workroom/store";
import { QUOTE_TEMPLATES, QUOTE_DEFAULTS } from "@/lib/workroom/quote-templates";

/**
 * Quotes. GET lists them and includes the workroom's known stem prices so a
 * new quote's flower list can prefill instead of asking for numbers the shop
 * already typed once. POST creates one from a template; PUT replaces one
 * whole (the builder autosaves the full document — a quote is one thought,
 * like a recipe); DELETE removes one.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const [quotes, events] = await Promise.all([store.listQuotes(), store.listStemEvents(90)]);

  // Average paid per stem per variety, same arithmetic as the stems page.
  const paid = new Map<string, { cost: number; stems: number }>();
  for (const e of events) {
    if (e.kind !== "purchase") continue;
    const p = paid.get(e.variety) ?? { cost: 0, stems: 0 };
    p.cost += e.cost;
    p.stems += e.stems;
    paid.set(e.variety, p);
  }
  const stemPrices: Record<string, number> = {};
  for (const [v, p] of paid) if (p.stems > 0) stemPrices[v] = Math.round((p.cost / p.stems) * 100) / 100;

  return NextResponse.json({ quotes, stemPrices, backend: store.backend });
}

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { kind?: unknown };
  const kind = p.kind === "funeral" ? "funeral" : "wedding";
  const now = Date.now();
  const quote: Quote = {
    id: newId("qt"),
    kind,
    status: "draft",
    clientName: "",
    phone: "",
    email: "",
    eventDate: "",
    venue: "",
    notes: "",
    deceased: "",
    serviceTime: "",
    viewingTime: "",
    casket: "",
    budgetTarget: 0,
    flowers: [],
    pieces: QUOTE_TEMPLATES[kind].map((t) => ({ ...t, id: newId("pc"), parts: [...t.parts] })),
    ...QUOTE_DEFAULTS,
    createdAt: now,
    updatedAt: now,
  };
  await getStore().upsertQuote(quote);
  return NextResponse.json({ ok: true, quote });
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n * 100) / 100)) : 0;
};

export async function PUT(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p || typeof p.id !== "string") return NextResponse.json({ error: "Malformed." }, { status: 400 });

  const existing = await getStore().getQuote(p.id);
  if (!existing) return NextResponse.json({ error: "No such quote." }, { status: 404 });

  const pieces: QuotePiece[] = [];
  for (const raw of (Array.isArray(p.pieces) ? p.pieces : []).slice(0, 60)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = str(r.name, 80);
    if (!name) continue;
    pieces.push({
      id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : newId("pc"),
      name,
      qty: Math.min(999, Math.max(1, Math.round(Number(r.qty) || 1))),
      hardgoods: num(r.hardgoods, 100_000),
      price: num(r.price, 1_000_000),
      ribbon: str(r.ribbon, 80),
      from: str(r.from, 120),
      parts: (Array.isArray(r.parts) ? r.parts : [])
        .slice(0, 30)
        .map((pt) => ({
          variety: normalizeVariety(str((pt as Record<string, unknown>)?.variety, 80)),
          stems: Math.min(999, Math.max(0, Math.round(Number((pt as Record<string, unknown>)?.stems) || 0))),
        }))
        .filter((pt) => pt.variety),
    });
  }

  const flowers = (Array.isArray(p.flowers) ? p.flowers : [])
    .slice(0, 60)
    .map((f) => ({
      variety: normalizeVariety(str((f as Record<string, unknown>)?.variety, 80)),
      costPerStem: num((f as Record<string, unknown>)?.costPerStem, 10_000),
    }))
    .filter((f) => f.variety);

  const quote: Quote = {
    ...existing,
    status: (["draft", "sent", "accepted", "declined"] as const).includes(p.status as Quote["status"])
      ? (p.status as Quote["status"])
      : existing.status,
    clientName: str(p.clientName, 120),
    phone: str(p.phone, 40),
    email: str(p.email, 160),
    eventDate: /^\d{4}-\d{2}-\d{2}$/.test(str(p.eventDate, 10)) ? str(p.eventDate, 10) : "",
    venue: str(p.venue, 160),
    notes: str(p.notes, 1000),
    deceased: str(p.deceased, 120),
    serviceTime: /^\d{2}:\d{2}$/.test(str(p.serviceTime, 5)) ? str(p.serviceTime, 5) : "",
    viewingTime: /^\d{2}:\d{2}$/.test(str(p.viewingTime, 5)) ? str(p.viewingTime, 5) : "",
    casket: (["open", "closed", "cremation"] as const).includes(p.casket as "open")
      ? (p.casket as Quote["casket"])
      : "",
    budgetTarget: num(p.budgetTarget, 1_000_000),
    flowers,
    pieces,
    markup: Math.min(20, Math.max(1, Number(p.markup) || QUOTE_DEFAULTS.markup)),
    laborPct: Math.min(300, Math.max(0, Number(p.laborPct) || 0)),
    delivery: num(p.delivery, 100_000),
    setup: num(p.setup, 100_000),
    updatedAt: Date.now(),
  };
  await getStore().upsertQuote(quote);
  return NextResponse.json({ ok: true, updatedAt: quote.updatedAt });
}

export async function DELETE(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof p.id !== "string" || !p.id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  await getStore().deleteQuote(p.id);
  return NextResponse.json({ ok: true });
}
