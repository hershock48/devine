"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryWarning, PinGate, money, todayISO } from "@/components/workroom/ui";

/**
 * THE DASHBOARD. Grown out of the "This week" screen after Kevin's second
 * critique: right numbers, wrong shape. Too many sentences, one fixed window,
 * and it lived behind a tab while the board got the front door. This is the
 * so-what promoted to the landing page, rebuilt on how the tools she already
 * reads do it (Square's own app leads with gross sales, transactions,
 * average sale; Stripe and Toast lead with a stat row and one trend chart):
 *
 *   - One range control governs the whole page: Day, Week, Month, Year,
 *     with arrows to step back through past windows.
 *   - A stat row, then one chart, then the florist-native sections. No
 *     paragraphs on the face; where a number comes from lives in one
 *     closed-by-default note at the bottom.
 *   - Every comparison is like-for-like: a Tuesday compares to LAST Tuesday
 *     (retail lives on weekday rhythm, Square aligns its comparisons the
 *     same way), a half-done month to the same days of last month, never a
 *     partial window against a full one. The one caption under the range
 *     control names the basis; the delta chips stay bare.
 *   - Register money comes from /api/workroom/summary, which asks Square's
 *     Payments API directly when the register link is live, so Month and
 *     Year show her real history including sales that predate the webhook.
 *     Orders and stems are ours alone; Square has never heard of them.
 *
 * DERIVED, NEVER STORED, still: every figure is recomputed on load from
 * ledgers someone typed or Square reported. Where a number cannot be known
 * it is counted and named, never guessed.
 *
 * MONEY DOUBLE-COUNT GUARD, still: board orders paid by card or cash ARE
 * Square payments, so Taken sums the register once and adds only hand-marked
 * payments, which never reached Square.
 *
 * Values sit in the sans, not the site serif: a dashboard number is a
 * reading, not a headline, and the serif's old-style figures wobble in a
 * stat row (the dataviz house rule agrees: hero figures in the working
 * face).
 */

type StemEvent = { id: string; kind: "purchase" | "shrink"; date: string; variety: string; stems: number; cost: number; reason: string };
type Recipe = { slug: string; parts: { variety: string; stems: number }[] };
type OrderPayment = { at: number; method: string; totalCents: number; feeCents: number };
type OrderLine = { slug: string | null; name: string; qty: number; each: number };
type Order = {
  id: string;
  source: "web" | "phone";
  status: string;
  fulfillment: "delivery" | "pickup";
  date: string;
  occasion: string;
  phone: string;
  email: string;
  lines: OrderLine[];
  subtotal: number;
  createdAt: number;
  payment?: OrderPayment | null;
};
type SaleLine = { slug: string | null; name: string; qty: number; eachCents: number; totalCents: number };
type Sale = { id: string; paidAt: string; source: string; totalCents: number; createdAt: number; workroomOrderId?: string; lines: SaleLine[] };
type Contact = { name: string; phone: string; email: string; createdAt: number };

type Summary = {
  source: "square" | "stored";
  truncated: boolean;
  current: { totalCents: number; count: number; cashCents: number; buckets: number[] };
  previous: { totalCents: number; count: number; cashCents: number };
};

type Range = "day" | "week" | "month" | "year";

const phoneKey = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Whole dollars on tiles; cents stay in tooltips and the table (Square's
    own widget rounds the same way). */
const wholeDollars = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const centsDollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The reporting window for (range, back), on this device's own calendar
 * (the todayISO rule: today means today in Marshall). All arithmetic goes
 * through Date parts, never raw day-lengths, so DST cannot shear an edge.
 *
 * prevBegin/prevEnd is the comparison window: the same window one beat
 * earlier (a day compares 7 days back, to the same weekday). When the
 * current window is still running, prevEnd is cut to the same elapsed
 * point, so a Tuesday morning never loses to a whole last week.
 */
function makeWindow(range: Range, back: number) {
  const now = new Date(todayISO() + "T12:00:00");
  now.setTime(Date.now());
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  let begin: Date;
  let end: Date;
  let prevBegin: Date;
  let prevEnd: Date;
  const edges: number[] = [];

  if (range === "day") {
    begin = new Date(y, m, d - back);
    end = new Date(y, m, d - back + 1);
    prevBegin = new Date(y, m, d - back - 7);
    prevEnd = new Date(y, m, d - back - 6);
    for (let h = 0; h <= 24; h++) edges.push(new Date(begin.getFullYear(), begin.getMonth(), begin.getDate(), h).getTime());
  } else if (range === "week") {
    const dow = (now.getDay() + 6) % 7; // Monday = 0
    begin = new Date(y, m, d - dow - back * 7);
    end = new Date(begin.getFullYear(), begin.getMonth(), begin.getDate() + 7);
    prevBegin = new Date(begin.getFullYear(), begin.getMonth(), begin.getDate() - 7);
    prevEnd = new Date(begin.getFullYear(), begin.getMonth(), begin.getDate());
    for (let i = 0; i <= 7; i++) edges.push(new Date(begin.getFullYear(), begin.getMonth(), begin.getDate() + i).getTime());
  } else if (range === "month") {
    begin = new Date(y, m - back, 1);
    end = new Date(y, m - back + 1, 1);
    prevBegin = new Date(y, m - back - 1, 1);
    prevEnd = new Date(y, m - back, 1);
    const days = Math.round((end.getTime() - begin.getTime()) / 86_400_000);
    for (let i = 0; i <= days; i++) edges.push(new Date(begin.getFullYear(), begin.getMonth(), 1 + i).getTime());
  } else {
    begin = new Date(y - back, 0, 1);
    end = new Date(y - back + 1, 0, 1);
    prevBegin = new Date(y - back - 1, 0, 1);
    prevEnd = new Date(y - back, 0, 1);
    for (let i = 0; i <= 12; i++) edges.push(new Date(begin.getFullYear(), i, 1).getTime());
  }

  const nowMs = Date.now();
  const partial = back === 0 && nowMs < end.getTime();
  const prevEndMs = partial
    ? Math.min(prevEnd.getTime(), prevBegin.getTime() + (nowMs - begin.getTime()))
    : prevEnd.getTime();

  return {
    beginMs: begin.getTime(),
    endMs: end.getTime(),
    prevBeginMs: prevBegin.getTime(),
    prevEndMs,
    edges,
    partial,
    begin,
    prevBegin,
  };
}

type Win = ReturnType<typeof makeWindow>;

function windowLabel(range: Range, back: number, w: Win): string {
  const b = w.begin;
  if (range === "day") {
    if (back === 0) return "Today";
    if (back === 1) return "Yesterday";
    return `${DAYS[b.getDay()]}, ${MONTHS[b.getMonth()].slice(0, 3)} ${b.getDate()}`;
  }
  if (range === "week") {
    const e = new Date(b.getFullYear(), b.getMonth(), b.getDate() + 6);
    const same = b.getMonth() === e.getMonth();
    return `${MONTHS[b.getMonth()].slice(0, 3)} ${b.getDate()} to ${same ? "" : MONTHS[e.getMonth()].slice(0, 3) + " "}${e.getDate()}`;
  }
  if (range === "month") return `${MONTHS[b.getMonth()]} ${b.getFullYear()}`;
  return String(b.getFullYear());
}

function comparisonLabel(range: Range, w: Win): string {
  const tail = w.partial ? " to this point" : "";
  if (range === "day") return `Compared with last ${DAYS[w.begin.getDay()]}${tail}.`;
  if (range === "week") return `Compared with the week before${tail}.`;
  if (range === "month") return `Compared with ${MONTHS[w.prevBegin.getMonth()]}${tail}.`;
  return `Compared with ${w.prevBegin.getFullYear()}${tail}.`;
}

/** Bucket names for the chart's tooltips, table, and sparse axis. */
function bucketLabels(range: Range, w: Win): { all: string[]; axis: (i: number) => string } {
  if (range === "day") {
    const all = Array.from({ length: 24 }, (_, h) => {
      const t = h % 12 === 0 ? 12 : h % 12;
      return `${t}${h < 12 ? "a" : "p"}`;
    });
    return { all, axis: (i) => (i % 6 === 0 ? all[i] : "") };
  }
  if (range === "week") {
    const all = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(w.begin.getFullYear(), w.begin.getMonth(), w.begin.getDate() + i);
      return `${DAYS[d.getDay()].slice(0, 3)} ${d.getDate()}`;
    });
    return { all, axis: (i) => all[i].slice(0, 3) };
  }
  if (range === "month") {
    const n = w.edges.length - 1;
    const all = Array.from({ length: n }, (_, i) => `${MONTHS[w.begin.getMonth()].slice(0, 3)} ${i + 1}`);
    return { all, axis: (i) => (i % 7 === 0 ? String(i + 1) : "") };
  }
  const all = MONTHS.map((mo) => mo.slice(0, 3));
  return { all, axis: (i) => all[i][0] };
}

/**
 * The y axis ceiling, in cents, chosen so the three ticks (0, half, max) are
 * all clean whole dollars: 10, 20, 50, 100, 200, 500... and never below $10.
 * Halves of that sequence are 5, 10, 25, 50, whole dollars every one; a
 * 1-2-5 ladder starting lower produced a "$0 / $1 / $1" axis on a quiet day
 * (half of 100 cents, rounded).
 */
function niceMax(maxCents: number): number {
  let d = 10;
  const step = [2, 2.5, 2];
  for (let i = 0; d * 100 < maxCents && i < 40; i++) d *= step[i % 3];
  return d * 100;
}

/* ------------------------------------------------------------------ */

export default function Dashboard({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [events, setEvents] = useState<StemEvent[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [backend, setBackend] = useState("memory");
  const [range, setRange] = useState<Range>("week");
  const [back, setBack] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  const win = useMemo(() => makeWindow(range, back), [range, back]);

  const pull = useCallback(async () => {
    const [s, o] = await Promise.all([
      fetch("/api/workroom/stems?days=400", { cache: "no-store" }),
      fetch("/api/workroom/orders?days=400", { cache: "no-store" }),
    ]);
    if (s.status === 401 || o.status === 401) {
      setAuthed(false);
      return;
    }
    const sd = await s.json();
    const od = await o.json();
    setEvents(sd.events ?? []);
    setRecipes(sd.recipes ?? []);
    setSales(sd.squareSales ?? []);
    setOrders(od.orders ?? []);
    setContacts(od.contacts ?? []);
    setBackend(sd.backend ?? "memory");
    setAuthed(true);
  }, []);

  // Refetch keeps the frame: the old numbers hold, dimmed, while the new
  // window loads, so stepping ranges never flashes an empty page.
  const summarySeq = useRef(0);
  const pullSummary = useCallback(async (w: Win) => {
    const seq = ++summarySeq.current;
    setLoadingSummary(true);
    const q = new URLSearchParams({
      begin: String(w.beginMs),
      end: String(w.endMs),
      prevBegin: String(w.prevBeginMs),
      prevEnd: String(w.prevEndMs),
      edges: w.edges.join(","),
    });
    try {
      const r = await fetch(`/api/workroom/summary?${q}`, { cache: "no-store" });
      if (r.status === 401) {
        setAuthed(false);
        return;
      }
      const data = (await r.json()) as Summary;
      if (seq === summarySeq.current) setSummary(data);
    } finally {
      if (seq === summarySeq.current) setLoadingSummary(false);
    }
  }, []);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
  }, [authed, pull]);

  useEffect(() => {
    if (!authed) return;
    pullSummary(win).catch(() => setLoadingSummary(false));
  }, [authed, win, pullSummary]);

  // A counter screen sits open all day; a gentle refresh keeps "Today"
  // honest without anyone thinking to reload.
  useEffect(() => {
    if (!authed || back !== 0) return;
    const t = setInterval(() => {
      pull().catch(() => {});
      pullSummary(makeWindow(range, 0)).catch(() => {});
    }, 90_000);
    return () => clearInterval(t);
  }, [authed, back, range, pull, pullSummary]);

  /* ---------------- the florist-side arithmetic ---------------- */

  const view = useMemo(() => {
    const recipeBySlug = new Map(recipes.map((r) => [r.slug, r]));

    // Cost per stem per variety from the whole loaded purchase history, so
    // a toss can be priced even when the buy was weeks earlier.
    const costAgg = new Map<string, { stems: number; cost: number }>();
    for (const e of events) {
      if (e.kind !== "purchase") continue;
      const c = costAgg.get(e.variety) ?? { stems: 0, cost: 0 };
      c.stems += e.stems;
      c.cost += e.cost;
      costAgg.set(e.variety, c);
    }
    const costPerStem = (variety: string): number | null => {
      const c = costAgg.get(variety);
      return c && c.stems > 0 ? c.cost / c.stems : null;
    };

    const saleMs = (s: Sale) => (Number.isFinite(Date.parse(s.paidAt)) ? Date.parse(s.paidAt) : s.createdAt);

    const calc = (beginMs: number, endMs: number) => {
      const fromISO = iso(new Date(beginMs));
      const toISO = iso(new Date(endMs - 1));
      const inMs = (ms: number) => ms >= beginMs && ms < endMs;
      const inDates = (dateISO: string) => dateISO >= fromISO && dateISO <= toISO;

      /* money the register never saw */
      const handMarked = orders.filter((o) => o.payment && o.payment.method === "other" && inMs(o.payment.at));
      const handMarkedCents = handMarked.reduce((sum, o) => sum + (o.payment?.totalCents ?? 0), 0);
      const feeCents = orders
        .filter((o) => o.payment && inMs(o.payment.at))
        .reduce((sum, o) => sum + (o.payment?.feeCents ?? 0), 0);

      /* orders */
      const ordersIn = orders.filter((o) => inMs(o.createdAt) && o.status !== "canceled");
      const orderedCents = ordersIn.reduce((sum, o) => sum + Math.round(o.subtotal * 100), 0);
      const web = ordersIn.filter((o) => o.source === "web").length;
      const delivery = ordersIn.filter((o) => o.fulfillment === "delivery").length;
      const occasions = new Map<string, number>();
      for (const o of ordersIn) {
        const k = o.occasion || "not given";
        occasions.set(k, (occasions.get(k) ?? 0) + 1);
      }
      let returning = 0;
      for (const o of ordersIn) {
        const pk = phoneKey(o.phone);
        const ek = o.email.trim().toLowerCase();
        if (contacts.some((c) => c.createdAt < o.createdAt && ((pk && phoneKey(c.phone) === pk) || (ek && c.email.trim().toLowerCase() === ek)))) {
          returning += 1;
        }
      }
      const leads = ordersIn
        .map((o) => Math.round((new Date(o.date + "T12:00:00").getTime() - o.createdAt) / 86_400_000))
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b);
      const leadMedian = leads.length ? leads[Math.floor(leads.length / 2)] : null;

      /* best sellers: ticket lines plus item-rung counter sales (linked
         sales skipped; their lines are the ticket's lines) */
      const counter = sales.filter((s) => !s.workroomOrderId && inMs(saleMs(s)));
      const sold = new Map<string, { qty: number; cents: number }>();
      const add = (name: string, qty: number, cents: number) => {
        const row = sold.get(name) ?? { qty: 0, cents: 0 };
        row.qty += qty;
        row.cents += cents;
        sold.set(name, row);
      };
      for (const o of ordersIn) for (const l of o.lines) add(l.name, l.qty, Math.round(l.each * 100) * l.qty);
      for (const s of counter) for (const l of s.lines) add(l.name, l.qty, l.totalCents);
      const bestSellers = [...sold.entries()]
        .filter(([name]) => name && name !== "(unnamed)" && name !== "Order fee" && name !== "Service fee" && !name.startsWith("Delivery ("))
        .sort((a, b) => b[1].cents - a[1].cents)
        .slice(0, 5);

      /* stems */
      const eventsIn = events.filter((e) => inDates(e.date));
      const bought = eventsIn.filter((e) => e.kind === "purchase");
      const tossed = eventsIn.filter((e) => e.kind === "shrink");
      const boughtStems = bought.reduce((sum, e) => sum + e.stems, 0);
      const boughtCost = bought.reduce((sum, e) => sum + e.cost, 0);
      const tossedStems = tossed.reduce((sum, e) => sum + e.stems, 0);
      let tossedCost = 0;
      let unpricedTossed = 0;
      for (const e of tossed) {
        const per = costPerStem(e.variety);
        if (per === null) unpricedTossed += e.stems;
        else tossedCost += per * e.stems;
      }
      const reasons = new Map<string, number>();
      for (const e of tossed) reasons.set(e.reason || "other", (reasons.get(e.reason || "other") ?? 0) + e.stems);

      let consumedStems = 0;
      let unreciped = 0;
      const consume = (slug: string | null, qty: number) => {
        const r = slug ? recipeBySlug.get(slug) : undefined;
        if (!r) {
          unreciped += 1;
          return;
        }
        for (const part of r.parts) consumedStems += part.stems * qty;
      };
      for (const o of orders) {
        if (o.status !== "made" && o.status !== "out" && o.status !== "done") continue;
        if (!inDates(o.date)) continue;
        for (const l of o.lines) consume(l.slug, l.qty);
      }
      for (const s of sales) {
        if (s.workroomOrderId) continue;
        if (!inMs(saleMs(s))) continue;
        for (const l of s.lines) consume(l.slug, l.qty);
      }

      return {
        handMarkedCount: handMarked.length, handMarkedCents, feeCents,
        ordersCount: ordersIn.length, orderedCents,
        web, phone: ordersIn.length - web, delivery, pickup: ordersIn.length - delivery,
        topOccasions: [...occasions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
        returning, leadMedian, bestSellers,
        boughtStems, boughtCost, tossedStems, tossedCost, unpricedTossed,
        topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
        consumedStems, unreciped,
        shrinkPct: boughtStems > 0 ? Math.round((tossedStems / boughtStems) * 100) : null,
      };
    };

    const now = calc(win.beginMs, win.endMs);
    const prev = calc(win.prevBeginMs, win.prevEndMs);

    // Owed is NOW, never windowed: money owed does not care which week it
    // started being owed in.
    const owed = orders.filter((o) => o.status === "done" && !o.payment);
    const owedCents = owed.reduce((sum, o) => sum + Math.round(o.subtotal * 100), 0);

    return { now, prev, owedCount: owed.length, owedCents };
  }, [events, recipes, orders, sales, contacts, win]);

  /* ---------------- small parts ---------------- */

  /** Arrow + percent, colored by direction times whether up is good, with
      the prior value beside it so the baseline is on the tile (Kevin's
      rule: a figure without a baseline is trivia). Shape carries the sign
      too, never color alone. */
  const delta = (cur: number, prevV: number, opts?: { badUp?: boolean; fmt?: (n: number) => string }) => {
    const fmt = opts?.fmt ?? ((n: number) => String(n));
    if (prevV <= 0) {
      return <span style={{ fontSize: 13, color: "var(--muted)" }}>was {fmt(prevV)}</span>;
    }
    const pct = Math.round(((cur - prevV) / prevV) * 100);
    const up = pct > 0;
    const flat = pct === 0;
    const good = flat ? null : opts?.badUp ? !up : up;
    const color = flat ? "var(--muted)" : good ? "var(--green)" : "var(--rose-ink)";
    return (
      <span style={{ fontSize: 13, color: "var(--muted)" }}>
        <span style={{ color, fontWeight: 700 }}>
          {flat ? "" : up ? "▲ " : "▼ "}
          {flat ? "even" : `${Math.abs(pct) > 999 ? ">999" : Math.abs(pct)}%`}
        </span>
        {" · "}{fmt(prevV)}
      </span>
    );
  };

  const tile = (label: string, value: string, sub?: React.ReactNode, deltaNode?: React.ReactNode, hero?: boolean) => (
    <div className="panel" style={{ padding: "14px 16px", minWidth: 0 }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: hero ? 38 : 27, fontWeight: 600, fontFamily: "var(--sans)", lineHeight: 1.15, margin: "4px 0 2px" }}>{value}</div>
      {deltaNode && <div>{deltaNode}</div>}
      {sub && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const sectionHead = (label: string, href?: string, linkText?: string) => (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "30px 0 10px" }}>
      <h2 style={{ fontFamily: "var(--sans)", fontSize: 14.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: 0 }}>
        {label}
      </h2>
      {href && (
        <a href={href} style={{ fontSize: 13.5, padding: "4px 0" }}>
          {linkText} <span aria-hidden="true">&rsaquo;</span>
        </a>
      )}
    </div>
  );

  if (!authed) {
    return (
      <>
        <h1>Dashboard</h1>
        <PinGate onAuthed={() => pull().catch(() => {})} />
      </>
    );
  }

  const { now, prev } = view;
  const cur = summary?.current;
  const prv = summary?.previous;
  const takenCents = (cur?.totalCents ?? 0) + now.handMarkedCents;
  const prevTakenCents = (prv?.totalCents ?? 0) + prev.handMarkedCents;
  const avgCents = cur && cur.count > 0 ? Math.round(cur.totalCents / cur.count) : null;
  const prevAvgCents = prv && prv.count > 0 ? Math.round(prv.totalCents / prv.count) : 0;

  /* auto-fit, not auto-fill: a four-tile row should fill its band, not
     leave a phantom fifth column of air on a desktop. */
  const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))" };
  const quiet = now.ordersCount === 0 && takenCents === 0 && now.boughtStems === 0 && (cur?.count ?? 0) === 0;

  /* chart geometry. The buckets are sliced to the window's label count:
     while a range change is refetching, the held summary still carries the
     OLD window's buckets (24 hours against 12 months once crashed the page
     on an out-of-range label), and the dimmed stale frame only has to look
     right, never to line up. */
  const labels = bucketLabels(range, win);
  const buckets = (cur?.buckets ?? []).slice(0, labels.all.length);
  const maxCents = niceMax(Math.max(0, ...buckets));
  const CW = 720;
  const CH = 150;
  const PADL = 44;
  const PADB = 20;
  const plotW = CW - PADL - 6;
  const plotH = CH - PADB - 8;
  const slot = buckets.length > 0 ? plotW / buckets.length : plotW;
  const barW = Math.min(24, Math.max(3, slot - 4));

  return (
    <>
      <h1 style={{ fontSize: "clamp(26px, 3vw, 34px)", marginBottom: 8 }}>Dashboard</h1>
      <MemoryWarning backend={backend} />

      {/* One range control governs everything below it. */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", margin: "0 0 4px" }}>
        <div role="group" aria-label="Range" style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 3, overflow: "hidden" }}>
          {(["day", "week", "month", "year"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => {
                setRange(r);
                setBack(0);
              }}
              style={{
                font: "inherit", fontSize: 13.5, fontWeight: range === r ? 700 : 400, cursor: "pointer",
                border: 0, padding: "7px 13px",
                background: range === r ? "var(--ink)" : "var(--paper)",
                color: range === r ? "var(--paper)" : "var(--ink)",
              }}
            >
              {r === "day" ? "Day" : r === "week" ? "Week" : r === "month" ? "Month" : "Year"}
            </button>
          ))}
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <button type="button" aria-label={`Previous ${range}`} onClick={() => setBack((b) => b + 1)}
            style={{ font: "inherit", fontSize: 17, border: 0, background: "none", cursor: "pointer", padding: "4px 8px", color: "var(--ink)" }}>
            &lsaquo;
          </button>
          <span style={{ fontWeight: 700, fontSize: 15.5, minWidth: 90, textAlign: "center" }}>{windowLabel(range, back, win)}</span>
          <button type="button" aria-label={`Next ${range}`} onClick={() => setBack((b) => Math.max(0, b - 1))} disabled={back === 0}
            style={{ font: "inherit", fontSize: 17, border: 0, background: "none", cursor: back === 0 ? "default" : "pointer", padding: "4px 8px", color: back === 0 ? "var(--line)" : "var(--ink)" }}>
            &rsaquo;
          </button>
        </span>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--muted)" }}>{comparisonLabel(range, win)}</p>

      <div style={{ opacity: loadingSummary ? 0.55 : 1, transition: "opacity 120ms" }} aria-busy={loadingSummary}>
        <div style={grid}>
          {tile(
            "Taken",
            wholeDollars(takenCents),
            <>cash {wholeDollars(cur?.cashCents ?? 0)}{now.handMarkedCount > 0 ? <> · {now.handMarkedCount} by hand</> : null}</>,
            delta(takenCents, prevTakenCents, { fmt: wholeDollars }),
            true,
          )}
          {tile(
            "Register sales",
            String(cur?.count ?? 0),
            "rings on the Square link",
            delta(cur?.count ?? 0, prv?.count ?? 0),
          )}
          {tile(
            "Average sale",
            avgCents === null ? "–" : centsDollars(avgCents),
            "per register ring",
            delta(avgCents ?? 0, prevAvgCents, { fmt: centsDollars }),
          )}
          {tile(
            "Owed right now",
            wholeDollars(view.owedCents),
            view.owedCount ? `${view.owedCount} order${view.owedCount === 1 ? "" : "s"} out the door unpaid` : "nothing outstanding",
          )}
        </div>

        {/* The trend: one chart, register money per bucket. Single series,
            so the title line is the legend. */}
        <div className="panel" style={{ padding: "14px 16px", marginTop: 12, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>
            Register money {range === "day" ? "by hour" : range === "year" ? "by month" : "by day"}
          </div>
          {/* tabIndex + role because a scrollable region a keyboard cannot
              reach cannot be scrolled by keyboard (the Stems catch; axe
              calls it at 390 where the chart actually scrolls). */}
          <div tabIndex={0} role="region" aria-label="Register money chart" style={{ overflowX: "auto" }}>
            {/* 7 or 12 bars compress onto a phone whole; 24 or 31 need room
                and scroll instead of shrinking below a thumb. */}
            <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" height={CH} role="img" style={{ minWidth: buckets.length > 12 ? 480 : 0, display: "block" }}
              aria-label={`Register money ${range === "day" ? "by hour" : range === "year" ? "by month" : "by day"}: ${
                buckets.length ? `${centsDollars(Math.max(...buckets))} at the peak` : "no sales in this window"
              }. Full values in the table below.`}>
              {/* hairline grid at 0, half, max */}
              {[0, 0.5, 1].map((f) => {
                const yy = 8 + plotH - plotH * f;
                return (
                  <g key={f}>
                    <line x1={PADL} x2={CW - 6} y1={yy} y2={yy} stroke="var(--line)" strokeWidth="1" />
                    <text x={PADL - 6} y={yy + 4} textAnchor="end" fontSize="11" fill="var(--muted)" fontFamily="var(--sans)">
                      {`$${Math.round((maxCents * f) / 100).toLocaleString("en-US")}`}
                    </text>
                  </g>
                );
              })}
              {buckets.map((c, i) => {
                const h = maxCents > 0 ? Math.round((c / maxCents) * plotH) : 0;
                const x = PADL + i * slot + (slot - barW) / 2;
                const yTop = 8 + plotH - h;
                const r = Math.min(4, barW / 2, h);
                return (
                  <g key={i}>
                    {c > 0 && (
                      /* rounded at the data end, square at the baseline */
                      <path
                        d={`M ${x} ${8 + plotH} V ${yTop + r} Q ${x} ${yTop} ${x + r} ${yTop} H ${x + barW - r} Q ${x + barW} ${yTop} ${x + barW} ${yTop + r} V ${8 + plotH} Z`}
                        fill="var(--green)"
                      />
                    )}
                    {/* the hit target is the whole slot, not the painted bar */}
                    <rect x={PADL + i * slot} y={8} width={slot} height={plotH} fill="transparent">
                      <title>{`${labels.all[i]}: ${centsDollars(c)}`}</title>
                    </rect>
                    {labels.axis(i) && (
                      <text x={PADL + i * slot + slot / 2} y={CH - 5} textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="var(--sans)">
                        {labels.axis(i)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>As a table</summary>
            <div tabIndex={0} role="region" aria-label="Register money, as a table" style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", marginTop: 8, fontSize: 13.5 }}>
                <tbody>
                  <tr>
                    {labels.all.map((l) => (
                      <th key={l} scope="col" style={{ padding: "3px 8px", borderBottom: "1px solid var(--line)", fontWeight: 600, textAlign: "right" }}>{l}</th>
                    ))}
                  </tr>
                  <tr>
                    {buckets.map((c, i) => (
                      <td key={i} style={{ padding: "3px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{centsDollars(c)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </div>

        {summary?.truncated && (
          <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
            Square returned more payments than this screen reads at once (4,000 per window); the register numbers above are missing the overflow.
          </p>
        )}
        {now.feeCents + prev.feeCents > 0 && (
          <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
            Order fees passed to the platform: {centsDollars(now.feeCents)}.
          </p>
        )}
      </div>

      {sectionHead("Orders", "/workroom/orders", "Open the board")}
      <div style={grid}>
        {tile("New orders", String(now.ordersCount), `${now.web} web · ${now.phone} phone`, delta(now.ordersCount, prev.ordersCount))}
        {tile("Ordered", wholeDollars(now.orderedCents), "tickets written, paid or not", delta(now.orderedCents, prev.orderedCents, { fmt: wholeDollars }))}
        {tile("Deliveries", String(now.delivery), `${now.pickup} pickup${now.pickup === 1 ? "" : "s"}`, delta(now.delivery, prev.delivery))}
        {tile(
          "Returning",
          now.ordersCount ? `${Math.round((now.returning / now.ordersCount) * 100)}%` : "–",
          `${now.returning} of ${now.ordersCount} ordered before`,
          prev.ordersCount > 0
            ? delta(now.ordersCount ? Math.round((now.returning / now.ordersCount) * 100) : 0, Math.round((prev.returning / prev.ordersCount) * 100), { fmt: (n) => `${n}%` })
            : undefined,
        )}
      </div>
      {(now.leadMedian !== null || now.topOccasions.length > 0) && (
        <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
          {now.leadMedian !== null && <>Median lead {now.leadMedian} day{now.leadMedian === 1 ? "" : "s"}, order to due date. </>}
          {now.topOccasions.length > 0 && <>Occasions: {now.topOccasions.map(([k, n]) => `${k} (${n})`).join(", ")}.</>}
        </p>
      )}
      {now.bestSellers.length > 0 && (
        <div className="panel" style={{ padding: "12px 16px", marginTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>
            Best sellers
          </div>
          {now.bestSellers.map(([name, r]) => {
            const topCents = now.bestSellers[0][1].cents || 1;
            return (
              <div key={name} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 12, alignItems: "center", padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
                  <div aria-hidden="true" style={{ height: 4, marginTop: 3, width: `${Math.max(2, Math.round((r.cents / topCents) * 100))}%`, background: "var(--green)", borderRadius: 2 }} />
                </div>
                <div style={{ fontSize: 14, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {r.qty} · {wholeDollars(r.cents)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {sectionHead("Stems", "/workroom/stems", "Stems & shrink")}
      <div style={grid}>
        {tile("Bought", String(now.boughtStems), `stems · ${money(now.boughtCost)} paid`, delta(now.boughtStems, prev.boughtStems))}
        {tile(
          "Tossed",
          money(now.tossedCost),
          `${now.tossedStems} stems${now.shrinkPct === null ? "" : ` · ${now.shrinkPct}% of bought`}`,
          delta(Math.round(now.tossedCost * 100), Math.round(prev.tossedCost * 100), { badUp: true, fmt: (n) => money(n / 100) }),
        )}
        {tile("Made into orders", String(now.consumedStems), "stems, via recipes", delta(now.consumedStems, prev.consumedStems))}
      </div>
      {now.topReasons.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
          Why tossed: {now.topReasons.map(([k, n]) => `${k} (${n})`).join(", ")}.
        </p>
      )}
      {now.unpricedTossed > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
          {now.unpricedTossed} tossed stem{now.unpricedTossed === 1 ? "" : "s"} had no purchase history to price {now.unpricedTossed === 1 ? "it" : "them"}; counted, not dollared.
        </p>
      )}
      {now.unreciped > 0 && (
        <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
          {now.unreciped} sold line{now.unreciped === 1 ? "" : "s"} had no recipe, so their stems could not be counted.
        </p>
      )}

      {quiet && (
        <p className="lede" style={{ marginTop: 28 }}>
          A quiet {range === "day" ? "day" : range === "week" ? "week" : range}: no orders, no money, no stems logged. Numbers
          appear the moment the other screens have something to add up.
        </p>
      )}

      {/* The provenance, off the face and in one place. */}
      <details style={{ marginTop: 30 }}>
        <summary style={{ fontSize: 13.5, color: "var(--muted)", cursor: "pointer" }}>Where these numbers come from</summary>
        <div style={{ fontSize: 13.5, color: "var(--muted)", maxWidth: 640 }}>
          <p style={{ margin: "10px 0 0" }}>
            Register money comes {summary?.source === "square" ? "straight from Square" : "from the stored copy of Square's webhook (the live link is not connected here)"},
            gross, refunds not subtracted; Taken adds hand-marked payments (checks, accounts) that never touched Square. Owed is every
            finished, unpaid ticket regardless of window. Ordered is tickets written, whichever window their money lands.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            Orders count web checkout, the phone pad, and returning means a phone or email seen on any earlier order. Best sellers
            add ticket lines to item-rung counter sales.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            Stems come from the stem log and recipes, consumed by finished orders and item-rung register sales; tossed stems are
            priced at each variety&rsquo;s average purchase cost on record. Order and stem history reaches back 400 days here, so a
            Year view early in January still shows last year whole; register money has no such limit when the Square link is live.
          </p>
        </div>
      </details>
    </>
  );
}
