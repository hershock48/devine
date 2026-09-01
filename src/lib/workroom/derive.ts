/**
 * The workroom's shared arithmetic. One copy of every rule that more than
 * one screen computes, because the 2026-09-01 review caught the cost of
 * copies: the dashboard, the stems report, and the inventory each carried
 * their own cost-per-stem and consumption math with slightly different
 * windows, so the same week's tossed dollars could disagree across tabs and
 * the owner had no way to tell which screen was lying.
 *
 * THE POLICIES, DECIDED ONCE:
 *
 *   costing      LOTS, oldest first (lotCosting, below). Every buy is a lot
 *                at its own invoice price; a toss or a made arrangement
 *                draws from the oldest lot with stems left and costs what
 *                it drew. RETRACTION 2026-09-01: the first policy was a
 *                blended average over the whole loaded history, and
 *                Kevin's two-week example broke it (a week-2 toss priced at
 *                the midpoint of two invoices, a holiday buy repricing a
 *                year of tosses). costPerStemMap survives only as the
 *                fallback for callers with no ledger to walk; every screen
 *                still loads the same HISTORY_DAYS so the walk starts from
 *                the same first lot everywhere.
 *
 *   sale time    a register sale happens at Square's own payment stamp,
 *                falling back to when the webhook stored it (seconds later
 *                in practice). Screens window sales by this INSTANT, never
 *                by slicing the ISO string: the slice reads UTC, which moved
 *                a 9:30pm sale into tomorrow.
 *
 *   consumption  stems leave the cooler when a board order is made/out/done
 *                (bucketed on its requested date) or when an UNLINKED
 *                register sale's lines map to recipes. A sale linked to a
 *                board order is that order's money, not a second sale; its
 *                stems are counted once, by the order's status. What cannot
 *                be counted is counted as uncountable: lines with no recipe,
 *                and register rings with no line items at all.
 *
 * This module is client-safe on purpose (no server-only imports): the three
 * screens that need it are all client components. The API routes clamp to
 * HISTORY_DAYS as their own defensive cap; if the number ever moves, it
 * moves here and there together.
 */

export const HISTORY_DAYS = 400;

/**
 * The one spelling of a variety name: trimmed, lowercased, single-spaced.
 * Purchases, recipes, shrink and the master list all match on this string,
 * so it lives here (client-safe) and the server store re-exports it; the
 * recipe form needs the same rule to say "not on the stem list" BEFORE the
 * server does.
 */
export function normalizeVariety(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** yyyy-mm-dd on the device's own calendar (the todayISO rule: "today"
    means today in Marshall, where the device is). */
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The Monday of the week containing d, at local midnight. The shop thinks
    in truck weeks; every screen's "week" anchors here or two screens will
    cover different day spans. */
export function mondayOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

/** When a register sale happened, as epoch ms. */
export function saleInstantMs(paidAt: string, createdAt: number): number {
  const ms = Date.parse(paidAt);
  return Number.isFinite(ms) ? ms : createdAt;
}

type PurchaseLike = { kind: string; variety: string; stems: number; cost: number };

/** Blended cost per stem per variety: total paid over total stems, across
    every purchase handed in (the whole loaded history, per the policy). */
export function costPerStemMap(events: PurchaseLike[]): Map<string, number> {
  const paid = new Map<string, { cost: number; stems: number }>();
  for (const e of events) {
    if (e.kind !== "purchase") continue;
    const p = paid.get(e.variety) ?? { cost: 0, stems: 0 };
    p.cost += e.cost;
    p.stems += e.stems;
    paid.set(e.variety, p);
  }
  const out = new Map<string, number>();
  for (const [v, p] of paid) if (p.stems > 0) out.set(v, p.cost / p.stems);
  return out;
}

type TossLike = { variety: string; stems: number };

/** Tossed stems priced at the blended cost; stems with no purchase on
    record are counted as unpriced, never guessed at zero. */
export function shrinkTotals(tossed: TossLike[], costPerStem: Map<string, number>): { stems: number; cost: number; unpriced: number } {
  let stems = 0;
  let cost = 0;
  let unpriced = 0;
  for (const e of tossed) {
    stems += e.stems;
    const per = costPerStem.get(e.variety);
    if (per == null) unpriced += e.stems;
    else cost += per * e.stems;
  }
  return { stems, cost, unpriced };
}

type RecipeLike = { parts: { variety: string; stems: number }[] };

/**
 * Stem cost of ONE unit of a recipe, or null when the recipe is missing or
 * any part is unpriced: costed only when whole, never a partial sum passed
 * off as complete. One rule for the Inventory page's recipe book, its
 * margins, and the Dashboard's best-sellers table.
 */
export function recipeUnitCost(recipe: RecipeLike | undefined, costPerStem: Map<string, number>): number | null {
  if (!recipe) return null;
  let cost = 0;
  for (const part of recipe.parts) {
    const c = costPerStem.get(part.variety);
    if (c == null) return null;
    cost += c * part.stems;
  }
  return cost;
}
type OrderLike = { status: string; date: string; lines: { slug: string | null; qty: number }[] };
type SaleLike = { workroomOrderId?: string; lines: { slug: string | null; qty: number }[] };

/**
 * Stems consumed, per variety, under the consumption policy above. The
 * callers own their windows (a week, a month, "the last 14 days") and pass
 * them as predicates; the RULE of what consumes and what cannot be counted
 * lives only here.
 */
export function consumption(opts: {
  orders: OrderLike[];
  sales: SaleLike[];
  recipeBySlug: Map<string, RecipeLike>;
  /** Whether an order's requested date is in the caller's window. */
  orderInWindow: (dateISO: string) => boolean;
  /** Whether a sale is in the caller's window (window by saleInstantMs). */
  saleInWindow: (s: SaleLike) => boolean;
}): { made: Map<string, number>; madeTotal: number; unrecipedLines: number; customSales: number } {
  const made = new Map<string, number>();
  let madeTotal = 0;
  let unrecipedLines = 0;
  let customSales = 0;

  const consume = (slug: string | null, qty: number) => {
    const recipe = slug ? opts.recipeBySlug.get(slug) : undefined;
    if (!recipe) {
      unrecipedLines += 1;
      return;
    }
    for (const part of recipe.parts) {
      made.set(part.variety, (made.get(part.variety) ?? 0) + part.stems * qty);
      madeTotal += part.stems * qty;
    }
  };

  for (const o of opts.orders) {
    // made, out, or done: the stems left the cooler when the arrangement
    // was made. A new or confirmed order has not touched it yet.
    if (o.status !== "made" && o.status !== "out" && o.status !== "done") continue;
    if (!opts.orderInWindow(o.date)) continue;
    for (const l of o.lines) consume(l.slug, l.qty);
  }
  for (const s of opts.sales) {
    if (s.workroomOrderId) continue;
    if (!opts.saleInWindow(s)) continue;
    if (s.lines.length === 0) customSales += 1;
    for (const l of s.lines) consume(l.slug, l.qty);
  }

  return { made, madeTotal, unrecipedLines, customSales };
}

/* ------------------------------------------------------------------ */
/*                        LOT COSTING (FIFO)                            */
/* ------------------------------------------------------------------ */

/**
 * THE COST OF A STEM IS THE INVOICE IT CAME OFF, NOT AN AVERAGE.
 *
 * Kevin's example (2026-09-01) broke the blended average: week 1 buys 15
 * roses at price A and sells 14; week 2 buys 15 at price B, sells 1 and
 * tosses 15. The average priced those 15 tossed stems at the midpoint of A
 * and B, though 14 of them were week-2 roses at B, and one holiday buy
 * would have repriced every toss for a year.
 *
 * So each buy is a LOT (stems, what was paid, the day). Tosses and made
 * arrangements draw stems from the OLDEST lot with stems left, which is
 * how the cooler actually empties: the older stems die or get used first.
 * A toss's dollars are the sum of the lot prices it drew; a sold
 * arrangement's stem cost is what its recipe drew when it was made. When
 * the lots run dry (a toss before any buy was logged, more sold than
 * bought) the excess stems are UNPRICED and counted as such, never guessed.
 *
 * Time order: events are walked by day, purchases before consumption on
 * the same day, then by the moment they were recorded. A board order
 * consumes on its requested date (the consumption policy above); a
 * register sale on its instant.
 *
 * Two derived prices come out of the walk for the screens that need a
 * number before a sale happens: lastUnitCost (the most recent invoice,
 * the right basis for a quote and for a new buy's one-tap fill) and
 * currentUnitCost (what the stems on hand cost, blended over the open lots
 * only; falls back to lastUnitCost when nothing is on hand), which prices
 * the recipe book's "what would this cost to make now".
 */

type LotEventLike = { id: string; kind: string; date: string; variety: string; stems: number; cost: number; createdAt: number };
type LotOrderLike = { id: string; status: string; date: string; lines: { slug: string | null; qty: number }[] };
type LotSaleLike = { id: string; paidAt: string; createdAt: number; workroomOrderId?: string; lines: { slug: string | null; qty: number }[] };

/** The stem cost of one sold line, realized when it was made. */
export type SoldCost = {
  source: "order" | "sale";
  /** The order or sale id. */
  id: string;
  slug: string;
  qty: number;
  /** Dollars drawn from lots. */
  cost: number;
  /** Stems the lots could not cover. */
  unpriced: number;
  day: string;
};

export type LotCosting = {
  /** By shrink event id: what the tossed stems had cost, and how many had no lot to draw from. */
  shrink: Map<string, { cost: number; unpriced: number }>;
  /** One entry per made order line / item-rung sale line with a recipe. */
  sold: SoldCost[];
  /** Open lots per variety: stems still on hand, what they cost, the oldest lot's day. */
  onHand: Map<string, { stems: number; cost: number; oldest: string | null }>;
  /** Most recent invoice price per stem, per variety. */
  lastUnitCost: Map<string, number>;
  /** Blended price of the open lots, else the last invoice price. */
  currentUnitCost: Map<string, number>;
};

type Lot = { day: string; left: number; unitCost: number };

export function lotCosting(opts: {
  events: LotEventLike[];
  orders: LotOrderLike[];
  sales: LotSaleLike[];
  recipeBySlug: Map<string, RecipeLike>;
}): LotCosting {
  type Step = { day: string; phase: 0 | 1; ms: number; run: () => void };
  const steps: Step[] = [];
  const lots = new Map<string, { list: Lot[]; head: number }>();
  const queue = (v: string) => {
    let q = lots.get(v);
    if (!q) lots.set(v, (q = { list: [], head: 0 }));
    return q;
  };

  /** Draw n stems of a variety from its oldest open lots. */
  const draw = (variety: string, n: number): { cost: number; unpriced: number } => {
    const q = queue(variety);
    let cost = 0;
    while (n > 0 && q.head < q.list.length) {
      const lot = q.list[q.head];
      const take = Math.min(lot.left, n);
      cost += take * lot.unitCost;
      lot.left -= take;
      n -= take;
      if (lot.left === 0) q.head += 1;
    }
    return { cost, unpriced: n };
  };

  const shrink = new Map<string, { cost: number; unpriced: number }>();
  const sold: SoldCost[] = [];
  const lastUnitCost = new Map<string, number>();
  const lastSeen = new Map<string, { day: string; ms: number }>();

  for (const e of opts.events) {
    if (e.kind === "purchase") {
      if (!(e.stems > 0)) continue;
      steps.push({
        day: e.date, phase: 0, ms: e.createdAt,
        run: () => {
          queue(e.variety).list.push({ day: e.date, left: e.stems, unitCost: e.cost / e.stems });
          const seen = lastSeen.get(e.variety);
          if (!seen || e.date > seen.day || (e.date === seen.day && e.createdAt >= seen.ms)) {
            lastSeen.set(e.variety, { day: e.date, ms: e.createdAt });
            lastUnitCost.set(e.variety, e.cost / e.stems);
          }
        },
      });
    } else if (e.kind === "shrink") {
      steps.push({ day: e.date, phase: 1, ms: e.createdAt, run: () => shrink.set(e.id, draw(e.variety, e.stems)) });
    }
  }

  const consumeLines = (source: "order" | "sale", id: string, day: string, lines: { slug: string | null; qty: number }[]) => {
    for (const l of lines) {
      const recipe = l.slug ? opts.recipeBySlug.get(l.slug) : undefined;
      if (!l.slug || !recipe) continue;
      let cost = 0;
      let unpriced = 0;
      for (const part of recipe.parts) {
        const d = draw(part.variety, part.stems * l.qty);
        cost += d.cost;
        unpriced += d.unpriced;
      }
      sold.push({ source, id, slug: l.slug, qty: l.qty, cost, unpriced, day });
    }
  };

  for (const o of opts.orders) {
    if (o.status !== "made" && o.status !== "out" && o.status !== "done") continue;
    const ms = new Date(o.date + "T12:00:00").getTime();
    steps.push({ day: o.date, phase: 1, ms, run: () => consumeLines("order", o.id, o.date, o.lines) });
  }
  for (const s of opts.sales) {
    if (s.workroomOrderId || s.lines.length === 0) continue;
    const ms = saleInstantMs(s.paidAt, s.createdAt);
    const day = isoDate(new Date(ms));
    steps.push({ day, phase: 1, ms, run: () => consumeLines("sale", s.id, day, s.lines) });
  }

  steps.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.phase - b.phase || a.ms - b.ms));
  for (const s of steps) s.run();

  const onHand = new Map<string, { stems: number; cost: number; oldest: string | null }>();
  const currentUnitCost = new Map<string, number>();
  for (const [variety, q] of lots) {
    let stems = 0;
    let cost = 0;
    let oldest: string | null = null;
    for (let i = q.head; i < q.list.length; i++) {
      const lot = q.list[i];
      if (lot.left <= 0) continue;
      if (oldest === null) oldest = lot.day;
      stems += lot.left;
      cost += lot.left * lot.unitCost;
    }
    onHand.set(variety, { stems, cost, oldest });
    const last = lastUnitCost.get(variety);
    if (stems > 0) currentUnitCost.set(variety, cost / stems);
    else if (last != null) currentUnitCost.set(variety, last);
  }

  return { shrink, sold, onHand, lastUnitCost, currentUnitCost };
}

/** The most recent invoice price per stem, per variety: what a quote or a
    new buy should start from. The lot walk with nothing consumed. */
export function lastUnitCostMap(events: LotEventLike[]): Map<string, number> {
  return lotCosting({ events, orders: [], sales: [], recipeBySlug: new Map() }).lastUnitCost;
}
