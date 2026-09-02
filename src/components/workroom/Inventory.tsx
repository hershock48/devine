"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { products } from "@/lib/catalog";
import { field, labelText, money, textButton, todayISO, MemoryWarning, PinGate, VarietyGate } from "@/components/workroom/ui";
import { HISTORY_DAYS, consumption, isoDate, lotCosting, normalizeVariety, recipeUnitCost, saleInstantMs } from "@/lib/workroom/derive";

/**
 * INVENTORY: the flower ledger, whole. Stems & shrink and Inventory were
 * two tabs for one job (what is in the cooler, what died, what it costs)
 * built on the same ledgers; Kevin merged them 2026-09-01, then renamed the
 * result Inventory the same day because "Stems" named one block of five.
 * This page is the shop's entire flower story except the truck order
 * (Weekly order, which logs purchases in one tap) and the glance numbers
 * (the Dashboard, which reads what this page writes).
 *
 * THE PAGE READS TOP TO BOTTOM IN DEPENDENCY ORDER, because Kevin read the
 * first layout and could not find the flow ("the master list is what
 * everything is built on, and it is at the bottom"). So:
 *
 *   1. Stem library   the one namespace. Every variety field on this page,
 *                     the weekly order and the recipes picks from it.
 *                     Selling prices per stem and per bunch live here.
 *   2. Log a buy /    the ledgers. A buy costs stems (what was paid for
 *      Log a toss     the lot, so a cost per stem derives); a toss is
 *                     priced at that cost, never typed twice.
 *   3. In the cooler  bought minus tossed minus made, per variety, over a
 *                     short window; toss from the row you are looking at.
 *   4. Recipes        which stems make which product. Written once, edited
 *                     rarely, so it sits low and closed.
 *   5. Recent entries the undo.
 *
 * NOTHING CREATES A NAME BY ACCIDENT. A typed "rosesss" is refused by name
 * on every form (the server refuses too), with one tap to add a genuinely
 * new variety to the library. Before this rule a purchase silently
 * registered whatever was typed, and a toss of "roses" could never match a
 * library that says "rose".
 *
 * Every number traces to a row someone typed or a register ring; nothing is
 * estimated silently. Where a cost is unknowable (no purchase of that
 * variety yet, no recipe on a product) the page says so instead of printing
 * a guess (glaze.md's placeholder rule, applied to arithmetic). The week
 * report that used to live here moved to the Dashboard, which owns every
 * windowed figure; this page keeps only what someone types and what the
 * cooler holds now.
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

/* Adding a name to the library is VarietyGate's job (ui.tsx): suggestions
   first, then a small deliberate form. The old one-tap helper died with
   Kevin's catch that one reflexive click enshrined the typo anyway. */

export default function Inventory({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [events, setEvents] = useState<StemEvent[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [backend, setBackend] = useState<string | null>(null);
  const [coolerDays, setCoolerDays] = useState(14);
  /** A recipe slug asked for from the missing-recipe list; the form loads it. */
  const [pickSlug, setPickSlug] = useState("");

  const pull = useCallback(async () => {
    // The full shared history: costing must use the same denominator as the
    // dashboard or the same toss prices differently on two tabs.
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

  const recipeBySlug = useMemo(() => new Map(recipes.map((r) => [r.slug, r])), [recipes]);
  const varietyByName = useMemo(() => new Map(varieties.map((v) => [v.name, v])), [varieties]);
  /** The library's names: the only thing any variety field may say. */
  const libraryNames = useMemo(() => varieties.map((v) => v.name).sort(), [varieties]);

  /* Lot costing over the loaded history (derive.ts), the same walk the
     Dashboard does, so a toss costs the same on both screens. Two prices
     come out of it for this page: what the stems ON HAND cost (prices the
     recipe book's "to make now"), and the LAST invoice price (the one-tap
     fill on a new buy). */
  const lots = useMemo(() => lotCosting({ events, orders, sales, recipeBySlug }), [events, orders, sales, recipeBySlug]);
  const costPerStem = lots.currentUnitCost;

  /** Stem cost of ONE unit of a product at today's on-hand prices
      (derive.ts), null when any part has never been bought. */
  const recipeCost = useCallback((slug: string) => recipeUnitCost(recipeBySlug.get(slug), costPerStem), [recipeBySlug, costPerStem]);

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

  /* On hand is the LOTS still open (derive.ts), whatever their age: the
     window used to decide it (bought minus tossed minus made since day X),
     which printed -15 the moment a buy fell outside the window while its
     toss stayed in. The window still scopes the movement columns; the
     Oldest column says how stale the open lots are. */
  const onHand = useCallback((v: string) => lots.onHand.get(v)?.stems ?? 0, [lots]);

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

  /** Rows: anything that moved in the window, plus anything still on hand. */
  const moved = useMemo(
    () => [...new Set([...cooler.rows.keys(), ...[...lots.onHand.entries()].filter(([, o]) => o.stems > 0).map(([v]) => v)])].sort(),
    [cooler, lots],
  );

  /* ---------------- recipes: coverage and the worth-writing list -------- */

  const recipeCoverage = useMemo(() => {
    const covered = recipeEligible.filter((p) => recipeBySlug.has(p.slug)).length;
    // What sold, ever loaded, that has no recipe: the handful worth writing,
    // biggest seller first. She should never face all 57.
    const sold = new Map<string, { qty: number; revenue: number }>();
    const add = (slug: string, qty: number, revenue: number) => {
      const s = sold.get(slug) ?? { qty: 0, revenue: 0 };
      s.qty += qty;
      s.revenue += revenue;
      sold.set(slug, s);
    };
    for (const o of orders) {
      if (o.status === "canceled") continue;
      for (const l of o.lines) if (l.slug) add(l.slug, l.qty, l.each * l.qty);
    }
    for (const s of sales) {
      if (s.workroomOrderId) continue;
      for (const l of s.lines) if (l.slug) add(l.slug, l.qty, l.totalCents / 100);
    }
    const missing = [...sold.entries()]
      .filter(([slug]) => !recipeBySlug.has(slug) && recipeEligibleSlugs.has(slug))
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([slug, s]) => ({ slug, qty: s.qty, revenue: s.revenue }));
    return { covered, total: recipeEligible.length, missing };
  }, [recipeBySlug, orders, sales]);

  if (!authed) {
    return (
      <>
        <h1>Inventory</h1>
        <PinGate onAuthed={() => setAuthed(true)} />
      </>
    );
  }

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

  const pricedCount = varieties.filter((v) => v.sellStem != null || v.sellBunch != null).length;

  return (
    <>
      <h1>Inventory</h1>

      <MemoryWarning backend={backend} />

      {/* No lede, on purpose (Kevin, 2026-09-01): workroom screens do not
          introduce themselves. The blocks below, in order, are the
          explanation. Do not re-add. */}

      {/* ---------------- 1. the library ---------------- */}
      <Block
        title="Stem library"
        summary={
          varieties.length === 0
            ? "empty; load the price lists to start"
            : /* "with a shop price", not "priced": sell prices live in the
                 library, wholesale cost/stem lives in the cooler table right
                 below, and the bare word read as a contradiction next to a
                 column full of costs. */
              `${varieties.length} varieties, ${pricedCount} with a shop price`
        }
        defaultOpen={varieties.length === 0}
      >
        <VarietyList varieties={varieties} varietyByName={varietyByName} onHand={onHand} onSaved={pull} />
      </Block>

      {/* ---------------- 2. the ledgers ---------------- */}
      {/* min(300px, 100%): a bare 300px minimum overflows the wrap by 28px at
          a 320 viewport (found by the width check; the wrap offers 272px). */}
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", alignItems: "start", marginBottom: 26 }}>
        <EventForm kind="purchase" library={libraryNames} lastCost={lots.lastUnitCost} onSaved={pull} />
        <EventForm kind="shrink" library={libraryNames} lastCost={lots.lastUnitCost} onSaved={pull} />
      </div>

      {/* ---------------- 3. the cooler ---------------- */}
      <Block
        title="In the cooler"
        summary={moved.length === 0 ? "nothing has moved yet" : `${moved.length} varieties moving`}
        defaultOpen
        aside={
          <label style={{ fontSize: 14.5, display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted">Counting the last</span>
            <select value={coolerDays} onChange={(e) => setCoolerDays(Number(e.target.value))} style={{ ...field, width: "auto" }}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </label>
        }
      >
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
          Bought, tossed and made since {coolerStart}. On hand is every buy not yet tossed or made,
          whatever its age; Oldest says how long the oldest of them has been in. Ledger arithmetic, not
          a shelf count.
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
            Nothing has moved in this window yet. Buys arrive here from the weekly order (or the
            form above), sales through the board and the register.
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
                  <th style={th}>Oldest</th>
                  <th style={th}><span className="sr-only">Log a toss</span></th>
                </tr>
              </thead>
              <tbody>
                {moved.map((name) => {
                  const r = cooler.rows.get(name) ?? { bought: 0, tossed: 0, made: 0, cost: 0, reasons: new Map<string, number>() };
                  const hand = onHand(name);
                  /* Cost/stem is what the stems ON HAND cost, blended over the
                     open lots (derive.ts), falling back to the last invoice
                     when nothing is left; the per-window average this column
                     used to show retired with the blended policy, 2026-09-01.
                     Oldest is the age of the oldest open lot: the stems that
                     will die next. */
                  const open = lots.onHand.get(name);
                  const cps = costPerStem.get(name) ?? null;
                  const age = open?.oldest ? Math.max(0, Math.round((Date.now() - new Date(open.oldest + "T12:00:00").getTime()) / 86_400_000)) : null;
                  return (
                    <CoolerRow
                      key={name}
                      name={name}
                      r={r}
                      hand={hand}
                      cps={cps}
                      age={age}
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

        {canMake.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <h3 style={{ fontSize: 17, margin: 0 }}>What the cooler can build</h3>
            <p className="muted" style={{ margin: "4px 0 10px", fontSize: 14 }}>
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
          </div>
        )}
      </Block>

      {/* ---------------- 4. recipes ---------------- */}
      {/* Low and closed on purpose (Kevin, 2026-09-01): recipes are a lot of
          work once and a rare edit after. The one-tap "worth writing"
          buttons live inside, so opening the block is the whole cost. */}
      <Block
        title="Recipes"
        summary={`${recipeCoverage.covered} of ${recipeCoverage.total} designs written`}
        defaultOpen={false}
        forceOpen={!!pickSlug}
      >
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
          A recipe is the stem list inside one design (a dozen red roses might be 12 rose + 4
          eucalyptus). It turns a sale into counted stems, a margin, and a prefilled quote. Gift
          items need none.
        </p>

        {recipes.length > 0 && (
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
            library={libraryNames}
            costPerStem={costPerStem}
            pickSlug={pickSlug}
            onSaved={() => {
              setPickSlug("");
              pull();
            }}
          />
        </div>
      </Block>

      {/* ---------------- 5. the undo ---------------- */}
      <RecentEvents events={events} onDeleted={pull} />
    </>
  );
}

/* ------------------------- a block ------------------------- */

/**
 * One collapsible panel with a heading and a one-line status in the
 * summary, Kevin's "blocks you can click to expand" (2026-09-01). Native
 * details/summary: no script, keyboard for free, and the open state is the
 * browser's. forceOpen is for a block that something outside just pointed
 * into (a "worth writing" tap must not land on a closed recipes block).
 */
function Block({
  title,
  summary,
  defaultOpen,
  forceOpen,
  aside,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  forceOpen?: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  /* Until the shop touches a block, it follows defaultOpen LIVE: the first
     render happens before the fetch answers, so a library that is "empty"
     for one frame must not lock itself open for the visit. A tap wins from
     then on. */
  const [chosen, setChosen] = useState<boolean | null>(null);
  useEffect(() => {
    if (forceOpen) setChosen(true);
  }, [forceOpen]);
  const open = chosen ?? !!defaultOpen;
  return (
    <details
      className="panel"
      open={open}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (now !== open) setChosen(now);
      }}
      style={{ marginBottom: 26 }}
    >
      <summary className="wr-block-summary" style={{ cursor: "pointer", listStyle: "none", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ fontSize: 13, color: "var(--muted)", display: "inline-block", width: 12 }}>
          {open ? "▾" : "▸"}
        </span>
        <h2 style={{ fontSize: 22, margin: 0, display: "inline" }}>{title}</h2>
        <span className="muted" style={{ fontSize: 14 }}>{summary}</span>
      </summary>
      {/* The aside is a control (a select), so it lives OUTSIDE the summary:
          inside, its click would toggle the block or need preventDefault,
          which stops a select from opening. */}
      {aside && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>{aside}</div>}
      {children}
      <style>{`.wr-block-summary::-webkit-details-marker { display: none; }`}</style>
    </details>
  );
}

/* ------------------------- the cooler row ------------------------- */

/**
 * One variety's line, with the toss built in: tap Toss, count, why, save.
 * The date is today on purpose; a cleanout is happening now, and backdating
 * lives in the Log a toss form above.
 */
function CoolerRow({
  name,
  r,
  hand,
  cps,
  age,
  td,
  onSaved,
}: {
  name: string;
  r: { bought: number; tossed: number; made: number };
  hand: number;
  cps: number | null;
  /** Days since the oldest open lot came in; null when nothing is on hand. */
  age: number | null;
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
        <td style={td}>{cps == null ? "" : money(cps)}</td>
        <td style={{ ...td, color: age != null && age >= 7 ? "var(--rose-ink)" : "var(--muted)" }}>{age == null ? "" : `${age}d`}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>
          <button type="button" onClick={() => setOpen((o) => !o)} style={{ ...textButton, fontSize: 13.5, color: open ? "var(--muted)" : "var(--rose-ink)" }}>
            {open ? "Cancel" : "Toss"}
            <span className="sr-only"> {name}</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ padding: "8px 8px 12px", borderBottom: "1px solid var(--line)", background: "var(--paper)" }}>
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

/* ------------------------- the ledger forms ------------------------- */

/**
 * Log a buy / Log a toss. The variety field is GATED to the library: an
 * unknown name is flagged while typing, refused on save (the server refuses
 * too), and one tap adds it to the library if it is genuinely new.
 *
 * THE COST FIELD IS THE P&L INPUT, in Kevin's words (2026-09-01): "what
 * you paid the wholesaler for that buy, off the invoice". Every shrink
 * dollar and every margin traces back to it, by lot (derive.ts). Nobody
 * multiplies anything: the form shows the per-stem figure live. The truck
 * never needs this form (Weekly order prices its lines from the prebook);
 * it is for the odd buy. When the variety has been bought before, the form
 * offers the LAST invoice price as one tap that fills the field in the
 * open (a typed number, not a silent guess); the last buy is the best
 * guess for a new one, an average over a year is not.
 */
function EventForm({
  kind,
  library,
  lastCost,
  onSaved,
}: {
  kind: "purchase" | "shrink";
  library: string[];
  /** Most recent invoice price per stem, per variety (derive.ts lots). */
  lastCost: Map<string, number>;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [variety, setVariety] = useState("");
  const [stems, setStems] = useState("");
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const listed = useMemo(() => new Set(library), [library]);
  const name = normalizeVariety(variety);
  const unknown = !!name && !listed.has(name);

  const stemsN = Number(stems);
  const costN = Number(cost);
  const perStem = kind === "purchase" && stemsN > 0 && costN > 0 ? costN / stemsN : null;
  const usual = kind === "purchase" && name && !unknown ? lastCost.get(name) ?? null : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved("");
    if (unknown) {
      setError(`"${name}" is not in the stem library. Pick a suggestion under the field, add it there, or fix the spelling.`);
      return;
    }
    const r = await fetch("/api/workroom/stems", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, date, variety: name, stems: stemsN, cost: costN, reason }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setError(d?.error || "That did not save.");
      return;
    }
    setSaved(kind === "purchase" ? `${stems} ${name} in.` : `${stems} ${name} logged as ${reason}.`);
    setVariety("");
    setStems("");
    setCost("");
    onSaved();
  }

  const list = `varieties-${kind}`;
  return (
    <form onSubmit={submit} className="panel" style={{ display: "grid", gap: 12 }}>
      {/* 22 to match the Block headers either side; the page's section
          heads sit on one scale whether or not the section collapses. */}
      <h2 style={{ fontSize: 22, margin: 0 }}>{kind === "purchase" ? "Log a buy" : "Log a toss"}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
        {kind === "purchase" ? (
          <>The Tuesday truck logs itself from <a href="/workroom/weekly-order">Weekly order</a>; this is for the odd buy.</>
        ) : (
          <>For backdating; a live cleanout is faster from the cooler table&rsquo;s Toss buttons below.</>
        )}
      </p>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
        <label>
          <span style={labelText}>Day</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={field} />
        </label>
        <label>
          <span style={labelText}>Variety</span>
          <input list={list} value={variety} onChange={(e) => setVariety(e.target.value)} required placeholder="from the library" style={field} />
          <datalist id={list}>
            {library.map((v) => (
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
            <span style={labelText}>Paid the wholesaler, off the invoice</span>
            <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} required placeholder="$ for this whole buy" style={field} />
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
      <VarietyGate
        value={variety}
        library={library}
        onReplace={setVariety}
        onAdded={(n) => {
          setVariety(n);
          onSaved();
        }}
      />
      {kind === "purchase" && perStem != null && (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {money(perStem)} a stem.
        </p>
      )}
      {kind === "purchase" && perStem == null && usual != null && (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          Your last buy of {name} came to {money(usual)} a stem.
          {stemsN > 0 && (
            <>
              {" "}
              <button type="button" onClick={() => setCost((usual * stemsN).toFixed(2))} style={{ ...textButton, fontSize: 14 }}>
                Use {money(usual * stemsN)} for {stemsN}
              </button>
            </>
          )}
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

/* ------------------------- the recipe form ------------------------- */

function RecipeForm({
  recipes,
  library,
  costPerStem,
  pickSlug,
  onSaved,
}: {
  recipes: Map<string, Recipe>;
  library: string[];
  costPerStem: Map<string, number>;
  /** A slug asked for from outside (the worth-writing list); loads on change. */
  pickSlug?: string;
  onSaved: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [parts, setParts] = useState<{ variety: string; stems: string }[]>([{ variety: "", stems: "" }]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  /** Names added to the library from THIS form (the one-tap add). Held
      locally instead of refetching, because a refetch mid-edit would reload
      the picked recipe over unsaved parts. */
  const [extraNames, setExtraNames] = useState<string[]>([]);

  const listed = useMemo(() => new Set([...library, ...extraNames]), [library, extraNames]);
  const suggest = useMemo(() => [...listed].sort(), [listed]);

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
    const v = normalizeVariety(p.variety);
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
      setError(`Not in the stem library: ${unknowns.join(", ")}. Pick a suggestion under the field, add ${unknowns.length === 1 ? "it" : "them"} there, or fix the spelling.`);
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
            written-versus-needed said in words. */}
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
            const setRow = (variety: string) => setParts((cur) => cur.map((x, at) => (at === i ? { ...x, variety } : x)));
            return (
              <div key={i}>
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 90px" }}>
                  <input
                    aria-label={`Part ${i + 1} variety`}
                    list="recipe-varieties"
                    placeholder="variety"
                    value={p.variety}
                    onChange={(e) => setRow(e.target.value)}
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
                <VarietyGate
                  value={p.variety}
                  library={suggest}
                  onReplace={setRow}
                  onAdded={(n) => {
                    setExtraNames((cur) => [...cur, n]);
                    setRow(n);
                  }}
                />
              </div>
            );
          })}
          {/* The whole library, not just purchased varieties: a recipe
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

/* ------------------------- the library ------------------------- */

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
    setStatus(r.ok ? `${d.added} varieties loaded from the price lists.` : d?.error || "Seeding failed.");
    onSaved();
  }

  async function remove(name: string) {
    if (!window.confirm(`Remove "${name}" from the stem library? Ledger entries that mention it stay.`)) return;
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
    <>
      {/* Second person, not third: this copy talks TO the shop. */}
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
        Every variety on this page, the weekly order and the recipes picks from these names; nothing
        else may invent one. Prices came off the laminated lists behind the counter; blanks are yours
        to fill, never guessed.
      </p>

      {varieties.length === 0 ? (
        <p style={{ margin: "14px 0 0" }}>
          <button className="btn btn--solid" type="button" onClick={seed}>
            Load the price lists
          </button>
        </p>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
          <input
            aria-label="Filter varieties"
            placeholder="find a variety"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ ...field, width: "auto" }}
          />
        </div>
      )}

      {varieties.length > 0 && (
        <div tabIndex={0} role="region" aria-label="Stem library" style={{ overflowX: "auto", marginTop: 8, position: "relative" }}>
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
                    <td style={tdR}>{v.sellStem == null ? "" : money(v.sellStem)}</td>
                    <td style={tdR}>{v.sellBunch == null ? "" : money(v.sellBunch)}</td>
                    <td style={tdR}>{v.stemsPerBunch ?? ""}</td>
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
      )}

      {/* add one */}
      {editing === null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!varietyByName.has(normalizeVariety(draft.name))) save();
            else setStatus("Already in the library. Edit it in the table.");
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
    </>
  );
}

/* ------------------------- the undo ------------------------- */

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
      <h2 style={{ fontSize: 22, margin: "0 0 10px" }}>Recent entries</h2>
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
