"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { parseDollars } from "@/components/workroom/PayControls";
import { Block, Rows, Scroll, Tiles, c$, csv$, downloadCsv, table, td, tdR, tdTotal, tdTotalR, thL, thR, whoOf, type ReportOrder, type ReportPayment } from "@/components/workroom/report-parts";
import CustomersView, { SPANS, type Span } from "@/components/workroom/ReportsCustomers";
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
  payWord,
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
 *   read. Both sheets lead with the few figures that matter (taken,
 *   given back, net, orders, the average order), list every payment and
 *   every refund line by line so the totals can be laid beside Square's
 *   own list, and hand the bookkeeper the window as spreadsheet files
 *   (2026-11-10, at Kevin's "can they be improved?"). The CUSTOMER sheet (Katy, 2026-11-09: "top customer report,
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

type Order = ReportOrder;
type Payment = ReportPayment;
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
const cashOnly = (o: Order) => {
  const all = [...(o.payment ? [o.payment] : []), ...(o.topUps ?? [])];
  return all.length > 0 && all.every((p) => p.method === "cash");
};
const methodWord: Record<string, string> = { web: "Card, on the website", card: "Card, at the board", cash: "Cash", check: "Checks", register: "Rung on the register", other: "By hand (bank transfer, marked paid)" };
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
      else {
        refundSquare += r.cents;
        // A cash order's money is in Square's books and in the drawer:
        // its refund comes out of the drawer whichever button said so.
        if (cashOnly(o)) refundCash += r.cents;
      }
    }
    // A whole refund (a canceled order marked refunded) goes back the way
    // it came: a card or register ring through Square; cash or a by-hand
    // mark by hand, and cash out of the drawer.
    if (o.payment?.refundedAt && inWin(o.payment.refundedAt, w) && refundableCents(o) > 0) {
      refundCount += 1;
      // Each payment that made the order up goes back its own way ($40
      // cash then $60 card: $40 by hand from the drawer, $60 through
      // Square), scaled to what was still refundable if part had gone
      // back before.
      const gross = grossPaidCents(o);
      const scale = gross > 0 ? refundableCents(o) / gross : 0;
      // Each share is rounded and the last takes what is left, so the
      // shares add up to exactly what went back (the refund list below
      // states the one figure).
      const paid = [...(o.payment ? [o.payment] : []), ...(o.topUps ?? [])];
      let left = refundableCents(o);
      for (let i = 0; i < paid.length; i++) {
        const p = paid[i];
        const cents = i === paid.length - 1 ? left : Math.min(left, Math.round(p.totalCents * scale));
        left -= cents;
        if (p.method === "cash" || p.method === "other") {
          refundHand += cents;
          if (p.method === "cash") refundCash += cents;
        } else refundSquare += cents;
      }
    }
  }
  /* THE CHECKS IN THE WINDOW, one by one: the deposit slip. */
  // One check dealt across several orders of an account is ONE check on
  // the slip: the route gives its shares one timestamp, and that with the
  // number is the check.
  const checkMap = new Map<string, { numbers: string[]; who: string; checkNumber: string; cents: number; at: number }>();
  for (const o of live) {
    for (const p of payments(o)) {
      if (p.via !== "check" || !inWin(p.at, w)) continue;
      // By its number and who wrote it, so one check keyed in two goes
      // is still one check; an unnumbered one by the moment it was taken.
      const key = p.checkNumber ? `n:${(o.business || o.name).trim().toLowerCase()}|${p.checkNumber}` : `t:${p.at}`;
      const cur = checkMap.get(key) ?? { numbers: [], who: o.business || o.name, checkNumber: p.checkNumber ?? "", cents: 0, at: p.at };
      cur.numbers.push(o.number);
      cur.cents += p.totalCents;
      checkMap.set(key, cur);
    }
  }
  const checks = [...checkMap.values()].sort((a, b) => a.at - b.at);
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

  /* THE JOURNAL: every payment in the window, one line each, in the order
     it was taken. The lines add up to Taken. */
  type Kind = "card" | "cash" | "check" | "other";
  const journal: { at: number; number: string; who: string; how: string; kind: Kind; cents: number }[] = [];
  for (const o of live) {
    for (const p of payments(o)) {
      if (!inWin(p.at, w)) continue;
      const k = methodKey(o, p);
      journal.push({
        at: p.at,
        number: o.number,
        who: whoOf(o),
        how: k === "web" ? "card, on the website" : k === "check" ? payWord(p) : k === "other" ? "by hand" : k === "register" ? "rung on the register" : k,
        // A ring on the register is filed with the cards: the board is not
        // told its tender, and cash to count has never included it.
        kind: k === "cash" ? "cash" : k === "check" ? "check" : k === "other" ? "other" : "card",
        cents: p.totalCents,
      });
    }
  }
  for (const sale of sales) {
    if (sale.workroomOrderId) continue;
    const at = saleInstantMs(sale.paidAt, sale.createdAt);
    if (!inWin(at, w)) continue;
    const cash = sale.source === "CASH";
    journal.push({ at, number: "", who: "Walk-in, rung on the register", how: cash ? "cash" : "card", kind: cash ? "cash" : "card", cents: sale.totalCents });
  }
  journal.sort((a, b) => a.at - b.at);

  /* EVERY REFUND in the window with what it was for. The lines add up to
     Money out. Credit moved to another order is not a refund. */
  const refundsList: { at: number; number: string; who: string; how: string; reason: string; cents: number }[] = [];
  for (const o of orders) {
    for (const r of o.refunds ?? []) {
      if (!inWin(r.at, w) || r.how === "transfer") continue;
      refundsList.push({
        at: r.at,
        number: o.number,
        who: whoOf(o),
        how: r.how === "hand" ? "cash" : r.how === "check" ? "a check" : "through Square",
        reason: r.note && !/^(Refunded from|Given back)/.test(r.note) ? r.note : "The ticket changed after it was paid",
        cents: r.cents,
      });
    }
    if (o.payment?.refundedAt && inWin(o.payment.refundedAt, w) && refundableCents(o) > 0) {
      refundsList.push({ at: o.payment.refundedAt, number: o.number, who: whoOf(o), how: "the way it was paid", reason: "The order was canceled", cents: refundableCents(o) });
    }
  }
  refundsList.sort((a, b) => a.at - b.at);
  const backCents = refundSquare + refundHand;

  /* THE MONTH BY DAY: what came in each way, what went back, the net. */
  const dayOf = new Map<string, { written: number; card: number; cash: number; check: number; other: number; back: number }>();
  const dayRow = (ms: number) => {
    const k = isoDate(new Date(ms));
    let d = dayOf.get(k);
    if (!d) {
      d = { written: 0, card: 0, cash: 0, check: 0, other: 0, back: 0 };
      dayOf.set(k, d);
    }
    return d;
  };
  for (const o of written) dayRow(o.createdAt).written += 1;
  for (const j of journal) dayRow(j.at)[j.kind] += j.cents;
  for (const r of refundsList) dayRow(r.at).back += r.cents;
  const perDay = w.days.map((iso) => ({ iso, ...(dayOf.get(iso) ?? { written: 0, card: 0, cash: 0, check: 0, other: 0, back: 0 }) }));

  /* WHAT IS LEFT TO DO: today's work not out the door, finished orders
     with money still to collect, and tomorrow at a glance. */
  const writtenLive = written.filter((o) => o.status !== "canceled");
  const writtenCents = writtenLive.reduce((sum, o) => sum + Math.round(o.subtotal * 100), 0);
  const stillOpenList = dated.filter((o) => o.status !== "canceled" && o.status !== "done");
  const owedOut = live.filter((o) => o.status === "done" && !o.account && balanceCents(o) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const nextDay = w.days.length === 1 ? shiftDay(w.days[0], 1) : "";
  const tomorrowOrders = nextDay ? live.filter((o) => o.date === nextDay && o.status !== "canceled") : [];
  const tomorrow = nextDay ? { count: tomorrowOrders.length, deliveries: tomorrowOrders.filter((o) => o.fulfillment === "delivery").length } : null;

  /* WHO OWES, BY AGE: each account's open orders in the four buckets, the
     oldest money first. */
  const agingMap = new Map<string, { key: string; label: string; buckets: number[]; total: number }>();
  for (const o of openAccount) {
    const key = accountKey(o);
    const cur = agingMap.get(key) ?? { key, label: o.business?.trim() || o.name || "No name", buckets: [0, 0, 0, 0], total: 0 };
    const a = ageOf(o.date);
    const owed = owedNowCents(o);
    cur.buckets[a <= 30 ? 0 : a <= 60 ? 1 : a <= 90 ? 2 : 3] += owed;
    cur.total += owed;
    agingMap.set(key, cur);
  }
  const agingAccounts = [...agingMap.values()].sort((x, y) => y.buckets[3] - x.buckets[3] || y.buckets[2] - x.buckets[2] || y.buckets[1] - x.buckets[1] || y.total - x.total);

  /* WHAT THE FLOWERS WERE FOR, and how the orders came in. */
  const occasionMap = new Map<string, { label: string; count: number; cents: number }>();
  for (const o of dated) {
    if (o.status === "canceled") continue;
    const label = o.quick ? "Quick sales at the counter" : o.occasion?.trim() || "No occasion given";
    const cur = occasionMap.get(label) ?? { label, count: 0, cents: 0 };
    occasionMap.set(label, { label, count: cur.count + 1, cents: cur.cents + o.lines.filter((l) => !isTaxLine(l)).reduce((sum, l) => sum + Math.round(l.each * l.qty * 100), 0) });
  }
  const byOccasion = [...occasionMap.values()].sort((a, b) => b.cents - a.cents);
  const sourceMap = new Map<string, { label: string; count: number; cents: number }>();
  for (const o of writtenLive) {
    const label = o.quick ? "Quick sale at the counter" : o.source === "web" ? "The website" : "Phone or counter";
    const cur = sourceMap.get(label) ?? { label, count: 0, cents: 0 };
    sourceMap.set(label, { label, count: cur.count + 1, cents: cur.cents + Math.round(o.subtotal * 100) });
  }
  const bySource = [...sourceMap.values()].sort((a, b) => b.cents - a.cents);

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
    backCents, journal, refundsList, writtenCents, stillOpenList, owedOut, tomorrow, agingAccounts, byOccasion, bySource,
    byCategory: [...byCategory.entries()].sort((a, b) => b[1] - a[1]),
    topProducts: [...byProduct.values()].sort((a, b) => b.cents - a.cents).slice(0, 10),
  };
}


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
  // Last month's two headline figures, for "up on October" beside this month's.
  const prev = useMemo(() => {
    if (view !== "month") return null;
    const pw = windowFor("month", shiftMonth(month, -1));
    const p = compute(orders, sales, pw, maps);
    return { label: dayAt(pw.days[0]).toLocaleDateString("en-US", { month: "long" }), takenCents: p.takenCents, written: p.written.filter((o) => o.status !== "canceled").length };
  }, [view, month, orders, sales, maps]);

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
            Orders placed in
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
        view === "customers" ? <CustomersView orders={orders} span={span} /> : <SheetView view={view} win={win} s={sheet} day={day} prev={prev} />
      )}
    </>
  );
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayShort = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const statusWord: Record<string, string> = { new: "not confirmed", confirmed: "to make", made: "made, not out", out: "out for delivery", done: "done" };
/** "12% up on October", or nothing when there is no earlier figure to compare with. */
const versus = (cur: number, was: number | undefined, label: string) => (was && was > 0 ? `${Math.abs(Math.round(((cur - was) / was) * 100))}% ${cur >= was ? "up on" : "down on"} ${label}` : undefined);

function SheetView({ view, win, s, day, prev }: { view: View; win: Window; s: Sheet; day: string; prev: { label: string; takenCents: number; written: number } | null }) {
  const methodRows: [string, string, string?][] = ["web", "card", "cash", "check", "register", "other"]
    .filter((m) => s.byMethod.has(m))
    .map((m) => {
      const x = s.byMethod.get(m)!;
      return [methodWord[m] ?? m, c$(x.cents), `${m === "check" ? `${s.checks.length} check${s.checks.length === 1 ? "" : "s"}` : `${x.count} payment${x.count === 1 ? "" : "s"}`}${(m === "card" || m === "web") && x.feeCents > 0 ? ` · includes ${c$(x.feeCents)} in card fees the customers paid` : ""}`];
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
  const taxTotal = (t: Sheet["taxPaid"]): [string, string] => ["Gross sales, before tax", c$(t.taxable + t.exempt + t.third + t.delivery)];
  const written = s.written.filter((o) => o.status !== "canceled");
  const stamp = view === "day" ? day : win.days[0]?.slice(0, 7) ?? "";
  const checksCents = s.checks.reduce((a, k) => a + k.cents, 0);
  const busiest = [...s.perDay].sort((a, b) => b.card + b.cash + b.check + b.other - (a.card + a.cash + a.check + a.other))[0];
  const busiestTaken = busiest ? busiest.card + busiest.cash + busiest.check + busiest.other : 0;

  /* FOR THE BOOKKEEPER: the window's payments, refunds and orders as
     spreadsheet files, made here from what the sheet already holds. */
  const downloadPayments = () =>
    downloadCsv(
      `devine-payments-${stamp}.csv`,
      ["Date", "Time", "Order", "Customer", "How", "Amount"],
      s.journal.map((j) => [isoDate(new Date(j.at)), clock(j.at), j.number, j.who, j.how, csv$(j.cents)]),
    );
  const downloadRefunds = () =>
    downloadCsv(
      `devine-refunds-${stamp}.csv`,
      ["Date", "Time", "Order", "Customer", "How it went back", "What for", "Amount"],
      s.refundsList.map((r) => [isoDate(new Date(r.at)), clock(r.at), r.number, r.who, r.how, r.reason, csv$(r.cents)]),
    );
  const downloadOrders = () =>
    downloadCsv(
      `devine-orders-${stamp}.csv`,
      ["Written", "Order", "Customer", "For date", "Delivery or pickup", "Occasion", "PO number", "Items", "Items and delivery", "Sales tax", "Total", "Paid", "Given back", "Owed", "On account", "Status"],
      s.written.map((o) => {
        const tax = o.lines.filter(isTaxLine).reduce((a, l) => a + Math.round(l.each * l.qty * 100), 0);
        const total = Math.round(o.subtotal * 100);
        return [
          isoDate(new Date(o.createdAt)),
          o.number,
          whoOf(o),
          o.date,
          o.fulfillment,
          o.occasion ?? "",
          o.poNumber ?? "",
          o.lines.filter((l) => !isUntaxedLine(l)).map((l) => `${l.qty} x ${l.name}`).join("; "),
          csv$(total - tax),
          csv$(tax),
          csv$(total),
          csv$(payments(o).reduce((a, p) => a + p.totalCents, 0)),
          csv$((o.refunds ?? []).filter((r) => r.how !== "transfer").reduce((a, r) => a + r.cents, 0)),
          csv$(o.status === "canceled" ? 0 : Math.max(0, balanceCents(o))),
          o.account ? "yes" : "",
          o.status,
        ];
      }),
    );

  return (
    <div className="sheet" style={{ maxWidth: 860 }}>
      <p style={{ margin: "0 0 10px", fontSize: 15 }}>
        <strong>{site.shortName}</strong> · {view === "day" ? "End of day" : "End of month"} · <strong>{win.label}</strong>
        <span className="muted"> · printed {new Date().toLocaleString("en-US", { timeZone: site.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      </p>
      <p className="no-print" style={{ margin: "0 0 14px", display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14 }}>
        <span className="muted">For the books, as spreadsheet files:</span>
        <button type="button" onClick={downloadPayments} disabled={s.journal.length === 0} style={{ ...textButton, fontSize: 14 }}>
          Payments ({s.journal.length})
        </button>
        <button type="button" onClick={downloadRefunds} disabled={s.refundsList.length === 0} style={{ ...textButton, fontSize: 14 }}>
          Refunds ({s.refundsList.length})
        </button>
        <button type="button" onClick={downloadOrders} disabled={s.written.length === 0} style={{ ...textButton, fontSize: 14 }}>
          Orders written ({s.written.length})
        </button>
      </p>

      <Tiles
        items={[
          { label: "Taken", value: c$(s.takenCents), sub: view === "month" ? versus(s.takenCents, prev?.takenCents, prev?.label ?? "") ?? `${s.journal.length} payment${s.journal.length === 1 ? "" : "s"}` : `${s.journal.length} payment${s.journal.length === 1 ? "" : "s"}` },
          { label: "Given back", value: c$(s.backCents), sub: `${s.refundsList.length} refund${s.refundsList.length === 1 ? "" : "s"}` },
          { label: "Net", value: c$(s.takenCents - s.backCents), sub: "taken, less given back" },
          { label: "Orders written", value: String(written.length), sub: view === "month" ? versus(written.length, prev?.written, prev?.label ?? "") ?? `${c$(s.writtenCents)} in tickets` : `${c$(s.writtenCents)} in tickets` },
          { label: "Average order", value: written.length ? c$(Math.round(s.writtenCents / written.length)) : c$(0), sub: view === "month" ? `${c$(s.writtenCents)} in tickets` : undefined },
          ...(view === "day" && s.tomorrow
            ? [{ label: "Tomorrow", value: `${s.tomorrow.count} order${s.tomorrow.count === 1 ? "" : "s"}`, sub: s.tomorrow.count ? `${s.tomorrow.deliveries} deliver${s.tomorrow.deliveries === 1 ? "y" : "ies"}, ${s.tomorrow.count - s.tomorrow.deliveries} pickup${s.tomorrow.count - s.tomorrow.deliveries === 1 ? "" : "s"}` : "nothing on the board yet" }]
            : []),
          ...(view === "month" && busiestTaken > 0 ? [{ label: "Busiest day", value: dayAt(busiest.iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }), sub: `${c$(busiestTaken)} taken` }] : []),
        ]}
      />

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

        {view === "day" && <Drawer day={day} cashFromSales={s.cashToCount} checksCents={checksCents} />}

        {s.checks.length > 0 && (
          <Block title="Checks to deposit" note="Each check recorded in this window, in the order it was taken.">
            <Rows
              rows={s.checks.map((k) => [`${k.who} · ${k.numbers.join(", ")}`, c$(k.cents), k.checkNumber ? `check #${k.checkNumber}` : "no check number written"] as [string, string, string])}
              total={[`${s.checks.length} check${s.checks.length === 1 ? "" : "s"}`, c$(checksCents)]}
            />
          </Block>
        )}

        <Block title="Money out" note="A refund is recorded on the order's card or its finished row, and that record is what is counted here. Money moved from one order to another of the same customer is not money out and is left off. A refund that leaves the ticket as written does not change the sales tax figures on this sheet; if tax went back with it, adjust the return by hand.">
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
          <Rows rows={taxRows(s.taxPaid)} total={taxTotal(s.taxPaid)} />
        </Block>

        <Block
          title={`Sales tax · orders written ${view === "day" ? "today" : "this month"}`}
          note={`${s.taxWritten.count} order${s.taxWritten.count === 1 ? "" : "s"} were written in this window, paid or not (the accrual basis). Use one basis or the other for the return, not both.`}
        >
          <Rows rows={taxRows(s.taxWritten)} total={taxTotal(s.taxWritten)} />
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

        {/* THE DAY, LINE BY LINE: what the totals above are made of, to lay
            beside Square's own list and the deposit slip. */}
        {view === "day" && (
          <Block title="Every payment today" note="In the order it was taken. The lines add up to Taken." wide>
            {s.journal.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nothing taken.</p>
            ) : (
              <Scroll label="Payments today">
                <table style={{ ...table, minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th style={thL}>Time</th>
                      <th style={thL}>Order</th>
                      <th style={thL}>Customer</th>
                      <th style={thL}>How</th>
                      <th style={thR}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.journal.map((j, i) => (
                      <tr key={i}>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{clock(j.at)}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{j.number}</td>
                        <td style={td}>{j.who}</td>
                        <td style={td}>{j.how}</td>
                        <td style={tdR}>{c$(j.cents)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={tdTotal} colSpan={4}>Taken</td>
                      <td style={tdTotalR}>{c$(s.takenCents)}</td>
                    </tr>
                  </tbody>
                </table>
              </Scroll>
            )}
          </Block>
        )}

        {s.refundsList.length > 0 && (
          <Block title={view === "day" ? "Every refund today" : "Every refund this month"} note="With what each was for, as it was recorded. The lines add up to Money out." wide>
            <Scroll label="Refunds">
              <table style={{ ...table, minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={thL}>When</th>
                    <th style={thL}>Order</th>
                    <th style={thL}>Customer</th>
                    <th style={thL}>How it went back</th>
                    <th style={thL}>What for</th>
                    <th style={thR}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {s.refundsList.map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{view === "day" ? clock(r.at) : dayShort(r.at)}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{r.number}</td>
                      <td style={td}>{r.who}</td>
                      <td style={td}>{r.how}</td>
                      <td style={td}>{r.reason}</td>
                      <td style={tdR}>{c$(r.cents)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={tdTotal} colSpan={5}>Given back</td>
                    <td style={tdTotalR}>{c$(s.backCents)}</td>
                  </tr>
                </tbody>
              </table>
            </Scroll>
          </Block>
        )}

        {view === "day" && s.stillOpenList.length > 0 && (
          <Block title="Not out the door yet" note="Today's work that is not finished, so nothing is left behind at closing.">
            <Rows rows={s.stillOpenList.map((o) => [`${o.number} · ${whoOf(o)}`, statusWord[o.status] ?? o.status, o.fulfillment === "delivery" ? `delivery${o.recipient ? ` to ${o.recipient}` : ""}` : "pickup"] as [string, string, string])} />
          </Block>
        )}

        {view === "day" && s.owedOut.length > 0 && (
          <Block title="Out the door, not paid" note="Finished orders with money still to collect that are not on a house account, whatever day they went out.">
            <Rows
              rows={s.owedOut.slice(0, 30).map((o) => [`${o.number} · ${whoOf(o)}`, c$(owedNowCents(o)), `${o.date}${o.phone ? ` · ${o.phone}` : ""}`] as [string, string, string])}
              total={[`${s.owedOut.length} order${s.owedOut.length === 1 ? "" : "s"}`, c$(s.owedOut.reduce((a, o) => a + owedNowCents(o), 0))]}
            />
          </Block>
        )}
      </div>

      {view === "month" && (
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", marginTop: 14 }}>
          <Block title="By day" note="Card includes the website, the board and the register. Every payment is in the Payments file above." wide>
            <Scroll label="The month by day">
              <table style={{ ...table, minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={thL}>Day</th>
                    <th style={thR}>Orders</th>
                    <th style={thR}>Card</th>
                    <th style={thR}>Cash</th>
                    <th style={thR}>Checks</th>
                    <th style={thR}>By hand</th>
                    <th style={thR}>Given back</th>
                    <th style={thR}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {s.perDay.filter((d) => d.iso <= todayISO()).map((d) => (
                    <tr key={d.iso}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{dayAt(d.iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</td>
                      <td style={tdR}>{d.written || ""}</td>
                      <td style={tdR}>{d.card ? c$(d.card) : ""}</td>
                      <td style={tdR}>{d.cash ? c$(d.cash) : ""}</td>
                      <td style={tdR}>{d.check ? c$(d.check) : ""}</td>
                      <td style={tdR}>{d.other ? c$(d.other) : ""}</td>
                      <td style={tdR}>{d.back ? c$(d.back) : ""}</td>
                      <td style={tdR}>{d.card || d.cash || d.check || d.other || d.back ? c$(d.card + d.cash + d.check + d.other - d.back) : ""}</td>
                    </tr>
                  ))}
                  <tr>
                    <td style={tdTotal}>Month</td>
                    <td style={tdTotalR}>{s.written.length}</td>
                    <td style={tdTotalR}>{c$(s.perDay.reduce((a, d) => a + d.card, 0))}</td>
                    <td style={tdTotalR}>{c$(s.perDay.reduce((a, d) => a + d.cash, 0))}</td>
                    <td style={tdTotalR}>{c$(s.perDay.reduce((a, d) => a + d.check, 0))}</td>
                    <td style={tdTotalR}>{c$(s.perDay.reduce((a, d) => a + d.other, 0))}</td>
                    <td style={tdTotalR}>{c$(s.backCents)}</td>
                    <td style={tdTotalR}>{c$(s.takenCents - s.backCents)}</td>
                  </tr>
                </tbody>
              </table>
            </Scroll>
          </Block>

          {s.agingAccounts.length > 0 && (
            <Block title="Who owes, by age" note="Each house account's open orders by the order's date, oldest money to the right. The one to call first is at the top." wide>
              <Scroll label="Accounts by age">
                <table style={{ ...table, minWidth: 560 }}>
                  <thead>
                    <tr>
                      <th style={thL}>Account</th>
                      <th style={thR}>Up to 30</th>
                      <th style={thR}>31 to 60</th>
                      <th style={thR}>61 to 90</th>
                      <th style={thR}>Over 90</th>
                      <th style={thR}>Owes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.agingAccounts.map((a) => (
                      <tr key={a.key}>
                        <td style={td}>{a.label}</td>
                        {a.buckets.map((b, i) => (
                          <td key={i} style={tdR}>{b ? c$(b) : ""}</td>
                        ))}
                        <td style={{ ...tdR, fontWeight: 700 }}>{c$(a.total)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td style={tdTotal}>All accounts</td>
                      {s.aging.map((b, i) => (
                        <td key={i} style={tdTotalR}>{c$(b)}</td>
                      ))}
                      <td style={tdTotalR}>{c$(s.owedNow)}</td>
                    </tr>
                  </tbody>
                </table>
              </Scroll>
            </Block>
          )}

          <Block title="Sales by category" note="Ticket lines of the month's dated orders, before tax; canceled orders left out.">
            <Rows rows={s.byCategory.map(([k, v]) => [k, c$(v)] as [string, string])} total={["Items and delivery", c$(s.byCategory.reduce((a, [, v]) => a + v, 0))]} />
          </Block>
          <Block title="Best sellers">
            <Rows rows={s.topProducts.map((p) => [p.name, c$(p.cents), `${p.qty} sold`] as [string, string, string])} />
          </Block>
          <Block title="What the flowers were for" note="The month's dated orders by the occasion on the order, before tax.">
            <Rows rows={s.byOccasion.map((x) => [x.label, c$(x.cents), `${x.count} order${x.count === 1 ? "" : "s"}`] as [string, string, string])} />
          </Block>
          <Block title="How the orders came in" note="Orders written this month, canceled ones left out, at their ticket totals.">
            <Rows rows={s.bySource.map((x) => [x.label, c$(x.cents), `${x.count} order${x.count === 1 ? "" : "s"}`] as [string, string, string])} total={["Orders written", c$(s.writtenCents)]} />
          </Block>
        </div>
      )}
      <p className="muted" style={{ margin: "14px 0 0", fontSize: 13 }}>
        Every figure here is derived from the board&rsquo;s orders and the Square rings it has seen since launch; nothing is estimated. Square&rsquo;s own reports remain the record for processing fees and deposits. Taken is gross of refunds; Net takes them off.
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
 * what was counted. Those are typed here, kept per day, and the block
 * says over or short. It prints with the sheet.
 *
 * AND THE DEPOSIT (2026-11-10): what is left in the drawer for tomorrow
 * makes the rest the cash to bank, and with the day's checks that is the
 * deposit slip's total. What was left becomes the next day's opening
 * float by itself, so the morning starts where the night ended.
 */
type DrawerCount = { day: string; openingCents: number; addedCents: number; removedCents: number; countedCents: number | null; leftCents?: number | null; note: string; by: string; at: number };
const amt = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));

function Drawer({ day, cashFromSales, checksCents }: { day: string; cashFromSales: number; checksCents: number }) {
  const [saved, setSaved] = useState<DrawerCount | null>(null);
  const [opening, setOpening] = useState("");
  const [added, setAdded] = useState("");
  const [removed, setRemoved] = useState("");
  const [counted, setCounted] = useState("");
  const [left, setLeft] = useState("");
  const [note, setNote] = useState("");
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  /** The day the opening float was carried from, when it was. */
  const [carried, setCarried] = useState("");

  useEffect(() => {
    let dead = false;
    setLoaded(false);
    setError("");
    // Another day: nothing of the last one stays in the boxes, whether or
    // not this day's count arrives.
    setSaved(null);
    setOpening("");
    setAdded("");
    setRemoved("");
    setCounted("");
    setLeft("");
    setNote("");
    setBy("");
    setCarried("");
    fetch(`/api/workroom/drawer?day=${day}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (dead) return;
        const c = (d?.count as DrawerCount | null) ?? null;
        const before = (d?.prev as DrawerCount | null) ?? null;
        setSaved(c);
        if (c) {
          setOpening(amt(c.openingCents));
          setAdded(c.addedCents ? amt(c.addedCents) : "");
          setRemoved(c.removedCents ? amt(c.removedCents) : "");
          setCounted(amt(c.countedCents));
          setLeft(amt(c.leftCents));
          setNote(c.note ?? "");
          setBy(c.by ?? "");
        } else if (before) {
          // No count for this day yet: it opens with what the last counted
          // day left in the drawer (or, if that was not said, its float).
          setOpening(amt(before.leftCents ?? before.openingCents));
          setCarried(before.day);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (!dead) setLoaded(true);
      });
    return () => {
      dead = true;
    };
  }, [day]);

  // A blank box is zero, except the count and what is left: blank means not said yet.
  const read = (v: string) => (v.trim() === "" ? 0 : parseDollars(v));
  const o = read(opening);
  const a = read(added);
  const r = read(removed);
  const k = counted.trim() === "" ? null : parseDollars(counted);
  const l = left.trim() === "" ? null : parseDollars(left);
  const bad = o === null || a === null || r === null || (counted.trim() !== "" && k === null) || (left.trim() !== "" && l === null);
  const expected = (o ?? 0) + (a ?? 0) - (r ?? 0) + cashFromSales;
  const diff = k === null ? null : k - expected;
  const leftTooMuch = k !== null && l !== null && l > k;
  const cashDeposit = k !== null && l !== null && !leftTooMuch ? k - l : null;

  async function save() {
    if (bad) return setError("One of the amounts did not read as money. Use figures like 150 or 150.00.");
    if (leftTooMuch) return setError("More is being left in the drawer than was counted. Check the two figures.");
    if (!isInitials(by)) return setError("Your initials, two or three letters, so the count has a name on it.");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/workroom/drawer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, openingCents: o, addedCents: a, removedCents: r, countedCents: k, leftCents: l, note, by: by.trim().toUpperCase(), baseAt: saved?.at ?? null }),
      });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; count?: DrawerCount; error?: string } | null;
      if (!res.ok || !d?.ok) setError(d?.error || "The count did not save.");
      else {
        setSaved(d.count ?? null);
        setCarried("");
      }
    } catch {
      setError("The connection dropped. The count is still in the boxes; save it again.");
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = { ...field, width: 110, padding: "6px 10px" };
  const line: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 14.5 };
  const figure: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
  return (
    <Block
      title="The drawer"
      note="Opening float plus cash put in, less cash taken out, plus the cash from the day's sales, is what the drawer should hold. Count it and the sheet says over or short. Say what stays in the drawer and the rest is the cash to bank; it becomes tomorrow's opening float."
    >
      {!loaded ? (
        <p className="muted" style={{ margin: 0 }}>Reading the count…</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          <label style={line}>
            Opening float (the cash it started with)
            <input value={opening} onChange={(e) => { setOpening(e.target.value); setCarried(""); }} inputMode="decimal" placeholder="0.00" aria-label="Opening float, in dollars" style={box} />
          </label>
          {carried && (
            <p className="muted" style={{ margin: "-4px 0 0", fontSize: 13 }}>
              Carried from the count on {dayAt(carried).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}. Change it if the drawer started with something else.
            </p>
          )}
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
            <span style={figure}>{c$(cashFromSales)}</span>
          </div>
          <div style={{ ...line, fontWeight: 700, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            <span>The drawer should hold</span>
            <span style={figure}>{bad ? "…" : c$(expected)}</span>
          </div>
          <label style={line}>
            Counted at close
            <input value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="decimal" placeholder="not counted yet" aria-label="Cash counted at close, in dollars" style={box} />
          </label>
          {diff !== null && !bad && (
            <div role="status" style={{ ...line, fontWeight: 700, color: diff === 0 ? "var(--green)" : "var(--rose-ink)" }}>
              <span>{diff === 0 ? "The drawer balances" : diff > 0 ? "Over" : "Short"}</span>
              <span style={figure}>{diff === 0 ? c$(0) : c$(Math.abs(diff))}</span>
            </div>
          )}
          <label style={{ ...line, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
            Leaving in the drawer for tomorrow
            <input value={left} onChange={(e) => setLeft(e.target.value)} inputMode="decimal" placeholder="not said yet" aria-label="Cash left in the drawer for tomorrow, in dollars" style={box} />
          </label>
          {cashDeposit !== null && !bad && (
            <>
              <div style={line}>
                <span>Cash to bank</span>
                <span style={figure}>{c$(cashDeposit)}</span>
              </div>
              {checksCents > 0 && (
                <div style={line}>
                  <span>Checks to bank</span>
                  <span style={figure}>{c$(checksCents)}</span>
                </div>
              )}
              <div role="status" style={{ ...line, fontWeight: 700 }}>
                <span>The deposit</span>
                <span style={figure}>{c$(cashDeposit + checksCents)}</span>
              </div>
            </>
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
