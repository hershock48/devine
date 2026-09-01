import { NextResponse } from "next/server";
import { priceOrder, sendOrder, type PaidOnline, type PricedOrder } from "@/lib/intake";
import { site } from "@/lib/site";
import { resolveSquare } from "@/lib/square/oauth";
import { chargeBoardOrder } from "@/lib/square/payments";
import { getStore, newId, type OrderPayment, type WorkroomOrder } from "@/lib/workroom/store";

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
 * PAID BY CARD (payload carries card.sourceId, pickup only): the CHARGE is
 * the order. Sequence: price, refuse non-pickup (the delivery fee is still
 * the owner's unanswered question, and charging a "final" total a fee might
 * later change would be the checkout lying), charge through the shop's
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

  const card = (raw as { card?: { sourceId?: unknown } }).card;
  const sourceId = typeof card?.sourceId === "string" ? card.sourceId : "";

  if (sourceId) return paidFlow(priced.order, sourceId);

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

async function paidFlow(order: PricedOrder, sourceId: string) {
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

  const id = newId("wr");
  const chargeLines = [
    ...order.lines.map((l) => ({ name: l.name, qty: l.qty, each: l.each })),
    ...(deliveryFee > 0 ? [{ name: `Delivery (${order.zip})`, qty: 1, each: deliveryFee }] : []),
  ];
  let charged: Awaited<ReturnType<typeof chargeBoardOrder>>;
  try {
    charged = await chargeBoardOrder(cfg, {
      workroomOrderId: id,
      orderNumber: order.number,
      lines: chargeLines,
      method: "card",
      sourceId,
    });
  } catch (err) {
    console.error(`[devine] online payment for ${order.number} failed:`, err);
    return NextResponse.json(
      { ok: false, error: "The card was not charged. Check the number and try again, or send the order and pay on the confirming call." },
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
    const wr = { ...toWorkroomOrder(order, "confirmed", payment), id };
    if (deliveryFee > 0) {
      wr.lines = [...wr.lines, { slug: null, name: `Delivery (${order.zip})`, qty: 1, each: deliveryFee }];
      wr.subtotal = Math.round((wr.subtotal + deliveryFee) * 100) / 100;
    }
    await getStore().createOrder(wr);
  } catch (err) {
    console.error(`[devine] CRITICAL: paid order ${order.number} (payment ${charged.paymentId}) not written to the board:`, err);
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
