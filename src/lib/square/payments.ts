import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { square, SquareError } from "./client";
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
 * a visible fee line such as "Convenience fee", never a hidden markup)
 * must ADD the fee to the order total it charges, then name the platform's
 * share of it here.
 *
 * Two hard rules from Square, enforced here rather than discovered in a
 * 400: the fee is only legal on an OAuth-token payment made with the
 * PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS scope, and on small totals it may
 * not exceed 60 percent of the payment. Tiny totals therefore drop the fee
 * rather than fail the sale; losing 99 cents beats losing the order.
 */

/** Cents. 99 is the portfolio-standard platform fee; SQUARE_APP_FEE_CENTS
    overrides, and 0 disables. */
/** THE WEBSITE'S FEE, in one place: the 99 cents ride only when they can
    reach the platform, through her OAuth grant. On the env-token path
    (sandbox, local dev) the cart shows no fee and the charge carries none,
    so the shop never holds Glazed's cents by accident. The checkout's
    config route and the order route both read this. */
export const webFeeCents = (cfg: { viaOAuth: boolean }): number => (cfg.viaOAuth ? appFeeCents() : 0);

/** Square's "this key was already used" answer, for callers that must
    tell a retried charge from a failed one. */
export const isIdempotencyReuse = (err: unknown): boolean => err instanceof Error && /IDEMPOTENCY_KEY_REUSED/.test(err.message);

/**
 * The payment call was SENT and no answer came back (the connection to
 * Square dropped, a timeout). Square may have charged the card. A caller
 * must never translate this into "the card was not charged": the honest
 * word is "unsure", and the retry, carrying the same idempotency key, is
 * how the truth comes out (a second charge is refused as a key reuse).
 */
export class PaymentUnsureError extends Error {
  constructor(cause: unknown) {
    super(`No answer from Square after the payment was sent: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "PaymentUnsureError";
  }
}
export const isPaymentUnsure = (err: unknown): boolean => err instanceof PaymentUnsureError;

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
 * THE FEE RULE, since the 2026-10-06 meeting (fourth revision): the shop's
 * own 3% card fee is RETIRED - Katy bakes processing into her prices (see
 * site.ts). What remains is the 99 cent platform fee on orders placed
 * through the WEBSITE (GLAZED WEB'S money, sent as app_fee_money), shown
 * online as the "Convenience fee" line. Board charges, card or cash, carry
 * nothing. The CALLER still states its fee via cardFee, so every payment
 * path says its fee story explicitly (the board passes cents 0); only
 * appFeeCents inside it rides to the platform account.
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
    /** Card only, per the fee rule above: the customer-paid fee line to
        add to the charge, computed and NAMED by the caller ("Convenience
        fee" online, "Card fee (3%)" at the board), plus how many of those
        cents belong to the platform account. Required, never defaulted,
        so every payment path states its fee story. Pass cents 0 to charge
        exactly the lines. */
    cardFee: { name: string; cents: number; appFeeCents: number };
    /** Optional. One key per (order, attempt): two requests carrying the
        same key (a double tap, a retried POST) get one Square payment
        between them instead of two. Derived by the caller from what makes
        the attempt unique: the card token, or "cash". */
    idempotencyKey?: string;
  },
) {
  // Square allows 45 characters; a card token alone is longer. The
  // caller's key is hashed so the whole of it counts and the per-call
  // suffix survives: the Orders call and the Payments call never share a key.
  const idem = (part: string) =>
    opts.idempotencyKey ? `${createHash("sha256").update(opts.idempotencyKey).digest("hex").slice(0, 40)}:${part}` : randomUUID();
  const subtotalCents = opts.lines.reduce((sum, l) => sum + cents(l.each) * l.qty, 0);
  if (subtotalCents <= 0) throw new Error("This order has no priced lines to charge.");

  const feeCents = opts.method === "card" ? Math.max(0, Math.round(opts.cardFee.cents)) : 0;
  const totalCents = subtotalCents + feeCents;
  // Square's 60-percent rule with margin (see createCardPayment): the
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

  const created = await square<CreateOrderResponse>(cfg, "POST", "/v2/orders", {
    idempotency_key: idem("o"),
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
    idempotency_key: idem("p"),
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
  try {
    res = await square<PaymentResponse>(cfg, "POST", "/v2/payments", body);
  } catch (err) {
    // Square answered (a decline, a refused key): a definite no, rethrown
    // as is. Anything else is the wire failing after the request left.
    if (err instanceof SquareError) throw err;
    throw new PaymentUnsureError(err);
  }
  if (!res.payment?.id) throw new Error("Square did not return a payment.");
  return {
    paymentId: res.payment.id,
    orderId: squareOrderId,
    status: res.payment.status ?? "",
    receiptUrl: res.payment.receipt_url ?? "",
    totalCents,
    feeCents,
  };
}
