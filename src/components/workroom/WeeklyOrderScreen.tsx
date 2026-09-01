"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { field, labelText, money, textButton, todayISO, MemoryWarning, PinGate } from "@/components/workroom/ui";
import PlantsSection from "@/components/workroom/Plants";

/**
 * The weekly buying page: the flower order, and the plant par sheet below
 * it (its own section since 2026-09-01; same weekly motion, and the header
 * was full).
 *
 * The real Kennicott order mostly repeats week to week; the work is the
 * delta (this week: cross out white lilies, write "blk org yellow"). So the
 * screen's first button copies last week's lines into a new draft and the
 * shop edits from there. "The truck came" is the payoff tap: every line
 * becomes a purchase in the cooler ledger, dated the truck date, priced
 * from the prebook, with bunches converted to stems by the stems-per-bunch
 * the shop taught it once.
 *
 * WHAT THIS PAGE DOES NOT DO: place the order. Nothing is transmitted to
 * Kennicott or anyone; she orders with her rep the way she always has,
 * reading from this sheet. It is the prebook and the receiving log, and
 * the lede says so, because Kevin himself had to ask.
 */

type Line = { variety: string; qty: string; unit: "bunch" | "stem"; unitPrice: string; stemsPerBunch: string; note: string };
type WeeklyOrder = {
  id: string;
  distributor: string;
  deliveryDate: string;
  status: "draft" | "received";
  lines: { variety: string; qty: number; unit: "bunch" | "stem"; unitPrice: number; stemsPerBunch: number | null; note: string }[];
  receivedAt: number | null;
  updatedAt: number;
};
type Variety = { name: string; stemsPerBunch: number | null };

const blankLine = (): Line => ({ variety: "", qty: "1", unit: "bunch", unitPrice: "", stemsPerBunch: "", note: "" });

export default function WeeklyOrderScreen({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [orders, setOrders] = useState<WeeklyOrder[]>([]);
  const [varieties, setVarieties] = useState<Variety[]>([]);
  const [backend, setBackend] = useState("memory");

  const [id, setId] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [distributor, setDistributor] = useState("Kennicott");
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(false);

  const pull = useCallback(async () => {
    const [ro, rv] = await Promise.all([
      fetch("/api/workroom/weekly-orders", { cache: "no-store" }),
      fetch("/api/workroom/varieties", { cache: "no-store" }),
    ]);
    if (ro.status === 401) {
      setAuthed(false);
      return;
    }
    const d = await ro.json();
    const v = await rv.json().catch(() => ({}));
    setOrders(d.orders ?? []);
    setVarieties(v.varieties ?? []);
    setBackend(d.backend ?? "memory");
    setAuthed(true);
  }, []);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
  }, [authed, pull]);

  const spbByName = useMemo(() => new Map(varieties.map((v) => [v.name, v.stemsPerBunch])), [varieties]);

  function loadDraft(o: WeeklyOrder) {
    setId(o.id);
    setDeliveryDate(o.deliveryDate);
    setDistributor(o.distributor);
    setLines(
      o.lines.map((l) => ({
        variety: l.variety,
        qty: String(l.qty),
        unit: l.unit,
        unitPrice: String(l.unitPrice),
        stemsPerBunch: l.stemsPerBunch == null ? "" : String(l.stemsPerBunch),
        note: l.note,
      })),
    );
    setOpen(true);
    setStatus("");
  }

  function startFrom(o: WeeklyOrder | null) {
    setId(null);
    setDeliveryDate(todayISO());
    setDistributor(o?.distributor ?? "Kennicott");
    setLines(
      o
        ? o.lines.map((l) => ({
            variety: l.variety,
            qty: String(l.qty),
            unit: l.unit,
            unitPrice: String(l.unitPrice),
            stemsPerBunch: l.stemsPerBunch == null ? "" : String(l.stemsPerBunch),
            note: "",
          }))
        : [blankLine()],
    );
    setOpen(true);
    setStatus("");
  }

  const draft = orders.find((o) => o.status === "draft");
  const lastReceived = orders.find((o) => o.status === "received");

  function toBody() {
    return {
      id: id ?? undefined,
      deliveryDate,
      distributor,
      lines: lines
        .filter((l) => l.variety.trim())
        .map((l) => ({
          variety: l.variety,
          qty: Number(l.qty),
          unit: l.unit,
          unitPrice: Number(l.unitPrice) || 0,
          stemsPerBunch: l.unit === "bunch" && l.stemsPerBunch ? Number(l.stemsPerBunch) : null,
          note: l.note,
        })),
    };
  }

  async function save(): Promise<string | null> {
    setStatus("");
    const r = await fetch("/api/workroom/weekly-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(toBody()),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setStatus(d?.error || "That did not save.");
      return null;
    }
    setId(d.order.id);
    setStatus("Draft saved.");
    pull();
    return d.order.id as string;
  }

  async function receive() {
    const missing = lines.filter((l) => l.variety.trim() && l.unit === "bunch" && !Number(l.stemsPerBunch));
    if (missing.length > 0) {
      setStatus(`Stems per bunch first, for: ${missing.map((l) => l.variety).join(", ")}. It is asked once and remembered.`);
      return;
    }
    if (!window.confirm(`Log the ${deliveryDate} truck? Every line becomes a purchase in the cooler ledger.`)) return;
    const savedId = await save();
    if (!savedId) return;
    const r = await fetch("/api/workroom/weekly-orders", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: savedId, action: "receive" }),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setStatus(d?.error || "That did not log.");
      return;
    }
    setStatus(`Truck logged: ${d.purchases} purchases in the ledger.`);
    setOpen(false);
    setId(null);
    pull();
  }

  const totals = useMemo(() => {
    let dollars = 0;
    let units = 0;
    let stems = 0;
    let stemsUnknown = false;
    for (const l of lines) {
      const q = Number(l.qty) || 0;
      dollars += q * (Number(l.unitPrice) || 0);
      units += q;
      if (l.unit === "stem") stems += q;
      else if (Number(l.stemsPerBunch)) stems += q * Number(l.stemsPerBunch);
      else if (l.variety.trim()) stemsUnknown = true;
    }
    return { dollars, units, stems, stemsUnknown };
  }, [lines]);

  if (!authed) {
    return (
      <>
        <h1>Weekly order</h1>
        <PinGate onAuthed={() => pull().catch(() => {})} />
      </>
    );
  }

  const tiny: React.CSSProperties = { ...field, padding: "7px 8px", fontSize: 14.5 };

  return (
    <>
      <h1>Weekly order</h1>
      <MemoryWarning backend={backend} />
      <p className="lede" style={{ margin: "4px 0 18px" }}>
        The prebook and the receiving log, for flowers and for plants. Build the list, read it to
        the rep the way you always order, and when the truck comes one tap logs every line into the
        cooler ledger.
      </p>

      {!open && (
        <section className="panel" style={{ marginBottom: 26 }}>
          <h2 style={{ fontSize: 22, margin: "0 0 10px" }}>This week</h2>
          <p style={{ margin: "0 0 14px", fontSize: 15 }}>
            {draft
              ? `A draft for ${draft.deliveryDate} is open: ${draft.lines.length} lines.`
              : lastReceived
                ? `Last truck logged ${lastReceived.deliveryDate}: ${lastReceived.lines.length} lines. Start this week from it and edit the difference.`
                : "No orders yet. The first one is typed from the printed prebook; every week after starts from the last."}
          </p>
          <p style={{ margin: 0, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {draft && (
              <button className="btn btn--solid" type="button" onClick={() => loadDraft(draft)}>
                Open the draft
              </button>
            )}
            {!draft && lastReceived && (
              <button className="btn btn--solid" type="button" onClick={() => startFrom(lastReceived)}>
                Start from last week
              </button>
            )}
            <button className={lastReceived || draft ? "btn" : "btn btn--solid"} type="button" onClick={() => startFrom(null)}>
              Start blank
            </button>
          </p>
        </section>
      )}

      {open && (
        <section className="panel" style={{ marginBottom: 26 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end", marginBottom: 14 }}>
            <label>
              <span style={labelText}>Truck date</span>
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} style={{ ...field, width: "auto" }} />
            </label>
            <label style={{ flex: "0 1 220px" }}>
              <span style={labelText}>Distributor</span>
              <input value={distributor} onChange={(e) => setDistributor(e.target.value)} style={field} />
            </label>
            <button type="button" onClick={() => setOpen(false)} style={{ ...textButton, marginLeft: "auto" }}>
              Close without losing the draft
            </button>
          </div>

          <div tabIndex={0} role="region" aria-label="Order lines" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse", fontSize: 14.5 }}>
              <thead>
                <tr>
                  {["Variety", "Qty", "Unit", "$ each", "Stems/bunch", "Note", ""].map((h) => (
                    <th key={h || "rm"} style={{ textAlign: "left", padding: "4px 6px", fontSize: 12.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ padding: 3, minWidth: 170 }}>
                      <input
                        aria-label={`Line ${i + 1} variety`}
                        list="wo-varieties"
                        value={l.variety}
                        onChange={(e) => {
                          const name = e.target.value;
                          setLines((cur) =>
                            cur.map((x, at) => {
                              if (at !== i) return x;
                              const spb = spbByName.get(name.trim().toLowerCase());
                              return { ...x, variety: name, stemsPerBunch: x.stemsPerBunch || (spb ? String(spb) : "") };
                            }),
                          );
                        }}
                        style={tiny}
                      />
                    </td>
                    <td style={{ padding: 3 }}>
                      <input aria-label={`Line ${i + 1} quantity`} inputMode="numeric" value={l.qty} onChange={(e) => setLines((cur) => cur.map((x, at) => (at === i ? { ...x, qty: e.target.value } : x)))} style={{ ...tiny, width: 58, textAlign: "right" }} />
                    </td>
                    <td style={{ padding: 3 }}>
                      <select aria-label={`Line ${i + 1} unit`} value={l.unit} onChange={(e) => setLines((cur) => cur.map((x, at) => (at === i ? { ...x, unit: e.target.value as "bunch" | "stem" } : x)))} style={tiny}>
                        <option value="bunch">bunch</option>
                        <option value="stem">stem</option>
                      </select>
                    </td>
                    <td style={{ padding: 3 }}>
                      <input aria-label={`Line ${i + 1} price`} inputMode="decimal" value={l.unitPrice} onChange={(e) => setLines((cur) => cur.map((x, at) => (at === i ? { ...x, unitPrice: e.target.value } : x)))} style={{ ...tiny, width: 74, textAlign: "right" }} />
                    </td>
                    <td style={{ padding: 3 }}>
                      {l.unit === "bunch" ? (
                        <input aria-label={`Line ${i + 1} stems per bunch`} inputMode="numeric" value={l.stemsPerBunch} onChange={(e) => setLines((cur) => cur.map((x, at) => (at === i ? { ...x, stemsPerBunch: e.target.value } : x)))} placeholder="?" style={{ ...tiny, width: 58, textAlign: "right" }} />
                      ) : (
                        <span className="muted" style={{ padding: "0 6px" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: 3, minWidth: 120 }}>
                      <input aria-label={`Line ${i + 1} note`} value={l.note} onChange={(e) => setLines((cur) => cur.map((x, at) => (at === i ? { ...x, note: e.target.value } : x)))} placeholder="colors, subs" style={tiny} />
                    </td>
                    <td style={{ padding: 3 }}>
                      <button type="button" onClick={() => setLines((cur) => cur.filter((_, at) => at !== i))} style={{ ...textButton, color: "var(--rose-ink)", fontSize: 13 }}>
                        Remove<span className="sr-only"> line {i + 1}</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <datalist id="wo-varieties">
            {varieties.map((v) => (
              <option key={v.name} value={v.name} />
            ))}
          </datalist>

          <p style={{ margin: "10px 0 0" }}>
            <button type="button" onClick={() => setLines((cur) => [...cur, blankLine()])} style={textButton}>
              Another line
            </button>
          </p>

          <p style={{ margin: "12px 0 0", fontSize: 15.5 }}>
            <strong>{money(totals.dollars)}</strong> · {totals.units} units
            {totals.stems > 0 && (
              <span className="muted">
                {" "}· at least {totals.stems} stems{totals.stemsUnknown ? ", some bunches uncounted yet" : ""}
              </span>
            )}
          </p>

          <p style={{ margin: "14px 0 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button className="btn" type="button" onClick={() => save()}>
              Save the draft
            </button>
            <button className="btn btn--solid" type="button" onClick={receive}>
              The truck came — log it
            </button>
          </p>
          <p aria-live="polite" style={{ margin: "10px 0 0", fontSize: 14, fontWeight: 600, color: status.includes("saved") || status.includes("logged") ? "var(--green)" : "var(--rose-ink)", minHeight: "1.3em" }}>
            {status}
          </p>
        </section>
      )}

      {/* ---------------- the record ---------------- */}
      {orders.length > 0 && (
        <section>
          <h2 style={{ fontSize: 20, margin: "0 0 10px" }}>Past orders</h2>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14.5 }}>
            {orders.map((o) => {
              const total = o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
              return (
                <li key={o.id} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "7px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                  <span style={{ minWidth: 86 }} className="muted">{o.deliveryDate}</span>
                  <span style={{ flex: 1 }}>
                    {o.distributor} · {o.lines.length} lines · {money(total)}
                  </span>
                  {o.status === "draft" ? (
                    <button type="button" onClick={() => loadDraft(o)} style={{ ...textButton, fontSize: 13.5 }}>
                      Open draft
                    </button>
                  ) : (
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--green)", letterSpacing: "0.06em", textTransform: "uppercase" }}>received</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <hr className="rule" />
      <PlantsSection authed={authed} />
    </>
  );
}
