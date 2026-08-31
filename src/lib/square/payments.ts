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
 * a visible "Service fee $0.99" line, never a hidden markup) must ADD the
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
