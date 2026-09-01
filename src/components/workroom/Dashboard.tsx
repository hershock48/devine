"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MemoryWarning, PinGate, money, phoneKey, todayISO } from "@/components/workroom/ui";
import { HISTORY_DAYS, consumption, isoDate, lotCosting, mondayOf, saleInstantMs, type SoldCost } from "@/lib/workroom/derive";

/**
 * THE DASHBOARD. Grown out of the "This week" screen after Kevin's second
 * critique: right numbers, wrong shape. Too many sentences, one fixed window,
 * one fixed comparison. Rebuilt on how the tools she already reads do it
 * (Square's own app leads with gross sales, transactions, average sale;
 * Stripe and Toast lead with a stat row and one trend chart):
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
 * STALENESS IS VISIBLE. The summary response is keyed to the window it was
 * fetched for; a held summary from another window (mid-refetch, or after a
 * failed fetch) renders DIMMED, never as current truth. A failed fetch says
 * so in one line instead of quietly showing zeros as a day's takings.
 *
 * Values sit in the sans, not the site serif: a dashboard number is a
 * reading, not a headline, and the serif's old-style figures wobble in a
 * stat row (the dataviz house rule agrees: hero figures in the working
 * face).
 */

type StemEvent = { id: string; kind: "purchase" | "shrink"; date: string; variety: string; stems: number; cost: number; reason: string; createdAt: number };
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

/* HISTORY_DAYS, the date/week helpers, and the stem arithmetic live in
   lib/workroom/derive.ts, shared with the Stems screen so one toss prices
   the same on every tab. */

/** Whole dollars on tiles; cents stay in tooltips and the table (Square's
    own widget rounds the same way). */
const wholeDollars = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
const centsDollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The reporting window for (range, back), hung from an anchor day passed in
 * as yyyy-mm-dd. The anchor is STATE, not a clock read inside the memo:
 * that keeps the memo's dependencies honest, and midnight rollover becomes
 * an ordinary state change (the refresh interval flips the anchor when the
 * device's date turns). All arithmetic goes through Date parts, never raw
 * day-lengths, so window BOUNDARIES land on real local midnights across
 * DST. Two knowingly-accepted DST quirks remain: the elapsed cut below is
 * raw ms, so on the two changeover days a "to this point" comparison sits
 * one hour off; and the fall-back day's 1a chart bucket covers both 1
 * o'clock hours (which is what the wall clock says happened). Totals are
 * exact either way.
 *
 * prevBegin/prevEnd is the comparison window: the same window one beat
 * earlier (a day compares 7 days back, to the same weekday). When the
 * current window is still running, prevEnd is cut to the same elapsed
 * point, so a Tuesday morning never loses to a whole last week.
 */
function makeWindow(range: Range, back: number, anchorISO: string) {
  const anchor = new Date(anchorISO + "T12:00:00");
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const d = anchor.getDate();

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
    const monday = mondayOf(anchor);
    begin = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - back * 7);
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

  // The one clock read left: the elapsed cut for a still-running window.
  // Read at window-build time; at worst the cut is a refresh interval old.
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
    /** Identity of this window, for keying a summary response to it. */
    key: `${begin.getTime()}:${end.getTime()}:${prevEndMs}`,
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

/** The short basis that sits on every delta chip ("100 last week"), so a
    tile reads without the caption (Kevin, 2026-09-01: "was 0" said nothing). */
function basisLabel(range: Range, w: Win): string {
  if (range === "day") return `last ${DAYS[w.begin.getDay()]}`;
  if (range === "week") return "last week";
  if (range === "month") return `in ${MONTHS[w.prevBegin.getMonth()].slice(0, 3)}`;
  return `in ${w.prevBegin.getFullYear()}`;
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

/* ------------------------- shared render parts ------------------------- */

/** The uppercase kicker over a number or a panel. One literal, not five. */
const kicker: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "var(--muted)",
};

/** The muted footnote line under a section. */
const note: React.CSSProperties = { margin: "10px 0 0", fontSize: 13.5, color: "var(--muted)" };

/** Arrow + percent, colored by direction times whether up is good, with the
    prior value beside it so the baseline is on the tile (Kevin's rule: a
    figure without a baseline is trivia). Shape carries the sign too, never
    color alone. */
function Delta({ cur, prev, basis, badUp, fmt }: { cur: number; prev: number; basis: string; badUp?: boolean; fmt?: (n: number) => string }) {
  const f = fmt ?? ((n: number) => String(n));
  if (prev <= 0) {
    return <span style={{ fontSize: 13, color: "var(--muted)" }}>{f(prev)} {basis}</span>;
  }
  const pct = Math.round(((cur - prev) / prev) * 100);
  const up = pct > 0;
  const flat = pct === 0;
  const good = flat ? null : badUp ? !up : up;
  const color = flat ? "var(--muted)" : good ? "var(--green)" : "var(--rose-ink)";
  return (
    <span style={{ fontSize: 13, color: "var(--muted)" }}>
      <span style={{ color, fontWeight: 700 }}>
        {flat ? "" : up ? "▲ " : "▼ "}
        {flat ? "even" : `${Math.abs(pct) > 999 ? ">999" : Math.abs(pct)}%`}
      </span>
      {" · "}{f(prev)} {basis}
    </span>
  );
}

function Tile({ label, value, sub, delta, hero }: { label: string; value: string; sub?: React.ReactNode; delta?: React.ReactNode; hero?: boolean }) {
  return (
    <div className="panel" style={{ padding: "14px 16px", minWidth: 0 }}>
      <div style={kicker}>{label}</div>
      <div style={{ fontSize: hero ? 38 : 27, fontWeight: 600, fontFamily: "var(--sans)", lineHeight: 1.15, margin: "4px 0 2px" }}>{value}</div>
      {delta && <div>{delta}</div>}
      {sub && <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionHead({ label, href, linkText }: { label: string; href?: string; linkText?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "30px 0 10px" }}>
      <h2 style={{ ...kicker, fontFamily: "var(--sans)", fontSize: 14.5, letterSpacing: "0.08em", margin: 0 }}>{label}</h2>
      {href && (
        <a href={href} style={{ fontSize: 13.5, padding: "4px 0" }}>
          {linkText} <span aria-hidden="true">&rsaquo;</span>
        </a>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function Dashboard({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [events, setEvents] = useState<StemEvent[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [backend, setBackend] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("week");
  const [back, setBack] = useState(0);
  /** The local calendar day the windows hang from; flipped by the refresh
      interval when midnight passes so "Today" rolls over. */
  const [anchorISO, setAnchorISO] = useState(todayISO);
  /** The last summary response, KEYED to the window it answered for. A held
      summary whose key mismatches the current window renders dimmed. */
  const [summary, setSummary] = useState<{ key: string; data: Summary } | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [summaryFailed, setSummaryFailed] = useState(false);

  const win = useMemo(() => makeWindow(range, back, anchorISO), [range, back, anchorISO]);

  const pull = useCallback(async () => {
    const [s, o] = await Promise.all([
      fetch(`/api/workroom/stems?days=${HISTORY_DAYS}`, { cache: "no-store" }),
      fetch(`/api/workroom/orders?days=${HISTORY_DAYS}`, { cache: "no-store" }),
    ]);
    if (s.status === 401 || o.status === 401) {
      setAuthed(false);
      return;
    }
    // A transient 500 mid-poll must not wipe loaded ledgers to zeros: keep
    // what we have and let the next poll try again.
    if (!s.ok || !o.ok) return;
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
  // window loads. A failed or malformed response never becomes "truth": the
  // held summary stays (still keyed to ITS window, so still dimmed) and one
  // line below the chart says the load failed. The sequence ref makes only
  // the NEWEST request's outcome count: without it, a slow old-window fetch
  // resolving last would overwrite a fresher answer and re-dim the page.
  const summarySeq = useRef(0);
  const pullSummary = useCallback(async (w: Win) => {
    const seq = ++summarySeq.current;
    setLoadingSummary(true);
    try {
      const q = new URLSearchParams({
        begin: String(w.beginMs),
        end: String(w.endMs),
        prevBegin: String(w.prevBeginMs),
        prevEnd: String(w.prevEndMs),
        edges: w.edges.join(","),
      });
      const r = await fetch(`/api/workroom/summary?${q}`, { cache: "no-store" });
      if (seq !== summarySeq.current) return;
      if (r.status === 401) {
        setAuthed(false);
        return;
      }
      const data = (await r.json().catch(() => null)) as Summary | null;
      if (seq !== summarySeq.current) return;
      if (!r.ok || !data?.current || !Array.isArray(data.current.buckets)) {
        setSummaryFailed(true);
        return;
      }
      setSummary({ key: w.key, data });
      setSummaryFailed(false);
    } catch {
      if (seq === summarySeq.current) setSummaryFailed(true);
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
    pullSummary(win).catch(() => {});
  }, [authed, win, pullSummary]);

  // A counter screen sits open all day; a gentle refresh keeps "Today"
  // honest without anyone thinking to reload. When midnight passes, the
  // anchor flips and the window effect refetches against the new day. The
  // Year range skips the periodic summary refetch on purpose: it re-walks a
  // year of Square payments per pass, and a year-scale chart does not need
  // 90-second freshness (it still refetches on any interaction).
  useEffect(() => {
    if (!authed || back !== 0) return;
    const t = setInterval(() => {
      pull().catch(() => {});
      const today = todayISO();
      if (today !== anchorISO) setAnchorISO(today);
      else if (range !== "year") pullSummary(win).catch(() => {});
    }, 90_000);
    return () => clearInterval(t);
  }, [authed, back, range, anchorISO, win, pull, pullSummary]);

  /* ---------------- the florist-side arithmetic ---------------- */

  const view = useMemo(() => {
    const recipeBySlug = new Map(recipes.map((r) => [r.slug, r]));

    // Lot costing over the whole loaded history (derive.ts): every toss and
    // every made arrangement drew its stems from the oldest open buy, so a
    // window only has to add up what its events already cost.
    const lots = lotCosting({ events, orders, sales, recipeBySlug });
    const soldByKey = new Map<string, SoldCost>();
    for (const e of lots.sold) soldByKey.set(`${e.source}:${e.id}:${e.slug}`, e);

    // Each sale's instant, resolved once (Date.parse per row per window
    // scan was the hottest wasted work on this screen).
    const salesM = sales.map((s) => ({ s, ms: saleInstantMs(s.paidAt, s.createdAt) }));

    // Earliest sighting per phone and per email, built once: the returning
    // check was O(orders x contacts) with regex normalization in the inner
    // loop, and contacts grow with every order forever.
    const firstByPhone = new Map<string, number>();
    const firstByEmail = new Map<string, number>();
    for (const c of contacts) {
      const pk = phoneKey(c.phone);
      const ek = c.email.trim().toLowerCase();
      if (pk && (firstByPhone.get(pk) ?? Infinity) > c.createdAt) firstByPhone.set(pk, c.createdAt);
      if (ek && (firstByEmail.get(ek) ?? Infinity) > c.createdAt) firstByEmail.set(ek, c.createdAt);
    }

    /** full=false computes only what the comparison window's deltas read;
        best sellers, occasions and lead times are current-window-only. */
    const calc = (beginMs: number, endMs: number, full: boolean) => {
      const fromISO = isoDate(new Date(beginMs));
      const toISO = isoDate(new Date(endMs - 1));
      const inMs = (ms: number) => ms >= beginMs && ms < endMs;
      const inDates = (dateISO: string) => dateISO >= fromISO && dateISO <= toISO;

      /* money the register never saw. The order fee is deliberately NOT
         totaled anywhere on this screen (Kevin, 2026-09-01: quit doing
         that); it is the customer's line item, not a shop metric. */
      const handMarked = orders.filter((o) => o.payment && o.payment.method === "other" && inMs(o.payment.at));
      const handMarkedCents = handMarked.reduce((sum, o) => sum + (o.payment?.totalCents ?? 0), 0);

      /* orders */
      const ordersIn = orders.filter((o) => inMs(o.createdAt) && o.status !== "canceled");
      const orderedCents = ordersIn.reduce((sum, o) => sum + Math.round(o.subtotal * 100), 0);
      const web = ordersIn.filter((o) => o.source === "web").length;
      const delivery = ordersIn.filter((o) => o.fulfillment === "delivery").length;
      let returning = 0;
      for (const o of ordersIn) {
        const pk = phoneKey(o.phone);
        const ek = o.email.trim().toLowerCase();
        const seen = Math.min(pk ? firstByPhone.get(pk) ?? Infinity : Infinity, ek ? firstByEmail.get(ek) ?? Infinity : Infinity);
        if (seen < o.createdAt) returning += 1;
      }

      const occasions = new Map<string, number>();
      const leads: number[] = [];
      const sold = new Map<string, { qty: number; cents: number }>();
      if (full) {
        for (const o of ordersIn) {
          const k = o.occasion || "not given";
          occasions.set(k, (occasions.get(k) ?? 0) + 1);
          const lead = Math.round((new Date(o.date + "T12:00:00").getTime() - o.createdAt) / 86_400_000);
          if (Number.isFinite(lead) && lead >= 0) leads.push(lead);
        }
        leads.sort((a, b) => a - b);

        /* best sellers: ticket lines plus item-rung counter sales (linked
           sales skipped; their lines are the ticket's lines) */
        const add = (name: string, qty: number, cents: number) => {
          const row = sold.get(name) ?? { qty: 0, cents: 0 };
          row.qty += qty;
          row.cents += cents;
          sold.set(name, row);
        };
        for (const o of ordersIn) for (const l of o.lines) add(l.name, l.qty, Math.round(l.each * 100) * l.qty);
        for (const { s, ms } of salesM) {
          if (s.workroomOrderId || !inMs(ms)) continue;
          for (const l of s.lines) add(l.name, l.qty, l.totalCents);
        }
      }
      /* margins, keyed by SLUG (three products share the name "Designer's
         Choice"), costed by what their recipes drew from the lots. What
         cannot be costed is counted, never guessed. Board lines carry a
         slug; item-rung register lines carry the SKU's slug. */
      /* Each row's stem cost is what its lines DREW from the lots when they
         were made (lot costing), looked up by order or sale id, so revenue
         and cost describe the same tickets whatever day the making fell on.
         A ticket not yet made has no cost yet, and the row says so. */
      const bySlug = new Map<string, { name: string; qty: number; cents: number; costCents: number; madeQty: number; unpriced: number }>();
      const addSlug = (source: "order" | "sale", id: string, slug: string | null, name: string, qty: number, cents: number) => {
        if (!slug) return;
        const row = bySlug.get(slug) ?? { name, qty: 0, cents: 0, costCents: 0, madeQty: 0, unpriced: 0 };
        row.qty += qty;
        row.cents += cents;
        const drew = soldByKey.get(`${source}:${id}:${slug}`);
        if (drew) {
          row.costCents += Math.round(drew.cost * 100);
          row.madeQty += drew.qty;
          row.unpriced += drew.unpriced;
        }
        bySlug.set(slug, row);
      };
      for (const o of ordersIn) for (const l of o.lines) addSlug("order", o.id, l.slug, l.name, l.qty, Math.round(l.each * 100) * l.qty);
      for (const { s, ms } of salesM) {
        if (s.workroomOrderId || !inMs(ms)) continue;
        for (const l of s.lines) addSlug("sale", s.id, l.slug, l.name, l.qty, l.totalCents);
      }
      let soldStemCents = 0;
      let uncostedUnits = 0;
      let unpricedSold = 0;
      const margins: { slug: string; name: string; qty: number; cents: number; costCents: number | null; why: "" | "no recipe" | "not made yet" | "cost unknown" }[] = [];
      for (const [slug, row] of bySlug) {
        const hasRecipe = recipeBySlug.has(slug);
        let why: "" | "no recipe" | "not made yet" | "cost unknown" = "";
        if (!hasRecipe) why = "no recipe";
        else if (row.madeQty === 0) why = "not made yet";
        else if (row.costCents === 0 && row.unpriced > 0) why = "cost unknown";
        if (why) uncostedUnits += row.qty;
        else soldStemCents += row.costCents;
        unpricedSold += row.unpriced;
        margins.push({ slug, name: row.name, qty: row.qty, cents: row.cents, costCents: why ? null : row.costCents, why });
      }
      margins.sort((a, b) => b.cents - a.cents);

      const bestSellers = [...sold.entries()]
        .filter(([name]) => name && name !== "(unnamed)" && name !== "Order fee" && name !== "Service fee" && !name.startsWith("Delivery ("))
        .sort((a, b) => b[1].cents - a[1].cents)
        .slice(0, 5);

      /* stems, on the shared arithmetic (derive.ts) */
      const eventsIn = events.filter((e) => inDates(e.date));
      const bought = eventsIn.filter((e) => e.kind === "purchase");
      const boughtStems = bought.reduce((sum, e) => sum + e.stems, 0);
      const boughtCost = bought.reduce((sum, e) => sum + e.cost, 0);
      const tossed = eventsIn.filter((e) => e.kind === "shrink");
      // Priced by the lots each toss drew from (derive.ts), never an average.
      const shrink = { stems: 0, cost: 0, unpriced: 0 };
      for (const e of tossed) {
        shrink.stems += e.stems;
        const drew = lots.shrink.get(e.id);
        if (!drew) shrink.unpriced += e.stems;
        else {
          shrink.cost += drew.cost;
          shrink.unpriced += drew.unpriced;
        }
      }
      const reasons = new Map<string, number>();
      if (full) for (const e of tossed) reasons.set(e.reason || "other", (reasons.get(e.reason || "other") ?? 0) + e.stems);

      const wrapped = salesM.filter(({ ms }) => inMs(ms)).map(({ s }) => s);
      const consumed = consumption({
        orders,
        sales: wrapped,
        recipeBySlug,
        orderInWindow: inDates,
        saleInWindow: () => true,
      });

      return {
        handMarkedCount: handMarked.length, handMarkedCents,
        ordersCount: ordersIn.length, orderedCents,
        web, phone: ordersIn.length - web, delivery, pickup: ordersIn.length - delivery,
        topOccasions: [...occasions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
        returning,
        leadMedian: leads.length ? leads[Math.floor(leads.length / 2)] : null,
        bestSellers,
        boughtStems, boughtCost,
        tossedStems: shrink.stems, tossedCost: shrink.cost, unpricedTossed: shrink.unpriced,
        topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
        consumedStems: consumed.madeTotal, unreciped: consumed.unrecipedLines,
        soldStemCents, uncostedUnits, unpricedSold, margins: full ? margins.slice(0, 8) : [],
        shrinkPct: boughtStems > 0 ? Math.round((shrink.stems / boughtStems) * 100) : null,
      };
    };

    const now = calc(win.beginMs, win.endMs, true);
    const prev = calc(win.prevBeginMs, win.prevEndMs, false);

    // Owed is NOW, never windowed: money owed does not care which week it
    // started being owed in.
    const owed = orders.filter((o) => o.status === "done" && !o.payment);
    const owedCents = owed.reduce((sum, o) => sum + Math.round(o.subtotal * 100), 0);

    return { now, prev, owedCount: owed.length, owedCents };
  }, [events, recipes, orders, sales, contacts, win]);

  if (!authed) {
    return (
      <>
        <h1>Dashboard</h1>
        <PinGate onAuthed={() => setAuthed(true)} />
      </>
    );
  }

  const { now, prev } = view;
  /** The summary is only CURRENT when it answers for this window; anything
      else renders dimmed (mid-refetch, or the last good answer after a
      failure). */
  const summaryMatches = summary?.key === win.key;
  const cur = summary?.data.current;
  const prv = summary?.data.previous;
  const stale = loadingSummary || !summaryMatches;
  const takenCents = (cur?.totalCents ?? 0) + now.handMarkedCents;
  const prevTakenCents = (prv?.totalCents ?? 0) + prev.handMarkedCents;
  const avgCents = cur && cur.count > 0 ? Math.round(cur.totalCents / cur.count) : null;
  const prevAvgCents = prv && prv.count > 0 ? Math.round(prv.totalCents / prv.count) : 0;

  /* auto-fit, not auto-fill: a four-tile row should fill its band, not
     leave a phantom fifth column of air on a desktop. */
  const grid: React.CSSProperties = { display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))" };
  const basis = basisLabel(range, win);

  const historyFloorMs = Date.now() - HISTORY_DAYS * 86_400_000;
  const beyondHistory = win.beginMs < historyFloorMs || win.prevBeginMs < historyFloorMs;
  const quiet = now.ordersCount === 0 && takenCents === 0 && now.boughtStems === 0 && (cur?.count ?? 0) === 0;

  /* chart geometry. The buckets are sliced to the window's label count: a
     held summary from another window may carry a different bucket count
     (24 hours against 12 months once crashed the page on an out-of-range
     label), and the dimmed stale frame only has to look right. */
  const labels = bucketLabels(range, win);
  const buckets = (cur?.buckets ?? []).slice(0, labels.all.length);
  const maxCents = niceMax(Math.max(0, ...buckets));
  const CW = 720;
  const CH = 150;
  const PADL = 44;
  const plotH = CH - 20 - 8;
  const plotW = CW - PADL - 6;
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

      <div style={{ opacity: stale ? 0.55 : 1, transition: "opacity 120ms" }} aria-busy={stale}>
        <div style={grid}>
          <Tile
            label="Taken"
            value={wholeDollars(takenCents)}
            hero
            delta={<Delta basis={basis} cur={takenCents} prev={prevTakenCents} fmt={wholeDollars} />}
            sub={<>cash {wholeDollars(cur?.cashCents ?? 0)}{now.handMarkedCount > 0 ? <> · {now.handMarkedCount} by hand</> : null}</>}
          />
          <Tile
            label="Register sales"
            value={String(cur?.count ?? 0)}
            sub="rings on the Square link"
            delta={<Delta basis={basis} cur={cur?.count ?? 0} prev={prv?.count ?? 0} />}
          />
          <Tile
            label="Average sale"
            value={avgCents === null ? "–" : centsDollars(avgCents)}
            sub="per register ring"
            delta={<Delta basis={basis} cur={avgCents ?? 0} prev={prevAvgCents} fmt={centsDollars} />}
          />
          <Tile
            label="Owed right now"
            value={wholeDollars(view.owedCents)}
            sub={view.owedCount ? `${view.owedCount} order${view.owedCount === 1 ? "" : "s"} out the door unpaid` : "nothing outstanding"}
          />
        </div>

        {/* The trend: one chart, register money per bucket. Single series,
            so the title line is the legend. */}
        <div className="panel" style={{ padding: "14px 16px", marginTop: 12, minWidth: 0 }}>
          <div style={{ ...kicker, marginBottom: 8 }}>
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

        {summaryFailed && !loadingSummary && (
          <p style={note}>
            The register summary could not load just now; the money figures hold the last loaded answer, dimmed. It retries
            on the next refresh or range change.
          </p>
        )}
        {summaryMatches && summary?.data.truncated && (
          <p style={note}>
            Square returned more payments than this screen reads in one pass; the register figures above are missing the overflow.
          </p>
        )}
      </div>

      {/* No silent caps: the ledgers load a bounded history, and a window
          (or its comparison, which a Year view drags a further year back)
          can reach past it. Register money is exempt while Square answers
          live. */}
      {beyondHistory && (
        <p style={{ ...note, margin: "14px 0 0", color: "var(--rose-ink)" }}>
          This window{win.prevBeginMs < historyFloorMs && win.beginMs >= historyFloorMs ? "'s comparison" : ""} reaches
          past the {HISTORY_DAYS} days of order and stem history this screen loads, so the Orders and Stems tiles below
          read low there. The register figures are unaffected while Square itself answers.
        </p>
      )}

      <SectionHead label="Orders" href="/workroom" linkText="Open the board" />
      <div style={grid}>
        <Tile label="New orders" value={String(now.ordersCount)} sub={`${now.web} web · ${now.phone} phone`} delta={<Delta basis={basis} cur={now.ordersCount} prev={prev.ordersCount} />} />
        <Tile label="Ordered" value={wholeDollars(now.orderedCents)} sub="tickets written, paid or not" delta={<Delta basis={basis} cur={now.orderedCents} prev={prev.orderedCents} fmt={wholeDollars} />} />
        <Tile label="Deliveries" value={String(now.delivery)} sub={`${now.pickup} pickup${now.pickup === 1 ? "" : "s"}`} delta={<Delta basis={basis} cur={now.delivery} prev={prev.delivery} />} />
        <Tile
          label="Returning"
          value={now.ordersCount ? `${Math.round((now.returning / now.ordersCount) * 100)}%` : "–"}
          sub={`${now.returning} of ${now.ordersCount} ordered before`}
          delta={
            prev.ordersCount > 0 ? (
              <Delta basis={basis}
                cur={now.ordersCount ? Math.round((now.returning / now.ordersCount) * 100) : 0}
                prev={Math.round((prev.returning / prev.ordersCount) * 100)}
                fmt={(n) => `${n}%`}
              />
            ) : undefined
          }
        />
      </div>
      {(now.leadMedian !== null || now.topOccasions.length > 0) && (
        <p style={note}>
          {now.leadMedian !== null && <>Median lead {now.leadMedian} day{now.leadMedian === 1 ? "" : "s"}, order to due date. </>}
          {now.topOccasions.length > 0 && <>Occasions: {now.topOccasions.map(([k, n]) => `${k} (${n})`).join(", ")}.</>}
        </p>
      )}
      {now.bestSellers.length > 0 && (
        <div className="panel" style={{ padding: "12px 16px", marginTop: 12 }}>
          <div style={{ ...kicker, marginBottom: 4 }}>Best sellers</div>
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

      <SectionHead label="Stems" href="/workroom/inventory" linkText="Open Inventory" />
      <div style={grid}>
        <Tile label="Bought" value={String(now.boughtStems)} sub={`stems · ${money(now.boughtCost)} paid`} delta={<Delta basis={basis} cur={now.boughtStems} prev={prev.boughtStems} />} />
        <Tile
          label="Tossed"
          value={money(now.tossedCost)}
          sub={`${now.tossedStems} stems${now.shrinkPct === null ? "" : ` · ${now.shrinkPct}% of bought`}`}
          delta={<Delta basis={basis} cur={Math.round(now.tossedCost * 100)} prev={Math.round(prev.tossedCost * 100)} badUp fmt={(n) => money(n / 100)} />}
        />
        <Tile label="Made into orders" value={String(now.consumedStems)} sub="stems, via recipes" delta={<Delta basis={basis} cur={now.consumedStems} prev={prev.consumedStems} />} />
        <Tile
          label="Stems in what sold"
          value={centsDollars(now.soldStemCents)}
          sub={now.uncostedUnits > 0 ? `${now.uncostedUnits} sold item${now.uncostedUnits === 1 ? "" : "s"} not costable yet` : "recipe-costed"}
          delta={<Delta basis={basis} cur={now.soldStemCents} prev={prev.soldStemCents} badUp fmt={centsDollars} />}
        />
      </div>
      {/* The margins table, moved here from the Inventory page 2026-09-01
          (Kevin: a week table on a data-entry page belongs on the
          dashboard). Same window as everything above it. */}
      {now.margins.length > 0 && (
        <div className="panel" style={{ padding: "12px 16px", marginTop: 12 }}>
          <div style={{ ...kicker, marginBottom: 4 }}>Margins on what sold</div>
          <div tabIndex={0} role="region" aria-label="Margins on what sold" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 460, borderCollapse: "collapse", fontSize: 14.5 }}>
              <thead>
                <tr>
                  {["Product", "Sold", "Revenue", "Stem cost", "Margin"].map((h, i) => (
                    <th key={h} style={{ ...kicker, fontSize: 12, textAlign: i === 0 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {now.margins.map((m) => {
                  const cell: React.CSSProperties = { textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" };
                  return (
                    <tr key={m.slug}>
                      <td style={{ ...cell, textAlign: "left" }}>{m.name}</td>
                      <td style={cell}>{m.qty}</td>
                      <td style={cell}>{centsDollars(m.cents)}</td>
                      <td style={cell}>{m.costCents == null ? m.why : centsDollars(m.costCents)}</td>
                      <td style={cell}>{m.costCents == null || m.cents === 0 ? "" : `${Math.round(((m.cents - m.costCents) / m.cents) * 100)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {now.topReasons.length > 0 && (
        <p style={note}>Why tossed: {now.topReasons.map(([k, n]) => `${k} (${n})`).join(", ")}.</p>
      )}
      {now.unpricedTossed > 0 && (
        <p style={{ ...note, margin: "8px 0 0" }}>
          {now.unpricedTossed} tossed stem{now.unpricedTossed === 1 ? "" : "s"} had no purchase history to price {now.unpricedTossed === 1 ? "it" : "them"}; counted, not dollared.
        </p>
      )}
      {now.unpricedSold > 0 && (
        <p style={{ ...note, margin: "8px 0 0" }}>
          {now.unpricedSold} stem{now.unpricedSold === 1 ? "" : "s"} in what sold had no buy on record to draw from; counted, not dollared.
        </p>
      )}
      {now.unreciped > 0 && (
        <p style={{ ...note, margin: "8px 0 0" }}>
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
            Register money comes {summary?.data.source === "square" ? "straight from Square" : "from the stored copy of Square's webhook (the live link is not connected here)"},
            gross, refunds not subtracted; Taken adds hand-marked payments (checks, accounts) that never touched Square. Owed is every
            finished, unpaid ticket regardless of window. Ordered is tickets written, whichever window their money lands.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            Orders count web checkout, the phone pad, and returning means a phone or email seen on any earlier order. Best sellers
            add ticket lines to item-rung counter sales.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            Stems come from the stem log and recipes, consumed by finished orders and item-rung register sales. Every buy is a
            lot; tosses and made arrangements draw from the oldest lot with stems left, so a tossed stem costs what its own
            invoice said, and a sold arrangement costs what its recipe drew when it was made. Order and stem history reaches back {HISTORY_DAYS} days
            here, so a Year view early in January still shows last year whole; the register figures have no such limit when the
            Square link is live.
          </p>
        </div>
      </details>
    </>
  );
}
