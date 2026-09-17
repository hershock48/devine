import { NextResponse } from "next/server";
import { site } from "@/lib/site";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { resolveSquare } from "@/lib/square/oauth";
import { fulfillPayment, gatewayIdentity, paymentFingerprint, pendingMessage, settledPayment, takePayment } from "@/lib/square/payment-service";
import { getStore, type WorkroomLine } from "@/lib/workroom/store";

/**
 * Where a board order's money gets settled: the card keyed on the order
 * card, cash recorded at pickup, or the by-hand mark for money that moved
 * outside the board. Card and cash are real Square payments into the shop's
 * own account, itemized, carrying our reference, so her ledger and the
 * board agree without anyone typing anything twice.
 *
 * Behind the signed workroom session, browser-only, like the board itself.
 * The old auth-file note that money "must not sit behind a mere PIN gate"
 * is half true here, and that half is why the gate is still acceptable: no
 * card NUMBER ever reaches this route (the browser tokenizes with Square's
 * SDK, we see a one-use token), and the route can only move money INTO the
 * shop's account, never out. Nothing in this app refunds; the orders route
 * only lets the owner record that a refund was made at Square.
 *
 * Since the September 2026 review every attempt goes through takePayment
 * (payment-service.ts): the intent is saved to Postgres BEFORE Square is
 * called, under one key per order, so a double click, a lost response or a
 * crashed instance can never charge the same order twice. The vocabulary
 * the PayControls pane relies on:
 *
 *   200 { ok, payment, receiptUrl }  settled and written to the board
 *   400                             the request itself is wrong; refresh
 *   402 { failed, retryOf }         Square declined, nothing was submitted,
 *                                   or the owner recorded no payment; staff
 *                                   may retry by sending retryOf back
 *   409 { pending }                 an earlier attempt is still unresolved;
 *                                   do not collect again until reconciled
 *   503 { pending }                 storage or Square unreachable; same rule
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
  // attemptId is the pane's one-per-click UUID; it goes into the fingerprint
  // so two clicks are two attempts and a stale form cannot replay an old one.
  // retryOf names the failed reference the staff member is knowingly
  // retrying; without it a failed row answers 402 and nothing is charged.
  const attemptId=typeof p.attemptId==='string'?p.attemptId:'';
  const retryOf=typeof p.retryOf==='string'?p.retryOf:undefined;
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
  if(!uuid.test(attemptId)||(retryOf!==undefined&&!uuid.test(retryOf)))return NextResponse.json({error:'Refresh this payment form before collecting money.'},{status:400});

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
  // account, an unlinked register ring). Records the fact and touches no
  // Square API; deliberately works with Square unconfigured. Card and cash
  // need the connection, and a missing one is a 503, not a charge.
  const cfg = method === "manual" ? null : await resolveSquare();
  if (method !== "manual" && !cfg) return NextResponse.json({ error: "Square is not connected." }, { status: 503 });
  const key = `board_${order.id}`;
  /* The board's fee story (Kevin, 2026-09-04 evening): the shop's own 3%
     card fee on card payments, kept by the shop (appFeeCents 0; the 99
     cent platform fee rides website orders only). Cash charges exactly its
     lines. One durable key per order, board_<id>, is the double-charge
     guard: every method for this order competes for the same row. */
  const cardFee = { name: `Card fee (${site.cardFeePct}%)`, cents: method === "card" ? Math.round((Math.round(subtotal * 100) * site.cardFeePct) / 100) : 0, appFeeCents: 0 };
  try {
    const outcome = await takePayment(key, paymentFingerprint({ attemptId,id: order.id, lines, method, cardFee }), {
      order: { ...order, lines, subtotal }, method, gateway: cfg ? gatewayIdentity(cfg) : null, cardFee,
    }, sourceId,retryOf);
    if(outcome.kind==='failed')return NextResponse.json({failed:true,pending:false,retryOf:outcome.attempt.snapshot.referenceId,error:outcome.attempt.result?.status==='OWNER_CONFIRMED_NO_PAYMENT'?'The owner verified no payment. Refresh and explicitly retry using the required payment method.':outcome.attempt.result?.status==='NOT_SUBMITTED'?'No payment was submitted. Refresh the order and check payment setup before trying again.':'The payment was declined or canceled. Try another card, record cash, or choose another payment method.'},{status:402});
    if (outcome.kind !== "completed") return NextResponse.json({ error: pendingMessage, pending: true }, { status: 409 });
    // Money moved. fulfillPayment writes the board row and is replayable from
    // /workroom/payments, so a failure here is recoverable, never a re-charge.
    await fulfillPayment(key);
    return NextResponse.json({ ok: true, payment: settledPayment(outcome.attempt), receiptUrl: outcome.attempt.result?.receiptUrl });
  } catch {
    return NextResponse.json({ pending: true, error: pendingMessage }, { status: 503 });
  }
}
