import "server-only";

import { randomUUID } from "node:crypto";
import { square } from "./client";
import type { ResolvedSquare } from "./oauth";

/**
 * Card payments with the Glazed platform fee. DORMANT ON PURPOSE: nothing
 * calls this yet, because the checkout deliberately takes no card online
 * (payment on the confirming call, the owner's own operation, decided
 * 2026-08-21 and recorded in glaze/clients/devine.md). It exists now so
 * the day cards turn on is a checkout change, not a plumbing project, and
 * so the fee mechanics are written down where the first caller will find
 * them.
 *
 * THE FEE RIDES INSIDE THE PAYMENT, NOT ON TOP OF IT. app_fee_money is
 * Square splitting the amount already being charged: customer pays
 * amountCents, the shop's account receives amountCents minus processing
 * minus the fee, and the fee accrues to the Glazed account that owns the
 * app. So the checkout that wants the customer to pay the fee (the model:
 * a visible "Order fee $0.99" line, never a hidden markup) must ADD the
 * fee to the order total it charges, then name the same number here.
 *
 * Two hard rules from Square, enforced here rather than discovered in a
 * 400: the fee is only legal on an OAuth-token payment made with the
 * PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS scope, and on small totals it may
 * not exceed 60 percent of the payment. Tiny totals therefore drop the fee
 * rather than fail the sale; losing 99 cents beats losing the order.
 */

/** Cents. 99 is the portfolio-standard platform fee; SQUARE_APP_FEE_CENTS
    overrides, and 0 disables. */
export function appFeeCents(): number {
  const raw = process.env.SQUARE_APP_FEE_CENTS?.trim();
  if (raw === undefined || raw === "") return 99;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 99;
}

export type CardPayment = {
  /** From Square's Web Payments SDK card tokenization in the browser. */
  sourceId: string;
  /** The full amount the customer pays, service fee already included. */
  amountCents: number;
  /** Our order id, so a payment can be traced back from either dashboard. */
  referenceId: string;
  note?: string;
  buyerEmail?: string;
};

type PaymentResponse = {
  payment?: { id?: string; status?: string; receipt_url?: string };
};

export async function createCardPayment(cfg: ResolvedSquare, p: CardPayment) {
  const fee = appFeeCents();
  // The 60 percent floor with margin: fee only when it is under a fifth of
  // the total, which for 99 cents means orders of five dollars and up.
  const feeLegal = cfg.viaOAuth && fee > 0 && fee * 5 <= p.amountCents;
  const body: Record<string, unknown> = {
    idempotency_key: randomUUID(),
    source_id: p.sourceId,
    amount_money: { amount: p.amountCents, currency: "USD" },
    location_id: cfg.locationId,
    reference_id: p.referenceId,
    note: p.note,
    buyer_email_address: p.buyerEmail,
  };
  if (feeLegal) body.app_fee_money = { amount: fee, currency: "USD" };
  const res = await square<PaymentResponse>(cfg, "POST", "/v2/payments", body);
  return { payment: res.payment, appFeeCents: feeLegal ? fee : 0 };
}

/* ------------------- board orders: the settled money ------------------- */

/**
 * Charging a BOARD ORDER, card or cash, from the workroom. This is Square's
 * documented pattern (create the order via the API, pay it via the API);
 * the register-side alternative, an unpaid API order collected at the POS,
 * is explicitly unsupported per Square staff (developer forum, 2026-08-18),
 * which is why payments for board orders live here and the register's job
 * is purely walk-outs.
 *
 * Line items are sent AD HOC (name + price), not by catalog id, on purpose:
 * half of board work is custom pieces with no catalog entry, the itemization
 * in her ledger reads the same either way, and an ad hoc line can never
 * collide with the register catalog. Stems for these sales are counted by
 * the board order's own made-status; the webhook links the sale back by
 * reference id and inventory skips linked sales.
 *
 * THE FEE RULE, per Kevin 2026-09-01 and the agreement's wording: card
 * payments taken remotely (online checkout or keyed here) carry the 99 cent
 * customer-paid order fee as its own line item, so the customer was
 * quoted the true total and her ledger shows the line. Cash carries no fee:
 * the fee rides remote card payments only, and a cash drawer holding 99
 * unexplained cents helps nobody.
 */

type BoardOrderLine = { name: string; qty: number; each: number };

type CreateOrderResponse = {
  order?: { id?: string; total_money?: { amount?: number } };
};

const cents = (dollars: number) => Math.round(dollars * 100);

export async function chargeBoardOrder(
  cfg: ResolvedSquare,
  opts: {
    /** The workroom order id; rides as reference_id so the webhook links the sale. */
    workroomOrderId: string;
    /** The DV number, for the human reading her Square dashboard. */
    orderNumber: string;
    lines: BoardOrderLine[];
    method: "card" | "cash";
    /** Card only: the Web Payments SDK token from the browser. */
    sourceId?: string;
  },
) {
  const subtotalCents = opts.lines.reduce((sum, l) => sum + cents(l.each) * l.qty, 0);
  if (subtotalCents <= 0) throw new Error("This order has no priced lines to charge.");

  const fee = opts.method === "card" ? appFeeCents() : 0;
  const feeLegal = fee > 0 && cfg.viaOAuth && fee * 5 <= subtotalCents + fee;
  const feeCents = feeLegal ? fee : 0;
  const totalCents = subtotalCents + feeCents;

  const lineItems: Record<string, unknown>[] = opts.lines.map((l) => ({
    name: l.name,
    quantity: String(l.qty),
    base_price_money: { amount: cents(l.each), currency: "USD" },
  }));
  if (feeCents > 0) {
    lineItems.push({
      name: "Order fee",
      quantity: "1",
      base_price_money: { amount: feeCents, currency: "USD" },
    });
  }

  const created = await square<CreateOrderResponse>(cfg, "POST", "/v2/orders", {
    idempotency_key: randomUUID(),
    order: {
      location_id: cfg.locationId,
      reference_id: opts.workroomOrderId,
      line_items: lineItems,
      // The note is what a person sees scanning her dashboard.
      note: `Board order ${opts.orderNumber}`,
    },
  });
  const squareOrderId = created.order?.id;
  if (!squareOrderId) throw new Error("Square did not return an order id.");
  // Square's total is the truth the payment must match; a mismatch here
  // means our line math drifted and the sale must not go through fuzzy.
  const squareTotal = created.order?.total_money?.amount;
  if (squareTotal !== undefined && squareTotal !== totalCents) {
    throw new Error(`Order total mismatch: ours ${totalCents}, Square's ${squareTotal}.`);
  }

  const body: Record<string, unknown> = {
    idempotency_key: randomUUID(),
    order_id: squareOrderId,
    location_id: cfg.locationId,
    amount_money: { amount: totalCents, currency: "USD" },
    reference_id: opts.workroomOrderId,
    note: `Board order ${opts.orderNumber}`,
  };
  if (opts.method === "card") {
    if (!opts.sourceId) throw new Error("Card payment without a card token.");
    body.source_id = opts.sourceId;
    if (feeCents > 0) body.app_fee_money = { amount: feeCents, currency: "USD" };
  } else {
    body.source_id = "CASH";
    body.cash_details = { buyer_supplied_money: { amount: totalCents, currency: "USD" } };
  }

  const res = await square<PaymentResponse>(cfg, "POST", "/v2/payments", body);
  if (!res.payment?.id) throw new Error("Square did not return a payment.");
  return {
    paymentId: res.payment.id,
    status: res.payment.status ?? "",
    receiptUrl: res.payment.receipt_url ?? "",
    totalCents,
    feeCents,
  };
}
