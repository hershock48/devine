import type { SquareSale, WorkroomOrder } from "./store";

/**
 * THE ROWS THE REPORT SHEETS READ, and the one function that makes each.
 *
 * The sheets (Reports.tsx, ReportsCustomers.tsx) add everything up in the
 * browser, on the counter's own calendar, from every order on file. The
 * board's list could not feed them: it carries whole orders (card messages,
 * addresses, notes) and stops at a fixed count, so a busy shop's older
 * months read low with nothing on the screen to say so. The sheets ask
 * /api/workroom/reports instead, which hands the rows over a page at a
 * time, each cut down to what a sheet adds up, and says outright when it
 * stopped short (`truncated`).
 *
 * Client-safe on purpose: the store is imported for its types only. Both
 * backends build their rows with toReportOrder and toReportSale, so the
 * memory store and Postgres cannot hand the sheets different shapes.
 */

export type ReportLine = { slug: string | null; name: string; qty: number; each: number };
export type ReportPayment = {
  at: number;
  method: string;
  via?: string;
  checkNumber?: string;
  note?: string;
  squarePaymentId: string;
  totalCents: number;
  /** A register ring's ticket total at link time: derive.ts balanceCents
      reads it, so it has to travel with the payment. */
  ticketCents?: number;
  feeCents: number;
  refundedAt?: number;
};
export type ReportOrder = {
  id: string;
  number: string;
  source: "web" | "phone";
  status: string;
  fulfillment: "delivery" | "pickup";
  name: string;
  business?: string;
  phone: string;
  email?: string;
  recipient?: string;
  company?: string;
  occasion?: string;
  zip: string;
  date: string;
  lines: ReportLine[];
  subtotal: number;
  createdAt: number;
  payment?: ReportPayment | null;
  topUps?: ReportPayment[];
  refunds?: { at: number; cents: number; how?: "square" | "hand" | "check" | "transfer"; note?: string; kept?: boolean }[];
  account?: boolean;
  taxExempt?: boolean;
  thirdParty?: boolean;
  quick?: boolean;
  poNumber?: string;
  /** Payments taken back as recorded by mistake: not money, listed so the
      day they were taken back shows who did it. */
  reversedPayments?: (ReportPayment & { reversed: { at: number; by: string; note: string } })[];
};
/** A ring on the register that belongs to no board order: a walk-in. */
export type ReportSale = { id: string; source: string; totalCents: number; paidAt: string; createdAt: number };

/** Rows a page: small enough to answer quickly, large enough that a year
    of a busy shop is a handful of requests. */
export const REPORT_PAGE_ROWS = 2000;
/** A page also stops at this many bytes of JSON, whatever its row count:
    the host refuses a response past 4.5 MB, and a run of forty-line
    wedding orders must make a shorter page, not a failed one. */
export const REPORT_PAGE_BYTES = 3_000_000;
/** The most rows one sheet load reads from each list. Far past any
    florist's 400 days; it is there so a runaway table cannot fill a
    browser. Reaching it is said out loud (the route's `truncated`). */
export const REPORT_MAX_ROWS = 50_000;

/** An order as the sheets read it. Payments, top-ups and refunds go whole:
    they are small, and the money rules in derive.ts read every key. What
    is left behind is what no sheet adds up: the address, the card message,
    the notes, who took and made it, and the stems a line was priced from. */
export function toReportOrder(o: WorkroomOrder): ReportOrder {
  return {
    id: o.id,
    number: o.number,
    source: o.source,
    status: o.status,
    fulfillment: o.fulfillment,
    name: o.name,
    ...(o.business ? { business: o.business } : {}),
    phone: o.phone,
    ...(o.email ? { email: o.email } : {}),
    ...(o.recipient ? { recipient: o.recipient } : {}),
    ...(o.company ? { company: o.company } : {}),
    ...(o.occasion ? { occasion: o.occasion } : {}),
    zip: o.zip,
    date: o.date,
    lines: (o.lines ?? []).map((l) => ({ slug: l.slug, name: l.name, qty: l.qty, each: l.each })),
    subtotal: o.subtotal,
    createdAt: o.createdAt,
    ...(o.payment ? { payment: o.payment } : {}),
    ...(o.topUps?.length ? { topUps: o.topUps } : {}),
    ...(o.refunds?.length ? { refunds: o.refunds } : {}),
    ...(o.account ? { account: true } : {}),
    ...(o.taxExempt ? { taxExempt: true } : {}),
    ...(o.thirdParty ? { thirdParty: true } : {}),
    ...(o.quick ? { quick: true } : {}),
    ...(o.poNumber ? { poNumber: o.poNumber } : {}),
    ...(o.reversedPayments?.length ? { reversedPayments: o.reversedPayments } : {}),
  };
}

export function toReportSale(s: SquareSale): ReportSale {
  return { id: s.id, source: s.source, totalCents: s.totalCents, paidAt: s.paidAt, createdAt: s.createdAt };
}
