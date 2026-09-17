import "server-only";

import { createHash } from "node:crypto";
import { square, SquareError } from "./client";
import { PaymentNotSubmitted } from "./payment-engine";
import type { ResolvedSquare } from "./oauth";

/** Shared Square adapter. The caller must first save and claim a durable attempt.
 * The customer fee and platform share retain the agreed pricing rules. The
 * existing one-fifth threshold is a conservative studio policy, not Square's limit.
 */

/** Cents. 99 is the portfolio-standard platform fee; SQUARE_APP_FEE_CENTS
    overrides, and 0 disables. */
export function appFeeCents(): number {
  const raw = process.env.SQUARE_APP_FEE_CENTS?.trim();
  if (raw === undefined || raw === "") return 99;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 99;
}

type PaymentResponse = { payment?: { id?: string; status?: string; receipt_url?: string; reference_id?: string; location_id?: string; amount_money?: { amount?: number; currency?: string } }; errors?: { code?: string }[] };
const DECLINED = new Set(["ADDRESS_VERIFICATION_FAILURE", "CARDHOLDER_INSUFFICIENT_PERMISSIONS", "CARD_EXPIRED", "CARD_NOT_SUPPORTED", "CARD_TOKEN_EXPIRED", "CVV_FAILURE", "EXPIRATION_FAILURE", "GENERIC_DECLINE", "INSUFFICIENT_FUNDS", "INVALID_ACCOUNT", "INVALID_CARD", "INVALID_CARD_DATA", "INVALID_EXPIRATION", "INVALID_PIN", "PAN_FAILURE", "PAYMENT_LIMIT_EXCEEDED", "TRANSACTION_LIMIT", "VOICE_FAILURE", "CARD_DECLINED_VERIFICATION_REQUIRED"]);

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
 * THE FEE RULE, per Kevin 2026-09-09 (third revision; see site.cardFeePct
 * for the register half): every card payment carries the shop's own 3%
 * card fee (site.cardFeePct - DEVINE'S money, covering her processing), and
 * orders placed through the WEBSITE additionally carry the 99 cent
 * platform fee (GLAZED WEB'S money, sent as app_fee_money). Online the
 * two combine into one customer-facing "Convenience fee" line; at the
 * board the line reads "Card fee (3%)". Cash carries nothing. The CALLER
 * computes and names the fee via cardFee, so every payment path states
 * its fee story explicitly; only appFeeCents inside it rides to the
 * platform account.
 */

type BoardOrderLine = { name: string; qty: number; each: number };

type CreateOrderResponse = {
  order?: { id?: string; total_money?: { amount?: number } };
};

const cents = (dollars: number) => Math.round(dollars * 100);

export function providerKey(attemptKey: string, operation: "order" | "payment") {
  if (!attemptKey) throw new Error("A durable payment attempt is required.");
  return createHash("sha256").update(`${operation}:${attemptKey}`).digest("hex").slice(0, 40);
}

export async function chargeBoardOrder(
  cfg: ResolvedSquare,
  opts: {
    attemptKey: string;
    /** The workroom order id; rides as reference_id so the webhook links the sale. */
    workroomOrderId: string;
    /** The DV number, for the human reading her Square dashboard. */
    orderNumber: string;
    lines: BoardOrderLine[];
    method: "card" | "cash";
    /** Card only: the Web Payments SDK token from the browser. */
    sourceId?: string;
    /** Card only, per the fee rule above: the customer-paid fee line to
        add to the charge, computed and NAMED by the caller ("Convenience
        fee" online, "Card fee (3%)" at the board), plus how many of those
        cents belong to the platform account. Required, never defaulted,
        so every payment path states its fee story. Pass cents 0 to charge
        exactly the lines. */
    cardFee: { name: string; cents: number; appFeeCents: number };
  },
) {
  const subtotalCents = opts.lines.reduce((sum, l) => sum + cents(l.each) * l.qty, 0);
  if (!Number.isSafeInteger(subtotalCents)||subtotalCents<=0||opts.lines.some(l=>!Number.isSafeInteger(l.qty)||l.qty<=0||!Number.isFinite(l.each)||l.each<0)) throw new PaymentNotSubmitted("INVALID_PRICED_LINES");
  if(opts.method==='card'&&!opts.sourceId)throw new PaymentNotSubmitted('MISSING_CARD_TOKEN');
  if(!Number.isSafeInteger(opts.cardFee.cents)||opts.cardFee.cents<0||!Number.isSafeInteger(opts.cardFee.appFeeCents)||opts.cardFee.appFeeCents<0)throw new PaymentNotSubmitted('INVALID_FEE');

  const feeCents = opts.method === "card" ? Math.max(0, Math.round(opts.cardFee.cents)) : 0;
  const totalCents = subtotalCents + feeCents;
  // The studio's conservative one-fifth threshold: the
  // platform's share only rides when it is well under the total, and it
  // can never exceed the fee line the customer actually paid.
  const appFeeWanted = Math.min(feeCents, Math.max(0, Math.round(opts.cardFee.appFeeCents)));
  const appFee = opts.method === "card" && cfg.viaOAuth && appFeeWanted > 0 && appFeeWanted * 5 <= totalCents ? appFeeWanted : 0;

  const lineItems: Record<string, unknown>[] = opts.lines.map((l) => ({
    name: l.name,
    quantity: String(l.qty),
    base_price_money: { amount: cents(l.each), currency: "USD" },
  }));
  if (feeCents > 0) {
    lineItems.push({
      name: opts.cardFee.name,
      quantity: "1",
      base_price_money: { amount: feeCents, currency: "USD" },
    });
  }

  let created:CreateOrderResponse;
  try{created = await square<CreateOrderResponse>(cfg, "POST", "/v2/orders", {
    idempotency_key: providerKey(opts.attemptKey, "order"),
    order: {
      location_id: cfg.locationId,
      reference_id: opts.workroomOrderId,
      line_items: lineItems,
      // The note is what a person sees scanning her dashboard.
      note: `Board order ${opts.orderNumber}`,
    },
  });}catch{throw new PaymentNotSubmitted('ORDER_CREATION_FAILED');}
  const squareOrderId = created.order?.id;
  if (!squareOrderId) throw new PaymentNotSubmitted("MISSING_PROVIDER_ORDER");
  // Square's total is the truth the payment must match; a mismatch here
  // means our line math drifted and the sale must not go through fuzzy.
  const squareTotal = created.order?.total_money?.amount;
  if (squareTotal !== totalCents) {
    throw new PaymentNotSubmitted('ORDER_TOTAL_MISMATCH');
  }

  const body: Record<string, unknown> = {
    idempotency_key: providerKey(opts.attemptKey, "payment"),
    order_id: squareOrderId,
    location_id: cfg.locationId,
    amount_money: { amount: totalCents, currency: "USD" },
    reference_id: opts.workroomOrderId,
    note: `Board order ${opts.orderNumber}`,
  };
  if (opts.method === "card") {
    if (!opts.sourceId) throw new Error("Card payment without a card token.");
    body.source_id = opts.sourceId;
    // Only the platform's share, never the whole fee line: the 3% part is
    // the shop's own money and stays in her account.
    if (appFee > 0) body.app_fee_money = { amount: appFee, currency: "USD" };
  } else {
    body.source_id = "CASH";
    body.cash_details = { buyer_supplied_money: { amount: totalCents, currency: "USD" } };
  }

  let res: PaymentResponse;
  try { res = await square<PaymentResponse>(cfg, "POST", "/v2/payments", body); }
  catch (error) {
    // Only explicit documented declines release the attempt. A reused token,
    // timeout, server error, or unknown response must still be reconciled.
    if (error instanceof SquareError && [400, 402].includes(error.status)) {
      const payload = error.body as PaymentResponse | null;
      if (payload?.errors?.length && payload.errors.every(item => DECLINED.has(item.code || "")) && !payload.payment) return { paymentId: "", status: "FAILED", receiptUrl: "", totalCents, feeCents };
    }
    throw error;
  }
  if (!res.payment?.id) throw new Error("Square did not return a payment.");
  if (res.payment.amount_money?.amount !== totalCents || res.payment.amount_money.currency !== "USD" || res.payment.reference_id !== opts.workroomOrderId || res.payment.location_id !== cfg.locationId) throw new Error("Square payment does not match the saved order.");
  return {
    paymentId: res.payment.id,
    status: res.payment.status ?? "",
    receiptUrl: res.payment.receipt_url ?? "",
    totalCents,
    feeCents,
  };
}
