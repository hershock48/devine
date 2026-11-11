import { NextResponse } from "next/server";
import { balanceCents, collectedCents, isTaxLine, taxLineName, ticketWithZipFee } from "@/lib/workroom/derive";
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

/** The Accounts tab's rule for "the same customer", for the server: the
    business when either order has one, else the phone (ui.tsx phoneKey:
    the last ten digits, seven at least), else the name. A walk-in is
    nobody. Credit only ever moves between two orders this calls the same. */
const phoneKey = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
};
function sameCustomer(a: WorkroomOrder, b: WorkroomOrder): boolean {
  if (a.quick || b.quick) return false;
  const ba = (a.business ?? "").trim().toLowerCase();
  const bb = (b.business ?? "").trim().toLowerCase();
  if (ba || bb) return !!ba && ba === bb;
  const pa = phoneKey(a.phone);
  const pb = phoneKey(b.phone);
  if (pa || pb) return !!pa && pa === pb;
  return !!a.name.trim() && a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}
/** A check by this number is already on the order: a second tap, a second
    screen, or the same check keyed again. Its own guard, because a by-hand
    payment has no Square id to be recognized by and may now run over what
    is due, so a repeat would land as credit instead of being refused. */
const hasCheck = (o: WorkroomOrder, n: string) => !!n && [o.payment, ...(o.topUps ?? [])].some((q) => !!q && q.via === "check" && q.checkNumber === n);

/** How far over what is due a by-hand payment may run, in cents: enough
    for a real overpayment, not enough for a slipped decimal point. */
const OVER_LIMIT_CENTS = 500_000;

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
  // "check" and "credit" (Katy, 2026-11-09) are by-hand marks like
  // "manual": no Square call, a record of money that moved outside the
  // board. A check carries its number; a credit names the overpaid order
  // it is moved from.
  const method = p.method === "card" || p.method === "cash" || p.method === "manual" || p.method === "check" || p.method === "credit" ? p.method : null;
  const checkNumber = typeof p.checkNumber === "string" ? p.checkNumber.trim().slice(0, 30) : "";
  const fromId = typeof p.fromId === "string" ? p.fromId : "";
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
  // A JSON number and nothing else: "4000" in quotes is refused as not a
  // number rather than read as one, so a pane bug cannot pay by accident.
  const amountCents = p.amountCents === undefined || p.amountCents === null ? undefined : typeof p.amountCents === "number" ? p.amountCents : NaN;
  if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    return NextResponse.json(
      { error: Number.isInteger(amountCents) && amountCents <= 0 ? "The amount has to be more than zero." : "The amount did not read as a number." },
      { status: 400 },
    );
  }
  if (ids.length >= 2) {
    if (method === "credit") return NextResponse.json({ error: "Credit moves onto one order at a time." }, { status: 400 });
    return payBatch(ids, method, sourceId, attempt, amountCents, checkNumber);
  }

  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return NextResponse.json({ error: "No such order." }, { status: 404 });
  if (order.voided) return NextResponse.json({ error: "That order was removed as written up twice. Put it back from the dashboard before taking money on it." }, { status: 409 });
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
  const { lines: ticketLines, subtotal: ticketSubtotal, appended: feeAppended } = topUp ? { lines: order.lines, subtotal: order.subtotal, appended: false } : ticketWithZipFee(order);
  // What is due now: the whole ticket (fee included) on a first payment,
  // the balance on a top-up. A part payment may be any amount up to it;
  // the fee still joins the ticket on the first payment, part or whole.
  const dueCents = topUp ? due : Math.round(ticketSubtotal * 100);
  // A CHECK FOR MORE THAN THE ORDER (Katy, 2026-11-09: "apply an overage
  // to another order of theirs"). A by-hand payment may run over what is
  // due: the extra sits on this order as credit, and the card offers to
  // move it onto another order. A card or cash charge never runs over.
  // Not onto an order first rung on the register: its balance never
  // shows an excess (a tip is the register's business), so the credit
  // would be on record and on no screen.
  const mayRunOver = (method === "check" || method === "manual") && order.payment?.method !== "register" && amountCents !== undefined && amountCents <= dueCents + OVER_LIMIT_CENTS;
  if (amountCents !== undefined && amountCents > dueCents && !mayRunOver) {
    return NextResponse.json({ error: `That is more than what is due (${(dueCents / 100).toFixed(2)}).` }, { status: 400 });
  }
  const part = amountCents !== undefined && amountCents < dueCents;
  const payCents = amountCents ?? dueCents;
  const lines: WorkroomLine[] = part
    ? partLines(`Part payment on order ${order.number}`, payCents, ticketLines, ticketSubtotal)
    : topUp
      ? partLines(`Balance on order ${order.number}`, due, ticketLines, ticketSubtotal)
      : ticketLines;
  const record = (p: OrderPayment) => recordOnce(order.id, p);

  // The by-hand mark: money already moved outside the board (a check, an
  // account, an unlinked register ring). Records the fact and touches
  // nothing else; deliberately works even with Square unconfigured.
  if (method === "manual" || method === "check" || method === "credit") {
    if (method === "check" && hasCheck(order, checkNumber)) {
      return NextResponse.json({ error: `Check #${checkNumber} is already recorded on ${order.number}. If this is a different check, give it its own number.` }, { status: 409 });
    }
    const at = Date.now();
    let cents = payCents;
    let note = "";
    if (method === "credit") {
      // CREDIT FROM ANOTHER ORDER: the overpaid order gives it up first
      // (the store appends only while that much is still owed back, so
      // the same credit cannot be spent twice), then it lands here.
      const src = fromId && fromId !== order.id ? await store.getOrder(fromId) : null;
      if (!src) return NextResponse.json({ error: "Pick the order the credit comes from." }, { status: 400 });
      if (src.voided || src.status === "canceled") return NextResponse.json({ error: `${src.number} is ${src.voided ? "removed" : "canceled"}; its money is refunded, not moved.` }, { status: 409 });
      if (!sameCustomer(src, order)) return NextResponse.json({ error: `${src.number} and ${order.number} are not the same customer's orders, so credit does not move between them.` }, { status: 409 });
      // A MOVE THAT STOPPED HALFWAY (the credit left its order and the
      // write here failed): the same tap again finishes it. Known by the
      // transfer on the source naming this order with no credit payment of
      // the same instant here.
      const here = [order.payment, ...(order.topUps ?? [])];
      const orphan = (src.refunds ?? []).find((x) => x.how === "transfer" && x.note === `Applied to order ${order.number}` && !here.some((q) => !!q && q.via === "credit" && q.at === x.at));
      if (orphan) {
        if (feeAppended) await store.setOrderLines(order.id, ticketLines, ticketSubtotal);
        await record({ at: orphan.at, method: "other", via: "credit", note: `Credit from order ${src.number}`, squarePaymentId: "", totalCents: orphan.cents, feeCents: 0 });
        return NextResponse.json({ ok: true, finished: true });
      }
      const credit = src.payment ? -balanceCents(src) : 0;
      if (credit <= 0) return NextResponse.json({ error: `${src.number} has no credit on it.` }, { status: 409 });
      if (amountCents !== undefined && amountCents > credit) return NextResponse.json({ error: `Only ${(credit / 100).toFixed(2)} of credit is on ${src.number}.` }, { status: 400 });
      cents = Math.min(payCents, credit);
      const moved = await store.addOrderRefund(src.id, { at, cents, how: "transfer", note: `Applied to order ${order.number}` });
      if (!moved) return NextResponse.json({ error: "That credit was already used or given back. Reload the board and look at both cards." }, { status: 409 });
      note = `Credit from order ${src.number}`;
    }
    const payment: OrderPayment = {
      at,
      method: "other",
      ...(method === "check" ? { via: "check" as const, ...(checkNumber ? { checkNumber } : {}) } : method === "credit" ? { via: "credit" as const, note } : {}),
      squarePaymentId: "",
      totalCents: cents,
      feeCents: 0,
    };
    try {
      if (feeAppended) await store.setOrderLines(order.id, ticketLines, ticketSubtotal);
      // recordOnce knows its own mark (this request's timestamp), so a
      // retry cannot land twice. Credit has already left its order by
      // here, so it gets three tries before anyone is asked to fix it.
      for (let tries = 0; ; tries++) {
        try {
          await record(payment);
          break;
        } catch (e) {
          if (method !== "credit" || tries >= 2) throw e;
        }
      }
    } catch (err) {
      if (method !== "credit") throw err;
      console.error(`[devine] credit left its order but did not land on ${order.number}:`, err);
      return NextResponse.json({ error: `The credit left its order but did not land on ${order.number}. Tap Move again now and it will finish. If this box has closed, write down both order numbers and ${(cents / 100).toFixed(2)}, and tell Glazed Web.` }, { status: 500 });
    }
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
      if (feeAppended) await store.setOrderLines(order.id, ticketLines, ticketSubtotal);
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
 * A PAYMENT THAT IS NOT THE WHOLE TICKET, as Square sees it: a part
 * payment, or the balance left after one. Sent as one untaxed line, it
 * would leave her Square sales-tax report short on every split ticket
 * (the tax is a line of the ticket, and Square only knows the tax it is
 * told). So the amount is split the way the ticket is: the part less its
 * share of the ticket's tax, and the tax line for that share, by
 * proportion (amount × ticket tax ÷ ticket total, rounded). Rounding can
 * leave the shares of a split a cent apart from the ticket's tax; the
 * ticket itself is unchanged and the board's balance is unaffected.
 */
function partLines(name: string, cents: number, ticketLines: WorkroomLine[], ticketSubtotal: number): WorkroomLine[] {
  const ticketCents = Math.round(ticketSubtotal * 100);
  const tax = ticketLines.filter(isTaxLine);
  const ticketTaxCents = tax.reduce((s, l) => s + Math.round(l.each * 100) * l.qty, 0);
  const taxShare = ticketCents > 0 && ticketTaxCents > 0 ? Math.min(cents, Math.round((cents * ticketTaxCents) / ticketCents)) : 0;
  const lines: WorkroomLine[] = [{ slug: null, name, qty: 1, each: (cents - taxShare) / 100 }];
  if (taxShare > 0) lines.push({ slug: null, name: tax[0]?.name ?? taxLineName, qty: 1, each: taxShare / 100 });
  return lines;
}

/**
 * ONE WRITE PER PAYMENT PER ORDER, however many times the board write is
 * tried. The three-try loops below retry the whole record step after a
 * blip, and a top-up is appended, not replaced: the second try must not
 * append again what the first one managed to write before it failed (one
 * order of a group written, the next one's write thrown). So the order is
 * re-read first, and the payment is skipped when it is already on it: by
 * its Square payment id, or, for the by-hand mark that has none, by the
 * request's own timestamp (one `at` per request, so the mark is its own
 * marker). The webhook may have written the same Square payment first;
 * that counts as written too.
 */
async function recordOnce(id: string, pmt: OrderPayment): Promise<void> {
  const store = getStore();
  const fresh = await store.getOrder(id);
  if (!fresh) return;
  // MONEY NEVER HIDES. The route refused a removed order before charging,
  // but a Remove can land in the seconds a card takes to clear. The money
  // is real, so the order comes back onto the books with it rather than
  // the payment vanishing with the order.
  if (fresh.voided) await store.patchOrder(id, { voided: null });
  const same = (q: OrderPayment | null | undefined) =>
    !!q && (pmt.squarePaymentId ? q.squarePaymentId === pmt.squarePaymentId : q.method === "other" && q.at === pmt.at);
  // The webhook can land first and write the same Square payment as a
  // "register" ring; the counter's own record (card, cash) is the truer
  // one and replaces it when it is the first payment. (A register top-up
  // written first stays: it changes no arithmetic, only the word.)
  if (same(fresh.payment)) {
    if (fresh.payment!.method === "register" && pmt.method !== "register") await store.setOrderPayment(id, pmt);
    return;
  }
  if ((fresh.topUps ?? []).some(same)) return;
  if (fresh.payment) await store.addOrderTopUp(id, pmt);
  else await store.setOrderPayment(id, pmt);
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
async function payBatch(ids: string[], method: "card" | "cash" | "manual" | "check", sourceId: string | undefined, attempt: string, amountCents?: number, checkNumber = "") {
  const store = getStore();
  const orders = await Promise.all(ids.map((x) => store.getOrder(x)));
  // Each order's ticket as it will stand once charged (the sheet fee
  // appended to a delivery ticket that never carried one), what it is
  // owed, and the lines Square is told.
  const parts: { o: WorkroomOrder; amountCents: number; lines: WorkroomLine[]; ticket: { lines: WorkroomLine[]; subtotal: number }; appended?: { lines: WorkroomLine[]; subtotal: number }; unreached?: boolean }[] = [];
  for (let i = 0; i < ids.length; i++) {
    const o = orders[i];
    if (!o) return NextResponse.json({ error: `No such order (${ids[i]}).` }, { status: 404 });
    if (o.voided) return NextResponse.json({ error: `${o.number} was removed as written up twice; take it out of the group first.` }, { status: 409 });
    if (o.status === "canceled") return NextResponse.json({ error: `${o.number} is canceled; take it out of the group first.` }, { status: 409 });
    if (o.status === "hold") return NextResponse.json({ error: `${o.number} is on hold; finish it first.` }, { status: 409 });
    if (method === "check" && hasCheck(o, checkNumber)) return NextResponse.json({ error: `Check #${checkNumber} is already recorded on ${o.number}. If this is a different check, give it its own number.` }, { status: 409 });
    if (o.payment) {
      const due = balanceCents(o);
      if (due <= 0) return NextResponse.json({ error: `${o.number} is already paid.` }, { status: 409 });
      const ticket = { lines: o.lines, subtotal: o.subtotal };
      parts.push({ o, amountCents: due, lines: groupLines(o, `Balance on order ${o.number}`, due, ticket), ticket });
      continue;
    }
    const { lines, subtotal, appended } = ticketWithZipFee(o);
    parts.push({
      o,
      amountCents: Math.round(subtotal * 100),
      lines: lines.map((l) => ({ ...l, name: `${o.number}: ${l.name}` })),
      ticket: { lines, subtotal },
      appended: appended ? { lines, subtotal } : undefined,
    });
  }
  const dueCents = parts.reduce((s, x) => s + x.amountCents, 0);
  if (dueCents <= 0) return NextResponse.json({ error: "Nothing is owed on those orders." }, { status: 409 });
  // A by-hand payment may run over (one check for a little more than the
  // account owes): the extra sits on the last order as credit.
  const over = amountCents !== undefined && amountCents > dueCents ? amountCents - dueCents : 0;
  if (over > 0 && !((method === "check" || method === "manual") && over <= OVER_LIMIT_CENTS && parts[parts.length - 1].o.payment?.method !== "register")) {
    return NextResponse.json({ error: `That is more than what is due on those orders (${(dueCents / 100).toFixed(2)}).` }, { status: 400 });
  }
  // A PART PAYMENT ON THE GROUP (Kevin, 2026-10-14) is dealt out in order,
  // each order filled before the next gets any, so every order's record is
  // its own share of the one charge and the first orders settle first. An
  // order the amount does not reach is left alone: no $0 record, and no
  // fee line appended to it until its own first payment.
  if (amountCents !== undefined && amountCents < dueCents) {
    let left = amountCents;
    // Strictly in order: once the amount runs out on one order, every
    // order after it is unreached too, a $0 ticket included, so the
    // group settles front to back and nothing later closes while an
    // earlier one is still owed.
    let reached = true;
    for (const x of parts) {
      const share = reached ? Math.min(left, x.amountCents) : 0;
      left -= share;
      if (share < x.amountCents) reached = false;
      if (!reached && share === 0) {
        // Not reached by this amount: no record at all, not a $0 one.
        x.lines = [];
        x.appended = undefined;
        x.unreached = true;
      } else if (share < x.amountCents) {
        x.lines = groupLines(x.o, `Part payment on order ${x.o.number}`, share, x.ticket);
      }
      x.amountCents = share;
    }
  }
  if (over > 0) parts[parts.length - 1].amountCents += over;
  const totalCents = parts.reduce((s, x) => s + x.amountCents, 0);
  // The reference stays the group's first order, whatever the amount
  // reached; the label counts only the orders this payment touches.
  const first = parts[0].o;
  // Every order the amount reached, a $0 ticket included (it is settled
  // by a $0 record, as it always was); only the unreached ones are left.
  const funded = parts.filter((x) => !x.unreached);
  const label = funded.length > 1 ? `${funded[0].o.number} +${funded.length - 1}` : funded[0].o.number;

  // One timestamp for the request: the by-hand mark's own marker, so a
  // retried write recognizes it (recordOnce).
  const at = Date.now();
  const record = async (make: (x: (typeof parts)[number]) => OrderPayment) => {
    for (const x of funded) {
      if (x.appended) await store.setOrderLines(x.o.id, x.appended.lines, x.appended.subtotal);
      await recordOnce(x.o.id, make(x));
    }
  };

  if (method === "manual" || method === "check") {
    const kind = method === "check" ? { via: "check" as const, ...(checkNumber ? { checkNumber } : {}) } : {};
    await record((x) => ({ at, method: "other", ...kind, squarePaymentId: "", totalCents: x.amountCents, feeCents: 0 }));
    return NextResponse.json({ ok: true, payment: { at, method: "other", ...kind, squarePaymentId: "", totalCents, feeCents: 0 }, orders: funded.map((x) => ({ number: x.o.number, cents: x.amountCents })) });
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
      await record((x) => ({ at, method, squarePaymentId: charged.paymentId, totalCents: x.amountCents, feeCents: 0 }));
      boardMissed = false;
      break;
    } catch (err) {
      boardMissed = true;
      console.error(`[devine] ${attemptNo === 3 ? "CRITICAL: " : ""}pay ${label}: Square payment ${charged.paymentId} succeeded but the board write failed (try ${attemptNo}):`, err);
      if (attemptNo < 3) await new Promise((r) => setTimeout(r, 400 * attemptNo));
    }
  }
  return NextResponse.json({ ok: true, payment: { at, method, squarePaymentId: charged.paymentId, totalCents: charged.totalCents, feeCents: charged.feeCents }, receiptUrl: charged.receiptUrl, boardMissed });
}

/** A part or balance line for one order of a group, its tax line carrying
    the order's number like every other line of the group's Square order,
    so the sales-tax report can tie it to the order. */
function groupLines(o: WorkroomOrder, name: string, cents: number, ticket: { lines: WorkroomLine[]; subtotal: number }): WorkroomLine[] {
  return partLines(name, cents, ticket.lines, ticket.subtotal).map((l, i) => (i === 0 ? l : { ...l, name: `${o.number}: ${l.name}` }));
}
