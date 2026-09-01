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
 *   costing      cost per stem is the blended average over the WHOLE loaded
 *                history, and every screen loads the same HISTORY_DAYS. An
 *                average over a long window means one expensive holiday buy
 *                does not reprice every rose; the same window everywhere
 *                means one number for one toss.
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
