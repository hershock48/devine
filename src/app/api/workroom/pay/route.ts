import { NextResponse } from "next/server";
import { balanceCents, deliveryLineName, zipFeeToAppend } from "@/lib/workroom/derive";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { resolveSquare } from "@/lib/square/oauth";
import { chargeBoardOrder, isIdempotencyReuse, isPaymentUnsure } from "@/lib/square/payments";
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
  // The pane's id for this card attempt; kept across a retry whose
  // answer was lost, so the retry cannot be a second charge (below).
  const attempt = typeof p.attempt === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(p.attempt) ? p.attempt : "";

  if (!id || !method) return NextResponse.json({ error: "Order id and method are required." }, { status: 400 });
  if (method === "card" && !sourceId) return NextResponse.json({ error: "No card token arrived." }, { status: 400 });

  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return NextResponse.json({ error: "No such order." }, { status: 404 });
  if (order.status === "canceled") return NextResponse.json({ error: "That order is canceled." }, { status: 409 });
  if (order.status === "hold") return NextResponse.json({ error: "That order is on hold; finish it first, then take payment." }, { status: 409 });
  // PAID ONCE ALREADY: only a balance left by an edit can be taken, and
  // only the balance (Kevin, 2026-10-14). A settled ticket is refused as
  // before; a ticket trimmed below what was paid is a refund, which lives
  // in the Square dashboard, not here.
  const topUp = !!order.payment;
  const due = balanceCents(order);
  if (topUp && due <= 0) {
    return NextResponse.json(
      { error: due === 0 ? `Already paid (${order.payment!.method}).` : `Already paid; ${(-due / 100).toFixed(2)} is owed back to the customer, not the other way. Refund it from the Square dashboard.` },
      { status: 409 },
    );
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
  const zipFee = topUp ? undefined : zipFeeToAppend(order);
  const lines: WorkroomLine[] = topUp
    ? [{ slug: null, name: `Balance on order ${order.number}`, qty: 1, each: due / 100 }]
    : zipFee !== undefined
      ? [...order.lines, { slug: null, name: deliveryLineName(order.zip), qty: 1, each: zipFee }]
      : order.lines;
  const subtotal = topUp ? due / 100 : zipFee !== undefined ? Math.round((order.subtotal + zipFee) * 100) / 100 : order.subtotal;
  const record = (p: OrderPayment) => (topUp ? store.addOrderTopUp(order.id, p) : store.setOrderPayment(order.id, p));

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
    await record(payment);
    return NextResponse.json({ ok: true, payment });
  }

  const cfg = await resolveSquare();
  if (!cfg) {
    return NextResponse.json(
      { error: "Square is not connected, so no payment can be taken here yet." },
      { status: 503 },
    );
  }

  /* No fee at the board since the 2026-10-06 meeting: the shop's 3% card
     fee is retired (site.ts), and the 99 cent platform fee rides website
     orders only. Card and cash both charge exactly the lines. */
  let charged: Awaited<ReturnType<typeof chargeBoardOrder>>;
  try {
    charged = await chargeBoardOrder(cfg, {
      workroomOrderId: order.id,
      orderNumber: order.number,
      lines: lines.map((l) => ({ name: l.name, qty: l.qty, each: l.each })),
      method,
      sourceId,
      cardFee: { name: "", cents: 0, appFeeCents: 0 },
      // One payment per (order, attempt): a double tap, or a retry after
      // a lost answer, carries the same attempt id with a fresh token and
      // is refused by Square as a key reuse (409 below). Cash is keyed on
      // the order alone; a cash ticket is paid once.
      idempotencyKey: `${order.id}:${method === "card" ? attempt || sourceId : "cash"}`,
    });
  } catch (err) {
    console.error(`[devine] pay ${order.number} (${method}) failed:`, err);
    if (isIdempotencyReuse(err)) {
      return NextResponse.json({ error: "That charge already went through. Reload the board before doing anything else." }, { status: 409 });
    }
    if (isPaymentUnsure(err)) {
      return NextResponse.json(
        { unsure: true, error: "No answer came back from Square, so the card MAY have been charged. Do not take the card again elsewhere. Tap Charge once more here: if the first charge went through, it will say so and not charge twice." },
        { status: 502 },
      );
    }
    // Square said no (a decline, a bad token): a definite not-charged.
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err).slice(0, 300) }, { status: 402 });
  }
  // MONEY HAS MOVED. From here nothing may answer "it did not go through":
  // a store blip after a successful charge is logged CRITICAL and the
  // answer is still ok with the payment, because an error here reads as
  // "try again" at the counter, and a second tap would charge twice. The
  // Square payment carries the order id either way; the board can be
  // reconciled from it.
  const payment: OrderPayment = {
    at: Date.now(),
    method,
    squarePaymentId: charged.paymentId,
    totalCents: charged.totalCents,
    feeCents: charged.feeCents,
  };
  // Three tries at the board, a breath apart: a blip is usually over by
  // the second. If it still misses, the answer says so (boardMissed), the
  // pane shows it in red instead of a clean PAID, and the webhook for this
  // very payment marks the order within seconds anyway.
  let boardMissed = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (zipFee !== undefined) await store.setOrderLines(order.id, lines, subtotal);
      await record(payment);
      boardMissed = false;
      break;
    } catch (err) {
      boardMissed = true;
      console.error(`[devine] ${attempt === 3 ? "CRITICAL: " : ""}pay ${order.number}: Square payment ${charged.paymentId} succeeded but the board write failed (try ${attempt}):`, err);
      if (attempt < 3) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  return NextResponse.json({ ok: true, payment, receiptUrl: charged.receiptUrl, boardMissed });
}
