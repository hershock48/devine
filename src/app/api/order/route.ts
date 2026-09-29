import { fulfillPayment, gatewayIdentity, paymentFingerprint, pendingMessage, takePayment } from "@/lib/square/payment-service";
import { NextResponse } from "next/server";
import { priceOrder, type PricedOrder } from "@/lib/intake";
import { site } from "@/lib/site";
import { resolveSquare } from "@/lib/square/oauth";
import { appFeeCents } from "@/lib/square/payments";
import { getStore, newId, type OrderPayment, type WorkroomOrder } from "@/lib/workroom/store";
import { allowFormPost } from "@/lib/workroom/login-limit";

/**
 * POST /api/order. Takes a customer order. The workroom pay, login and
 * orders routes and the Square webhook write too; this is the customer side.
 *
 * EVERY ONLINE ORDER IS PAID BY CARD (Kevin, 2026-09-29: an order placed on
 * the website cannot be paid by phone or in cash). The unpaid shape that
 * emailed a ticket and took payment on a confirming call is gone; a request
 * without a card is refused with a 400 that sends the customer to the phone,
 * which is where every order the site cannot take belongs.
 *
 *   400 { ok: false, error }   the order itself is wrong, or cannot be paid
 *                              online; nothing was charged and nothing is
 *                              saved, so the cart forgets the attempt
 *
 * The CHARGE is the order (payload carries card.sourceId and
 * card.attemptKey). Sequence: price, gate delivery (a zip must be on the
 * owner's fee sheet and the flowers must clear her minimum), confirm Square
 * and storage are reachable at all (the 2026-09-28 audit: a 503 here left the
 * cart on "awaiting confirmation" forever for a charge that never started),
 * then hand the whole intent to takePayment, which saves it to Postgres under the browser's
 * attemptKey BEFORE Square is called. The board id derives from that key,
 * so a retried request lands on the same row instead of a second order.
 * After a successful charge, fulfillPayment writes the board row and sends
 * the emails; both are replayable from /workroom/payments if they fail, so
 * the response is ok whenever the money moved. The Square sale itself
 * (reference id attached) is the deepest backstop. The extra vocabulary:
 *
 *   402 { failed }     Square declined, or nothing was submitted; the cart
 *                      offers "return to checkout" and forgets the attempt
 *   202 { pending }    Square's answer was lost; the cart keeps the attempt
 *                      key and asks /api/order/payment-status. NEVER a
 *                      second charge from here.
 *   409 { pending }    the same attempt key arrived carrying a different order
 *   503 { pending }    storage or Square unreachable before the call
 *
 * A paid pickup is born "confirmed": the total is settled and the date is
 * chosen; there is nothing left for a confirm call to collect.
 *
 * Runs on Node, not edge: nodemailer speaks raw SMTP sockets.
 */
export const runtime = "nodejs";

export async function POST(req: Request) {
  // Twenty card attempts per ten minutes per address: room for a customer
  // retrying declines, not for a script walking stolen cards through Square.
  // Refused before anything is saved, so the cart treats it like a 400.
  if (!(await allowFormPost("order", req, 20))) {
    return NextResponse.json({ ok: false, error: `Too many tries from this connection. Wait a few minutes, or call the shop at ${site.phone}.` }, { status: 429 });
  }
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

  const card = (raw as { card?: { sourceId?: unknown; attemptKey?: unknown } }).card;
  const sourceId = typeof card?.sourceId === "string" ? card.sourceId : "";

  if (!sourceId) {
    return NextResponse.json({ ok: false, error: `Online orders are paid by card at checkout. To order another way, call the shop at ${site.phone}.` }, { status: 400 });
  }
  return paidFlow(priced.order, sourceId, typeof card?.attemptKey === "string" ? card.attemptKey : "");
}

/** The checkout's "cannot be paid online right now" answer. A 400, because
    nothing was saved and nothing was sent to Square: the cart forgets the
    attempt and the customer is free to try again or pick up the phone. */
const cardsUnavailable = () =>
  NextResponse.json(
    { ok: false, error: `Card payment isn't available right now, so nothing was charged. Call the shop at ${site.phone} and we'll take your order by phone.` },
    { status: 400 },
  );

async function paidFlow(order: PricedOrder, sourceId: string, attemptKey: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptKey)) return NextResponse.json({ ok: false, error: "Refresh checkout before paying." }, { status: 400 });
  if (process.env.CHECKOUT_CARDS?.trim() !== "on") return cardsUnavailable();

  /*
    DELIVERY CAN PAY BY CARD since 2026-09-01: the owner confirmed her
    per-zip fee sheet and minimums, which dissolved the reason this was
    pickup-only (an unpriceable delivery meant an unchargeable total).
    Two honest gates remain, both with the shop's phone as the out:
    a zip off her sheet cannot be priced, and the flowers subtotal must
    clear her minimum ($45 Marshall / $55 outside, the stricter
    fee-excluded reading; see site.ts).
  */
  let deliveryFee = 0;
  if (order.fulfillment === "delivery") {
    const fee = site.deliveryFees[order.zip];
    if (fee === undefined) {
      return NextResponse.json(
        { ok: false, error: `We take delivery orders online for the zips on our delivery list. For anywhere else, call the shop at ${site.phone} and we will sort it out.` },
        { status: 400 },
      );
    }
    const inMarshall = order.zip === site.marshallZip;
    const min = inMarshall ? site.deliveryMinimums.marshall : site.deliveryMinimums.outside;
    if (order.subtotal < min) {
      return NextResponse.json(
        { ok: false, error: `Delivery orders start at $${min} in flowers ${inMarshall ? "in Marshall" : "outside Marshall"}. Add a little more to place it online, or call the shop at ${site.phone}.` },
        { status: 400 },
      );
    }
    deliveryFee = fee;
  }

  // Both checks happen before takePayment saves anything, so a "no" here is
  // provably not a charge and the cart may forget the attempt (400). Letting
  // either failure reach takePayment turned it into an ambiguous 503.
  if (getStore().backend !== "postgres") return cardsUnavailable();
  let cfg: Awaited<ReturnType<typeof resolveSquare>>;
  try { cfg = await resolveSquare(); } catch { return cardsUnavailable(); }
  if (!cfg) return cardsUnavailable();

  const id = `web_${attemptKey.replaceAll("-", "")}`;
  const chargeLines = [
    ...order.lines.map((l) => ({ name: l.name, qty: l.qty, each: l.each })),
    ...(deliveryFee > 0 ? [{ name: `Delivery (${order.zip})`, qty: 1, each: deliveryFee }] : []),
  ];
  /* The website's fee story (Kevin, 2026-09-04): one Convenience fee line
     combining the shop's 3% card fee with the 99 cent platform fee. Only
     the 99 cents ride to the Glazed account; the 3% is the shop's. The
     browser shows the same arithmetic (CartView) and Square's order-total
     check would catch any drift between the two. */
  const baseCents = chargeLines.reduce((s, l) => s + Math.round(l.each * 100) * l.qty, 0);
  const convenienceCents = Math.round((baseCents * site.cardFeePct) / 100) + appFeeCents();
  // The board ticket carries the delivery line too, and its subtotal is the
  // whole order value (flowers + delivery), so the ticket's rows and its
  // Subtotal agree with what the card was charged. The row is not written
  // here: it rides inside the saved intent and fulfillPayment writes it once
  // the charge is confirmed, so a declined card leaves no ghost ticket.
  const wr = { ...toWorkroomOrder(order, "confirmed", null), id };
  if (deliveryFee > 0) {
    wr.lines = [...wr.lines, { slug: null, name: `Delivery (${order.zip})`, qty: 1, each: deliveryFee }];
    wr.subtotal = Math.round((wr.subtotal + deliveryFee) * 100) / 100;
  }
  // The fingerprint is what makes a repeat of the same attempt key a retry
  // rather than a conflict. priceOrder mints a fresh order number on every
  // request, so it is left out; everything the customer chose is in.
  const { number: ignoredNumber, ...stableOrder } = order;
  void ignoredNumber;
  try {
    const outcome = await takePayment(attemptKey, paymentFingerprint({ order: stableOrder, deliveryFee, convenienceCents }), {
      order: wr, online: { order, deliveryCents: Math.round(deliveryFee * 100) }, method: "card",
      gateway: gatewayIdentity(cfg), cardFee: { name: "Convenience fee", cents: convenienceCents, appFeeCents: appFeeCents() },
    }, sourceId);
    if(outcome.kind==='failed')return NextResponse.json({ok:false,failed:true,pending:false,error:outcome.attempt.result?.status==='OWNER_CONFIRMED_NO_PAYMENT'?'The owner verified no payment. Refresh and explicitly retry using the required payment method.':outcome.attempt.result?.status==='NOT_SUBMITTED'?'No payment was submitted. Return to checkout or contact the shop.':'The card payment was declined or canceled. Return to checkout to check your card details or choose another payment method.'},{status:402});
    if (outcome.kind !== "completed") return NextResponse.json({ ok: false, pending: true, error: outcome.kind === "conflict" ? "This checkout has a different saved order. Check its payment status before placing another." : pendingMessage }, { status: outcome.kind === "pending" ? 202 : 409 });
    await fulfillPayment(attemptKey).catch(() => console.error("[devine] paid order requires recovery", attemptKey));
    const charged = outcome.attempt.result!;
    return NextResponse.json({ ok: true, number: outcome.attempt.snapshot.order.number, paid: { totalCents: charged.totalCents, feeCents: charged.feeCents, receiptUrl: charged.receiptUrl } });
  } catch {
    return NextResponse.json({ ok: false, pending: true, error: pendingMessage }, { status: 503 });
  }
}

function toWorkroomOrder(o: PricedOrder, status: WorkroomOrder["status"], payment: OrderPayment | null): WorkroomOrder {
  return {
    id: newId("wr"),
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
    lines: o.lines.map((l) => ({ slug: l.slug, name: l.name, qty: l.qty, each: l.each })),
    subtotal: o.subtotal,
    createdAt: Date.now(),
    payment,
  };
}
