"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { products } from "@/lib/catalog";
import { field, labelText, money, textButton, MemoryWarning, PinGate } from "@/components/workroom/ui";

/**
 * The cooler's ledger, derived, and the master stem list, managed.
 *
 * ON HAND is arithmetic over a recent window, not a counted truth:
 * bought minus tossed minus made, per variety, over the last N days. Flowers
 * are perishable, so a short window is MORE honest than an all-time balance:
 * a stem bought six weeks ago is compost whether or not a recipe consumed
 * it. The window is hers to widen; the label always says what it covers.
 *
 * "Made" counts two sources: board orders marked made or done (the stems
 * left the cooler when the arrangement did), and Square register sales whose
 * line items map to a recipe. The honesty notes name what could NOT be
 * counted (no recipe, custom-amount register sales), because a shortfall
 * that looks like completeness is how the numbers rot.
 *
 * THE MASTER LIST is the one namespace: recipes, purchases and the weekly
 * order all speak it. Sell prices are her laminated lists; blanks are hers
 * to fill, never guessed.
 */

type StemEvent = { id: string; kind: "purchase" | "shrink"; date: string; variety: string; stems: number; cost: number };
type Recipe = { slug: string; parts: { variety: string; stems: number }[] };
type Order = { id: string; status: string; date: string; lines: { slug: string | null; qty: number }[] };
type SquareSale = { id: string; paidAt: string; lines: { slug: string | null; qty: number }[] };
type Variety = {
  name: string;
  kind: "flower" | "green";
  sellStem: number | null;
  sellBunch: number | null;
  stemsPerBunch: number | null;
};

const productName = new Map(products.map((p) => [p.slug, p.name]));

export default function Inventory({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [events, setEvents] = useState<StemEvent[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<SquareSale[]>([]);
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [backend, setBackend] = useState("memory");
  const [days, setDays] = useState(14);

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

  const windowStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, [days]);

  const ledger = useMemo(() => {
    const rows = new Map<string, { bought: number; tossed: number; made: number; cost: number }>();
    const row = (v: string) => {
      let r = rows.get(v);
      if (!r) rows.set(v, (r = { bought: 0, tossed: 0, made: 0, cost: 0 }));
      return r;
    };

    for (const e of events) {
      if (e.date < windowStart) continue;
      if (e.kind === "purchase") {
        row(e.variety).bought += e.stems;
        row(e.variety).cost += e.cost;
      } else row(e.variety).tossed += e.stems;
    }

    let unrecipedLines = 0;
    const consume = (slug: string | null, qty: number) => {
      const recipe = slug ? recipeBySlug.get(slug) : undefined;
      if (!recipe) {
        unrecipedLines += 1;
        return;
      }
      for (const part of recipe.parts) row(part.variety).made += part.stems * qty;
    };
    for (const o of orders) {
      // "made" and "done" only: a new order has not touched the cooler yet.
      if (o.status !== "made" && o.status !== "done") continue;
      if (o.date < windowStart) continue;
      for (const l of o.lines) consume(l.slug, l.qty);
    }
    let customSales = 0;
    for (const s of sales) {
      if ((s.paidAt || "").slice(0, 10) < windowStart) continue;
      if (s.lines.length === 0) customSales += 1;
      for (const l of s.lines) consume(l.slug, l.qty);
    }

    return { rows, unrecipedLines, customSales };
  }, [events, orders, sales, recipeBySlug, windowStart]);

  const onHand = useCallback(
    (v: string) => {
      const r = ledger.rows.get(v);
      return r ? r.bought - r.tossed - r.made : 0;
    },
    [ledger],
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

  /* Every variety that either exists on the list or moved in the window. */
  const allNames = useMemo(() => {
    const s = new Set(varieties.map((v) => v.name));
    for (const n of ledger.rows.keys()) s.add(n);
    return [...s].sort();
  }, [varieties, ledger]);
  const varietyByName = useMemo(() => new Map(varieties.map((v) => [v.name, v])), [varieties]);
  const moved = allNames.filter((n) => ledger.rows.has(n));

  if (!authed) {
    return (
      <>
        <h1>Inventory</h1>
        <PinGate onAuthed={() => pull().catch(() => {})} />
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

  return (
    <>
      <h1>Inventory</h1>
      <MemoryWarning backend={backend} />

      {/* ---------------- in the cooler ---------------- */}
      <section className="panel" style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>In the cooler</h2>
          <label style={{ fontSize: 14.5, display: "flex", gap: 8, alignItems: "center" }}>
            <span className="muted">Counting the last</span>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ ...field, width: "auto" }}>
              {[7, 14, 30, 60, 90].map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
          Bought minus tossed minus made since {windowStart}. Arithmetic over the ledgers, not a
          shelf count: stems older than the window are treated as gone, because they are.
        </p>
        {(ledger.unrecipedLines > 0 || ledger.customSales > 0) && (
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
            Not counted:{" "}
            {ledger.unrecipedLines > 0 && `${ledger.unrecipedLines} sold line(s) with no recipe to name their stems`}
            {ledger.unrecipedLines > 0 && ledger.customSales > 0 && ", and "}
            {ledger.customSales > 0 && `${ledger.customSales} register sale(s) rung as a bare amount`}
            . Recipes and item-rung sales fix that, not this page.
          </p>
        )}

        {moved.length === 0 ? (
          <p style={{ margin: "16px 0 0" }}>
            Nothing has moved in this window yet. Purchases arrive here from the weekly order (or the
            Stems &amp; shrink page), sales through the board and the register.
          </p>
        ) : (
          <div tabIndex={0} role="region" aria-label="Stems on hand" style={{ overflowX: "auto", marginTop: 14 }}>
            <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 14.5 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left" }}>Variety</th>
                  <th style={th}>Bought</th>
                  <th style={th}>Tossed</th>
                  <th style={th}>Made</th>
                  <th style={th}>On hand</th>
                  <th style={th}>Cost/stem</th>
                </tr>
              </thead>
              <tbody>
                {moved.map((name) => {
                  const r = ledger.rows.get(name)!;
                  const hand = r.bought - r.tossed - r.made;
                  const cps = r.bought > 0 ? r.cost / r.bought : null;
                  return (
                    <tr key={name}>
                      <td style={{ ...td, textAlign: "left" }}>{name}</td>
                      <td style={td}>{r.bought}</td>
                      <td style={td}>{r.tossed || ""}</td>
                      <td style={td}>{r.made || ""}</td>
                      <td style={{ ...td, fontWeight: 700, color: hand < 0 ? "var(--rose-ink)" : "var(--ink)" }}>{hand}</td>
                      <td style={td}>{cps == null ? "—" : money(cps)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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

      <VarietyList varieties={varieties} varietyByName={varietyByName} onHand={onHand} onSaved={pull} />
    </>
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
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
        The one list everything speaks: recipes, purchases and the weekly order all pick from these
        names. Sell prices came off the laminated lists behind the counter; a blank means her sheet
        did not say, and it is hers to fill, not ours to guess.
      </p>

      {varieties.length > 0 && (
        <div tabIndex={0} role="region" aria-label="Master stem list" style={{ overflowX: "auto", marginTop: 14 }}>
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
