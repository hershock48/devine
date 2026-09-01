"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { products } from "@/lib/catalog";
import { field, labelText, money, textButton, todayISO, MemoryWarning, PinGate } from "@/components/workroom/ui";
import { HISTORY_DAYS, consumption, costPerStemMap, isoDate, mondayOf, normalizeVariety, saleInstantMs, shrinkTotals } from "@/lib/workroom/derive";

/**
 * STEMS: the flower ledger, whole. Stems & shrink and Inventory were two
 * tabs for one job (what is in the cooler, what died, what it costs) built
 * on the same ledgers, and Kevin merged them 2026-09-01 when the header
 * filled up. This page is now the shop's entire flower story except the
 * truck order (Weekly order, which logs purchases in one tap) and the glance
 * numbers (the Dashboard, which reads what this page writes).
 *
 * The mechanics are three small ledgers and one shared derivation
 * (lib/workroom/derive.ts, same arithmetic as the Dashboard):
 *
 *   purchases   what came in and what it cost -> a cost per stem, per variety
 *   shrink      what got tossed and why       -> priced at what was PAID,
 *                                               never typed twice
 *   recipes     which stems make which product -> cost of goods per
 *                                               arrangement, and the key that
 *                                               unlocks everything else
 *
 * RECIPES ARE THE KEYSTONE, and the page says so: made counts, margins, the
 * cooler's decrement and the quote prefills all starve without them. Nobody
 * should write 57 recipes; the page names the handful worth writing (what
 * actually sells, uncovered first) and one tap loads each into the form.
 *
 * THE CLEANOUT IS A WALK. The owner tosses wilted stems from several
 * varieties in one pass down the rack, so the cooler table lets her log a
 * toss on the row she is looking at: tap Toss, count, why, done. The
 * standalone toss form stays for backdating and for varieties that have not
 * moved in the window.
 *
 * Every number traces to a row someone typed or a register ring; nothing is
 * estimated silently. Where a cost is unknowable (no purchase of that
 * variety yet, no recipe on a product) the page says so instead of printing
 * a guess (glaze.md's placeholder rule, applied to arithmetic).
 */

type StemEvent = {
  id: string;
  kind: "purchase" | "shrink";
  date: string;
  variety: string;
  stems: number;
  cost: number;
  reason: string;
  createdAt: number;
};
type Recipe = { slug: string; parts: { variety: string; stems: number }[] };
type Order = {
  id: string;
  status: string;
  date: string;
  lines: { slug: string | null; name: string; qty: number; each: number }[];
  subtotal: number;
};
type Sale = {
  id: string;
  paidAt: string;
  createdAt: number;
  workroomOrderId?: string;
  lines: { slug: string | null; qty: number; totalCents: number }[];
};
type Variety = {
  name: string;
  kind: "flower" | "green";
  sellStem: number | null;
  sellBunch: number | null;
  stemsPerBunch: number | null;
};

const REASONS = ["wilted", "damaged", "overbought", "event fell through", "other"];

const productName = new Map(products.map((p) => [p.slug, p.name]));
const productPrice = new Map(products.map((p) => [p.slug, p.price]));

/** Products a recipe can exist FOR: anything that is not purely a gift item.
    Chocolate, tea, plush and chimes have no stems in them, so they never
    count against recipe coverage. */
const recipeEligible = products.filter((p) => p.cats.some((c) => c !== "gifts-add-ons"));
const recipeEligibleSlugs = new Set(recipeEligible.map((p) => p.slug));
/** The recipe picker's option list: eligible designs only, by name. */
const sortedEligible = [...recipeEligible].sort((a, b) => a.name.localeCompare(b.name));

/** Monday-to-Sunday week containing the given yyyy-mm-dd (the shared Monday
    anchor from derive.ts, so this page's week and the dashboard's Week range
    can never cover different days). Falls back to the current week when
    handed garbage: the anchor comes from a date input the user can clear,
    and a cleared input must not print "week of NaN-NaN". */
function weekOf(dateISO: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) dateISO = todayISO();
  const monday = mondayOf(new Date(dateISO + "T12:00:00"));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { from: isoDate(monday), to: isoDate(sunday) };
}

export default function Stems({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [events, setEvents] = useState<StemEvent[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [backend, setBackend] = useState("memory");
  const [anchor, setAnchor] = useState(todayISO());
  const [coolerDays, setCoolerDays] = useState(14);
  /** A recipe slug asked for from the missing-recipe list; the form loads it. */
  const [pickSlug, setPickSlug] = useState("");

  const pull = useCallback(async () => {
    // The full shared history: costing must use the same denominator as the
    // dashboard or the same toss prices differently on two tabs. It also
    // lets the week picker reach back a whole year.
    const r = await fetch(`/api/workroom/stems?days=${HISTORY_DAYS}`, { cache: "no-store" });
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    const d = await r.json();
    setEvents(d.events ?? []);
    setRecipes(d.recipes ?? []);
    setOrders(d.orders ?? []);
    setSales(d.squareSales ?? []);
    setVarieties(d.varieties ?? []);
    setBackend(d.backend ?? "memory");
    setAuthed(true);
  }, []);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
  }, [authed, pull]);

  /* The shared blended average over the loaded history (derive.ts), so a
     toss prices the same here as on the Dashboard tile. */
  const costPerStem = useMemo(() => costPerStemMap(events), [events]);

  // The master stem list first (this page's own namespace since the merge),
  // plus anything the ledgers mention that the list somehow does not.
  const knownVarieties = useMemo(
    () => [...new Set([...varieties.map((v) => v.name), ...events.map((e) => e.variety)])].sort(),
    [varieties, events],
  );
  const recipeBySlug = useMemo(() => new Map(recipes.map((r) => [r.slug, r])), [recipes]);
  const varietyByName = useMemo(() => new Map(varieties.map((v) => [v.name, v])), [varieties]);
  /** The master list's names alone: what a recipe may reference. The entry
      forms keep the wider ledger-known set, because a purchase is a fact
      and facts may bring new names. */
  const masterNames = useMemo(() => varieties.map((v) => v.name).sort(), [varieties]);

  /** Stem cost of ONE unit of a product, or null when the recipe is missing
      or any part is unpriced: costed only when whole, the one costing rule
      for the week figures and the margins table alike (they were two loops
      that could have drifted). */
  const recipeCost = useCallback(
    (slug: string): number | null => {
      const recipe = recipeBySlug.get(slug);
      if (!recipe) return null;
      let cost = 0;
      for (const part of recipe.parts) {
        const c = costPerStem.get(part.variety);
        if (c == null) return null;
        cost += c * part.stems;
      }
      return cost;
    },
    [recipeBySlug, costPerStem],
  );

  /* ---------------- the cooler (windowed ledger) ---------------- */

  const coolerStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - coolerDays);
    return isoDate(d);
  }, [coolerDays]);

  const cooler = useMemo(() => {
    const rows = new Map<string, { bought: number; tossed: number; made: number; cost: number; reasons: Map<string, number> }>();
    const row = (v: string) => {
      let r = rows.get(v);
      if (!r) rows.set(v, (r = { bought: 0, tossed: 0, made: 0, cost: 0, reasons: new Map() }));
      return r;
    };

    for (const e of events) {
      if (e.date < coolerStart) continue;
      if (e.kind === "purchase") {
        row(e.variety).bought += e.stems;
        row(e.variety).cost += e.cost;
      } else {
        const r = row(e.variety);
        r.tossed += e.stems;
        const why = e.reason || "other";
        r.reasons.set(why, (r.reasons.get(why) ?? 0) + e.stems);
      }
    }

    /* Consumption is the SHARED rule (derive.ts): made/out/done orders plus
       unlinked register sales, uncountables counted. Sales window by their
       instant, never a sliced ISO string (the slice read UTC). */
    const startMs = new Date(coolerStart + "T00:00:00").getTime();
    const consumed = consumption({
      orders,
      sales,
      recipeBySlug,
      orderInWindow: (dateISO) => dateISO >= coolerStart,
      saleInWindow: (s) => saleInstantMs((s as Sale).paidAt, (s as Sale).createdAt) >= startMs,
    });
    for (const [variety, stems] of consumed.made) row(variety).made += stems;

    return { rows, unrecipedLines: consumed.unrecipedLines, customSales: consumed.customSales };
  }, [events, orders, sales, recipeBySlug, coolerStart]);

  const onHand = useCallback(
    (v: string) => {
      const r = cooler.rows.get(v);
      return r ? r.bought - r.tossed - r.made : 0;
    },
    [cooler],
  );

  const canMake = useMemo(() => {
    const out: { slug: string; n: number }[] = [];
    for (const r of recipes) {
      if (r.parts.length === 0) continue;
      let n = Infinity;
      for (const part of r.parts) n = Math.min(n, Math.floor(onHand(part.variety) / part.stems));
      out.push({ slug: r.slug, n: Math.max(0, n) });
    }
    return out.sort((a, b) => b.n - a.n);
  }, [recipes, onHand]);

  /* Worst shrink first: the number that changes next Tuesday's order. Only
     varieties with real movement rank, so one tossed stem of something she
     bought two of does not headline. */
  const worstShrink = useMemo(() => {
    const out: { name: string; pct: number; tossed: number; why: string }[] = [];
    for (const [name, r] of cooler.rows) {
      if (r.bought < 10 || r.tossed === 0) continue;
      const why = [...r.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
      out.push({ name, pct: Math.round((r.tossed / r.bought) * 100), tossed: r.tossed, why });
    }
    return out.sort((a, b) => b.pct - a.pct).slice(0, 3);
  }, [cooler]);

  const moved = useMemo(() => [...cooler.rows.keys()].sort(), [cooler]);

  /* ---------------- what sold, per product ---------------- */

  /** Product sales aggregated over a window: board order lines (by requested
      date) plus item-rung register sales (by instant, linked ones skipped:
      their lines are the ticket's lines). null dates mean "whole history". */
  const soldBetween = useCallback(
    (fromISO: string | null, toISO: string | null) => {
      const sold = new Map<string, { qty: number; revenue: number }>();
      const add = (slug: string, qty: number, revenue: number) => {
        const s = sold.get(slug) ?? { qty: 0, revenue: 0 };
        s.qty += qty;
        s.revenue += revenue;
        sold.set(slug, s);
      };
      for (const o of orders) {
        if (o.status === "canceled") continue;
        if (fromISO && (o.date < fromISO || o.date > toISO!)) continue;
        for (const l of o.lines) if (l.slug) add(l.slug, l.qty, l.each * l.qty);
      }
      const fromMs = fromISO ? new Date(fromISO + "T00:00:00").getTime() : -Infinity;
      const endMs = toISO ? new Date(toISO + "T00:00:00").getTime() + 86_400_000 : Infinity;
      for (const s of sales) {
        if (s.workroomOrderId) continue;
        const ms = saleInstantMs(s.paidAt, s.createdAt);
        if (ms < fromMs || ms >= endMs) continue;
        for (const l of s.lines) if (l.slug) add(l.slug, l.qty, l.totalCents / 100);
      }
      return sold;
    },
    [orders, sales],
  );

  /* ---------------- recipes: coverage and the worth-writing list -------- */

  const recipeCoverage = useMemo(() => {
    const covered = recipeEligible.filter((p) => recipeBySlug.has(p.slug)).length;
    // What sold, ever loaded, that has no recipe: the handful worth writing,
    // biggest seller first. She should never face all 57.
    const soldAll = soldBetween(null, null);
    const missing = [...soldAll.entries()]
      .filter(([slug]) => !recipeBySlug.has(slug) && recipeEligibleSlugs.has(slug))
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([slug, s]) => ({ slug, qty: s.qty, revenue: s.revenue }));
    return { covered, total: recipeEligible.length, missing };
  }, [recipeBySlug, soldBetween]);

  /* ---------------- the week report ---------------- */

  const week = weekOf(anchor);
  /*
    The page loads HISTORY_DAYS. Pick an older week and every figure computes
    to a perfectly convincing zero, which on a page whose whole job is giving
    her numbers she has never had, reads as "no shrink that week" rather than
    "not loaded". Say which it is.
  */
  const windowStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - HISTORY_DAYS);
    return isoDate(d);
  })();
  const outsideWindow = week.from < windowStart;

  const report = useMemo(() => {
    const inWeek = (d: string) => d >= week.from && d <= week.to;

    const bought = { stems: 0, cost: 0 };
    const weekTossed: StemEvent[] = [];
    for (const e of events) {
      if (!inWeek(e.date)) continue;
      if (e.kind === "purchase") {
        bought.stems += e.stems;
        bought.cost += e.cost;
      } else weekTossed.push(e);
    }
    // Priced by the shared rule (derive.ts), same as the dashboard's tile.
    const s = shrinkTotals(weekTossed, costPerStem);
    const tossed = { stems: s.stems, cost: s.cost, unknown: s.unpriced };

    /*
      What sold: board lines plus item-rung register sales, the same two
      sources as the dashboard's best sellers. The first version counted
      board orders only, so counter-rung recipe products were invisible to
      the margin table while the cooler was decrementing for them.
    */
    const sold = soldBetween(week.from, week.to);
    let stemCost = 0;
    let uncostedUnits = 0;
    for (const [slug, sale] of sold) {
      const cost = recipeCost(slug);
      if (cost == null) uncostedUnits += sale.qty;
      else stemCost += cost * sale.qty;
    }

    return { bought, tossed, stemCost, uncostedUnits, sold };
  }, [events, costPerStem, recipeCost, soldBetween, week.from, week.to]);

  if (!authed) {
    return (
      <>
        <h1>Stems</h1>
        <PinGate onAuthed={() => setAuthed(true)} />
      </>
    );
  }

  const shrinkRate = report.bought.stems > 0 ? (report.tossed.stems / report.bought.stems) * 100 : null;

  const th: React.CSSProperties = {
    textAlign: "right",
    padding: "6px 8px",
    borderBottom: "1px solid var(--line)",
    fontSize: 12.5,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--muted)",
  };
  const td: React.CSSProperties = {
    textAlign: "right",
    padding: "6px 8px",
    borderBottom: "1px solid var(--line)",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <>
      <h1>Stems</h1>

      <MemoryWarning backend={backend} />

      {/* No lede, on purpose. The screen once introduced itself here; Kevin
          cut it (2026-09-01): the sections are self-explanatory, and copy
          about the page is glaze.md's own thing to cut. Do not re-add. */}

      {/* ---------------- the cooler ---------------- */}
      <section className="panel" style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>In the cooler</h2>
          <label style={{ fontSize: 14.5, display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted">Counting the last</span>
            <select value={coolerDays} onChange={(e) => setCoolerDays(Number(e.target.value))} style={{ ...field, width: "auto" }}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
          Bought minus tossed minus made since {coolerStart}; ledger arithmetic, not a shelf count.
          Stems older than the window count as gone.
        </p>
        {(cooler.unrecipedLines > 0 || cooler.customSales > 0) && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
            Not counted:{" "}
            {cooler.unrecipedLines > 0 && `${cooler.unrecipedLines} sold line(s) with no recipe`}
            {cooler.unrecipedLines > 0 && cooler.customSales > 0 && " and "}
            {cooler.customSales > 0 && `${cooler.customSales} register sale(s) rung as a bare amount`}
            .
          </p>
        )}

        {moved.length === 0 ? (
          <p style={{ margin: "16px 0 0" }}>
            Nothing has moved in this window yet. Purchases arrive here from the weekly order (or
            the forms below), sales through the board and the register.
          </p>
        ) : (
          <div tabIndex={0} role="region" aria-label="Stems on hand" style={{ overflowX: "auto", marginTop: 14, position: "relative" }}>
            {/* position: relative on the wrapper, because the sr-only spans
                inside are position: absolute: without a positioned ancestor
                they resolve against the PAGE, escape this wrapper's clip,
                and a span whose static position is the table's far-right
                column stretches the whole document to 688px at a 390
                viewport (the width check caught it; rect sweeps could not,
                since the span is 1px wide). */}
            <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 14.5 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Variety</th>
                  <th style={th}>Bought</th>
                  <th style={th}>Tossed</th>
                  <th style={th}>Shrink</th>
                  <th style={th}>Made</th>
                  <th style={th}>On hand</th>
                  <th style={th}>Cost/stem</th>
                  <th style={th}><span className="sr-only">Log a toss</span></th>
                </tr>
              </thead>
              <tbody>
                {moved.map((name) => {
                  const r = cooler.rows.get(name)!;
                  const hand = r.bought - r.tossed - r.made;
                  /* Windowed on purpose, and NOT the shared blended average
                     (derive.ts): this column answers "what did this
                     window's buys cost per stem", while toss pricing and
                     recipe costing everywhere use the long blended
                     average. Two different questions, two numbers. */
                  const cps = r.bought > 0 ? r.cost / r.bought : null;
                  return (
                    <CoolerRow
                      key={name}
                      name={name}
                      r={r}
                      hand={hand}
                      cps={cps}
                      td={td}
                      onSaved={pull}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {worstShrink.length > 0 && (
          <p style={{ margin: "10px 0 0", fontSize: 14.5 }}>
            Dying in the cooler:{" "}
            {worstShrink.map((w, i) => (
              <span key={w.name}>
                {i > 0 && ", "}
                <strong style={{ color: w.pct >= 15 ? "var(--rose-ink)" : "var(--ink)" }}>{w.name} {w.pct}%</strong>
                {` (${w.tossed} stems, mostly ${w.why})`}
              </span>
            ))}
            .
          </p>
        )}
      </section>

      {/* ---------------- can make ---------------- */}
      {canMake.length > 0 && (
        <section className="panel" style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>What the cooler can build</h2>
          <p className="muted" style={{ margin: "8px 0 12px", fontSize: 14 }}>
            Per recipe, the scarcest stem decides. Products without a recipe are not listed.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 15, display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {canMake.map(({ slug, n }) => (
              <li key={slug} style={{ display: "flex", justifyContent: "space-between", gap: 10, borderBottom: "1px solid var(--line)", padding: "5px 0" }}>
                <span>{productName.get(slug) ?? slug}</span>
                <strong style={{ fontVariantNumeric: "tabular-nums", color: n === 0 ? "var(--rose-ink)" : "var(--green)" }}>{n}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------------- the week ---------------- */}
      <section className="panel" style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>
            The week of {week.from}
          </h2>
          <label style={{ fontSize: 14.5, display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted">Pick any day in a week</span>
            <input type="date" value={anchor} min={windowStart} onChange={(e) => setAnchor(e.target.value)} style={{ ...field, width: "auto" }} />
          </label>
        </div>

        {outsideWindow && (
          <p role="status" style={{ margin: "14px 0 0", fontSize: 14.5, fontWeight: 600, color: "var(--rose-ink)" }}>
            That week is older than the {HISTORY_DAYS} days this page loads, so the figures below
            are blank rather than real. Nothing is missing from the shop&rsquo;s records.
          </p>
        )}

        <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", margin: "18px 0 6px" }}>
          <Figure label="Stems bought" value={`${report.bought.stems}`} sub={money(report.bought.cost)} />
          <Figure
            label="Stems tossed"
            value={`${report.tossed.stems}`}
            sub={report.tossed.cost > 0 ? `${money(report.tossed.cost)} paid for` : "—"}
            tone={report.tossed.stems > 0 ? "bad" : undefined}
          />
          <Figure
            label="Shrink"
            value={shrinkRate == null ? "—" : `${shrinkRate.toFixed(0)}%`}
            sub="tossed ÷ bought"
            tone={shrinkRate != null && shrinkRate > 15 ? "bad" : undefined}
          />
          <Figure
            label="Stems in what sold"
            value={money(report.stemCost)}
            sub={report.uncostedUnits > 0 ? `${report.uncostedUnits} sold item(s) not costable yet` : "recipe-costed"}
          />
        </div>
        {report.tossed.unknown > 0 && (
          <p className="muted" style={{ fontSize: 14, margin: "8px 0 0" }}>
            {report.tossed.unknown} tossed stem(s) have no purchase on record; cost unknown, not guessed.
          </p>
        )}

        {report.sold.size > 0 && (
          /* The table scrolls inside its own box on a phone; five columns at
             390px must never be the page's problem. tabIndex + role because a
             scrollable region a keyboard cannot reach cannot be scrolled by
             keyboard. Rows carry board lines AND item-rung register sales. */
          <div tabIndex={0} role="region" aria-label="Products sold this week" style={{ overflowX: "auto", marginTop: 18 }}>
          <table style={{ width: "100%", minWidth: 460, borderCollapse: "collapse", fontSize: 14.5 }}>
            <thead>
              <tr>
                {["Product", "Sold", "Revenue", "Stem cost", "Margin"].map((h, i) => (
                  <th key={h} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...report.sold.entries()]
                .sort((a, b) => b[1].revenue - a[1].revenue)
                .map(([slug, s]) => {
                const recipe = recipeBySlug.get(slug);
                const cost = recipeCost(slug);
                return (
                  <tr key={slug}>
                    <td style={{ ...td, textAlign: "left" }}>{productName.get(slug) ?? slug}</td>
                    <td style={td}>{s.qty}</td>
                    <td style={td}>{money(s.revenue)}</td>
                    <td style={td}>{cost == null ? (recipe ? "cost unknown" : "no recipe") : money(cost * s.qty)}</td>
                    <td style={td}>
                      {cost == null || s.revenue === 0 ? "—" : `${Math.round(((s.revenue - cost * s.qty) / s.revenue) * 100)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {/* ---------------- recipes ---------------- */}
      {/* THE BOOK BEFORE THE PEN. The first version was a form with no read
          view: the only way to see a recipe was to select its product in a
          dropdown, and Kevin read the whole section as half done. He was
          right. What exists is listed first, legibly; the editor follows. */}
      <section className="panel" style={{ marginBottom: 26 }}>
        <h2 style={{ fontSize: 22, margin: 0 }}>Recipes</h2>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
          Recipes cover {recipeCoverage.covered} of {recipeCoverage.total} designs (gift items need
          none). A recipe turns a sale into counted stems, a margin, and a prefilled quote.
        </p>

        {recipes.length === 0 ? (
          <p style={{ margin: "12px 0 0", fontSize: 14.5 }}>
            None written yet. A recipe is the stem list inside one design: a dozen red roses might
            be 12 roses + 4 eucalyptus.
          </p>
        ) : (
          <div style={{ margin: "12px 0 0" }}>
            {[...recipes]
              .sort((a, b) => (productName.get(a.slug) ?? a.slug).localeCompare(productName.get(b.slug) ?? b.slug))
              .map((r) => {
                const name = productName.get(r.slug) ?? r.slug;
                const price = productPrice.get(r.slug);
                const cost = recipeCost(r.slug);
                return (
                  <div key={r.slug} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "6px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600 }}>{name}</span>
                    <span className="muted" style={{ flex: "1 1 200px", minWidth: 0 }}>
                      {r.parts.map((p) => `${p.stems} ${p.variety}`).join(" + ") || "no parts yet"}
                    </span>
                    <span style={{ fontSize: 14, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {cost == null
                        ? "cost unknown"
                        : price != null && price > 0
                          ? `${money(cost)} of ${money(price)} · ${Math.round(((price - cost) / price) * 100)}%`
                          : money(cost)}
                    </span>
                    <button type="button" onClick={() => setPickSlug(r.slug)} style={{ ...textButton, fontSize: 13.5 }}>
                      Edit<span className="sr-only"> the {name} recipe</span>
                    </button>
                  </div>
                );
              })}
          </div>
        )}

        {recipeCoverage.missing.length > 0 && (
          <div style={{ margin: "12px 0 4px" }}>
            <p style={{ margin: "0 0 6px", fontSize: 14.5, fontWeight: 600 }}>
              Worth writing first:
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {recipeCoverage.missing.map((m) => (
                <button
                  key={m.slug}
                  type="button"
                  onClick={() => setPickSlug(m.slug)}
                  style={{
                    font: "inherit", fontSize: 14, cursor: "pointer",
                    border: "1px solid var(--line)", borderRadius: 3, background: "var(--paper)",
                    padding: "6px 10px", color: "var(--ink)",
                  }}
                >
                  {productName.get(m.slug) ?? m.slug} <span className="muted">({m.qty} sold, {money(m.revenue)})</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <RecipeForm
            recipes={recipeBySlug}
            varieties={masterNames}
            costPerStem={costPerStem}
            pickSlug={pickSlug}
            onSaved={() => {
              setPickSlug("");
              pull();
            }}
          />
        </div>
      </section>

      {/* ---------------- the ledgers ---------------- */}
      {/* min(300px, 100%): a bare 300px minimum overflows the wrap by 28px at
          a 320 viewport (found by the width check; the wrap offers 272px). */}
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <EventForm kind="purchase" varieties={knownVarieties} onSaved={pull} />
          <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
            The truck does this in one tap, on <a href="/workroom/weekly-order">Weekly order</a>.
          </p>
        </div>
        <EventForm kind="shrink" varieties={knownVarieties} onSaved={pull} />
      </div>

      <div style={{ marginTop: 26 }}>
        <VarietyList varieties={varieties} varietyByName={varietyByName} onHand={onHand} onSaved={pull} />
      </div>

      <RecentEvents events={events} onDeleted={pull} />
    </>
  );
}

/* ------------------------- the cooler row ------------------------- */

/**
 * One variety's line, with the toss built in: tap Toss, count, why, save.
 * The date is today on purpose; a cleanout is happening now, and backdating
 * lives in the standalone form below.
 */
function CoolerRow({
  name,
  r,
  hand,
  cps,
  td,
  onSaved,
}: {
  name: string;
  r: { bought: number; tossed: number; made: number };
  hand: number;
  cps: number | null;
  td: React.CSSProperties;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [stems, setStems] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [error, setError] = useState("");
  const shrinkPct = r.bought > 0 && r.tossed > 0 ? Math.round((r.tossed / r.bought) * 100) : null;

  async function toss() {
    setError("");
    const res = await fetch("/api/workroom/stems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "shrink", variety: name, stems: Number(stems), reason, date: todayISO() }),
    });
    const d = await res.json().catch(() => null);
    if (!res.ok) {
      setError(d?.error || "That did not save.");
      return;
    }
    setOpen(false);
    setStems("");
    onSaved();
  }

  return (
    <>
      <tr>
        <td style={{ ...td, textAlign: "left" }}>{name}</td>
        <td style={td}>{r.bought}</td>
        <td style={td}>{r.tossed || ""}</td>
        <td style={{ ...td, color: shrinkPct != null && shrinkPct >= 15 ? "var(--rose-ink)" : "var(--muted)" }}>
          {shrinkPct == null ? "" : `${shrinkPct}%`}
        </td>
        <td style={td}>{r.made || ""}</td>
        <td style={{ ...td, fontWeight: 700, color: hand < 0 ? "var(--rose-ink)" : "var(--ink)" }}>{hand}</td>
        <td style={td}>{cps == null ? "—" : money(cps)}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>
          <button type="button" onClick={() => setOpen((o) => !o)} style={{ ...textButton, fontSize: 13.5, color: open ? "var(--muted)" : "var(--rose-ink)" }}>
            {open ? "Cancel" : "Toss"}
            <span className="sr-only"> {name}</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ padding: "8px 8px 12px", borderBottom: "1px solid var(--line)", background: "var(--paper)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>Tossing {name}, today:</span>
              <input
                aria-label={`Stems of ${name} tossed`}
                inputMode="numeric"
                placeholder="stems"
                value={stems}
                onChange={(e) => setStems(e.target.value)}
                style={{ ...field, width: 90 }}
                autoFocus
              />
              <select aria-label="Why" value={reason} onChange={(e) => setReason(e.target.value)} style={{ ...field, width: "auto" }}>
                {REASONS.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
              <button className="btn btn--solid" type="button" onClick={toss} disabled={!(Number(stems) > 0)}>
                Log the toss
              </button>
              <span aria-live="polite" style={{ fontSize: 14, color: "var(--rose-ink)", fontWeight: 600 }}>{error}</span>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div>
      <p style={{ margin: 0, fontSize: 12.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 700 }}>{label}</p>
      <p style={{ margin: "2px 0 0", fontSize: 28, fontFamily: "var(--serif)", color: tone === "bad" ? "var(--rose-ink)" : "var(--ink)", fontVariantNumeric: "tabular-nums" }}>{value}</p>
      {sub && <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>{sub}</p>}
    </div>
  );
}

function EventForm({ kind, varieties, onSaved }: { kind: "purchase" | "shrink"; varieties: string[]; onSaved: () => void }) {
  const [date, setDate] = useState(todayISO());
  const [variety, setVariety] = useState("");
  const [stems, setStems] = useState("");
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const stemsN = Number(stems);
  const costN = Number(cost);
  const perStem = kind === "purchase" && stemsN > 0 && costN > 0 ? costN / stemsN : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved("");
    const r = await fetch("/api/workroom/stems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, date, variety, stems: stemsN, cost: costN, reason }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setError(d?.error || "That did not save.");
      return;
    }
    setSaved(kind === "purchase" ? `${stems} ${variety.trim().toLowerCase()} in.` : `${stems} ${variety.trim().toLowerCase()} logged as ${reason}.`);
    setVariety("");
    setStems("");
    setCost("");
    onSaved();
  }

  const list = `varieties-${kind}`;
  return (
    <form onSubmit={submit} className="panel" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ fontSize: 20, margin: 0 }}>{kind === "purchase" ? "Stems in" : "Stems tossed"}</h2>
      {kind === "shrink" && (
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          For backdating; a live cleanout is faster from the cooler table&rsquo;s Toss buttons.
        </p>
      )}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <label>
          <span style={labelText}>Day</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={field} />
        </label>
        <label>
          <span style={labelText}>Variety</span>
          <input list={list} value={variety} onChange={(e) => setVariety(e.target.value)} required placeholder="roses" style={field} />
          <datalist id={list}>
            {varieties.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </label>
        <label>
          <span style={labelText}>Stems</span>
          <input inputMode="numeric" value={stems} onChange={(e) => setStems(e.target.value)} required style={field} />
        </label>
        {kind === "purchase" ? (
          <label>
            <span style={labelText}>Paid, total</span>
            <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} required placeholder="$" style={field} />
          </label>
        ) : (
          <label>
            <span style={labelText}>Why</span>
            <select value={reason} onChange={(e) => setReason(e.target.value)} style={field}>
              {REASONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {perStem != null && (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {money(perStem)} a stem.
        </p>
      )}
      <p style={{ margin: 0, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn--solid" type="submit">
          {kind === "purchase" ? "Log the buy" : "Log the toss"}
        </button>
        <span aria-live="polite" style={{ fontSize: 14, color: error ? "var(--rose-ink)" : "var(--green)", fontWeight: 600 }}>
          {error || saved}
        </span>
      </p>
    </form>
  );
}

function RecipeForm({
  recipes,
  varieties,
  costPerStem,
  pickSlug,
  onSaved,
}: {
  recipes: Map<string, Recipe>;
  varieties: string[];
  costPerStem: Map<string, number>;
  /** A slug asked for from outside (the worth-writing list); loads on change. */
  pickSlug?: string;
  onSaved: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [parts, setParts] = useState<{ variety: string; stems: string }[]>([{ variety: "", stems: "" }]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  /** Names added to the master list from THIS form (the one-tap add). Held
      locally instead of refetching, because a refetch mid-edit would reload
      the picked recipe over unsaved parts. */
  const [extraNames, setExtraNames] = useState<string[]>([]);

  /* What a recipe may reference: the master list, per the retraction note
     in the recipes route. A typo is flagged in place, and a genuinely new
     variety is one tap, not a silent list entry. */
  const listed = useMemo(() => new Set([...varieties, ...extraNames]), [varieties, extraNames]);
  const suggest = useMemo(() => [...new Set([...varieties, ...extraNames])].sort(), [varieties, extraNames]);

  async function addToList(name: string) {
    setError("");
    const r = await fetch("/api/workroom/varieties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind: "flower", sellStem: "", sellBunch: "", stemsPerBunch: "" }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setError(d?.error || "That did not save.");
      return;
    }
    setExtraNames((cur) => [...cur, d?.variety?.name ?? name]);
  }

  // Choosing a product loads its saved recipe, so editing is the same motion
  // as creating and there is no second UI to learn.
  const pick = useCallback(
    (next: string) => {
      setSlug(next);
      setSaved("");
      setError("");
      const existing = recipes.get(next);
      setParts(
        existing && existing.parts.length
          ? existing.parts.map((p) => ({ variety: p.variety, stems: String(p.stems) }))
          : [{ variety: "", stems: "" }],
      );
    },
    [recipes],
  );

  useEffect(() => {
    if (pickSlug) pick(pickSlug);
  }, [pickSlug, pick]);

  const price = slug ? productPrice.get(slug) ?? null : null;
  let liveCost: number | null = 0;
  for (const p of parts) {
    const v = p.variety.trim().toLowerCase();
    const n = Number(p.stems);
    if (!v || !(n > 0)) continue;
    const c = costPerStem.get(v);
    if (c == null) {
      liveCost = null;
      break;
    }
    liveCost += c * n;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved("");
    // Same check the server enforces, said here first so the refusal sits
    // next to the field instead of arriving as a failed save.
    const unknowns = [
      ...new Set(
        parts
          .filter((p) => p.variety.trim() && Number(p.stems) > 0)
          .map((p) => normalizeVariety(p.variety))
          .filter((v) => !listed.has(v)),
      ),
    ];
    if (unknowns.length > 0) {
      setError(`Not on the stem list: ${unknowns.join(", ")}. Add ${unknowns.length === 1 ? "it" : "them"} with the button by the field, or fix the spelling.`);
      return;
    }
    const r = await fetch("/api/workroom/recipes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        parts: parts.filter((p) => p.variety.trim() && Number(p.stems) > 0).map((p) => ({ variety: p.variety, stems: Number(p.stems) })),
      }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setError(d?.error || "That did not save.");
      return;
    }
    setSaved("Recipe saved.");
    onSaved();
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, maxWidth: 480 }}>
      <label>
        <span style={labelText}>Product</span>
        {/* Recipe-eligible designs only (a chocolate box has no stems), and
            written-versus-needed said in words: the first version offered
            all 57 products and marked existing recipes with a bare dot. */}
        <select value={slug} onChange={(e) => pick(e.target.value)} required style={field}>
          <option value="">Choose one</option>
          {sortedEligible.some((p) => !recipes.has(p.slug)) && (
            <optgroup label="Needs a recipe">
              {sortedEligible.filter((p) => !recipes.has(p.slug)).map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} ({money(p.price)})
                </option>
              ))}
            </optgroup>
          )}
          {sortedEligible.some((p) => recipes.has(p.slug)) && (
            <optgroup label="Already written">
              {sortedEligible.filter((p) => recipes.has(p.slug)).map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} ({money(p.price)})
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      {slug && (
        <>
          {parts.map((p, i) => {
            const name = normalizeVariety(p.variety);
            const unknown = !!name && !listed.has(name);
            return (
              <div key={i}>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 90px" }}>
                  <input
                    aria-label={`Part ${i + 1} variety`}
                    list="recipe-varieties"
                    placeholder="variety"
                    value={p.variety}
                    onChange={(e) => setParts((cur) => cur.map((x, at) => (at === i ? { ...x, variety: e.target.value } : x)))}
                    style={field}
                  />
                  <input
                    aria-label={`Part ${i + 1} stems`}
                    inputMode="numeric"
                    placeholder="stems"
                    value={p.stems}
                    onChange={(e) => setParts((cur) => cur.map((x, at) => (at === i ? { ...x, stems: e.target.value } : x)))}
                    style={field}
                  />
                </div>
                {unknown && (
                  <p style={{ margin: "4px 0 0", fontSize: 13 }}>
                    <span style={{ color: "var(--rose-ink)", fontWeight: 600 }}>Not on the stem list.</span>{" "}
                    <button type="button" onClick={() => addToList(name)} style={{ ...textButton, fontSize: 13 }}>
                      Add &ldquo;{name}&rdquo; to it
                    </button>{" "}
                    <span className="muted">or fix the spelling.</span>
                  </p>
                )}
              </div>
            );
          })}
          {/* The whole master list, not just purchased varieties: a recipe
              names what the product is made of, whether or not this quarter
              happened to buy it yet. */}
          <datalist id="recipe-varieties">
            {suggest.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <p style={{ margin: 0 }}>
            <button type="button" onClick={() => setParts((cur) => [...cur, { variety: "", stems: "" }])} style={textButton}>
              Another stem
            </button>
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            {liveCost == null
              ? "A variety here has no purchase on record yet, so this recipe cannot be costed."
              : price != null
                ? `${money(liveCost)} of stems in a ${money(price)} product${liveCost > 0 ? `, ${Math.round(((price - liveCost) / price) * 100)}% margin before labor` : ""}.`
                : ""}
          </p>
        </>
      )}
      <p style={{ margin: 0, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn--solid" type="submit" disabled={!slug}>
          Save the recipe
        </button>
        <span aria-live="polite" style={{ fontSize: 14, color: error ? "var(--rose-ink)" : "var(--green)", fontWeight: 600 }}>
          {error || saved}
        </span>
      </p>
    </form>
  );
}

/* ------------------------- the master list ------------------------- */

function VarietyList({
  varieties,
  varietyByName,
  onHand,
  onSaved,
}: {
  varieties: Variety[];
  varietyByName: Map<string, Variety>;
  onHand: (v: string) => number;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", kind: "flower", sellStem: "", sellBunch: "", stemsPerBunch: "" });
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState("");

  async function save(name?: string) {
    setStatus("");
    const body = name ? { ...draft, name } : draft;
    const r = await fetch("/api/workroom/varieties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setStatus(d?.error || "That did not save.");
      return;
    }
    setStatus(`${d.variety.name} saved.`);
    setEditing(null);
    setDraft({ name: "", kind: "flower", sellStem: "", sellBunch: "", stemsPerBunch: "" });
    onSaved();
  }

  async function seed() {
    setStatus("");
    const r = await fetch("/api/workroom/varieties", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed: true }),
    });
    const d = await r.json().catch(() => null);
    setStatus(r.ok ? `${d.added} varieties loaded from her price lists.` : d?.error || "Seeding failed.");
    onSaved();
  }

  async function remove(name: string) {
    if (!window.confirm(`Remove "${name}" from the stem list? Ledger entries that mention it stay.`)) return;
    await fetch("/api/workroom/varieties", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    onSaved();
  }

  function beginEdit(v: Variety) {
    setEditing(v.name);
    setDraft({
      name: v.name,
      kind: v.kind,
      sellStem: v.sellStem == null ? "" : String(v.sellStem),
      sellBunch: v.sellBunch == null ? "" : String(v.sellBunch),
      stemsPerBunch: v.stemsPerBunch == null ? "" : String(v.stemsPerBunch),
    });
  }

  const shown = varieties.filter((v) => !filter || v.name.includes(filter.toLowerCase()));

  const td: React.CSSProperties = { padding: "5px 8px", borderBottom: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" };
  const tdR: React.CSSProperties = { ...td, textAlign: "right" };
  const tiny: React.CSSProperties = { ...field, padding: "5px 7px", fontSize: 14 };

  return (
    <section className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ fontSize: 22, margin: 0 }}>The stem list</h2>
        {varieties.length === 0 ? (
          <button className="btn btn--solid" type="button" onClick={seed}>
            Load her price lists
          </button>
        ) : (
          <input
            aria-label="Filter varieties"
            placeholder="find a variety"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ ...field, width: "auto" }}
          />
        )}
      </div>
      {/* Second person, not third: this copy talks TO the shop, and an early
          draft said "hers to fill" as if the reader were somebody else. */}
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
        Recipes, purchases and the weekly order all pick from these names. Prices came off the
        laminated lists behind the counter; blanks are yours to fill, never guessed.
      </p>

      {varieties.length > 0 && (
        <details style={{ marginTop: 12 }}>
        <summary style={{ fontSize: 14, color: "var(--muted)", cursor: "pointer" }}>
          Open the list ({varieties.length} varieties)
        </summary>
        <div tabIndex={0} role="region" aria-label="Master stem list" style={{ overflowX: "auto", marginTop: 8, position: "relative" }}>
          <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 14.5 }}>
            <thead>
              <tr>
                {["Variety", "Kind", "Sell/stem", "Sell/bunch", "Stems/bunch", "On hand", ""].map((h, i) => (
                  <th key={h || "x"} style={{ textAlign: i === 0 || i === 1 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid var(--line)", fontSize: 12.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((v) =>
                editing === v.name ? (
                  <tr key={v.name}>
                    <td style={td}>{v.name}</td>
                    <td style={td}>
                      <select aria-label="Kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} style={tiny}>
                        <option value="flower">flower</option>
                        <option value="green">green</option>
                      </select>
                    </td>
                    {(["sellStem", "sellBunch", "stemsPerBunch"] as const).map((k) => (
                      <td key={k} style={tdR}>
                        <input
                          aria-label={k}
                          inputMode="decimal"
                          value={draft[k]}
                          onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                          style={{ ...tiny, width: 76, textAlign: "right" }}
                        />
                      </td>
                    ))}
                    <td style={tdR}>{onHand(v.name)}</td>
                    <td style={{ ...tdR, whiteSpace: "nowrap" }}>
                      <button type="button" onClick={() => save(v.name)} style={{ ...textButton, color: "var(--green)", fontWeight: 700 }}>Save</button>{" "}
                      <button type="button" onClick={() => setEditing(null)} style={textButton}>Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={v.name}>
                    <td style={td}>{v.name}</td>
                    <td style={{ ...td, color: "var(--muted)" }}>{v.kind}</td>
                    <td style={tdR}>{v.sellStem == null ? "—" : money(v.sellStem)}</td>
                    <td style={tdR}>{v.sellBunch == null ? "—" : money(v.sellBunch)}</td>
                    <td style={tdR}>{v.stemsPerBunch ?? "—"}</td>
                    <td style={{ ...tdR, fontWeight: 600 }}>{onHand(v.name) || ""}</td>
                    <td style={{ ...tdR, whiteSpace: "nowrap" }}>
                      <button type="button" onClick={() => beginEdit(v)} style={textButton}>Edit</button>{" "}
                      <button type="button" onClick={() => remove(v.name)} style={{ ...textButton, color: "var(--rose-ink)" }}>Remove</button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        </details>
      )}

      {/* add one */}
      {editing === null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!varietyByName.has(draft.name.trim().toLowerCase())) save();
            else setStatus("Already on the list. Edit it in the table.");
          }}
          style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginTop: 16 }}
        >
          <label style={{ flex: "1 1 160px" }}>
            <span style={labelText}>New variety</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="ranunculus" style={field} />
          </label>
          <label>
            <span style={labelText}>Sell/stem</span>
            <input inputMode="decimal" value={draft.sellStem} onChange={(e) => setDraft({ ...draft, sellStem: e.target.value })} placeholder="$" style={{ ...field, width: 90 }} />
          </label>
          <button className="btn btn--solid" type="submit" disabled={!draft.name.trim()}>
            Add it
          </button>
        </form>
      )}
      <p aria-live="polite" style={{ margin: "10px 0 0", fontSize: 14, fontWeight: 600, color: status.includes("saved") || status.includes("loaded") ? "var(--green)" : "var(--rose-ink)", minHeight: "1.3em" }}>
        {status}
      </p>
    </section>
  );
}

function RecentEvents({ events, onDeleted }: { events: StemEvent[]; onDeleted: () => void }) {
  const recent = [...events].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  if (recent.length === 0) return null;

  /*
    A native confirm, deliberately. Everything else on this screen is one tap
    (the working-screen rule), but delete is the one move with no undo and no
    Remove-button counterpart to blame: a mis-tap here silently changes the
    week's numbers. One ugly dialog beats one wrong report.
  */
  async function remove(e: StemEvent) {
    const what =
      e.kind === "purchase" ? `${e.stems} ${e.variety} in, ${money(e.cost)}` : `${e.stems} ${e.variety} tossed`;
    if (!window.confirm(`Remove "${what}" from ${e.date}? The numbers recalculate without it.`)) return;
    await fetch("/api/workroom/stems", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: e.id }),
    });
    onDeleted();
  }

  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 20, margin: "0 0 10px" }}>Recent entries</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14.5 }}>
        {recent.map((e) => (
          <li key={e.id} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
            <span style={{ minWidth: 86 }} className="muted">{e.date}</span>
            <span style={{ flex: 1 }}>
              {e.kind === "purchase"
                ? `${e.stems} ${e.variety} in, ${money(e.cost)}`
                : `${e.stems} ${e.variety} tossed, ${e.reason}`}
            </span>
            <button
              type="button"
              onClick={() => remove(e)}
              style={{ ...textButton, fontSize: 13.5, color: "var(--rose-ink)" }}
            >
              Remove<span className="sr-only"> entry from {e.date}, {e.variety}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
