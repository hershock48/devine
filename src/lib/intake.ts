import "server-only";

import nodemailer from "nodemailer";
import { bySlug, money } from "@/lib/catalog";
import { site, addressOneLine } from "@/lib/site";
import { occasions as OCCASIONS } from "@/lib/occasions";

/**
 * ORDER INTAKE. The order leaves the browser, arrives in an inbox, and the shop
 * takes it from there by phone. No card is taken online in this phase.
 *
 * Mail is SMTP through a mailbox, per glaze.md: "Mail is SMTP through a mailbox
 * the client already owns, not a hosted API." Until DeVine's signs and hands over
 * a mailbox, the sending account is a glazedweb.com mailbox and ORDER_TO points
 * at Glazed, so a stray order on the pitch host reaches a person who will pick
 * up the phone, not a void. Flipping to the shop is an env edit, not a deploy:
 * ORDER_TO becomes their inbox and nothing in this file changes.
 *
 * THE THREE STATES, in order of honesty:
 *
 *   configured, send succeeds  ->  order emailed to the shop, confirmation
 *                                  emailed to the customer if they gave one.
 *   not configured             ->  "unconfigured". The API says so and the cart
 *                                  falls back to the prefilled mailto, so the
 *                                  visitor still has a working route. Payload
 *                                  logged whole so nothing is lost.
 *   configured, send fails     ->  "send-failed". Same fallback, same log.
 *
 * glaze.md says an unconfigured contact form should still succeed for the
 * visitor and log the payload. This file deliberately diverges for the failure
 * case: a CONTACT message that quietly reaches only the log is an operator
 * problem, but an ORDER that reaches only the log is a customer waiting for
 * flowers nobody is making. Sympathy orders make the stakes plain. So when the
 * send fails the customer is told, and handed the phone number and a prefilled
 * email instead of a false receipt. The log still gets the whole payload either
 * way, so even the worst case loses nothing but the visitor's next tap.
 */

export type IntakeLine = { slug: string; qty: number };

export type IntakePayload = {
  lines: IntakeLine[];
  name: string;
  phone: string;
  email: string; // may be ""
  fulfillment: "delivery" | "pickup";
  recipient: string; // delivery only; "" on pickup
  street: string; // delivery only
  town: string; // delivery only
  zip: string; // delivery only
  date: string; // yyyy-mm-dd, requested; the shop confirms by phone
  occasion: string; // may be ""
  cardMessage: string; // may be ""
  notes: string; // may be ""
};

export type PricedLine = { slug: string; name: string; qty: number; each: number; line: number };

export type PricedOrder = Omit<IntakePayload, "lines"> & {
  number: string;
  lines: PricedLine[];
  subtotal: number;
};

const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

/**
 * Validate and PRICE ON THE SERVER. The browser sends slugs and quantities and
 * nothing else about money; every price on the ticket comes from the catalog at
 * the moment of ordering. A client-supplied total is a number a customer chose.
 */
export function priceOrder(raw: unknown): { order: PricedOrder } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Empty order." };
  const p = raw as Record<string, unknown>;

  const linesRaw = Array.isArray(p.lines) ? p.lines : [];
  const lines: PricedLine[] = [];
  for (const l of linesRaw.slice(0, 40)) {
    if (!l || typeof l !== "object") continue;
    const slug = str((l as IntakeLine).slug, 80);
    const qtyN = Number((l as IntakeLine).qty);
    const product = bySlug.get(slug);
    if (!product || !Number.isFinite(qtyN)) continue;
    const qty = Math.min(99, Math.max(1, Math.round(qtyN)));
    lines.push({
      slug,
      name: product.name,
      qty,
      each: product.price,
      line: Math.round(product.price * qty * 100) / 100,
    });
  }
  if (lines.length === 0) return { error: "The cart is empty." };

  const name = str(p.name, 120);
  const phone = str(p.phone, 40);
  if (!name) return { error: "A name is required." };
  // The confirm call is the whole payment plan, so a phone number is the one
  // field the order cannot exist without.
  if (phone.replace(/\D/g, "").length < 7) return { error: "A phone number we can call is required." };

  const fulfillment = p.fulfillment === "pickup" ? "pickup" : "delivery";
  const recipient = str(p.recipient, 120);
  const street = str(p.street, 160);
  const town = str(p.town, 80);
  const zip = str(p.zip, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(p.date, 10)) ? str(p.date, 10) : "";

  if (!date) return { error: "A requested date is required." };
  if (fulfillment === "delivery" && (!street || !town)) {
    return { error: "A delivery order needs a street address and a town." };
  }

  const occasionRaw = str(p.occasion, 40);
  const occasion = (OCCASIONS as readonly string[]).includes(occasionRaw) ? occasionRaw : "";

  return {
    order: {
      number: orderNumber(),
      lines,
      subtotal: Math.round(lines.reduce((s, l) => s + l.line, 0) * 100) / 100,
      name,
      phone,
      email: str(p.email, 160),
      fulfillment,
      recipient,
      street,
      town,
      zip,
      date,
      occasion,
      cardMessage: str(p.cardMessage, 600),
      notes: str(p.notes, 600),
    },
  };
}

/**
 * DV-0821-4183: date so the counter reads at a glance on a fridge printout, then
 * four random digits. No database in this phase means no sequence; at this
 * shop's volume a same-day collision is a 1-in-10,000 lottery, and two tickets
 * with different names on them survive one anyway.
 */
function orderNumber(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `DV-${mm}${dd}-${rand}`;
}

/**
 * The shop's copy. Shaped like the paper ticket a designer works from: who,
 * where, when, what, the message, in that order, nothing decorative. Plain text
 * so it prints from any mail client onto any printer in the building.
 */
/** Set when the order was paid online by card at checkout; both email
    copies change their money sentences accordingly. deliveryCents is 0
    for pickups. */
export type PaidOnline = { totalCents: number; feeCents: number; deliveryCents?: number };

export function shopTicket(o: PricedOrder, paid?: PaidOnline): string {
  const lines = o.lines.map((l) => `  ${l.qty} x ${l.name}   ${money(l.each)} each   ${money(l.line)}`);
  const where =
    o.fulfillment === "delivery"
      ? [
          `Deliver to: ${o.recipient || o.name}`,
          `Address: ${o.street}, ${o.town}${o.zip ? ` ${o.zip}` : ""}`,
          deliveryAreaLine(o),
        ]
      : [`Pickup at the shop, ${addressOneLine}`];

  return [
    `ORDER ${o.number}`,
    "",
    `Ordered by: ${o.name}`,
    `Phone: ${o.phone}`,
    o.email ? `Email: ${o.email}` : null,
    "",
    `${o.fulfillment === "delivery" ? "DELIVERY" : "PICKUP"} requested for ${o.date}`,
    ...where,
    o.occasion ? `Occasion: ${o.occasion}` : null,
    "",
    ...lines,
    "",
    paid
      ? `Subtotal ${money(o.subtotal)}${paid.deliveryCents ? ` + ${money(paid.deliveryCents / 100)} delivery` : ""} + ${money(paid.feeCents / 100)} order fee = ${money(paid.totalCents / 100)} PAID`
      : `Subtotal ${money(o.subtotal)} (no tax or delivery on this figure; settled on the confirm call)`,
    "",
    `Card message: ${o.cardMessage || "(none)"}`,
    o.notes ? `Notes: ${o.notes}` : null,
    "",
    paid
      ? `PAID ONLINE BY CARD: ${money(paid.totalCents / 100)}. Nothing to collect; just make it.`
      : "No payment has been taken. Call the customer to confirm and take payment.",
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

/**
 * A delivery zip off the published list is a flag on the ticket, never a wall in
 * the checkout. ZipCheck's rule holds here too: a near miss is a phone call, not
 * a refusal, and the person who decides is the one holding the van keys.
 */
function deliveryAreaLine(o: PricedOrder): string | null {
  if (!o.zip) return null;
  return (site.deliveryZips as readonly string[]).includes(o.zip)
    ? null
    : `NOTE: ${o.zip} is not on the published delivery list. Confirm before promising.`;
}

/** The customer's copy. Says what happens next, promises nothing it cannot keep. */
function customerCopy(o: PricedOrder, paid?: PaidOnline): string {
  return [
    `Thank you, ${o.name}. We have your order.`,
    "",
    `Order ${o.number}`,
    ...o.lines.map((l) => `  ${l.qty} x ${l.name}   ${money(l.line)}`),
    `Subtotal ${money(o.subtotal)}`,
    paid && paid.deliveryCents ? `Delivery ${money(paid.deliveryCents / 100)}` : null,
    paid ? `Order fee ${money(paid.feeCents / 100)}` : null,
    paid ? `Paid by card ${money(paid.totalCents / 100)}` : null,
    "",
    o.fulfillment === "delivery"
      ? `Requested for delivery on ${o.date} to ${o.recipient || o.name}, ${o.street}, ${o.town}.`
      : `Requested for pickup on ${o.date} at ${addressOneLine}.`,
    o.cardMessage ? `Card message: ${o.cardMessage}` : null,
    "",
    paid
      ? "Your card has been charged; this email is your record. Questions, changes, anything at all: call us."
      : "No payment has been taken online. We will call you at " + o.phone + " to confirm the details and take payment.",
    "",
    `${site.name}`,
    `${site.phone}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}

export type SendResult = "sent" | "unconfigured" | "send-failed";

export async function sendOrder(o: PricedOrder, paid?: PaidOnline): Promise<SendResult> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.ORDER_TO;

  // Nothing is lost even in the best case: the log always carries the whole
  // ticket, so an inbox mishap after a 200 is recoverable from Vercel's logs.
  console.log(`[devine] order ${o.number}:\n` + shopTicket(o, paid));

  if (!host || !user || !pass || !to) {
    console.log(`[devine] order ${o.number} NOT emailed: SMTP_HOST/SMTP_USER/SMTP_PASS/ORDER_TO incomplete.`);
    return "unconfigured";
  }

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass },
  });

  try {
    // The shop's ticket is the send that matters; it alone decides success.
    await transport.sendMail({
      from: process.env.ORDER_FROM || user,
      to,
      replyTo: o.email || undefined, // shop hits reply, reaches the customer
      subject: `${paid ? "PAID order" : "Order"} ${o.number}: ${o.fulfillment} ${o.date}, ${o.name}`,
      text: shopTicket(o, paid),
    });
  } catch (err) {
    console.error(`[devine] order ${o.number} send FAILED:`, err);
    return "send-failed";
  }

  // The customer's receipt is best-effort, pjs style: a customer whose order is
  // in the shop and whose receipt bounced has an order. But it is AWAITED,
  // because a fire-and-forget send dies on serverless: the lambda freezes the
  // moment the response returns, and the agreement flow's first live test
  // delivered exactly one of its two emails for exactly this reason. The
  // catch keeps a bounced receipt from failing the order.
  if (o.email) {
    await transport
      .sendMail({
        from: process.env.ORDER_FROM || user,
        to: o.email,
        replyTo: to,
        subject: `Your ${site.shortName} order ${o.number}`,
        text: customerCopy(o, paid),
      })
      .catch((err) => console.error(`[devine] order ${o.number} confirmation not sent:`, err));
  }

  return "sent";
}
