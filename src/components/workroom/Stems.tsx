"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { products } from "@/lib/catalog";
import { field, labelText, money, textButton, todayISO, MemoryWarning, PinGate } from "@/components/workroom/ui";

/**
 * Stems, shrink, recipes, and the Monday number.
 *
 * This page is the reason the workroom exists: the owner named stem management
 * and shrink as the gap her POS never filled. The mechanics are three small
 * ledgers and one derivation:
 *
 *   purchases   what came in and what it cost -> a cost per stem, per variety
 *   shrink      what got tossed and why       -> priced at what was PAID,
 *                                               never typed twice
 *   recipes     which stems make which product -> cost of goods per arrangement
 *
 * The week report divides and multiplies those three. Every number on it
 * traces to a row someone typed; nothing is estimated silently. Where a cost
 * is unknowable (no purchase of that variety yet, no recipe on a product) the
 * report says so instead of printing a guess — a made-up margin is worse than
 * a blank one (glaze.md's placeholder rule, applied to arithmetic).
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

const REASONS = ["wilted", "damaged", "overbought", "event fell through", "other"];

const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name));
const productName = new Map(products.map((p) => [p.slug, p.name]));
const productPrice = new Map(products.map((p) => [p.slug, p.price]));

/** Monday-to-Sunday week containing the given yyyy-mm-dd. Falls back to the
    current week when handed garbage: the anchor comes from a date input the
    user can clear, and a cleared input must not print "week of NaN-NaN". */
function weekOf(dateISO: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) dateISO = todayISO();
  const d = new Date(dateISO + "T12:00:00");
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: iso(monday), to: iso(sunday) };
}

export default function Stems({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [events, setEvents] = useState<StemEvent[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [masterList, setMasterList] = useState<string[]>([]);
  const [backend, setBackend] = useState("memory");
  const [anchor, setAnchor] = useState(todayISO());

  const pull = useCallback(async () => {
    const r = await fetch("/api/workroom/stems", { cache: "no-store" });
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    const d = await r.json();
    setEvents(d.events ?? []);
    setRecipes(d.recipes ?? []);
    setOrders(d.orders ?? []);
    setMasterList(((d.varieties ?? []) as { name: string }[]).map((v) => v.name));
    setBackend(d.backend ?? "memory");
    setAuthed(true);
  }, []);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
  }, [authed, pull]);

  /*
    Cost per stem, per variety: total paid / total stems across the fetched 90
    days. An average over the quarter, not the last invoice, so one expensive
    holiday buy does not reprice every rose in the report.
  */
  const costPerStem = useMemo(() => {
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
  }, [events]);

  // The master stem list first (the Inventory page's namespace), plus
  // anything the ledgers mention that the list somehow does not.
  const knownVarieties = useMemo(
    () => [...new Set([...masterList, ...events.map((e) => e.variety)])].sort(),
    [masterList, events],
  );
  const recipeBySlug = useMemo(() => new Map(recipes.map((r) => [r.slug, r])), [recipes]);

  const week = weekOf(anchor);
  /*
    The page loads 90 days. Pick an older week and every figure computes to a
    perfectly convincing zero — which on a page whose whole job is giving her
    numbers she has never had, reads as "no shrink that week" rather than "not
    loaded". Say which it is.
  */
  const windowStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const outsideWindow = week.from < windowStart;
  const report = useMemo(() => {
    const inWeek = (d: string) => d >= week.from && d <= week.to;

    const bought = { stems: 0, cost: 0 };
    const tossed = { stems: 0, cost: 0, unknown: 0 };
    for (const e of events) {
      if (!inWeek(e.date)) continue;
      if (e.kind === "purchase") {
        bought.stems += e.stems;
        bought.cost += e.cost;
      } else {
        tossed.stems += e.stems;
        const c = costPerStem.get(e.variety);
        if (c == null) tossed.unknown += e.stems;
        else tossed.cost += c * e.stems;
      }
    }

    const sold = new Map<string, { qty: number; revenue: number }>();
    let revenue = 0;
    let stemCost = 0;
    let uncostedLines = 0;
    for (const o of orders) {
      if (o.status === "canceled" || !inWeek(o.date)) continue;
      revenue += o.subtotal;
      for (const l of o.lines) {
        if (l.slug) {
          const s = sold.get(l.slug) ?? { qty: 0, revenue: 0 };
          s.qty += l.qty;
          s.revenue += l.each * l.qty;
          sold.set(l.slug, s);
        }
        /*
          A line is "costed" only when a recipe exists AND every part has a
          purchase to price it from. Anything less joins the uncosted count:
          the first version quietly added $0 for unknown-cost parts while the
          footnote blamed only missing recipes, which made "stems in what
          sold" read more complete than it was.
        */
        const recipe = l.slug ? recipeBySlug.get(l.slug) : undefined;
        const costs = recipe?.parts.map((part) => costPerStem.get(part.variety));
        if (!recipe || costs!.some((c) => c == null)) {
          uncostedLines += 1;
          continue;
        }
        recipe.parts.forEach((part, i) => {
          stemCost += (costs![i] as number) * part.stems * l.qty;
        });
      }
    }

    return { bought, tossed, revenue, stemCost, uncostedLines, sold };
  }, [events, orders, recipeBySlug, costPerStem, week.from, week.to]);

  if (!authed) {
    return (
      <>
        <h1>Stems &amp; shrink</h1>
        <PinGate onAuthed={() => pull().catch(() => {})} />
      </>
    );
  }

  const shrinkRate = report.bought.stems > 0 ? (report.tossed.stems / report.bought.stems) * 100 : null;

  return (
    <>
      <h1>Stems &amp; shrink</h1>

      <MemoryWarning backend={backend} />

      {/* The point of the typing, stated where the typing happens: Kevin's
          test read was "you put the info in there -- so what, where does it
          go?" and the honest answer was three other tabs, silently. */}
      <p className="lede" style={{ margin: "4px 0 18px" }}>
        Everything logged here feeds three places: what the cooler holds on Inventory, the
        prefilled flower costs on Quotes, and the shrink and made numbers on This week. Skip the
        logging and those pages go quiet, not wrong.
      </p>

      {/* ---------------- the week ---------------- */}
      <section className="panel" style={{ marginBottom: 30 }}>
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
            That week is older than the 90 days this page loads, so the figures below
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
          <Figure label="Order revenue" value={money(report.revenue)} sub="subtotals, board orders" />
          <Figure
            label="Stems in what sold"
            value={money(report.stemCost)}
            sub={report.uncostedLines > 0 ? `${report.uncostedLines} line(s) not costable yet` : "recipe-costed"}
          />
        </div>
        {report.tossed.unknown > 0 && (
          <p className="muted" style={{ fontSize: 14, margin: "8px 0 0" }}>
            {report.tossed.unknown} tossed stem(s) have no purchase on record, so their dollar cost is
            unknown rather than guessed.
          </p>
        )}

        {report.sold.size > 0 && (
          /* The table scrolls inside its own box on a phone; five columns at
             390px must never be the page's problem. tabIndex + role because a
             scrollable region a keyboard cannot reach cannot be scrolled by
             keyboard — axe called it, axe was right. */
          <div tabIndex={0} role="region" aria-label="Products sold this week" style={{ overflowX: "auto", marginTop: 18 }}>
          <table style={{ width: "100%", minWidth: 460, borderCollapse: "collapse", fontSize: 14.5 }}>
            <thead>
              <tr>
                {["Product", "Sold", "Revenue", "Stem cost", "Margin"].map((h, i) => (
                  <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid var(--line)", fontSize: 12.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...report.sold.entries()].map(([slug, s]) => {
                const recipe = recipeBySlug.get(slug);
                let cost: number | null = null;
                if (recipe) {
                  cost = 0;
                  for (const part of recipe.parts) {
                    const c = costPerStem.get(part.variety);
                    if (c == null) {
                      cost = null;
                      break;
                    }
                    cost += c * part.stems;
                  }
                }
                const num: React.CSSProperties = { textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" };
                return (
                  <tr key={slug}>
                    <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{productName.get(slug) ?? slug}</td>
                    <td style={num}>{s.qty}</td>
                    <td style={num}>{money(s.revenue)}</td>
                    <td style={num}>{cost == null ? (recipe ? "cost unknown" : "no recipe") : money(cost * s.qty)}</td>
                    <td style={num}>
                      {cost == null ? "—" : `${Math.round(((s.revenue - cost * s.qty) / s.revenue) * 100)}%`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </section>

      {/* ---------------- the ledgers ---------------- */}
      {/* min(300px, 100%): a bare 300px minimum overflows the wrap by 28px at
          a 320 viewport (found by the width check; the wrap offers 272px). */}
      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", alignItems: "start" }}>
        <EventForm kind="purchase" varieties={knownVarieties} onSaved={pull} />
        <EventForm kind="shrink" varieties={knownVarieties} onSaved={pull} />
        <RecipeForm recipes={recipeBySlug} varieties={knownVarieties} costPerStem={costPerStem} onSaved={pull} />
      </div>

      <RecentEvents events={events} onDeleted={pull} />
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
  onSaved,
}: {
  recipes: Map<string, Recipe>;
  varieties: string[];
  costPerStem: Map<string, number>;
  onSaved: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [parts, setParts] = useState<{ variety: string; stems: string }[]>([{ variety: "", stems: "" }]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  // Choosing a product loads its saved recipe, so editing is the same motion
  // as creating and there is no second UI to learn.
  function pick(next: string) {
    setSlug(next);
    setSaved("");
    setError("");
    const existing = recipes.get(next);
    setParts(
      existing && existing.parts.length
        ? existing.parts.map((p) => ({ variety: p.variety, stems: String(p.stems) }))
        : [{ variety: "", stems: "" }],
    );
  }

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
    <form onSubmit={submit} className="panel" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ fontSize: 20, margin: 0 }}>Recipes</h2>
      <label>
        <span style={labelText}>Product</span>
        <select value={slug} onChange={(e) => pick(e.target.value)} required style={field}>
          <option value="">Choose one</option>
          {sortedProducts.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.name} ({money(p.price)}){recipes.has(p.slug) ? " ·" : ""}
            </option>
          ))}
        </select>
      </label>
      {slug && (
        <>
          {parts.map((p, i) => (
            <div key={i} style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 90px" }}>
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
          ))}
          {/* The whole master list, not just purchased varieties: a recipe
              names what the product is made of, whether or not this quarter
              happened to buy it yet. */}
          <datalist id="recipe-varieties">
            {varieties.map((v) => (
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
    if (!window.confirm(`Remove "${what}" from ${e.date}? The week's numbers recalculate without it.`)) return;
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
