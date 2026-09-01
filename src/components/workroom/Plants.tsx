"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { field, labelText, money, textButton, todayISO } from "@/components/workroom/ui";

/**
 * The plant par sheet, working the way the printed one does: walk the shop,
 * type what you Have, and Need computes itself against the standard number.
 * Need is never stored anywhere, only derived, so it cannot go stale; the
 * order summary at the bottom is the sheet's Need column ready to read to
 * the supplier.
 *
 * A SECTION, not a page, since 2026-09-01: plants are the same weekly
 * buying motion as the flower order, so this lives on the Weekly order
 * screen (Kevin's call while thinning the header). The screen owns the
 * gate and the memory warning; this renders nothing until it is authed.
 */

type PlantItem = {
  slug: string;
  name: string;
  retail: number | null;
  cost: number | null;
  par: number;
  have: number | null;
  countedAt: string;
};

export default function PlantsSection({ authed }: { authed: boolean }) {
  const [plants, setPlants] = useState<PlantItem[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayISO());
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", retail: "", cost: "", par: "" });

  const pull = useCallback(async () => {
    const r = await fetch("/api/workroom/plants", { cache: "no-store" });
    // A 401 here means the whole screen is locked; the host page's gate is
    // already showing, so this section just stays empty.
    if (!r.ok) return;
    const d = await r.json();
    setPlants(d.plants ?? []);
  }, []);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
  }, [authed, pull]);

  const haveOf = useCallback(
    (p: PlantItem): number | null => {
      const typed = counts[p.slug];
      if (typed !== undefined && typed !== "") return Math.round(Number(typed)) || 0;
      if (typed === "") return null;
      return p.have;
    },
    [counts],
  );

  const needs = useMemo(
    () =>
      plants
        .map((p) => {
          const have = haveOf(p);
          return { p, need: have == null ? null : Math.max(0, p.par - have) };
        })
        .filter((x) => x.need != null && x.need > 0),
    [plants, haveOf],
  );

  async function saveCounts() {
    setStatus("");
    const payload = Object.entries(counts)
      .filter(([, v]) => v !== "")
      .map(([slug, v]) => ({ slug, have: Number(v) }));
    if (payload.length === 0) {
      setStatus("Type at least one count first.");
      return;
    }
    const r = await fetch("/api/workroom/plants", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ counts: payload, date }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setStatus(d?.error || "That did not save.");
      return;
    }
    setStatus(`${d.saved} count(s) saved for ${date}.`);
    setCounts({});
    pull();
  }

  async function seed() {
    setStatus("");
    const r = await fetch("/api/workroom/plants", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed: true }),
    });
    const d = await r.json().catch(() => null);
    setStatus(r.ok ? `${d.added} plants loaded from the par sheet.` : d?.error || "Seeding failed.");
    pull();
  }

  async function saveItem(slug?: string) {
    setStatus("");
    const r = await fetch("/api/workroom/plants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, name: draft.name, retail: draft.retail, cost: draft.cost, par: draft.par }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setStatus(d?.error || "That did not save.");
      return;
    }
    setStatus(`${d.item.name} saved.`);
    setEditing(null);
    setDraft({ name: "", retail: "", cost: "", par: "" });
    pull();
  }

  async function remove(p: PlantItem) {
    if (!window.confirm(`Remove "${p.name}" from the par sheet?`)) return;
    await fetch("/api/workroom/plants", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: p.slug }),
    });
    pull();
  }

  if (!authed) return null;

  const th: React.CSSProperties = { textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)", fontSize: 12.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" };
  const td: React.CSSProperties = { textAlign: "right", padding: "6px 8px", borderBottom: "1px solid var(--line)", fontVariantNumeric: "tabular-nums" };
  const tiny: React.CSSProperties = { ...field, padding: "5px 7px", fontSize: 14 };

  const lastCount = plants.map((p) => p.countedAt).filter(Boolean).sort().at(-1);

  return (
    <>
      <section className="panel" style={{ marginBottom: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10 }}>
          <h2 style={{ fontSize: 22, margin: 0 }}>The plant par sheet</h2>
          {plants.length === 0 ? (
            <button className="btn btn--solid" type="button" onClick={seed}>
              Load the par sheet
            </button>
          ) : (
            <label style={{ fontSize: 14.5, display: "flex", gap: 8, alignItems: "center" }}>
              <span className="muted">Counting on</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...field, width: "auto" }} />
            </label>
          )}
        </div>
        <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>
          Walk the shop, type what is there, and Need works itself out against the standard number.
          {lastCount && ` Last count saved ${lastCount}.`}
        </p>

        {plants.length > 0 && (
          <>
            {/* position: relative so the sr-only spans inside (position:
                absolute) stay clipped by this scroll wrapper instead of
                stretching the document (the Stems page's 688px lesson). */}
            <div tabIndex={0} role="region" aria-label="Plant par sheet" style={{ overflowX: "auto", marginTop: 14, position: "relative" }}>
              <table style={{ width: "100%", minWidth: 640, borderCollapse: "collapse", fontSize: 14.5 }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "left" }}>Plant</th>
                    <th style={th}>Retail</th>
                    <th style={th}>Cost</th>
                    <th style={th}>Keep</th>
                    <th style={th}>Have</th>
                    <th style={th}>Need</th>
                    <th style={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {plants.map((p) => {
                    if (editing === p.slug) {
                      return (
                        <tr key={p.slug}>
                          <td style={{ ...td, textAlign: "left" }}>
                            <input aria-label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={tiny} />
                          </td>
                          {(["retail", "cost", "par"] as const).map((k) => (
                            <td key={k} style={td}>
                              <input aria-label={k} inputMode="decimal" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} style={{ ...tiny, width: 70, textAlign: "right" }} />
                            </td>
                          ))}
                          <td style={td}></td>
                          <td style={td}></td>
                          <td style={{ ...td, whiteSpace: "nowrap" }}>
                            <button type="button" onClick={() => saveItem(p.slug)} style={{ ...textButton, color: "var(--green)", fontWeight: 700 }}>Save</button>{" "}
                            <button type="button" onClick={() => setEditing(null)} style={textButton}>Cancel</button>
                          </td>
                        </tr>
                      );
                    }
                    const have = haveOf(p);
                    const need = have == null ? null : Math.max(0, p.par - have);
                    return (
                      <tr key={p.slug}>
                        <td style={{ ...td, textAlign: "left" }}>{p.name}</td>
                        <td style={td}>{p.retail == null ? "—" : money(p.retail)}</td>
                        <td style={td}>{p.cost == null ? "—" : money(p.cost)}</td>
                        <td style={td}>{p.par}</td>
                        <td style={{ ...td, width: 84 }}>
                          <input
                            aria-label={`${p.name} on hand`}
                            inputMode="numeric"
                            value={counts[p.slug] ?? (p.have == null ? "" : String(p.have))}
                            onChange={(e) => setCounts((c) => ({ ...c, [p.slug]: e.target.value }))}
                            style={{ ...tiny, width: 64, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ ...td, fontWeight: 700, color: need != null && need > 0 ? "var(--rose-ink)" : "var(--ink)" }}>
                          {need == null ? "—" : need}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(p.slug);
                              setDraft({
                                name: p.name,
                                retail: p.retail == null ? "" : String(p.retail),
                                cost: p.cost == null ? "" : String(p.cost),
                                par: String(p.par),
                              });
                            }}
                            style={textButton}
                          >
                            Edit
                          </button>{" "}
                          <button type="button" onClick={() => remove(p)} style={{ ...textButton, color: "var(--rose-ink)" }}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p style={{ margin: "14px 0 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn--solid" type="button" onClick={saveCounts}>
                Save the counts
              </button>
              <span aria-live="polite" style={{ fontSize: 14, fontWeight: 600, color: status.includes("saved") || status.includes("loaded") ? "var(--green)" : "var(--rose-ink)" }}>
                {status}
              </span>
            </p>
          </>
        )}
      </section>

      {needs.length > 0 && (
        <section className="panel" style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>The plant order</h2>
          <p className="muted" style={{ margin: "0 0 10px", fontSize: 14 }}>
            {needs.some((x) => x.p.cost != null)
              ? `The Need column, ready to read to the supplier: about ${money(
                  needs.reduce((s, x) => s + (x.p.cost ?? 0) * (x.need as number), 0),
                )}${needs.some((x) => x.p.cost == null) ? " plus the uncosted lines" : ""}.`
              : "The Need column, ready to read to the supplier."}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 15.5 }}>
            {needs.map(({ p, need }) => (
              <li key={p.slug} style={{ padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                <strong>{need}</strong> × {p.name}
                {p.cost != null && <span className="muted"> ({money(p.cost * (need as number))})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {plants.length > 0 && editing === null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveItem();
          }}
          className="panel"
          style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}
        >
          <label style={{ flex: "1 1 180px" }}>
            <span style={labelText}>New plant</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={'Fern 6"'} style={field} />
          </label>
          <label>
            <span style={labelText}>Retail</span>
            <input inputMode="decimal" value={draft.retail} onChange={(e) => setDraft({ ...draft, retail: e.target.value })} placeholder="$" style={{ ...field, width: 84 }} />
          </label>
          <label>
            <span style={labelText}>Cost</span>
            <input inputMode="decimal" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} placeholder="$" style={{ ...field, width: 84 }} />
          </label>
          <label>
            <span style={labelText}>Keep</span>
            <input inputMode="numeric" value={draft.par} onChange={(e) => setDraft({ ...draft, par: e.target.value })} placeholder="2" style={{ ...field, width: 70 }} />
          </label>
          <button className="btn btn--solid" type="submit" disabled={!draft.name.trim() || !draft.par.trim()}>
            Add it
          </button>
        </form>
      )}
    </>
  );
}
