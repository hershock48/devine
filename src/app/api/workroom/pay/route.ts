import { NextResponse } from "next/server";
import { site } from "@/lib/site";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { resolveSquare } from "@/lib/square/oauth";
import { chargeBoardOrder } from "@/lib/square/payments";
import { getStore, type OrderPayment, type WorkroomLine } from "@/lib/workroom/store";

/**
 * Where a board order's money gets settled: the card keyed on the order
 * card, or cash recorded at pickup. Either way the charge is a real Square
 * payment into the shop's own account, itemized, carrying our order id, so
 * her ledger and the board agree without anyone typing anything twice.
 *
 * Behind the workroom cookie, browser-only, like the board itself. This IS
 * the thing the auth file said must not sit behind a mere PIN gate ("when
 * Stripe lands, that stays behind a real login") half true here: no card
 * NUMBER ever reaches this route (the browser tokenizes with Square's SDK,
 * we see a one-use token), and the route can only move money INTO the
 * shop's account, never out. The PIN gate remains acceptable for exactly
 * that reason; refunds, if ever built, are the line that needs the login.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Empty request." }, { status: 400 });
  }
  const p = (raw ?? {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id : "";
  const method = p.method === "card" || p.method === "cash" || p.method === "manual" ? p.method : null;
  const sourceId = typeof p.sourceId === "string" ? p.sourceId : undefined;

  if (!id || !method) return NextResponse.json({ error: "Order id and method are required." }, { status: 400 });
  if (method === "card" && !sourceId) return NextResponse.json({ error: "No card token arrived." }, { status: 400 });

  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return NextResponse.json({ error: "No such order." }, { status: 404 });
  if (order.status === "canceled") return NextResponse.json({ error: "That order is canceled." }, { status: 409 });
  if (order.payment) {
    return NextResponse.json({ error: `Already paid (${order.payment.method}).` }, { status: 409 });
  }

  /*
    THE DELIVERY FEE RIDES EVERY DELIVERY CHARGE, whichever side takes it.
    Found via Kevin's own test ticket: an unpaid web delivery carried only
    its flower lines, so the workroom's Take-card would have quietly
    undercharged by the fee on every phoned-in delivery while the online
    checkout charged it correctly. If the ticket has no delivery line yet
    and the zip is on her sheet, one is appended (and persisted on
    success, so the ticket's rows agree with its payment). A zip off the
    sheet charges the lines as they stand; that fee is the confirm call's
    business, the way it always was.
  */
  const hasDeliveryLine = order.lines.some((l) => l.name.startsWith("Delivery ("));
  const zipFee = order.fulfillment === "delivery" && !hasDeliveryLine ? site.deliveryFees[order.zip] : undefined;
  const lines: WorkroomLine[] =
    zipFee !== undefined
      ? [...order.lines, { slug: null, name: `Delivery (${order.zip})`, qty: 1, each: zipFee }]
      : order.lines;
  const subtotal = zipFee !== undefined ? Math.round((order.subtotal + zipFee) * 100) / 100 : order.subtotal;

  // The by-hand mark: money already moved outside the board (a check, an
  // account, an unlinked register ring). Records the fact and touches
  // nothing else; deliberately works even with Square unconfigured.
  if (method === "manual") {
    const payment: OrderPayment = {
      at: Date.now(),
      method: "other",
      squarePaymentId: "",
      totalCents: Math.round(subtotal * 100),
      feeCents: 0,
    };
    if (zipFee !== undefined) await store.setOrderLines(order.id, lines, subtotal);
    await store.setOrderPayment(order.id, payment);
    return NextResponse.json({ ok: true, payment });
  }

  const cfg = await resolveSquare();
  if (!cfg) {
    return NextResponse.json(
      { error: "Square is not connected, so no payment can be taken here yet." },
      { status: 503 },
    );
  }

  try {
    const charged = await chargeBoardOrder(cfg, {
      workroomOrderId: order.id,
      orderNumber: order.number,
      lines: lines.map((l) => ({ name: l.name, qty: l.qty, each: l.each })),
      method,
      sourceId,
    });
    const payment: OrderPayment = {
      at: Date.now(),
      method,
      squarePaymentId: charged.paymentId,
      totalCents: charged.totalCents,
      feeCents: charged.feeCents,
    };
    if (zipFee !== undefined) await store.setOrderLines(order.id, lines, subtotal);
    await store.setOrderPayment(order.id, payment);
    return NextResponse.json({ ok: true, payment, receiptUrl: charged.receiptUrl });
  } catch (err) {
    console.error(`[devine] pay ${order.number} (${method}) failed:`, err);
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err).slice(0, 300) }, { status: 502 });
  }
}
