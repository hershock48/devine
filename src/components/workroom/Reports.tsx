"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDollars } from "@/components/workroom/PayControls";
import type { Category, Product } from "@/lib/catalog";
import { useCategories, useProducts } from "@/components/CatalogContext";
import { site } from "@/lib/site";
import {
  HISTORY_DAYS,
  balanceCents,
  grossPaidCents,
  isDeliveryLine,
  isoDate,
  isTaxLine,
  isUntaxedLine,
  owedNowCents,
  refundableCents,
  refundedCents,
  saleInstantMs,
} from "@/lib/workroom/derive";
import { InitialsInput, MemoryWarning, PinGate, field, isInitials, money, phoneKey, textButton, todayISO } from "@/components/workroom/ui";

/**
 * REPORTS (Katy, 2026-10-22: "billing and end of day / end of month and
 * insight reporting"). Two printable sheets, each the answer to one
 * question the shop asks at a fixed time:
 *
 *   THE DAY SHEET, at closing: what money came in today and by which
 *   way, what cash should be in the drawer, what went back out, which
 *   orders were written and which went out the door, the tax on the
 *   day's sales, and what the accounts did. Staff close the drawer, so
 *   the staff PIN opens it.
 *
 *   THE MONTH SHEET, for the books and the sales-tax return: the same
 *   money, by day, the tax on both bases the state accepts (orders paid
 *   in the month, and orders written in the month), sales by category
 *   and the best sellers, and what the house accounts owe by age. Behind
 *   the owner's PIN as a screen gate: a month's takings are hers to
 *   read. The CUSTOMER sheet (Katy, 2026-11-09: "top customer report,
 *   different types of customer reports") sits behind the same gate:
 *   who spends the most, who orders most often, who is new, and which
 *   regulars have gone quiet. (The figures derive from ledgers every staff sign-in can
 *   already fetch, so unlike the dashboard's summary route there is no
 *   server-side tier here; the gate keeps the sheet off a staff screen,
 *   it does not hide the data.)
 *
 * EVERY FIGURE IS DERIVED from two ledgers the board already keeps: the
 * orders (with their payments, top-ups and refunds) and the Square rings
 * the webhook stored. A card or cash payment taken on a card IS a Square
 * ring, so such rings are counted once, through the order; only rings
 * that match no order (a walk-in rung straight on the register) are
 * added as their own line. The sheet never estimates: a number it cannot
 * derive is left out, not guessed.
 *
 * The calendar is the client's (the dashboard's rule): "today" is today
 * at the counter, not in the serverless region's UTC.
 */

type Line = { slug: string | null; name: string; qty: number; each: number };
type Payment = { at: number; method: string; via?: string; checkNumber?: string; note?: string; squarePaymentId: string; totalCents: number; feeCents: number; refundedAt?: number };
type Order = {
  id: string;
  number: string;
  source: "web" | "phone";
  status: string;
  fulfillment: "delivery" | "pickup";
  name: string;
  business?: string;
  phone: string;
  zip: string;
  date: string;
  lines: Line[];
  subtotal: number;
  createdAt: number;
  payment?: Payment | null;
  topUps?: Payment[];
  refunds?: { at: number; cents: number; how?: "square" | "hand" | "check" | "transfer"; note?: string; kept?: boolean }[];
  account?: boolean;
  taxExempt?: boolean;
  thirdParty?: boolean;
  quick?: boolean;
};
type Sale = { id: string; workroomOrderId?: string; source: string; totalCents: number; paidAt: string; createdAt: number };

type View = "day" | "month" | "customers";
type Window = { beginMs: number; endMs: number; label: string; days: string[] };

/** The local window for a day (ISO date) or a month ("YYYY-MM"). */
function windowFor(view: View, anchor: string): Window {
  if (view === "day" ? !isDay(anchor) : !isMonth(anchor)) anchor = view === "day" ? todayISO() : monthOf(todayISO());
  if (view === "day") {
    const [y, m, d] = anchor.split("-").map(Number);
    const begin = new Date(y, m - 1, d);
    const end = new Date(y, m - 1, d + 1);
    return { beginMs: begin.getTime(), endMs: end.getTime(), label: begin.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }), days: [anchor] };
  }
  const [y, m] = anchor.split("-").map(Number);
  const begin = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const days: string[] = [];
  for (let d = new Date(begin); d < end; d.setDate(d.getDate() + 1)) days.push(isoOf(d));
  return { beginMs: begin.getTime(), endMs: end.getTime(), label: begin.toLocaleDateString("en-US", { month: "long", year: "numeric" }), days };
}
const isoOf = isoDate;
/** A local Date at noon on an ISO day, for labels (never UTC midnight,
    which is the evening before in Marshall). */
const dayAt = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, 12); };
/** Only a well-formed anchor is ever set: desktop Firefox renders the
    month and date inputs as plain text boxes, and "Oct 2026" must not
    reach windowFor. */
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && isoDate(dayAt(v)) === v;
const isMonth = (v: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const monthOf = (iso: string) => iso.slice(0, 7);
const shiftDay = (iso: string, by: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return isoOf(new Date(y, m - 1, d + by));
};
const shiftMonth = (ym: string, by: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const inWin = (ms: number, w: Window) => ms >= w.beginMs && ms < w.endMs;
const dateInWin = (iso: string, w: Window) => (w.days.length === 0 ? false : w.days.length === 1 ? iso === w.days[0] : iso.slice(0, 7) === w.days[0].slice(0, 7));

/** Money that came in. Credit moved from another order of the same
    customer (via "credit", 2026-11-09) is on the order's record but is
    NOT new money: the overpayment was counted when it was taken, on the
    order it was taken on. Every money-in figure here reads this list. */
const payments = (o: Order): Payment[] => [...(o.payment ? [o.payment] : []), ...(o.topUps ?? [])].filter((p) => p.via !== "credit");
const methodWord: Record<string, string> = { web: "Card, on the website", card: "Card, at the board", cash: "Cash", check: "Checks", register: "Rung on the register", other: "By hand (transfer, marked paid)" };
/** The row a payment lands on. A website order's checkout card is its
    own line, since the counter's terminal never saw it: that is the
    first payment, written in the same request as the order (api/order),
    so it sits within seconds of createdAt. A card taken at the board
    later on a web order (checkout cards off, or a top-up) is the board's. */
const methodKey = (o: Order, p: Payment) =>
  p.method === "card" && o.source === "web" && p.at === o.payment?.at && Math.abs(p.at - o.createdAt) < 120_000 ? "web" : p.method === "other" && p.via === "check" ? "check" : p.method;

type Sheet = ReturnType<typeof compute>;

function compute(orders: Order[], sales: Sale[], w: Window, maps: { bySlug: Map<string, Product>; catBySlug: Map<string, Category> }) {
  const { bySlug, catBySlug } = maps;
  const live = orders.filter((o) => o.status !== "hold");

  /* MONEY IN, by the way it came. An order's payments carry the method
     the board wrote; a Square ring that matched no order is a walk-in
     rung straight on the register (the webhook keeps those too). */
  const byMethod = new Map<string, { cents: number; count: number; feeCents: number }>();
  const add = (k: string, cents: number, fee = 0) => {
    const cur = byMethod.get(k) ?? { cents: 0, count: 0, feeCents: 0 };
    byMethod.set(k, { cents: cur.cents + cents, count: cur.count + 1, feeCents: cur.feeCents + fee });
  };
  for (const o of live) for (const p of payments(o)) if (inWin(p.at, w)) add(methodKey(o, p), p.totalCents, p.feeCents);
  let walkInCard = 0, walkInCash = 0, walkIns = 0;
  for (const s of sales) {
    if (s.workroomOrderId) continue;
    if (!inWin(saleInstantMs(s.paidAt, s.createdAt), w)) continue;
    walkIns += 1;
    if (s.source === "CASH") walkInCash += s.totalCents;
    else walkInCard += s.totalCents;
  }
  const takenCents = [...byMethod.values()].reduce((s, x) => s + x.cents, 0) + walkInCard + walkInCash;
  const cardFeeCents = [...byMethod.values()].reduce((s, x) => s + x.feeCents, 0);

  /* MONEY OUT: part refunds (how they went back), and whole refunds of
     canceled orders marked in the window. */
  let refundSquare = 0, refundHand = 0, refundCash = 0, refundCount = 0;
  for (const o of orders) {
    // A part refund says how it went back; by hand is out of the drawer
    // (cash or a check; the drawer side is counted as cash, the only
    // place it can have come from on the day).
    // Credit moved onto another order ("transfer") left the shop not at all.
    for (const r of o.refunds ?? []) {
      if (!inWin(r.at, w) || r.how === "transfer") continue;
      refundCount += 1;
      if (r.how === "hand") { refundHand += r.cents; refundCash += r.cents; }
      else if (r.how === "check") refundHand += r.cents;
      else refundSquare += r.cents;
    }
    // A whole refund (a canceled order marked refunded) goes back the way
    // it came: a card or register ring through Square; cash or a by-hand
    // mark by hand, and cash out of the drawer.
    if (o.payment?.refundedAt && inWin(o.payment.refundedAt, w)) {
      refundCount += 1;
      // Each payment that made the order up goes back its own way ($40
      // cash then $60 card: $40 by hand from the drawer, $60 through
      // Square), scaled to what was still refundable if part had gone
      // back before.
      const gross = grossPaidCents(o);
      const scale = gross > 0 ? refundableCents(o) / gross : 0;
      for (const p of payments(o)) {
        const cents = Math.round(p.totalCents * scale);
        if (p.method === "cash" || p.method === "other") {
          refundHand += cents;
          if (p.method === "cash") refundCash += cents;
        } else refundSquare += cents;
      }
    }
  }
  /* THE CHECKS IN THE WINDOW, one by one: the deposit slip. */
  const checks: { number: string; who: string; checkNumber: string; cents: number; at: number }[] = [];
  for (const o of live) for (const p of payments(o)) if (p.via === "check" && inWin(p.at, w)) checks.push({ number: o.number, who: o.business || o.name, checkNumber: p.checkNumber ?? "", cents: p.totalCents, at: p.at });
  checks.sort((a, b) => a.at - b.at);
  const cashIn = (byMethod.get("cash")?.cents ?? 0) + walkInCash;
  const cashToCount = cashIn - refundCash;

  /* ORDERS: written in the window, and the window's work by date. */
  const written = live.filter((o) => inWin(o.createdAt, w));
  const dated = live.filter((o) => dateInWin(o.date, w));
  const quick = written.filter((o) => o.quick);
  const canceled = orders.filter((o) => o.status === "canceled" && inWin(o.createdAt, w));

  /* SALES TAX, two bases. Michigan accepts either, used consistently;
     the sheet shows both so the return and the books can each pick
     theirs. Items are the taxable lines (not delivery, not the tax line);
     exempt and third-party orders are listed apart. */
  const taxOn = (set: Order[]) => {
    let taxable = 0, tax = 0, exempt = 0, third = 0, delivery = 0;
    for (const o of set) {
      if (o.status === "canceled") continue;
      const items = o.lines.filter((l) => !isUntaxedLine(l)).reduce((s, l) => s + Math.round(l.each * l.qty * 100), 0);
      delivery += o.lines.filter(isDeliveryLine).reduce((s, l) => s + Math.round(l.each * l.qty * 100), 0);
      if (o.taxExempt) exempt += items;
      else if (o.thirdParty) third += items;
      else {
        taxable += items;
        tax += o.lines.filter(isTaxLine).reduce((s, l) => s + Math.round(l.each * l.qty * 100), 0);
      }
    }
    return { taxable, tax, exempt, third, delivery, count: set.filter((o) => o.status !== "canceled").length };
  };
  const paidIn = live.filter((o) => o.payment && inWin(o.payment.at, w));
  const taxPaid = taxOn(paidIn);
  const taxWritten = taxOn(written);

  /* HOUSE ACCOUNTS: billed in the window (account orders written), paid
     in the window (payments on account orders), owed now, and by age of
     the order's date: the invoice date a statement would carry. */
  const accountOrders = live.filter((o) => o.account);
  const billed = accountOrders.filter((o) => o.status !== "canceled" && inWin(o.createdAt, w)).reduce((s, o) => s + Math.round(o.subtotal * 100), 0);
  const accountPaid = accountOrders.reduce((s, o) => s + payments(o).filter((p) => inWin(p.at, w)).reduce((t, p) => t + p.totalCents, 0), 0);
  const openAccount = accountOrders.filter((o) => o.status !== "canceled" && balanceCents(o) > 0);
  const owedNow = openAccount.reduce((s, o) => s + owedNowCents(o), 0);
  const today = todayISO();
  const ageOf = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? Math.max(0, Math.round((Date.parse(today) - ms) / 86_400_000)) : 0;
  };
  const aging = [0, 0, 0, 0];
  for (const o of openAccount) {
    const a = ageOf(o.date);
    aging[a <= 30 ? 0 : a <= 60 ? 1 : a <= 90 ? 2 : 3] += owedNowCents(o);
  }
  // The Accounts tab's own grouping (groupAccounts): the business, else
  // the phone, else the name, so "across N accounts" is its N.
  const accountKey = (o: Order) => (o.business?.trim() ? `biz:${o.business.trim().toLowerCase()}` : phoneKey(o.phone) ? `ph:${phoneKey(o.phone)}` : `name:${o.name.trim().toLowerCase()}`);
  const customers = new Set(openAccount.map(accountKey)).size;

  /* THE MONTH'S DETAIL: by day, by category, best sellers. */
  const dayOf = new Map<string, { taken: number; count: number; written: number }>();
  const bump = (ms: number, f: (d: { taken: number; count: number; written: number }) => void) => {
    if (!inWin(ms, w)) return;
    const k = isoDate(new Date(ms));
    const d = dayOf.get(k) ?? { taken: 0, count: 0, written: 0 };
    f(d);
    dayOf.set(k, d);
  };
  for (const o of live) {
    bump(o.createdAt, (d) => { d.written += 1; });
    for (const p of payments(o)) bump(p.at, (d) => { d.taken += p.totalCents; d.count += 1; });
  }
  for (const s of sales) if (!s.workroomOrderId) bump(saleInstantMs(s.paidAt, s.createdAt), (d) => { d.taken += s.totalCents; d.count += 1; });
  const perDay = w.days.map((iso) => ({ iso, ...(dayOf.get(iso) ?? { taken: 0, count: 0, written: 0 }) }));
  const byCategory = new Map<string, number>();
  const byProduct = new Map<string, { name: string; qty: number; cents: number }>();
  for (const o of dated) {
    if (o.status === "canceled") continue;
    for (const l of o.lines) {
      if (isTaxLine(l)) continue;
      const cents = Math.round(l.each * l.qty * 100);
      const cat = isDeliveryLine(l) ? "Delivery" : l.slug ? catBySlug.get(bySlug.get(l.slug)?.cats[0] ?? "")?.name ?? "Other" : "Custom and by stems";
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + cents);
      if (!isDeliveryLine(l)) {
        const key = l.slug || l.name.trim().toLowerCase();
        const cur = byProduct.get(key) ?? { name: l.slug ? bySlug.get(l.slug)?.name ?? l.name : l.name, qty: 0, cents: 0 };
        byProduct.set(key, { name: cur.name, qty: cur.qty + l.qty, cents: cur.cents + cents });
      }
    }
  }

  return {
    byMethod, walkInCard, walkInCash, walkIns, takenCents, cardFeeCents,
    refundSquare, refundHand, refundCash, refundCount, cashIn, cashToCount, checks,
    written, dated, quick, canceled,
    taxPaid, taxWritten,
    billed, accountPaid, owedNow, aging, customers, openAccount: openAccount.length,
    perDay,
    byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    topProducts: [...byProduct.values()].sort((a, b) => b.cents - a.cents).slice(0, 10),
  };
}

/** Cents as dollars; a negative figure reads "−$8.95", not "$-8.95". */
const c$ = (cents: number) => (cents < 0 ? `−${money(-cents / 100)}` : money(cents / 100));

export default function Reports({ initialAuthed, initialOwner }: { initialAuthed: boolean; initialOwner: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [owner, setOwner] = useState(initialOwner);
  const [ownerHint, setOwnerHint] = useState("");
  const [view, setView] = useState<View>("day");
  const [day, setDay] = useState(todayISO);
  const [month, setMonth] = useState(() => monthOf(todayISO()));
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [backend, setBackend] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const pull = useCallback(async () => {
    try {
      // One request: the stems route carries the orders and the stored
      // Square rings together (the dashboard reads it the same way).
      const s = await fetch(`/api/workroom/stems?days=${HISTORY_DAYS}`, { cache: "no-store" });
      if (s.status === 401) {
        setAuthed(false);
        return;
      }
      if (!s.ok) throw new Error("The figures did not load.");
      const sd = await s.json();
      setOrders(sd.orders ?? []);
      setSales(sd.squareSales ?? []);
      setBackend(sd.backend ?? null);
      setLoaded(true);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The figures did not load.");
    }
  }, []);
  useEffect(() => {
    if (!authed) return;
    pull();
    const t = setInterval(pull, 60_000);
    return () => clearInterval(t);
  }, [authed, pull]);

  const win = useMemo(() => windowFor(view === "month" ? "month" : "day", view === "month" ? month : day), [view, day, month]);
  const [span, setSpan] = useState<Span>("90");
  const products = useProducts();
  const categories = useCategories();
  const maps = useMemo(
    () => ({ bySlug: new Map(products.map((p) => [p.slug, p])), catBySlug: new Map(categories.map((c) => [c.slug, c])) }),
    [products, categories],
  );
  const sheet = useMemo(() => compute(orders, sales, win, maps), [orders, sales, win, maps]);

  if (!authed) {
    return (
      <>
        <h1>Reports</h1>
        <PinGate onAuthed={(info) => { setAuthed(true); if (info?.owner) setOwner(true); }} />
      </>
    );
  }

  const monthLocked = view !== "day" && !owner;

  return (
    <>
      {/* Printing: the sheet alone, on plain paper, with the tabs and the
          controls left on the screen. */}
      <style>{`@media print { header, nav, .no-print { display: none !important; } .sheet { max-width: none !important; } body { background: #fff; } }`}</style>
      <h1>Reports</h1>
      <MemoryWarning backend={backend} />
      <div className="no-print" style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", margin: "0 0 16px" }}>
        <div role="group" aria-label="Sheet" style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 2 }}>
          {(["day", "month", "customers"] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              style={{ ...textButton, padding: "6px 14px", fontSize: 14, textDecoration: "none", background: view === v ? "var(--ink)" : "transparent", color: view === v ? "var(--paper)" : "var(--ink)" }}
            >
              {v === "day" ? "End of day" : v === "month" ? "End of month" : "Customers"}
            </button>
          ))}
        </div>
        {view === "day" ? (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => setDay((d) => shiftDay(d, -1))} style={{ ...textButton, fontSize: 14 }} aria-label="The day before">‹</button>
            <input type="date" value={day} max={todayISO()} onChange={(e) => isDay(e.target.value) && setDay(e.target.value)} aria-label="Day" style={{ padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 2, font: "inherit", fontSize: 14, background: "var(--paper)" }} />
            <button type="button" disabled={day >= todayISO()} onClick={() => setDay((d) => shiftDay(d, 1))} style={{ ...textButton, fontSize: 14 }} aria-label="The day after">›</button>
            {day !== todayISO() && <button type="button" onClick={() => setDay(todayISO())} style={{ ...textButton, fontSize: 13.5 }}>Today</button>}
          </span>
        ) : view === "customers" ? (
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 14 }}>
            Orders dated in
            <select value={span} onChange={(e) => setSpan(e.target.value as Span)} aria-label="Period" style={{ padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 2, font: "inherit", fontSize: 14 }}>
              {SPANS.map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </label>
        ) : (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} style={{ ...textButton, fontSize: 14 }} aria-label="The month before">‹</button>
            <input type="month" value={month} max={monthOf(todayISO())} onChange={(e) => isMonth(e.target.value) && setMonth(e.target.value)} aria-label="Month" style={{ padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 2, font: "inherit", fontSize: 14, background: "var(--paper)" }} />
            <button type="button" disabled={month >= monthOf(todayISO())} onClick={() => setMonth((m) => shiftMonth(m, 1))} style={{ ...textButton, fontSize: 14 }} aria-label="The month after">›</button>
          </span>
        )}
        <button type="button" className="btn" onClick={() => window.print()} disabled={monthLocked || !loaded}>
          Print this sheet
        </button>
        <button type="button" onClick={() => pull()} style={{ ...textButton, fontSize: 13.5 }}>Refresh</button>
        {error && <span role="alert" style={{ color: "var(--rose-ink)", fontWeight: 600 }}>{error}</span>}
      </div>

      {monthLocked ? (
        <>
          <p className="lede" style={{ margin: "4px 0 10px" }}>
            {view === "customers" ? "Who the customers are and what they spend" : "A month’s takings"} {view === "customers" ? "is" : "are"} the owner&rsquo;s to read: this sheet asks for the owner&rsquo;s PIN. The end-of-day sheet is open to everyone.
          </p>
          <PinGate
            onAuthed={(info) => {
              if (info?.owner) {
                setOwner(true);
                setOwnerHint("");
              } else setOwnerHint("That is the staff PIN; it opens the rest of the workroom, but this sheet needs the owner's.");
            }}
          />
          <p aria-live="polite" style={{ color: "var(--rose-ink)", fontWeight: 600, minHeight: "1.4em", maxWidth: 420 }}>{ownerHint}</p>
        </>
      ) : !loaded ? (
        <p className="muted" aria-live="polite">Adding it up…</p>
      ) : (
        view === "customers" ? <CustomersView orders={orders} span={span} /> : <SheetView view={view} win={win} s={sheet} day={day} />
      )}
    </>
  );
}

const kicker: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 6px" };
const table: React.CSSProperties = { borderCollapse: "collapse", width: "100%", fontSize: 14.5 };
const td: React.CSSProperties = { padding: "5px 8px 5px 0", borderBottom: "1px solid var(--line)" };
const tdR: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const tdTotal: React.CSSProperties = { ...td, fontWeight: 700, borderBottom: 0 };
const tdTotalR: React.CSSProperties = { ...tdR, fontWeight: 700, borderBottom: 0 };

function Rows({ rows, total }: { rows: [string, string, string?][]; total?: [string, string] }) {
  return (
    <table style={table}>
      <tbody>
        {rows.map(([k, v, sub], i) => (
          <tr key={i}>
            <td style={td}>
              {k}
              {sub ? <span className="muted" style={{ display: "block", fontSize: 13 }}>{sub}</span> : null}
            </td>
            <td style={tdR}>{v}</td>
          </tr>
        ))}
        {total && (
          <tr>
            <td style={tdTotal}>{total[0]}</td>
            <td style={tdTotalR}>{total[1]}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Block({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="panel" style={{ padding: 16, breakInside: "avoid" }}>
      <h2 style={{ ...kicker, margin: "0 0 10px" }}>{title}</h2>
      {children}
      {note && <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>{note}</p>}
    </section>
  );
}

function SheetView({ view, win, s, day }: { view: View; win: Window; s: Sheet; day: string }) {
  const methodRows: [string, string, string?][] = ["web", "card", "cash", "check", "register", "other"]
    .filter((m) => s.byMethod.has(m))
    .map((m) => {
      const x = s.byMethod.get(m)!;
      return [methodWord[m] ?? m, c$(x.cents), `${x.count} payment${x.count === 1 ? "" : "s"}${(m === "card" || m === "web") && x.feeCents > 0 ? ` · includes ${c$(x.feeCents)} in card fees the customers paid` : ""}`];
    });
  if (s.walkInCard > 0 || s.walkInCash > 0) {
    methodRows.push(["Walk-ins rung straight on the register", c$(s.walkInCard + s.walkInCash), `${s.walkIns} ring${s.walkIns === 1 ? "" : "s"} · ${c$(s.walkInCash)} cash, ${c$(s.walkInCard)} card`]);
  }
  const dated = s.dated.filter((o) => o.status !== "canceled");
  const deliveries = dated.filter((o) => o.fulfillment === "delivery");
  const done = dated.filter((o) => o.status === "done");
  const stillOpen = dated.filter((o) => o.status !== "done");
  const taxRows = (t: Sheet["taxPaid"]): [string, string, string?][] => [
    ["Taxable sales (items)", c$(t.taxable)],
    [`Sales tax collected (${Math.round(site.taxRate * 100)}%)`, c$(t.tax)],
    ["Tax-exempt sales (items)", c$(t.exempt), "schools, churches, certificate holders"],
    ["Third-party sales (items)", c$(t.third), "Tribute and the like bill the tax themselves"],
    ["Delivery charges (not taxed)", c$(t.delivery)],
  ];

  return (
    <div className="sheet" style={{ maxWidth: 860 }}>
      <p style={{ margin: "0 0 14px", fontSize: 15 }}>
        <strong>{site.shortName}</strong> · {view === "day" ? "End of day" : "End of month"} · <strong>{win.label}</strong>
        <span className="muted"> · printed {new Date().toLocaleString("en-US", { timeZone: site.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      </p>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))" }}>
        <Block
          title="Money in"
          note="Card and cash taken on a card are Square's own rings and are counted once, here. Card fees are the customer-paid fee on web orders and board card charges; Square's processing cost is not shown."
        >
          <Rows rows={methodRows.length ? methodRows : [["Nothing taken", c$(0)]]} total={["Taken", c$(s.takenCents)]} />
        </Block>

        <Block
          title="Cash to count"
          note="What the drawer should hold from this window's business, before the float. Cash given back (a part refund by hand, or a canceled cash order refunded) is taken off; anything paid out of the drawer for other reasons is not known here."
        >
          <Rows
            rows={[
              ["Cash taken", c$(s.cashIn)],
              ["Cash given back", s.refundCash > 0 ? `− ${c$(s.refundCash)}` : c$(0)],
            ]}
            total={["Cash to count", c$(s.cashToCount)]}
          />
        </Block>

        {view === "day" && <Drawer day={day} cashFromSales={s.cashToCount} />}

        {s.checks.length > 0 && (
          <Block title="Checks to deposit" note="Each check recorded in this window, in the order it was taken.">
            <Rows
              rows={s.checks.map((k) => [`${k.who} · ${k.number}`, c$(k.cents), k.checkNumber ? `check #${k.checkNumber}` : "no check number written"] as [string, string, string])}
              total={[`${s.checks.length} check${s.checks.length === 1 ? "" : "s"}`, c$(s.checks.reduce((a, k) => a + k.cents, 0))]}
            />
          </Block>
        )}

        <Block title="Money out" note="A refund is recorded on the order's card or its finished row, and that record is what is counted here. Money moved from one order to another of the same customer is not money out and is left off.">
          <Rows
            rows={[
              ["Refunded through Square", c$(s.refundSquare)],
              ["Given back by hand (cash or a check)", c$(s.refundHand)],
            ]}
            total={[`${s.refundCount} refund${s.refundCount === 1 ? "" : "s"}`, c$(s.refundSquare + s.refundHand)]}
          />
        </Block>

        <Block title="Orders" note={view === "day" ? "Written: taken today, for any date. Dated: the day's work, whatever day it was taken." : "Written: taken this month. Dated: this month's work."}>
          <Rows
            rows={[
              ["Written", String(s.written.length), `${s.quick.length} quick sale${s.quick.length === 1 ? "" : "s"} · ${s.written.filter((o) => o.source === "web").length} from the website · ${s.canceled.length} canceled`],
              [`Dated ${view === "day" ? "today" : "this month"}`, String(dated.length), `${deliveries.length} deliver${deliveries.length === 1 ? "y" : "ies"}, ${dated.length - deliveries.length} pickup${dated.length - deliveries.length === 1 ? "" : "s"}`],
              ["Out the door", String(done.length)],
              ["Still open", String(stillOpen.length)],
            ]}
          />
        </Block>

        <Block
          title={`Sales tax · orders paid ${view === "day" ? "today" : "this month"}`}
          note={`${s.taxPaid.count} order${s.taxPaid.count === 1 ? "" : "s"} took their first payment in this window (the cash basis).`}
        >
          <Rows rows={taxRows(s.taxPaid)} />
        </Block>

        <Block
          title={`Sales tax · orders written ${view === "day" ? "today" : "this month"}`}
          note={`${s.taxWritten.count} order${s.taxWritten.count === 1 ? "" : "s"} were written in this window, paid or not (the accrual basis). Use one basis or the other for the return, not both.`}
        >
          <Rows rows={taxRows(s.taxWritten)} />
        </Block>

        <Block title="House accounts" note="Billed is the ticket total of account orders written in the window; paid is every payment on an account order in the window. Owed now is not windowed.">
          <Rows
            rows={[
              ["Billed to accounts", c$(s.billed)],
              ["Paid on accounts", c$(s.accountPaid)],
              ["Owed now", c$(s.owedNow), `${s.openAccount} order${s.openAccount === 1 ? "" : "s"} across ${s.customers} account${s.customers === 1 ? "" : "s"}`],
            ]}
          />
        </Block>

        <Block title="Owed by age" note="By each order's date. A statement goes out from the Accounts tab.">
          <Rows
            rows={[
              ["Up to 30 days", c$(s.aging[0])],
              ["31 to 60 days", c$(s.aging[1])],
              ["61 to 90 days", c$(s.aging[2])],
              ["Over 90 days", c$(s.aging[3])],
            ]}
            total={["Owed now", c$(s.owedNow)]}
          />
        </Block>
      </div>

      {view === "month" && (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", marginTop: 14 }}>
          <Block title="By day">
            <table style={table}>
              <thead>
                <tr>
                  <th style={{ ...td, textAlign: "left", ...kicker, fontSize: 12 }}>Day</th>
                  <th style={{ ...tdR, ...kicker, fontSize: 12 }}>Written</th>
                  <th style={{ ...tdR, ...kicker, fontSize: 12 }}>Payments</th>
                  <th style={{ ...tdR, ...kicker, fontSize: 12 }}>Taken</th>
                </tr>
              </thead>
              <tbody>
                {s.perDay.filter((d) => d.iso <= todayISO()).map((d) => (
                  <tr key={d.iso}>
                    <td style={td}>{dayAt(d.iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</td>
                    <td style={tdR}>{d.written}</td>
                    <td style={tdR}>{d.count}</td>
                    <td style={tdR}>{c$(d.taken)}</td>
                  </tr>
                ))}
                <tr>
                  <td style={tdTotal}>Month</td>
                  <td style={tdTotalR}>{s.written.length}</td>
                  <td style={tdTotalR}>{s.perDay.reduce((a, d) => a + d.count, 0)}</td>
                  <td style={tdTotalR}>{c$(s.takenCents)}</td>
                </tr>
              </tbody>
            </table>
          </Block>
          <div style={{ display: "grid", gap: 14 }}>
            <Block title="Sales by category" note="Ticket lines of the month's dated orders, before tax; canceled orders left out.">
              <Rows rows={s.byCategory.map(([k, v]) => [k, c$(v)] as [string, string])} total={["Items and delivery", c$(s.byCategory.reduce((a, [, v]) => a + v, 0))]} />
            </Block>
            <Block title="Best sellers">
              <Rows rows={s.topProducts.map((p) => [p.name, c$(p.cents), `${p.qty} sold`] as [string, string, string])} />
            </Block>
          </div>
        </div>
      )}
      <p className="muted" style={{ margin: "14px 0 0", fontSize: 13 }}>
        Every figure here is derived from the board&rsquo;s orders and the Square rings it has seen since launch; nothing is estimated. Square&rsquo;s own reports remain the record for processing fees and deposits. Gross of refunds unless a line says otherwise.
      </p>
    </div>
  );
}

/* ------------------------------ the drawer ------------------------------ */

/**
 * THE DRAWER AT CLOSING (Katy, 2026-11-09: "cash we're putting in,
 * balancing drawer at end of day, daily reports"). The sheet already knew
 * the cash the day's sales should have left; it could not know the float
 * the drawer opened with, cash put in or taken out that was not a sale, or
 * what was counted. Those four figures are typed here, kept per day, and
 * the block says over or short. It prints with the sheet.
 */
type DrawerCount = { day: string; openingCents: number; addedCents: number; removedCents: number; countedCents: number | null; note: string; by: string; at: number };
const amt = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));

function Drawer({ day, cashFromSales }: { day: string; cashFromSales: number }) {
  const [saved, setSaved] = useState<DrawerCount | null>(null);
  const [opening, setOpening] = useState("");
  const [added, setAdded] = useState("");
  const [removed, setRemoved] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let dead = false;
    setLoaded(false);
    setError("");
    fetch(`/api/workroom/drawer?day=${day}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead) return;
        const c = (d?.count as DrawerCount | null) ?? null;
        setSaved(c);
        setOpening(amt(c?.openingCents));
        setAdded(c && c.addedCents ? amt(c.addedCents) : "");
        setRemoved(c && c.removedCents ? amt(c.removedCents) : "");
        setCounted(amt(c?.countedCents));
        setNote(c?.note ?? "");
        setBy(c?.by ?? "");
        setLoaded(true);
      })
      .catch(() => {
        if (!dead) setLoaded(true);
      });
    return () => {
      dead = true;
    };
  }, [day]);

  // A blank box is zero, except the count: blank means not counted yet.
  const read = (v: string) => (v.trim() === "" ? 0 : parseDollars(v));
  const o = read(opening);
  const a = read(added);
  const r = read(removed);
  const k = counted.trim() === "" ? null : parseDollars(counted);
  const bad = o === null || a === null || r === null || (counted.trim() !== "" && k === null);
  const expected = (o ?? 0) + (a ?? 0) - (r ?? 0) + cashFromSales;
  const diff = k === null ? null : k - expected;

  async function save() {
    if (bad) return setError("One of the amounts did not read as money. Use figures like 150 or 150.00.");
    if (!isInitials(by)) return setError("Your initials, two or three letters, so the count has a name on it.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/workroom/drawer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, openingCents: o, addedCents: a, removedCents: r, countedCents: k, note, by: by.trim().toUpperCase() }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; count?: DrawerCount; error?: string } | null;
      if (!res.ok || !d?.ok) setError(d?.error || "The count did not save.");
      else setSaved(d.count ?? null);
    } catch {
      setError("The connection dropped. The count is still in the boxes; save it again.");
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = { ...field, width: 110, padding: "6px 10px" };
  const line: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 14.5 };
  return (
    <Block
      title="The drawer"
      note="Opening float plus cash put in, less cash taken out, plus the cash from the day's sales, is what the drawer should hold. Count it and the sheet says over or short."
    >
      {!loaded ? (
        <p className="muted" style={{ margin: 0 }}>Reading the count…</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <label style={line}>
            Opening float (the cash it started with)
            <input value={opening} onChange={(e) => setOpening(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Opening float, in dollars" style={box} />
          </label>
          <label style={line}>
            Cash put in during the day (not a sale)
            <input value={added} onChange={(e) => setAdded(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Cash put in, in dollars" style={box} />
          </label>
          <label style={line}>
            Cash taken out during the day (a drop, a purchase)
            <input value={removed} onChange={(e) => setRemoved(e.target.value)} inputMode="decimal" placeholder="0.00" aria-label="Cash taken out, in dollars" style={box} />
          </label>
          <div style={line}>
            <span>Cash from the day&rsquo;s sales</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{c$(cashFromSales)}</span>
          </div>
          <div style={{ ...line, fontWeight: 700, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <span>The drawer should hold</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{bad ? "…" : c$(expected)}</span>
          </div>
          <label style={line}>
            Counted at close
            <input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" placeholder="not counted yet" aria-label="Cash counted at close, in dollars" style={box} />
          </label>
          {diff !== null && !bad && (
            <div role="status" style={{ ...line, fontWeight: 700, color: diff === 0 ? "var(--green)" : "var(--rose-ink)" }}>
              <span>{diff === 0 ? "The drawer balances" : diff > 0 ? "Over" : "Short"}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{diff === 0 ? c$(0) : c$(Math.abs(diff))}</span>
            </div>
          )}
          <label className="no-print" style={{ ...line, justifyContent: "flex-start" }}>
            Note
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} aria-label="A note on the count" style={{ ...field, flex: "1 1 200px", width: "auto", padding: "6px 10px" }} />
          </label>
          {note && <p style={{ margin: 0, fontSize: 13.5 }} className="muted">Note: {note}</p>}
          <p className="no-print" style={{ margin: 0, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <InitialsInput value={by} onChange={setBy} />
            <button type="button" className="btn" disabled={busy} onClick={save}>
              {busy ? "Saving…" : "Save the count"}
            </button>
            {error && <span role="alert" style={{ color: "var(--rose-ink)", fontWeight: 600, fontSize: 14 }}>{error}</span>}
          </p>
          {saved && (
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              Saved by {saved.by}, {new Date(saved.at).toLocaleString("en-US", { timeZone: site.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.
            </p>
          )}
        </div>
      )}
    </Block>
  );
}

/* ----------------------------- the customers ---------------------------- */

type Span = "30" | "90" | "365" | "year" | "all";
const SPANS: [Span, string][] = [
  ["30", "the last 30 days"],
  ["90", "the last 90 days"],
  ["year", "this year"],
  ["365", "the last 12 months"],
  ["all", "everything on file"],
];

/**
 * THE CUSTOMER SHEET (Katy, 2026-11-09: "top customer report, etc.,
 * different types of customer reports"). Four answers from the orders
 * already on the board, no separate customer table: who spends the most
 * (or orders the most often, by the sort), who placed a first order in the
 * period, and which regulars have gone quiet. A customer is the Accounts
 * tab's grouping: the business when there is one, else the phone, else the
 * name. Quick sales are nobody and are left out; canceled and held orders
 * are not sales. Spend is ticket totals, tax and delivery included, by
 * the order's own date.
 */
function CustomersView({ orders, span }: { orders: Order[]; span: Span }) {
  const [sort, setSort] = useState<"spend" | "orders" | "recent">("spend");
  const today = todayISO();
  const from =
    span === "all" ? "0000-00-00" : span === "year" ? `${today.slice(0, 4)}-01-01` : isoDate(new Date(dayAt(today).getTime() - Number(span) * 86_400_000));
  const data = useMemo(() => {
    const keyOf = (o: Order) => (o.business?.trim() ? `biz:${o.business.trim().toLowerCase()}` : phoneKey(o.phone) ? `ph:${phoneKey(o.phone)}` : `name:${o.name.trim().toLowerCase()}`);
    type Row = { key: string; label: string; phone: string; orders: number; cents: number; last: string; first: string; everOrders: number; everCents: number; owed: number; account: boolean };
    const rows = new Map<string, Row>();
    const sales = orders.filter((o) => o.status !== "canceled" && o.status !== "hold" && !o.quick && (o.name.trim() || o.business?.trim()));
    for (const o of sales) {
      const key = keyOf(o);
      const cur = rows.get(key) ?? { key, label: "", phone: "", orders: 0, cents: 0, last: "", first: "9999-99-99", everOrders: 0, everCents: 0, owed: 0, account: false };
      const cents = Math.round(o.subtotal * 100);
      cur.everOrders += 1;
      cur.everCents += cents;
      if (o.date > cur.last) {
        cur.last = o.date;
        cur.label = o.business ? `${o.business}${o.name ? ` · ${o.name}` : ""}` : o.name;
        cur.phone = o.phone;
      }
      if (o.date < cur.first) cur.first = o.date;
      if (o.date >= from && o.date <= today) {
        cur.orders += 1;
        cur.cents += cents;
      }
      if (o.account) cur.account = true;
      cur.owed += balanceCents(o) > 0 ? owedNowCents(o) : 0;
      rows.set(key, cur);
    }
    const all = [...rows.values()];
    const inSpan = all.filter((r) => r.orders > 0);
    const quietFrom = isoDate(new Date(dayAt(today).getTime() - 90 * 86_400_000));
    return {
      inSpan,
      total: inSpan.reduce((s, r) => s + r.cents, 0),
      fresh: all.filter((r) => r.first >= from && r.first <= today).sort((a, b) => b.first.localeCompare(a.first)),
      quiet: all.filter((r) => r.everOrders >= 2 && r.last < quietFrom).sort((a, b) => b.everCents - a.everCents).slice(0, 25),
      repeat: inSpan.filter((r) => r.everOrders >= 2).length,
    };
  }, [orders, from, today]);
  const top = [...data.inSpan].sort((a, b) => (sort === "spend" ? b.cents - a.cents : sort === "orders" ? b.orders - a.orders || b.cents - a.cents : b.last.localeCompare(a.last))).slice(0, 25);
  const label = SPANS.find(([v]) => v === span)?.[1] ?? "";
  const short = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? dayAt(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
  const head: React.CSSProperties = { ...kicker, fontSize: 12 };

  return (
    <div className="sheet" style={{ maxWidth: 860 }}>
      <p style={{ margin: "0 0 14px", fontSize: 15 }}>
        <strong>{site.shortName}</strong> · Customers · <strong>orders dated in {label}</strong>
        <span className="muted"> · printed {new Date().toLocaleString("en-US", { timeZone: site.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      </p>
      {/* minmax(0, 1fr): the wide table scrolls inside its own block on a
          phone instead of widening the page. */}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <Block title="In short">
          <Rows
            rows={[
              ["Customers who ordered", String(data.inSpan.length), `${data.repeat} have ordered more than once`],
              ["What they spent", c$(data.total), data.inSpan.length ? `${c$(Math.round(data.total / data.inSpan.length))} a customer on average` : undefined],
              ["First-time customers", String(data.fresh.length)],
            ]}
          />
        </Block>

        <Block title={`Top customers · ${sort === "spend" ? "by what they spent" : sort === "orders" ? "by how often they order" : "most recent first"}`} note="The top 25. Spend is ticket totals with tax and delivery; canceled orders and quick sales are left out.">
          <p className="no-print" style={{ margin: "0 0 8px", display: "flex", gap: 14, flexWrap: "wrap", fontSize: 14 }}>
            Sort by
            {(
              [
                ["spend", "what they spent"],
                ["orders", "number of orders"],
                ["recent", "most recent order"],
              ] as ["spend" | "orders" | "recent", string][]
            ).map(([v, w]) => (
              <button key={v} type="button" onClick={() => setSort(v)} aria-pressed={sort === v} style={{ ...textButton, fontSize: 14, fontWeight: sort === v ? 700 : 400 }}>
                {w}
              </button>
            ))}
          </p>
          {top.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No orders in this period.</p>
          ) : (
            <div role="region" aria-label="Top customers table" tabIndex={0} style={{ overflowX: "auto" }}>
              <table style={{ ...table, minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={{ ...td, textAlign: "left", ...head }}>Customer</th>
                    <th style={{ ...tdR, ...head }}>Orders</th>
                    <th style={{ ...tdR, ...head }}>Spent</th>
                    <th style={{ ...tdR, ...head }}>Average</th>
                    <th style={{ ...tdR, ...head }}>Last order</th>
                    <th style={{ ...tdR, ...head }}>Owes now</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r, i) => (
                    <tr key={r.key}>
                      <td style={td}>
                        {i + 1}. {r.label || "No name"}
                        <span className="muted" style={{ display: "block", fontSize: 13 }}>
                          {[r.phone, r.account ? "house account" : ""].filter(Boolean).join(" · ")}
                        </span>
                      </td>
                      <td style={tdR}>{r.orders}</td>
                      <td style={tdR}>{c$(r.cents)}</td>
                      <td style={tdR}>{c$(Math.round(r.cents / r.orders))}</td>
                      <td style={tdR}>{short(r.last)}</td>
                      <td style={tdR}>{r.owed > 0 ? c$(r.owed) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Block>

        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))" }}>
          <Block title="New customers" note="Their first order on file falls in this period.">
            {data.fresh.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>None in this period.</p>
            ) : (
              <Rows rows={data.fresh.slice(0, 25).map((r) => [r.label || "No name", c$(r.everCents), `first order ${short(r.first)} · ${r.everOrders} order${r.everOrders === 1 ? "" : "s"} since`] as [string, string, string])} />
            )}
          </Block>
          <Block title="Regulars gone quiet" note="Two or more orders on file, and none dated in the last 90 days. By what they have spent in all; worth a call or a card.">
            {data.quiet.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nobody: every regular has ordered in the last 90 days.</p>
            ) : (
              <Rows rows={data.quiet.map((r) => [r.label || "No name", c$(r.everCents), `${r.everOrders} orders · last ${short(r.last)}${r.phone ? ` · ${r.phone}` : ""}`] as [string, string, string])} />
            )}
          </Block>
        </div>
      </div>
      <p className="muted" style={{ margin: "14px 0 0", fontSize: 13 }}>
        From the orders on the board, which go back {HISTORY_DAYS} days at most; older history is not counted. A customer is their business when they have one, otherwise their phone number, otherwise their name.
      </p>
    </div>
  );
}
