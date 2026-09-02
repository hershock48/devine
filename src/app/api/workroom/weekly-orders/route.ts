import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import {
  getStore,
  newId,
  normalizeVariety,
  type StemEvent,
  type WeeklyOrder,
  type WeeklyOrderLine,
} from "@/lib/workroom/store";

/**
 * The weekly flower order. GET lists recent orders; POST saves a draft
 * (create or update); PUT with {id, action: "receive"} logs the truck.
 *
 * RECEIVING IS THE POINT OF THE WHOLE SCREEN: one tap turns every line into
 * a purchase StemEvent dated the truck date, so the cooler's ledger fills
 * itself and nobody types the prebook twice. Rules that keep the ledger
 * honest:
 *
 *   - a bunch line cannot be received without stems-per-bunch, because
 *     stems = qty x spb and inventing spb would silently mis-cost every
 *     recipe that touches the variety. The screen asks; this route refuses.
 *   - receive works exactly once (draft -> received). A second tap answers
 *     409 instead of double-buying the same truck.
 *   - every line's variety must already be on the master list. RETRACTION,
 *     2026-09-01 (Kevin): receive used to register unknown names itself,
 *     the last of the implicit-registration paths; a typo in a draft line
 *     became a phantom list entry the moment the truck was logged. Now
 *     nothing creates names implicitly anywhere: receive refuses by name,
 *     BEFORE writing any purchase, and the screen offers the same one-tap
 *     Add-it every other variety field carries.
 *   - a received line's spb is written back to the variety when the variety
 *     has none, so next week nobody is asked twice.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const orders = await store.listWeeklyOrders(20);
  return NextResponse.json({ orders, backend: store.backend });
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function parseLines(raw: unknown): WeeklyOrderLine[] | null {
  if (!Array.isArray(raw) || raw.length > 200) return null;
  const lines: WeeklyOrderLine[] = [];
  for (const l of raw as Record<string, unknown>[]) {
    const variety = normalizeVariety(str(l?.variety, 80));
    const qty = Math.round(Number(l?.qty));
    const unitPrice = Math.round((Number(l?.unitPrice) || 0) * 1000) / 1000; // Kennicott prices to the tenth cent
    const spb = Math.round(Number(l?.stemsPerBunch));
    if (!variety || !Number.isFinite(qty) || qty < 1 || qty > 10_000) return null;
    if (!(unitPrice >= 0) || unitPrice > 100_000) return null;
    lines.push({
      variety,
      qty,
      unit: l?.unit === "stem" ? "stem" : "bunch",
      unitPrice,
      stemsPerBunch: Number.isFinite(spb) && spb >= 1 && spb <= 1000 ? spb : null,
      note: str(l?.note, 120),
    });
  }
  return lines;
}

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ error: "Malformed." }, { status: 400 });

  const store = getStore();
  const id = str(p.id, 40);
  const existing = id ? (await store.listWeeklyOrders(200)).find((o) => o.id === id) : undefined;
  if (id && !existing) return NextResponse.json({ error: "No such order." }, { status: 404 });
  if (existing?.status === "received") {
    // The record of what the truck brought is a ledger source now. Editing
    // it would detach the logged purchases from the paper trail.
    return NextResponse.json({ error: "That order was received and is closed." }, { status: 409 });
  }

  const deliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(str(p.deliveryDate, 10)) ? str(p.deliveryDate, 10) : "";
  const lines = parseLines(p.lines);
  if (!deliveryDate || !lines || lines.length === 0) {
    return NextResponse.json({ error: "A truck date and at least one line are required." }, { status: 400 });
  }

  const order: WeeklyOrder = {
    id: existing?.id ?? newId("wo"),
    distributor: str(p.distributor, 60) || "Kennicott",
    deliveryDate,
    status: "draft",
    lines,
    receivedAt: null,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  await store.upsertWeeklyOrder(order);
  return NextResponse.json({ ok: true, order });
}

export async function PUT(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as { id?: unknown; action?: unknown } | null;
  const id = str(p?.id, 40);
  if (!id || p?.action !== "receive") return NextResponse.json({ error: "Malformed." }, { status: 400 });

  const store = getStore();
  const order = (await store.listWeeklyOrders(200)).find((o) => o.id === id);
  if (!order) return NextResponse.json({ error: "No such order." }, { status: 404 });
  if (order.status === "received") {
    return NextResponse.json({ error: "Already received. The purchases are logged." }, { status: 409 });
  }

  const missing = order.lines.filter((l) => l.unit === "bunch" && !l.stemsPerBunch).map((l) => l.variety);
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Stems per bunch is needed first for: ${missing.join(", ")}.`, missing },
      { status: 400 },
    );
  }

  /* The stems form's own rule, applied to the OTHER purchase constructor
     (found by the 2026-09-02 constructor audit): "a purchase needs what was
     paid for it." This path used to write $0 lots from blank prebook
     prices, and a zero-cost lot poisons cost/stem and margins silently -
     the exact guessed-as-zero the ledger refuses everywhere else. */
  const unpriced = order.lines.filter((l) => !(l.unitPrice > 0)).map((l) => l.variety);
  if (unpriced.length > 0) {
    return NextResponse.json(
      { error: `A price is needed first for: ${unpriced.join(", ")}. The ledger refuses purchases guessed at zero.`, unpriced },
      { status: 400 },
    );
  }

  const varieties = new Map((await store.listVarieties()).map((v) => [v.name, v]));
  // Refuse BEFORE the first purchase is written, so a failed receive leaves
  // the ledger untouched instead of half a truck logged.
  const unknown = [...new Set(order.lines.map((l) => l.variety).filter((v) => !varieties.has(v)))];
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        error: `Not in the stem library: ${unknown.join(", ")}. Add ${unknown.length === 1 ? "it" : "them"} to the library first, or fix the spelling.`,
        unknown,
      },
      { status: 400 },
    );
  }

  for (const l of order.lines) {
    const stems = l.unit === "stem" ? l.qty : l.qty * (l.stemsPerBunch as number);
    const event: StemEvent = {
      id: newId("st"),
      kind: "purchase",
      date: order.deliveryDate,
      variety: l.variety,
      stems,
      cost: Math.round(l.qty * l.unitPrice * 100) / 100,
      reason: "",
      createdAt: Date.now(),
    };
    await store.addStemEvent(event);

    const known = varieties.get(l.variety)!;
    if (!known.stemsPerBunch && l.stemsPerBunch) {
      await store.upsertVariety({ ...known, stemsPerBunch: l.stemsPerBunch });
    }
  }

  const received: WeeklyOrder = { ...order, status: "received", receivedAt: Date.now(), updatedAt: Date.now() };
  await store.upsertWeeklyOrder(received);
  return NextResponse.json({ ok: true, order: received, purchases: order.lines.length });
}

export async function DELETE(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { id?: unknown };
  const id = str(p.id, 40);
  if (!id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const order = (await getStore().listWeeklyOrders(200)).find((o) => o.id === id);
  if (order?.status === "received") {
    // Deleting a received order would orphan its logged purchases from the
    // paper trail while leaving them in the cooler ledger. Keep the record.
    return NextResponse.json({ error: "A received order stays on the books." }, { status: 409 });
  }
  await getStore().deleteWeeklyOrder(id);
  return NextResponse.json({ ok: true });
}
