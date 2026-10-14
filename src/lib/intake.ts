import "server-only";

import nodemailer from "nodemailer";
import { bySlug, money } from "@/lib/catalog";
import { site, addressOneLine, deliveryFeeFor, deliveryMinimumFor } from "@/lib/site";
import { occasions as OCCASIONS } from "@/lib/occasions";
import { block, esc, logoAttachment, longDay, orderTable, phoneLink, shell, textBlock, type MoneyRow } from "@/lib/email-html";

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
  /** Card payments only (Katy, 2026-10-06: billing separate from delivery,
      with a same-as box). Where the card lives; printed on the ticket, never
      used to deliver. Absent on pay-on-call orders. */
  billing?: { street: string; town: string; state: string; zip: string };
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
  // Required since 2026-10-13 (Kevin): the receipt, the copy of the order
  // and the delivered note all go here; an online order without one has
  // no paper trail for the buyer.
  const email = str(p.email, 160);
  if (!email || !email.includes("@")) return { error: "An email address is required, for your receipt." };

  const subtotal = Math.round(lines.reduce((s, l) => s + l.line, 0) * 100) / 100;
  // THE DELIVERY MINIMUM IS A GATE, not a note (Kevin, 2026-10-13): her
  // sheet says $45 in Marshall, $55 elsewhere, before the delivery fee,
  // and an order under it is not a delivery order. Checked for paid and
  // pay-on-call alike; the cart says the same thing before this is reached.
  if (fulfillment === "delivery") {
    const inMarshall = zip === site.marshallZip;
    const min = deliveryMinimumFor(zip);
    if (subtotal < min) {
      return {
        error: `Delivery orders are $${min} and up before the delivery fee ${inMarshall ? "in Marshall" : "outside Marshall"}. Add $${(min - subtotal).toFixed(2)} more to qualify for delivery, or choose pickup.`,
      };
    }
  }

  const occasionRaw = str(p.occasion, 40);
  const occasion = (OCCASIONS as readonly string[]).includes(occasionRaw) ? occasionRaw : "";

  const b = p.billing && typeof p.billing === "object" ? (p.billing as Record<string, unknown>) : null;
  const billing = b && (str(b.street, 160) || str(b.zip, 10))
    ? { street: str(b.street, 160), town: str(b.town, 80), state: str(b.state, 2).toUpperCase(), zip: str(b.zip, 10) }
    : undefined;

  return {
    order: {
      number: orderNumber(),
      lines,
      subtotal,
      name,
      phone,
      email,
      fulfillment,
      recipient,
      street,
      town,
      zip,
      date,
      occasion,
      cardMessage: str(p.cardMessage, site.cardMessageMax),
      notes: str(p.notes, 600),
      ...(billing ? { billing } : {}),
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
  // The shop's clock, not the server's: a 9 pm order on the 14th is a
  // 1014 number, whatever UTC says.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: site.timeZone, month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const mm = parts.find((p) => p.type === "month")?.value ?? "00";
  const dd = parts.find((p) => p.type === "day")?.value ?? "00";
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
    paid && o.billing ? `Card billing address: ${[o.billing.street, [o.billing.town, o.billing.state].filter(Boolean).join(" "), o.billing.zip].filter(Boolean).join(", ")}` : null,
    o.occasion ? `Occasion: ${o.occasion}` : null,
    "",
    ...lines,
    "",
    paid
      ? `Subtotal ${money(o.subtotal)}${paid.deliveryCents ? ` + ${money(paid.deliveryCents / 100)} delivery` : ""} + ${money(paid.feeCents / 100)} convenience fee = ${money(paid.totalCents / 100)} PAID`
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
    paid ? `Convenience fee ${money(paid.feeCents / 100)}` : null,
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

/** The same copy, branded (Kevin, 2026-10-13). The text version above
    rides along as the alternative. */
function customerCopyHtml(o: PricedOrder, paid?: PaidOnline): string {
  const rows: MoneyRow[] = [{ label: "Subtotal", value: money(o.subtotal) }];
  if (paid) {
    if (paid.deliveryCents) rows.push({ label: `Delivery (${o.zip})`, value: money(paid.deliveryCents / 100) });
    rows.push({ label: "Online ordering fee", value: money(paid.feeCents / 100), muted: true });
    rows.push({ label: "Paid by card", value: money(paid.totalCents / 100), strong: true });
  } else if (o.fulfillment === "delivery") {
    // The same arithmetic the cart showed: the zip's fee and the total
    // due on the call, or a plain word that delivery is priced on the call.
    const fee = deliveryFeeFor(o.zip);
    if (fee !== undefined) {
      rows.push({ label: `Delivery (${o.zip})`, value: money(fee) });
      rows.push({ label: "Total due when we call", value: money(Math.round((o.subtotal + fee) * 100) / 100), strong: true });
    } else {
      rows.push({ label: "Delivery", value: "priced on the call", muted: true });
    }
  } else {
    rows.push({ label: "Total due at pickup", value: money(o.subtotal), strong: true });
  }
  const when = longDay(o.date);
  const sections = [
    block(`Order ${o.number}`, orderTable(o.lines.map((l) => ({ qty: l.qty, name: l.name, total: l.line })), rows)),
    o.fulfillment === "delivery"
      ? block("Delivery", `${esc(when)}<br>${esc(o.recipient || o.name)}<br>${esc(o.street)}, ${esc(o.town)} ${esc(o.zip)}`)
      : block("Pickup", `${esc(when)}<br>${esc(addressOneLine)}`),
    textBlock("Card message", o.cardMessage),
    textBlock("Notes", o.notes),
  ];
  return shell({
    title: `Your ${site.shortName} order ${o.number}`,
    heading: `Thank you, ${o.name}.`,
    intro: paid
      ? "We have your order and your card has been charged. This email is your record."
      : `We have your order. No payment has been taken online; we will call you at <strong>${esc(o.phone)}</strong> to confirm the details and take payment.`,
    sections,
  });
}

export type SendResult = "sent" | "unconfigured" | "send-failed";

/**
 * The delivered note (Kevin, 2026-09-04, from the shop's meeting): when a
 * DELIVERY order is marked done on the board, the customer hears so by
 * email. Best-effort and awaited (the serverless freeze rule); a missing
 * address or unconfigured mail is a log line, never a failed status move.
 */
export async function sendDeliveredEmail(o: {
  number: string;
  name: string;
  email: string;
  recipient: string;
}): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !o.email) {
    console.log(`[devine] delivered note for ${o.number} not sent (no ${o.email ? "SMTP" : "email on the order"}).`);
    return;
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass },
  });
  await transport
    .sendMail({
      from: process.env.ORDER_FROM || user,
      to: o.email,
      replyTo: process.env.ORDER_TO || undefined,
      subject: `Delivered: your ${site.shortName} order ${o.number}`,
      text: [
        `Your order ${o.number} has been delivered${o.recipient && o.recipient !== o.name ? ` to ${o.recipient}` : ""}.`,
        "",
        `Thank you for ordering from ${site.name}. If anything about the delivery needs a word, call the shop at ${site.phone}.`,
      ].join("\n"),
      html: shell({
        title: `Delivered: your ${site.shortName} order ${o.number}`,
        heading: "Delivered.",
        intro: `Your order ${esc(o.number)} has been delivered${o.recipient && o.recipient !== o.name ? ` to <strong>${esc(o.recipient)}</strong>` : ""}. Thank you for ordering from ${esc(site.name)}.`,
        sections: [],
        outro: `If anything about the delivery needs a word, call the shop at ${phoneLink()}.`,
      }),
      attachments: [logoAttachment()],
    })
    .catch((err) => console.error(`[devine] delivered note for ${o.number} not sent:`, err));
}

/**
 * The phone-order receipt (found by Kevin's double-check, 2026-09-04): the
 * write-up form asks for an email "for their receipt", and until this
 * function nothing sent one - web orders emailed a copy, phone orders
 * emailed nothing. Best-effort and awaited, same rules as every send.
 */
export async function sendWorkroomReceipt(o: {
  number: string;
  name: string;
  email: string;
  date: string;
  fulfillment: string;
  recipient: string;
  lines: { name: string; qty: number; each: number }[];
  subtotal: number;
}): Promise<void> {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass || !o.email) {
    if (o.email) console.log(`[devine] receipt for ${o.number} not sent: SMTP incomplete.`);
    return;
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass },
  });
  const text = [
    `Thanks, ${o.name}. Here is your ${site.shortName} order, written up by the shop.`,
    "",
    `Order ${o.number}`,
    `${o.fulfillment === "delivery" ? "Delivery" : "Pickup"} on ${o.date}${o.recipient && o.recipient !== o.name ? `, for ${o.recipient}` : ""}`,
    "",
    ...o.lines.map((l) => `  ${l.qty} x ${l.name}  ${money(l.each * l.qty)}`),
    `  Subtotal ${money(o.subtotal)}`,
    "",
    `Questions or changes: call the shop at ${site.phone}.`,
  ].join("\n");
  await transport
    .sendMail({
      from: process.env.ORDER_FROM || user,
      to: o.email,
      replyTo: process.env.ORDER_TO || undefined,
      subject: `Your ${site.shortName} order ${o.number}`,
      text,
      html: shell({
        title: `Your ${site.shortName} order ${o.number}`,
        heading: `Thanks, ${o.name}.`,
        intro: `Here is your ${esc(site.shortName)} order, written up by the shop.`,
        sections: [
          block(
            `Order ${o.number}`,
            orderTable(
              o.lines.map((l) => ({ qty: l.qty, name: l.name, total: Math.round(l.each * l.qty * 100) / 100 })),
              [{ label: "Subtotal", value: money(o.subtotal), strong: true }],
            ),
          ),
          block(
            o.fulfillment === "delivery" ? "Delivery" : "Pickup",
            `${esc(longDay(o.date))}${
              o.recipient && o.recipient !== o.name ? `<br>For ${esc(o.recipient)}` : ""
            }${o.fulfillment === "pickup" ? `<br>${esc(addressOneLine)}` : ""}`,
          ),
        ],
      }),
      attachments: [logoAttachment()],
    })
    .catch((err) => console.error(`[devine] receipt for ${o.number} not sent:`, err));
}

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
        html: customerCopyHtml(o, paid),
        attachments: [logoAttachment()],
      })
      .catch((err) => console.error(`[devine] order ${o.number} confirmation not sent:`, err));
  }

  return "sent";
}
