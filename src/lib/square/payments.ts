import "server-only";

import { createHash } from "node:crypto";
import { square, SquareError } from "./client";
import { PaymentNotSubmitted } from "./payment-engine";
import type { ResolvedSquare } from "./oauth";

/**
 * Card and cash payments through the shop's own Square account, with the
 * Glazed platform fee. Written dormant on 2026-08-21 (checkout took no card
 * online; payment on the confirming call was the owner's own operation) so
 * that the day cards turned on would be a checkout change, not a plumbing
 * project. Cards turned on 2026-09-01. Every caller now arrives through
 * payment-engine.ts with a saved, claimed attempt, and the idempotency keys
 * below derive from that attempt so a retried request cannot double charge.
 *
 * THE FEE RIDES INSIDE THE PAYMENT, NOT ON TOP OF IT. app_fee_money is
 * Square splitting the amount already being charged: the customer pays
 * totalCents, the shop's account receives totalCents minus processing
 * minus the fee, and the fee accrues to the Glazed account that owns the
 * app. So a checkout that wants the customer to pay the fee (the model: a
 * visible fee line such as "Convenience fee", never a hidden markup) must
 * ADD the fee to the order total it charges, then name the platform's
 * share of it in cardFee.appFeeCents.
 *
 * Two hard rules from Square, enforced here rather than discovered in a
 * 400: the fee is only legal on an OAuth-token payment made with the
 * PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS scope, and on small totals it may
 * not exceed 60 percent of the payment. The code keeps a wider margin (the
 * fee rides only when it is under a fifth of the total; a studio choice,
 * not Square's number), and tiny totals drop the fee rather than fail the
 * sale; losing 99 cents beats losing the order.
 *
 * What comes back matters as much as what goes out: only Square's
 * documented decline codes turn into a FAILED result the staff may retry.
 * A timeout, a reused token or an unfamiliar answer is thrown, and the
 * engine parks the attempt as unknown until reconciliation reads Square.
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
  // Square's 60-percent rule with margin (see the file header): the
  // platform's share only rides when it is under a fifth of the total, and
  // it can never exceed the fee line the customer actually paid.
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
