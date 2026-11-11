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

/** `parts` rides along only on a piece priced by stems at the counter:
    the stems it used, which the dashboard's stem costing draws from the
    lots in place of the slug's recipe (derive.ts recipeFor). */
export type ReportLine = { slug: string | null; name: string; qty: number; each: number; parts?: { variety: string; stems: number }[] };
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
    lines: (o.lines ?? []).map((l) => ({ slug: l.slug, name: l.name, qty: l.qty, each: l.each, ...(l.parts?.length ? { parts: l.parts } : {}) })),
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
  };
}

export function toReportSale(s: SquareSale): ReportSale {
  return { id: s.id, source: s.source, totalCents: s.totalCents, paidAt: s.paidAt, createdAt: s.createdAt };
}

/* ------------------------------------------------------------------ */
/*        THE STEM LEDGER'S ROWS (dashboard, inventory, weekly order)   */
/* ------------------------------------------------------------------ */

/**
 * WHAT THE STEM ARITHMETIC READS, and nothing else. The dashboard, the
 * inventory and the weekly order sheet walk every made order, every
 * item-rung register ring and every stem event (derive.ts consumption and
 * lotCosting), and they used to walk the board's lists, which stop at a
 * fixed count: past it the oldest rows were gone, so stems on hand read
 * high and a year's figures read low with nothing on the screen to say so.
 * These rows come whole, a page at a time, from the same route the report
 * sheets read (api/workroom/reports), and are a fraction of an order's
 * size, which is what lets a screen read all of them.
 *
 *   ledger order   id, status, requested date, when it was written (the
 *                  page reader's place in the list), and each line's slug,
 *                  quantity, price and by-stems parts. Canceled orders are
 *                  left out by the store: nothing on these screens counts
 *                  one. The inventory and the weekly order sheet read this;
 *                  the dashboard needs the money too and reads ReportOrder.
 *   ledger sale    a ring that belongs to no board order (a linked ring's
 *                  stems are counted through its order, by every rule in
 *                  derive.ts), with its lines. A ring rung as a bare
 *                  amount comes with no lines, and is counted as such.
 */
export type LedgerLine = { slug: string | null; qty: number; each: number; parts?: { variety: string; stems: number }[] };
export type LedgerOrder = { id: string; status: string; date: string; createdAt: number; lines: LedgerLine[] };
export type LedgerSaleLine = { slug: string | null; name: string; qty: number; totalCents: number };
export type LedgerSale = { id: string; paidAt: string; createdAt: number; lines: LedgerSaleLine[] };

export function toLedgerOrder(o: WorkroomOrder): LedgerOrder {
  return {
    id: o.id,
    status: o.status,
    date: o.date,
    createdAt: o.createdAt,
    lines: (o.lines ?? []).map((l) => ({ slug: l.slug, qty: l.qty, each: l.each, ...(l.parts?.length ? { parts: l.parts } : {}) })),
  };
}

export function toLedgerSale(s: SquareSale): LedgerSale {
  return {
    id: s.id,
    paidAt: s.paidAt,
    createdAt: s.createdAt,
    lines: (s.lines ?? []).map((l) => ({ slug: l.slug, name: l.name, qty: l.qty, totalCents: l.totalCents })),
  };
}

/** A register ring's money and moment, linked to an order or not: what the
    dashboard's summary adds up when Square itself cannot be asked. */
export type SaleMoney = { id: string; source: string; totalCents: number; paidAt: string; createdAt: number };

/**
 * WHO ORDERED BEFORE THE LEDGER BEGINS. The dashboard's Returning tile
 * asks, of each order in its window, whether that phone or email was on an
 * earlier order. The orders it has loaded answer that for the last 400
 * days; this answers it for everything older: the first sighting, by phone
 * key and by email, of every customer who is on an order on file now and
 * was also on one written before the ledger's first day. (It used to read
 * the board's contact list, which stops at a fixed count of the newest
 * orders, so at volume an old customer coming back read as a new one.)
 *
 * One function for both backends: each hands over its older sightings and
 * the phones and emails on file, and the keys are made here, by derive.ts.
 */
export type EarlierSightings = { phones: Record<string, number>; emails: Record<string, number> };
export function earlierSightings(
  older: { phone: string; email: string; first: number }[],
  onFile: { phone: string; email: string }[],
  keys: { phone: (s: string) => string; email: (s: string) => string },
): EarlierSightings {
  const wantPhone = new Set<string>();
  const wantEmail = new Set<string>();
  for (const c of onFile) {
    const pk = keys.phone(c.phone ?? "");
    const ek = keys.email(c.email ?? "");
    if (pk) wantPhone.add(pk);
    if (ek) wantEmail.add(ek);
  }
  const phones: Record<string, number> = {};
  const emails: Record<string, number> = {};
  for (const c of older) {
    const pk = keys.phone(c.phone ?? "");
    const ek = keys.email(c.email ?? "");
    if (pk && wantPhone.has(pk) && !(phones[pk] <= c.first)) phones[pk] = c.first;
    if (ek && wantEmail.has(ek) && !(emails[ek] <= c.first)) emails[ek] = c.first;
  }
  return { phones, emails };
}
