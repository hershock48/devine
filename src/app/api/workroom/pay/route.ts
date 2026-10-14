import { NextResponse } from "next/server";
import { balanceCents, collectedCents, deliveryLineName, zipFeeToAppend } from "@/lib/workroom/derive";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { resolveSquare } from "@/lib/square/oauth";
import { chargeBoardOrder, isIdempotencyReuse, isPaymentUnsure } from "@/lib/square/payments";
import { getStore, type OrderPayment, type WorkroomLine, type WorkroomOrder } from "@/lib/workroom/store";

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

  // SEVERAL ORDERS, ONE PAYMENT (Kevin, 2026-10-14): the pane may send
  // ids instead of id, the orders placed together for one customer.
  const ids = Array.isArray(p.ids) ? [...new Set(p.ids.filter((x): x is string => typeof x === "string"))].slice(0, 20) : [];
  if (!(id || ids.length >= 2) || !method) return NextResponse.json({ error: "Order id and method are required." }, { status: 400 });
  if (method === "card" && !sourceId) return NextResponse.json({ error: "No card token arrived." }, { status: 400 });
  // PART OF IT NOW (Kevin, 2026-10-14: "x amount cash and the rest on
  // card, or half on this card and half on another"). An optional amount,
  // in cents; absent means the whole of what is due, as always. What is
  // not paid stays on the ticket as balance, and the next payment is a
  // top-up by the path that already exists for an edited ticket.
  const amountCents = p.amountCents === undefined || p.amountCents === null ? undefined : Number(p.amountCents);
  if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    return NextResponse.json(
      { error: Number.isFinite(amountCents) && amountCents <= 0 ? "The amount has to be more than zero." : "The amount did not read as a number." },
      { status: 400 },
    );
  }
  if (ids.length >= 2) return payBatch(ids, method, sourceId, attempt, amountCents);

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
  const ticketLines: WorkroomLine[] = zipFee !== undefined ? [...order.lines, { slug: null, name: deliveryLineName(order.zip), qty: 1, each: zipFee }] : order.lines;
  const ticketSubtotal = zipFee !== undefined ? Math.round((order.subtotal + zipFee) * 100) / 100 : order.subtotal;
  // What is due now: the whole ticket (fee included) on a first payment,
  // the balance on a top-up. A part payment may be any amount up to it;
  // the fee still joins the ticket on the first payment, part or whole.
  const dueCents = topUp ? due : Math.round(ticketSubtotal * 100);
  if (amountCents !== undefined && amountCents > dueCents) {
    return NextResponse.json({ error: `That is more than what is due (${(dueCents / 100).toFixed(2)}).` }, { status: 400 });
  }
  const part = amountCents !== undefined && amountCents < dueCents;
  const payCents = amountCents ?? dueCents;
  const lines: WorkroomLine[] = part
    ? [{ slug: null, name: `Part payment on order ${order.number}`, qty: 1, each: payCents / 100 }]
    : topUp
      ? [{ slug: null, name: `Balance on order ${order.number}`, qty: 1, each: due / 100 }]
      : ticketLines;
  const record = (p: OrderPayment) => (topUp ? store.addOrderTopUp(order.id, p) : store.setOrderPayment(order.id, p));

  // The by-hand mark: money already moved outside the board (a check, an
  // account, an unlinked register ring). Records the fact and touches
  // nothing else; deliberately works even with Square unconfigured.
  if (method === "manual") {
    const payment: OrderPayment = {
      at: Date.now(),
      method: "other",
      squarePaymentId: "",
      totalCents: payCents,
      feeCents: 0,
    };
    if (zipFee !== undefined) await store.setOrderLines(order.id, ticketLines, ticketSubtotal);
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
      // Cash carries what was collected so far, so a cash top-up after a
      // cash payment is a new key, and a double tap of the same top-up
      // (same state) is still one record.
      idempotencyKey: `${order.id}:${method === "card" ? attempt || sourceId : `cash:${collectedCents(order)}`}`,
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
      if (zipFee !== undefined) await store.setOrderLines(order.id, ticketLines, ticketSubtotal);
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

/**
 * ONE PAYMENT FOR SEVERAL ORDERS. Each order is charged what it is owed
 * (its balance, plus the sheet fee a delivery ticket with no delivery
 * line would get, the single-order rule), the sum goes to Square (or the
 * drawer, or the by-hand mark) once, and every order is marked paid with
 * its own share and the one Square payment id. A canceled, held or
 * settled order in the list is refused by name, so nobody pays for one
 * that does not need it.
 */
async function payBatch(ids: string[], method: "card" | "cash" | "manual", sourceId: string | undefined, attempt: string, amountCents?: number) {
  const store = getStore();
  const orders = await Promise.all(ids.map((x) => store.getOrder(x)));
  const parts: { o: WorkroomOrder; amountCents: number; lines: WorkroomLine[]; appended?: { lines: WorkroomLine[]; subtotal: number } }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const o = orders[i];
    if (!o) return NextResponse.json({ error: `No such order (${ids[i]}).` }, { status: 404 });
    if (o.status === "canceled") return NextResponse.json({ error: `${o.number} is canceled; take it out of the group first.` }, { status: 409 });
    if (o.status === "hold") return NextResponse.json({ error: `${o.number} is on hold; finish it first.` }, { status: 409 });
    if (o.payment) {
      const due = balanceCents(o);
      if (due <= 0) return NextResponse.json({ error: `${o.number} is already paid.` }, { status: 409 });
      parts.push({ o, amountCents: due, lines: [{ slug: null, name: `Balance on order ${o.number}`, qty: 1, each: due / 100 }] });
      continue;
    }
    const zipFee = zipFeeToAppend(o);
    const lines: WorkroomLine[] = zipFee !== undefined ? [...o.lines, { slug: null, name: deliveryLineName(o.zip), qty: 1, each: zipFee }] : o.lines;
    const subtotal = zipFee !== undefined ? Math.round((o.subtotal + zipFee) * 100) / 100 : o.subtotal;
    parts.push({
      o,
      amountCents: Math.round(subtotal * 100),
      lines: lines.map((l) => ({ ...l, name: `${o.number}: ${l.name}` })),
      appended: zipFee !== undefined ? { lines, subtotal } : undefined,
    });
  }
  const dueCents = parts.reduce((s, x) => s + x.amountCents, 0);
  if (dueCents <= 0) return NextResponse.json({ error: "Nothing is owed on those orders." }, { status: 409 });
  if (amountCents !== undefined && amountCents > dueCents) {
    return NextResponse.json({ error: `That is more than what is due on those orders (${(dueCents / 100).toFixed(2)}).` }, { status: 400 });
  }
  // A PART PAYMENT ON THE GROUP (Kevin, 2026-10-14) is dealt out in order,
  // each order filled before the next gets any, so every order's record is
  // its own share of the one charge and the first orders settle first. An
  // order the amount does not reach is left alone: no $0 record, and no
  // fee line appended to it until its own first payment.
  if (amountCents !== undefined && amountCents < dueCents) {
    let left = amountCents;
    for (const x of parts) {
      const share = Math.min(left, x.amountCents);
      left -= share;
      if (share < x.amountCents) {
        x.lines = share > 0 ? [{ slug: null, name: `Part payment on order ${x.o.number}`, qty: 1, each: share / 100 }] : [];
        if (share === 0) x.appended = undefined;
      }
      x.amountCents = share;
    }
  }
  const totalCents = parts.reduce((s, x) => s + x.amountCents, 0);
  const first = parts[0].o;
  const label = `${first.number} +${parts.length - 1}`;

  const record = async (make: (x: (typeof parts)[number]) => OrderPayment) => {
    for (const x of parts) {
      if (x.amountCents <= 0) continue;
      if (x.appended) await store.setOrderLines(x.o.id, x.appended.lines, x.appended.subtotal);
      const pmt = make(x);
      if (x.o.payment) await store.addOrderTopUp(x.o.id, pmt);
      else await store.setOrderPayment(x.o.id, pmt);
    }
  };

  if (method === "manual") {
    await record((x) => ({ at: Date.now(), method: "other", squarePaymentId: "", totalCents: x.amountCents, feeCents: 0 }));
    return NextResponse.json({ ok: true, payment: { at: Date.now(), method: "other", squarePaymentId: "", totalCents, feeCents: 0 } });
  }

  const cfg = await resolveSquare();
  if (!cfg) return NextResponse.json({ error: "Square is not connected, so no payment can be taken here yet." }, { status: 503 });
  let charged: Awaited<ReturnType<typeof chargeBoardOrder>>;
  try {
    charged = await chargeBoardOrder(cfg, {
      // "batch:" tells the webhook this payment covers several orders, so
      // it records the sale and leaves the marking to the shares below
      // rather than paying the first order the whole amount.
      workroomOrderId: `batch:${first.id}`,
      orderNumber: label,
      lines: parts.flatMap((x) => x.lines.map((l) => ({ name: l.name, qty: l.qty, each: l.each }))),
      method,
      sourceId,
      cardFee: { name: "", cents: 0, appFeeCents: 0 },
      idempotencyKey: `${ids.slice().sort().join("+")}:${method === "card" ? attempt || sourceId : `cash:${parts.reduce((s, x) => s + collectedCents(x.o), 0)}`}`,
    });
  } catch (err) {
    console.error(`[devine] pay ${label} (${method}) failed:`, err);
    if (isIdempotencyReuse(err)) return NextResponse.json({ error: "That charge already went through. Reload the board before doing anything else." }, { status: 409 });
    if (isPaymentUnsure(err)) {
      return NextResponse.json(
        { unsure: true, error: "No answer came back from Square, so the card MAY have been charged. Do not take the card again elsewhere. Tap Charge once more here: if the first charge went through, it will say so and not charge twice." },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err).slice(0, 300) }, { status: 402 });
  }
  let boardMissed = false;
  for (let attemptNo = 1; attemptNo <= 3; attemptNo++) {
    try {
      await record((x) => ({ at: Date.now(), method, squarePaymentId: charged.paymentId, totalCents: x.amountCents, feeCents: 0 }));
      boardMissed = false;
      break;
    } catch (err) {
      boardMissed = true;
      console.error(`[devine] ${attemptNo === 3 ? "CRITICAL: " : ""}pay ${label}: Square payment ${charged.paymentId} succeeded but the board write failed (try ${attemptNo}):`, err);
      if (attemptNo < 3) await new Promise((r) => setTimeout(r, 400 * attemptNo));
    }
  }
  return NextResponse.json({ ok: true, payment: { at: Date.now(), method, squarePaymentId: charged.paymentId, totalCents: charged.totalCents, feeCents: charged.feeCents }, receiptUrl: charged.receiptUrl, boardMissed });
}
