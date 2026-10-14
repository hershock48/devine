import { NextResponse } from "next/server";
import { priceOrder, sendOrder, type PaidOnline, type PricedOrder } from "@/lib/intake";
import { deliveryFeeFor, site } from "@/lib/site";
import { cardsEnabled } from "@/lib/square/cards";
import { chargeBoardOrder, isIdempotencyReuse, isPaymentUnsure, webFeeCents } from "@/lib/square/payments";
import { getStore, newId, type OrderPayment, type SquareSale, type WorkroomOrder } from "@/lib/workroom/store";
import { taxLineName, deliveryLineName } from "@/lib/workroom/derive";

/**
 * POST /api/order. The only route on the site with a side effect.
 *
 * TWO SHAPES OF ORDER since 2026-09-01, and they anchor on different
 * events:
 *
 * UNPAID (the default, and the only shape until CHECKOUT_CARDS is "on"):
 * the ticket email is the order. The response vocabulary is small so
 * CartView can be honest about each case:
 *
 *   200 { ok: true,  number }        the shop's inbox has the ticket
 *   400 { ok: false, error }         the order itself is wrong; fix and resubmit
 *   503 { ok: false, reason: "unconfigured" }   mail was never set up here
 *   502 { ok: false, reason: "send-failed" }    mail is set up and did not work
 *
 * 503/502 mean "did not reach the shop", the cart says exactly that, and
 * never thanks a visitor for an order nobody received.
 *
 * PAID BY CARD (payload carries card.sourceId): the CHARGE is the order.
 * Sequence: price, gate delivery (a zip must be on the owner's fee sheet
 * and the flowers must clear her minimum; anything else falls back to the
 * pay-on-call flow, see paidFlow), charge through the shop's
 * Square account with the board id as reference, THEN store the board row
 * already paid, then email. A failed charge returns 402 and nothing
 * persists. After a successful charge the emails become best-effort with
 * loud logging: the customer's money moved, so the response must be ok and
 * the board row (plus the Square sale itself) is the record even if SMTP
 * hiccups. A paid pickup is born "confirmed": the total is settled and the
 * date is chosen; there is nothing left for a confirm call to collect.
 *
 * Runs on Node, not edge: nodemailer speaks raw SMTP sockets.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "That did not look like an order." }, { status: 400 });
  }

  const priced = priceOrder(raw);
  if ("error" in priced) {
    return NextResponse.json({ ok: false, error: priced.error }, { status: 400 });
  }

  const card = (raw as { card?: { sourceId?: unknown; attempt?: unknown } }).card;
  const sourceId = typeof card?.sourceId === "string" ? card.sourceId : "";
  // The browser's own id for this checkout attempt (see paidFlow). Shape
  // checked, never trusted for anything but the idempotency key.
  const attempt = typeof card?.attempt === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(card.attempt) ? card.attempt : "";

  if (sourceId) return paidFlow(priced.order, sourceId, attempt);
  // ONLINE ORDERS ARE PAID ONLINE (Kevin, 2026-10-13): while cards are
  // on, by the same test the cart's config uses, an unpaid order is
  // refused here too, not only hidden in the cart, so no request shape
  // reaches the board unpaid. Cards off (the switch, or Square not
  // resolving) is call mode everywhere, and then every order is a call.
  if ((await cardsEnabled()).on) {
    return NextResponse.json({ ok: false, error: "Online orders are paid by card at checkout." }, { status: 400 });
  }

  const result = await sendOrder(priced.order);
  if (result === "sent") {
    /*
      Onto the workroom board too — but only an order that actually reached the
      shop. On "unconfigured" and "send-failed" the customer is told to call
      instead, and a board row for an order the customer was told did not go
      through is a ghost someone will make flowers for. Best-effort: the email
      is the order; a board miss is a log line, never a failed checkout.
    */
    try {
      await getStore().createOrder(toWorkroomOrder(priced.order, newId("wr"), "new", null));
    } catch (err) {
      console.error(`[devine] order ${priced.order.number} not written to the board:`, err);
    }
    return NextResponse.json({ ok: true, number: priced.order.number });
  }
  return NextResponse.json(
    { ok: false, reason: result },
    { status: result === "unconfigured" ? 503 : 502 },
  );
}

async function paidFlow(order: PricedOrder, sourceId: string, attempt: string) {
  const cards = await cardsEnabled();
  if (!cards.on) {
    return NextResponse.json({ ok: false, error: "Card payment is not available online right now; the card was not charged. Please call the shop to order." }, { status: 503 });
  }
  const cfg = cards.cfg;

  /*
    DELIVERY CAN PAY BY CARD since 2026-09-01: the owner confirmed her
    per-zip fee sheet and minimums, which dissolved the reason this was
    pickup-only (an unpriceable delivery meant an unchargeable total).
    One gate remains here: a zip off her sheet cannot be priced. The
    minimum is checked once, in priceOrder, for every order shape.
  */
  let deliveryFee = 0;
  if (order.fulfillment === "delivery") {
    const fee = deliveryFeeFor(order.zip);
    if (fee === undefined) {
      return NextResponse.json(
        { ok: false, error: `We don't deliver to ${order.zip} through the website, so the card was not charged. Give us a call at ${site.phone} and let's see what we can do, or choose pickup.` },
        { status: 400 },
      );
    }
    deliveryFee = fee;
  }

  const id = newId("wr");
  const chargeLines = [
    ...order.lines.map((l) => ({ name: l.name, qty: l.qty, each: l.each })),
    ...(order.tax > 0 ? [{ name: taxLineName, qty: 1, each: order.tax }] : []),
    ...(deliveryFee > 0 ? [{ name: deliveryLineName(order.zip), qty: 1, each: deliveryFee }] : []),
  ];
  /* The website's fee line is the 99 cent platform fee alone since the
     2026-10-06 meeting (the shop's 3% card fee is retired; see site.ts).
     It rides to the Glazed account as app_fee_money. The browser shows the
     same number (CartView, from /api/checkout/config) and Square's
     order-total check would catch any drift between the two. */
  // One rule for the fee, shared with the checkout's config route.
  const convenienceCents = webFeeCents(cfg);
  let charged: Awaited<ReturnType<typeof chargeBoardOrder>>;
  try {
    charged = await chargeBoardOrder(cfg, {
      workroomOrderId: id,
      orderNumber: order.number,
      lines: chargeLines,
      method: "card",
      sourceId,
      cardFee: { name: "Convenience fee", cents: convenienceCents, appFeeCents: convenienceCents },
      // ONE KEY PER ATTEMPT, NOT PER TOKEN. The browser keeps one attempt
      // id for as long as it is unsure whether a payment went through
      // (its response was lost), and every card token is single-use, so
      // a retry arrives with a new token and the same attempt. Keyed on
      // the attempt plus what is being bought, the retry of a charge that
      // did go through is refused by Square as a key reuse and answered
      // 409 below; a changed cart is a different purchase and charges.
      // A browser that sends no attempt falls back to the token itself,
      // which still folds a doubled POST into one payment.
      idempotencyKey: attempt
        ? `web:${attempt}:${JSON.stringify(chargeLines)}:${convenienceCents}`
        : `web:${sourceId}`,
    });
  } catch (err) {
    console.error(`[devine] online payment for ${order.number} failed:`, err);
    if (isIdempotencyReuse(err)) {
      // The same attempt arrived twice; the first one charged. Say so,
      // rather than "not charged", which would invite a third.
      return NextResponse.json(
        { ok: false, error: `That payment already went through; your receipt is on its way. If it does not arrive, call the shop at ${site.phone}.` },
        { status: 409 },
      );
    }
    if (isPaymentUnsure(err)) {
      // Sent, unanswered. Not "not charged": the browser keeps its attempt
      // id and the retry settles it either way.
      return NextResponse.json(
        { ok: false, unsure: true, error: `We did not hear back from the card processor, so your card may or may not have been charged. You can try once more: if the first payment went through, we will say so and not charge again. Or call the shop at ${site.phone}.` },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { ok: false, error: `The card was not charged. Check the number and try again, or call the shop at ${site.phone}.` },
      { status: 402 },
    );
  }

  const payment: OrderPayment = {
    at: Date.now(),
    method: "card",
    squarePaymentId: charged.paymentId,
    totalCents: charged.totalCents,
    feeCents: charged.feeCents,
  };
  const paid: PaidOnline = {
    totalCents: charged.totalCents,
    feeCents: charged.feeCents,
    deliveryCents: Math.round(deliveryFee * 100),
  };

  // Money moved; from here everything is recorded loudly and nothing can
  // fail the response. The Square sale itself (reference id attached) is
  // the deepest backstop: even a total storage-and-mail outage leaves a
  // findable, refundable payment tied to this order number.
  try {
    // The board ticket carries the delivery line too, and its subtotal is
    // the whole order value (flowers + delivery), so the ticket's rows and
    // its Subtotal agree with what the card was charged.
    const wr = toWorkroomOrder(order, id, "confirmed", payment);
    if (deliveryFee > 0) {
      wr.lines = [...wr.lines, { slug: null, name: deliveryLineName(order.zip), qty: 1, each: deliveryFee }];
      wr.subtotal = Math.round((wr.subtotal + deliveryFee) * 100) / 100;
    }
    await getStore().createOrder(wr);
  } catch (err) {
    console.error(`[devine] CRITICAL: paid order ${order.number} (payment ${charged.paymentId}) not written to the board:`, err);
  }
  try {
    // The sale, linked, written here too, and on its own: Square's webhook
    // can fire before the board row above exists, and a sale stored
    // unlinked in that gap would count as a walk-out in the stem numbers
    // forever (Square does not redeliver on a 200). This write wins either
    // order of arrival, and a failed board write above does not skip it.
    const sale: SquareSale = {
      id: charged.paymentId,
      workroomOrderId: id,
      orderId: charged.orderId,
      locationId: cfg.locationId,
      source: "CARD",
      totalCents: charged.totalCents,
      paidAt: new Date().toISOString(),
      lines: [],
      createdAt: Date.now(),
    };
    await getStore().upsertSquareSale(sale);
  } catch (err) {
    console.error(`[devine] paid order ${order.number}: sale ${charged.paymentId} not written; the webhook's copy will stand`, err);
  }
  try {
    await sendOrder(order, paid);
  } catch (err) {
    console.error(`[devine] paid order ${order.number}: emails did not send`, err);
  }

  return NextResponse.json({
    ok: true,
    number: order.number,
    paid: { totalCents: charged.totalCents, feeCents: charged.feeCents, receiptUrl: charged.receiptUrl },
  });
}

function toWorkroomOrder(o: PricedOrder, id: string, status: WorkroomOrder["status"], payment: OrderPayment | null): WorkroomOrder {
  return {
    id,
    number: o.number,
    source: "web",
    status,
    name: o.name,
    phone: o.phone,
    email: o.email,
    fulfillment: o.fulfillment,
    recipient: o.recipient,
    street: o.street,
    town: o.town,
    zip: o.zip,
    date: o.date,
    occasion: o.occasion,
    cardMessage: o.cardMessage,
    notes: o.notes,
    // The tax rides as a line, the board's convention (derive.ts), and the
    // ticket's subtotal is the whole ticket: items plus tax (plus the
    // delivery line, appended by the paid flow).
    lines: [
      ...o.lines.map((l) => ({ slug: l.slug, name: l.name, qty: l.qty, each: l.each })),
      ...(o.tax > 0 ? [{ slug: null, name: taxLineName, qty: 1, each: o.tax }] : []),
    ],
    subtotal: Math.round((o.subtotal + o.tax) * 100) / 100,
    createdAt: Date.now(),
    payment,
  };
}
