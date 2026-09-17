import { fulfillPayment, gatewayIdentity, paymentFingerprint, pendingMessage, takePayment } from "@/lib/square/payment-service";
import { NextResponse } from "next/server";
import { priceOrder, sendOrder, type PricedOrder } from "@/lib/intake";
import { site } from "@/lib/site";
import { resolveSquare } from "@/lib/square/oauth";
import { appFeeCents } from "@/lib/square/payments";
import { getStore, newId, type OrderPayment, type WorkroomOrder } from "@/lib/workroom/store";

/**
 * POST /api/order. Takes a customer order. The workroom pay, login and
 * orders routes and the Square webhook write too; this is the customer side.
 *
 * TWO SHAPES OF ORDER since 2026-09-01, anchored on different events:
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
 * PAID BY CARD (payload carries card.sourceId and card.attemptKey): the
 * CHARGE is the order. Sequence: price, gate delivery (a zip must be on the
 * owner's fee sheet and the flowers must clear her minimum; anything else
 * falls back to the pay-on-call flow, see paidFlow), then hand the whole
 * intent to takePayment, which saves it to Postgres under the browser's
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

  if (sourceId) return paidFlow(priced.order, sourceId, typeof card?.attemptKey === "string" ? card.attemptKey : "");

  const result = await sendOrder(priced.order);
  if (result === "sent") {
    /*
      Onto the workroom board too, but only an order that actually reached the
      shop. On "unconfigured" and "send-failed" the customer is told to call
      instead, and a board row for an order the customer was told did not go
      through is a ghost someone will make flowers for. Best-effort: the email
      is the order; a board miss is a log line, never a failed checkout.
    */
    try {
      await getStore().createOrder(toWorkroomOrder(priced.order, "new", null));
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

async function paidFlow(order: PricedOrder, sourceId: string, attemptKey: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptKey)) return NextResponse.json({ ok: false, error: "Refresh checkout before paying." }, { status: 400 });
  if (process.env.CHECKOUT_CARDS?.trim() !== "on") {
    return NextResponse.json({ ok: false, error: "Card payment is not available online yet." }, { status: 400 });
  }

  /*
    DELIVERY CAN PAY BY CARD since 2026-09-01: the owner confirmed her
    per-zip fee sheet and minimums, which dissolved the reason this was
    pickup-only (an unpriceable delivery meant an unchargeable total).
    Two honest gates remain, both with the pay-on-call flow as the out:
    a zip off her sheet cannot be priced, and the flowers subtotal must
    clear her minimum ($45 Marshall / $55 outside, the stricter
    fee-excluded reading; see site.ts).
  */
  let deliveryFee = 0;
  if (order.fulfillment === "delivery") {
    const fee = site.deliveryFees[order.zip];
    if (fee === undefined) {
      return NextResponse.json(
        { ok: false, error: "We can only price delivery to zips on our list, so card payment is off for this one. Send the order and we will sort delivery on the confirming call." },
        { status: 400 },
      );
    }
    const inMarshall = order.zip === site.marshallZip;
    const min = inMarshall ? site.deliveryMinimums.marshall : site.deliveryMinimums.outside;
    if (order.subtotal < min) {
      return NextResponse.json(
        { ok: false, error: `Delivery orders start at $${min} in flowers ${inMarshall ? "in Marshall" : "outside Marshall"}. Add a little more, or send the order unpaid and we will talk it through on the confirming call.` },
        { status: 400 },
      );
    }
    deliveryFee = fee;
  }

  const cfg = await resolveSquare();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "Card payment is not available right now; the order was not placed. You can order and pay on the confirming call instead." }, { status: 503 });
  }

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
