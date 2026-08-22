"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Quote } from "@/lib/workroom/store";
import { priceQuote, type QuotePricing } from "@/lib/workroom/quote-math";
import { site, addressOneLine } from "@/lib/site";
import { field, labelText, money, textButton, MemoryWarning, PinGate } from "@/components/workroom/ui";

/**
 * The quote builder. One page that IS the quote: type into it and the price
 * updates beside your hand; walk away and it has already saved itself; hit
 * print and the same numbers leave as a clean client document with none of
 * the shop's internals on it.
 *
 * THE FLOW, tuned to how the conversation actually runs: pieces first ("a
 * bridal bouquet, four bridesmaids...") because that is what the client says;
 * flower prices second, because a variety typed into any piece adds itself to
 * the price list — you price each flower once, not once per piece. The dials
 * (markup, labor, delivery) live next to the total they change.
 *
 * Numeric fields hold whatever half-typed string the input contains; the math
 * (lib/workroom/quote-math.ts) treats garbage as zero and REPORTS it as
 * unpriced instead of pricing it. Nothing here rounds, sums or guesses on its
 * own — one math file, three consumers.
 */

/* The draft mirrors Quote but keeps editable numbers as strings, so a field
   mid-edit ("2." on the way to "2.5") never fights the keyboard. */
type DraftPart = { variety: string; stems: string };
type DraftPiece = { id: string; name: string; qty: string; hardgoods: string; parts: DraftPart[] };
type Draft = Omit<Quote, "pieces" | "flowers" | "markup" | "laborPct" | "delivery" | "setup"> & {
  pieces: DraftPiece[];
  flowers: { variety: string; costPerStem: string }[];
  markup: string;
  laborPct: string;
  delivery: string;
  setup: string;
};

const toDraft = (q: Quote): Draft => ({
  ...q,
  pieces: q.pieces.map((p) => ({
    ...p,
    qty: String(p.qty),
    hardgoods: p.hardgoods ? String(p.hardgoods) : "",
    parts: p.parts.map((pt) => ({ variety: pt.variety, stems: pt.stems ? String(pt.stems) : "" })),
  })),
  flowers: q.flowers.map((f) => ({ variety: f.variety, costPerStem: f.costPerStem ? String(f.costPerStem) : "" })),
  markup: String(q.markup),
  laborPct: String(q.laborPct),
  delivery: q.delivery ? String(q.delivery) : "",
  setup: q.setup ? String(q.setup) : "",
});

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export default function QuoteBuilder({ id, initialAuthed }: { id: string; initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState(false);
  const [backend, setBackend] = useState("memory");
  const [stemPrices, setStemPrices] = useState<Record<string, number>>({});
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  /** The serialization last known to be on the server. */
  const savedRef = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pull = useCallback(async () => {
    const r = await fetch("/api/workroom/quotes", { cache: "no-store" });
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    const d = await r.json();
    setBackend(d.backend ?? "memory");
    setStemPrices(d.stemPrices ?? {});
    const q = (d.quotes as Quote[] | undefined)?.find((x) => x.id === id);
    if (!q) setMissing(true);
    else {
      const loaded = toDraft(q);
      savedRef.current = JSON.stringify(loaded);
      setDraft(loaded);
    }
    setAuthed(true);
  }, [id]);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
  }, [authed, pull]);

  /*
    Autosave: 800ms after the last keystroke, the whole document. A quote is
    one thought; sending it whole means no field can be the one that missed.

    SKIP ON CONTENT, NOT ON A CLOCK. This used to bail out for 500ms after
    load, to avoid echoing the just-loaded document straight back. It also
    swallowed any real edit inside that window and scheduled nothing to catch
    it: a review typed into a freshly opened quote, waited well past the
    debounce, and read the field back empty while the screen said "Saved".
    Comparing against the last known-saved serialization suppresses the echo
    exactly and never suppresses a change.
  */
  const serialized = draft ? JSON.stringify(draft) : "";
  useEffect(() => {
    if (!draft || serialized === savedRef.current) return;
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const sending = serialized;
        const r = await fetch("/api/workroom/quotes", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: sending,
        });
        if (r.ok) savedRef.current = sending;
        setSaveState(r.ok ? "saved" : "failed");
      } catch {
        setSaveState("failed");
      }
    }, 800);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  /* A tab closed mid-debounce would drop the last keystrokes; say so. */
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (saveState !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  const pricing = useMemo(() => (draft ? priceQuote(draft) : null), [draft]);

  if (!authed) {
    return (
      <>
        <h1>Quote</h1>
        <PinGate onAuthed={() => pull().catch(() => {})} />
      </>
    );
  }
  if (missing) {
    return (
      <>
        <h1>That quote is gone</h1>
        <p className="lede">
          It may have been deleted, or the workroom is on memory storage and the server
          restarted. <a href="/workroom/quotes">Back to quotes</a>.
        </p>
      </>
    );
  }
  if (!draft || !pricing) {
    return (
      <>
        <h1>Quote</h1>
        <p className="lede" aria-live="polite">Opening…</p>
      </>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  /* A variety typed into a piece prices itself exactly once: on blur it joins
     the flower list, prefilled from the cooler's 90-day average if the shop
     has bought it before, flagged for a price if not. */
  const ensureFlower = (varietyRaw: string) => {
    const v = norm(varietyRaw);
    if (!v) return;
    setDraft((d) => {
      if (!d || d.flowers.some((f) => norm(f.variety) === v)) return d;
      const known = stemPrices[v];
      return { ...d, flowers: [...d.flowers, { variety: v, costPerStem: known ? String(known) : "" }] };
    });
  };

  const knownVarieties = [...new Set([...Object.keys(stemPrices), ...draft.flowers.map((f) => f.variety)])].sort();

  async function removeQuote() {
    if (!window.confirm(`Delete this ${draft!.kind} quote${draft!.clientName ? ` for ${draft!.clientName}` : ""}? There is no undo.`)) return;
    await fetch("/api/workroom/quotes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    window.location.href = "/workroom/quotes";
  }

  return (
    <>
      <style>{`
        .qb-grid { display: grid; gap: 24px; grid-template-columns: minmax(0, 1fr); align-items: start; }
        @media (min-width: 980px) {
          .qb-grid { grid-template-columns: minmax(0, 1fr) 320px; }
          .qb-side { position: sticky; top: 16px; }
        }
        .qb-bar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between;
          align-items: center; gap: 12px; padding: 10px 18px; background: var(--paper-2);
          border-top: 1px solid var(--line); font-size: 15px; z-index: 5; }
        @media (min-width: 980px) { .qb-bar { display: none; } }
        #quote-doc { display: none; }
        @media print {
          .qb-app, .qb-bar { display: none !important; }
          #quote-doc { display: block; }
          @page { margin: 18mm; }
        }
      `}</style>

      <div className="qb-app">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
          <div>
            <p className="kicker">
              <a href="/workroom/quotes" style={{ color: "inherit", display: "inline-block", padding: "6px 0" }}>Quotes</a> · {draft.kind}
            </p>
            <h1 style={{ marginBottom: 4 }}>{draft.clientName || `New ${draft.kind} quote`}</h1>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span aria-live="polite" className="muted" style={{ fontSize: 14, minWidth: 110, textAlign: "right", color: saveState === "failed" ? "var(--rose-ink)" : undefined }}>
              {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Not saved — check connection"}
            </span>
            <label style={{ fontSize: 14.5, display: "flex", gap: 8, alignItems: "center" }}>
              <span className="muted">Status</span>
              <select value={draft.status} onChange={(e) => set({ status: e.target.value as Quote["status"] })} style={{ ...field, width: "auto" }}>
                {(["draft", "sent", "accepted", "declined"] as const).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <button className="btn" type="button" onClick={() => window.print()}>
              Print the quote
            </button>
          </div>
        </div>

        <MemoryWarning backend={backend} />

        <div className="qb-grid">
          <div style={{ display: "grid", gap: 22, minWidth: 0 }}>
            {/* -------- who & when -------- */}
            {/* minWidth: 0 on every section: they are grid items, and without
                it one wide intrinsic child (a date input, a long option) sets
                the whole column's width past a 390px phone. Same lesson as
                the phone-order form, now applied at the section level. */}
            <section className="panel" style={{ display: "grid", gap: 14, minWidth: 0 }}>
              <h2 style={{ fontSize: 20, margin: 0 }}>Who &amp; when</h2>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>{draft.kind === "wedding" ? "Couple / client" : "Family / client"}</span>
                  <input value={draft.clientName} onChange={(e) => set({ clientName: e.target.value })} style={field} />
                </label>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>Phone</span>
                  <input type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} style={field} />
                </label>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>Email</span>
                  <input type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} style={field} />
                </label>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>{draft.kind === "wedding" ? "Wedding date" : "Service date"}</span>
                  <input type="date" value={draft.eventDate} onChange={(e) => set({ eventDate: e.target.value })} style={field} />
                </label>
                <label style={{ minWidth: 0, gridColumn: "1 / -1" }}>
                  <span style={labelText}>{draft.kind === "wedding" ? "Venue" : "Service location"}</span>
                  <input value={draft.venue} onChange={(e) => set({ venue: e.target.value })} style={field} />
                </label>
              </div>
              <label>
                <span style={labelText}>Notes <span className="muted" style={{ fontWeight: 400 }}>(internal, never printed)</span></span>
                <textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} style={field} />
              </label>
            </section>

            {/* -------- the pieces -------- */}
            <section style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>The pieces</h2>
              <p className="muted" style={{ fontSize: 14.5, margin: "0 0 14px" }}>
                Type a flower into any piece and it joins the price list below on its own.
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                {draft.pieces.map((piece, pi) => (
                  <PieceCard
                    key={piece.id}
                    piece={piece}
                    pricing={pricing.perPiece.get(piece.id)}
                    onChange={(next) => set({ pieces: draft.pieces.map((x, i) => (i === pi ? next : x)) })}
                    onBlurVariety={ensureFlower}
                    onRemove={() => {
                      if (!window.confirm(`Remove "${piece.name}" from the quote?`)) return;
                      set({ pieces: draft.pieces.filter((_, i) => i !== pi) });
                    }}
                  />
                ))}
              </div>
              <p style={{ margin: "10px 0 0" }}>
                <button
                  type="button"
                  style={textButton}
                  onClick={() =>
                    set({
                      pieces: [...draft.pieces, { id: `pc_${Date.now().toString(36)}`, name: "", qty: "1", hardgoods: "", parts: [] }],
                    })
                  }
                >
                  Add a piece
                </button>
              </p>
              {/* One datalist for every flower input on the page. Rendered
                  here, once: an id inside a repeated component is the
                  duplicate-id trap from the glaze failure log. */}
              <datalist id="qb-varieties">
                {knownVarieties.map((v) => (
                  <option key={v} value={v} />
                ))}
              </datalist>
            </section>

            {/* -------- flower prices -------- */}
            <section className="panel" style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>Flower prices</h2>
              <p className="muted" style={{ fontSize: 14.5, margin: "0 0 12px" }}>
                Cost per stem, wholesale. Prefilled from what the shop has actually paid
                when we know it; blank means the quote is waiting on a price.
              </p>
              {draft.flowers.length === 0 ? (
                <p className="muted" style={{ fontSize: 14.5, margin: 0 }}>
                  Nothing yet. Flowers appear here as you type them into pieces.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {draft.flowers.map((f, fi) => {
                    const used = pricing.buyList.find((b) => b.variety === norm(f.variety));
                    const unpriced = pricing.unpricedVarieties.includes(norm(f.variety));
                    return (
                      <div key={fi} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ flex: "1 1 140px", fontSize: 15.5, fontWeight: unpriced ? 600 : 400, color: unpriced ? "var(--rose-ink)" : "var(--ink)" }}>
                          {f.variety}
                        </span>
                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14.5 }}>
                          <span className="muted">$</span>
                          <input
                            aria-label={`Cost per stem, ${f.variety}`}
                            inputMode="decimal"
                            placeholder="0.00"
                            value={f.costPerStem}
                            onChange={(e) => set({ flowers: draft.flowers.map((x, i) => (i === fi ? { ...x, costPerStem: e.target.value } : x)) })}
                            style={{ ...field, width: 84 }}
                          />
                          <span className="muted">a stem</span>
                        </label>
                        <span className="muted" style={{ fontSize: 13.5 }}>
                          {used ? `${used.stems} stems in this quote` : "not used yet"}
                        </span>
                        {!used && (
                          <button type="button" style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}
                            onClick={() => set({ flowers: draft.flowers.filter((_, i) => i !== fi) })}>
                            Remove
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* -------- the buy list -------- */}
            {pricing.buyList.length > 0 && (
              <section className="panel" style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>Flowers to order</h2>
                <p className="muted" style={{ fontSize: 14.5, margin: "0 0 10px" }}>
                  The wholesale order this quote implies, totalled across every piece.
                </p>
                <div tabIndex={0} role="region" aria-label="Flowers to order" style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", minWidth: 340, borderCollapse: "collapse", fontSize: 14.5 }}>
                    <thead>
                      <tr>
                        {["Variety", "Stems", "Est. cost"].map((h, i) => (
                          <th key={h} style={{ textAlign: i === 0 ? "left" : "right", padding: "6px 8px", borderBottom: "1px solid var(--line)", fontSize: 12.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pricing.buyList.map((b) => (
                        <tr key={b.variety}>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>{b.variety}</td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.stems}</td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--line)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{b.cost == null ? "needs a price" : money(b.cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <p style={{ margin: 0 }}>
              <button type="button" style={{ ...textButton, color: "var(--rose-ink)" }} onClick={removeQuote}>
                Delete this quote
              </button>
            </p>
          </div>

          {/* -------- the dials & the total -------- */}
          <aside className="qb-side panel" style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <h2 style={{ fontSize: 20, margin: 0 }}>The price</h2>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
              <label style={{ minWidth: 0 }}>
                <span style={labelText}>Flower markup ×</span>
                <input inputMode="decimal" value={draft.markup} onChange={(e) => set({ markup: e.target.value })} style={field} />
              </label>
              <label style={{ minWidth: 0 }}>
                <span style={labelText}>Labor %</span>
                <input inputMode="decimal" value={draft.laborPct} onChange={(e) => set({ laborPct: e.target.value })} style={field} />
              </label>
              <label style={{ minWidth: 0 }}>
                <span style={labelText}>Delivery $</span>
                <input inputMode="decimal" value={draft.delivery} onChange={(e) => set({ delivery: e.target.value })} style={field} />
              </label>
              <label style={{ minWidth: 0 }}>
                <span style={labelText}>Setup $</span>
                <input inputMode="decimal" value={draft.setup} onChange={(e) => set({ setup: e.target.value })} style={field} />
              </label>
            </div>

            <dl style={{ margin: 0, fontSize: 14.5, display: "grid", gap: 5 }}>
              <Row label="Flowers, wholesale" val={money(pricing.stemCost)} muted />
              <Row label={`× ${Number(draft.markup) || 1} markup`} val={money(pricing.flowerRetail)} />
              <Row label={`Labor, ${Number(draft.laborPct) || 0}%`} val={money(pricing.labor)} />
              <Row label="Hardgoods" val={money(pricing.hardgoods)} />
              {pricing.delivery > 0 && <Row label="Delivery" val={money(pricing.delivery)} />}
              {pricing.setup > 0 && <Row label="Setup" val={money(pricing.setup)} />}
            </dl>
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--serif)", fontSize: 20 }}>Total</span>
              <strong style={{ fontSize: 26, fontVariantNumeric: "tabular-nums" }}>{money(pricing.total)}</strong>
            </div>
            {draft.kind === "wedding" && pricing.total > 0 && (
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                Deposit to save the date: <strong>{money(pricing.deposit)}</strong> (50%, per the shop&rsquo;s
                published wedding process).
              </p>
            )}
            {pricing.unpricedVarieties.length > 0 && (
              <p role="status" style={{ margin: 0, fontSize: 14, color: "var(--rose-ink)", fontWeight: 600 }}>
                {pricing.unpricedVarieties.length === 1
                  ? `1 flower still needs a stem price: ${pricing.unpricedVarieties[0]}.`
                  : `${pricing.unpricedVarieties.length} flowers still need a stem price: ${pricing.unpricedVarieties.join(", ")}.`}{" "}
                The total above leaves them out rather than guessing.
              </p>
            )}
            {pricing.total > 0 && pricing.unpricedVarieties.length === 0 && (
              <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
                After flowers and hardgoods the quote keeps {money(Math.max(0, pricing.total - pricing.stemCost - pricing.hardgoods))} for
                labor and margin.
              </p>
            )}
          </aside>
        </div>

        {/* Mobile: the total rides along at the bottom of the screen. */}
        <div className="qb-bar">
          <span aria-hidden="true" className="muted">{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Not saved"}</span>
          <span style={{ fontWeight: 700, fontSize: 17, fontVariantNumeric: "tabular-nums" }}>{money(pricing.total)}</span>
        </div>
        <div style={{ height: 46 }} aria-hidden="true" />
      </div>

      <PrintDoc draft={draft} pricing={pricing} />
    </>
  );
}

function Row({ label, val, muted }: { label: string; val: string; muted?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, color: muted ? "var(--muted)" : "var(--ink)" }}>
      <dt style={{ margin: 0 }}>{label}</dt>
      <dd style={{ margin: 0, fontVariantNumeric: "tabular-nums" }}>{val}</dd>
    </div>
  );
}

function PieceCard({
  piece,
  pricing,
  onChange,
  onBlurVariety,
  onRemove,
}: {
  piece: DraftPiece;
  pricing?: { each: number; total: number; unpriced: string[] };
  onChange: (p: DraftPiece) => void;
  onBlurVariety: (v: string) => void;
  onRemove: () => void;
}) {
  const setPart = (i: number, patch: Partial<DraftPart>) =>
    onChange({ ...piece, parts: piece.parts.map((p, at) => (at === i ? { ...p, ...patch } : p)) });

  return (
    <article className="panel" style={{ padding: 16, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          aria-label="Piece name"
          placeholder="What is it? (Bridal bouquet…)"
          value={piece.name}
          onChange={(e) => onChange({ ...piece, name: e.target.value })}
          style={{ ...field, flex: "2 1 200px", minWidth: 0, width: "auto", fontWeight: 600 }}
        />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14.5 }}>
          <span className="muted">×</span>
          <input
            aria-label={`Quantity of ${piece.name || "piece"}`}
            inputMode="numeric"
            value={piece.qty}
            onChange={(e) => onChange({ ...piece, qty: e.target.value })}
            style={{ ...field, width: 58 }}
          />
        </label>
        <span style={{ marginLeft: "auto", fontSize: 15.5 }}>
          {pricing && pricing.each > 0 ? (
            <strong style={{ fontVariantNumeric: "tabular-nums" }}>
              {money(pricing.each)} each · {money(pricing.total)}
            </strong>
          ) : (
            <span className="muted" style={{ fontSize: 13.5, fontStyle: "italic" }}>
              no price yet · left off the print
            </span>
          )}
        </span>
      </div>

      {piece.parts.map((part, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            aria-label={`Flower ${i + 1} in ${piece.name || "piece"}`}
            list="qb-varieties"
            placeholder="flower"
            value={part.variety}
            onChange={(e) => setPart(i, { variety: e.target.value })}
            onBlur={(e) => onBlurVariety(e.target.value)}
            style={{ ...field, flex: "1 1 150px", minWidth: 0, width: "auto" }}
          />
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
            <input
              aria-label={`Stems of ${part.variety || `flower ${i + 1}`}`}
              inputMode="numeric"
              placeholder="stems"
              value={part.stems}
              onChange={(e) => setPart(i, { stems: e.target.value })}
              style={{ ...field, width: 74 }}
            />
            <span className="muted">stems</span>
          </label>
          <button
            type="button"
            aria-label={`Remove ${part.variety || `flower ${i + 1}`} from ${piece.name || "piece"}`}
            onClick={() => onChange({ ...piece, parts: piece.parts.filter((_, at) => at !== i) })}
            /* marginLeft auto: on a phone this row wraps, and Remove used to
               land hard-left on its own line mid-card — the "thrown on there"
               look. Pushed to the right edge it reads as placed, and it lines
               up with "Remove piece" below on every width. */
            style={{ ...textButton, fontSize: 13.5, color: "var(--muted)", marginLeft: "auto" }}
          >
            Remove
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" style={textButton} onClick={() => onChange({ ...piece, parts: [...piece.parts, { variety: "", stems: "" }] })}>
          Add a flower
        </button>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14 }}>
          <span className="muted">Hardgoods $</span>
          <input
            aria-label={`Hardgoods for ${piece.name || "piece"}`}
            inputMode="decimal"
            placeholder="0"
            value={piece.hardgoods}
            onChange={(e) => onChange({ ...piece, hardgoods: e.target.value })}
            style={{ ...field, width: 74 }}
          />
        </label>
        <button type="button" onClick={onRemove} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)", marginLeft: "auto" }}>
          Remove piece
        </button>
      </div>

    </article>
  );
}

/**
 * The client's copy. Same numbers, none of the workings: no stem counts, no
 * markup, no labor split — a family choosing casket flowers does not need to
 * see the arithmetic, and a competitor does not get the recipe. Policies on
 * it are the shop's own published words (site.ts), never invented.
 */
function PrintDoc({ draft, pricing }: { draft: Draft; pricing: QuotePricing }) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return (
    <div id="quote-doc" style={{ fontFamily: "var(--sans)", color: "#1a1611", fontSize: "12.5pt", lineHeight: 1.55 }}>
      <header style={{ borderBottom: "2px solid #1a1611", paddingBottom: "4mm", marginBottom: "6mm" }}>
        <p style={{ fontFamily: "var(--serif)", fontSize: "22pt", margin: 0 }}>{site.name}</p>
        <p style={{ margin: "1mm 0 0", fontSize: "10.5pt" }}>
          {addressOneLine} · {site.phone} · {site.email}
        </p>
      </header>

      <p style={{ fontSize: "10.5pt", letterSpacing: ".12em", textTransform: "uppercase", margin: "0 0 1mm" }}>
        {draft.kind === "wedding" ? "Wedding flowers · quote" : "Funeral flowers · quote"}
      </p>
      <p style={{ fontFamily: "var(--serif)", fontSize: "17pt", margin: "0 0 1mm" }}>
        {draft.clientName || "—"}
      </p>
      <p style={{ margin: "0 0 6mm", fontSize: "11pt" }}>
        {[draft.eventDate, draft.venue].filter(Boolean).join(" · ") || " "}
        <span style={{ float: "right" }}>Prepared {today}</span>
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11.5pt" }}>
        <thead>
          <tr>
            {["Piece", "Qty", "Each", "Total"].map((h, i) => (
              <th key={h} style={{ textAlign: i === 0 ? "left" : "right", borderBottom: "1px solid #1a1611", padding: "2mm 1mm", fontSize: "9.5pt", letterSpacing: ".08em", textTransform: "uppercase" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Only pieces that carry a price. Template rows the conversation
              never reached would print as a column of $0.00 — a client quote
              that looks abandoned. The builder shows which pieces are being
              left off, next to each one. */}
          {draft.pieces
            .filter((p) => p.name.trim() && (pricing.perPiece.get(p.id)?.each ?? 0) > 0)
            .map((p) => {
              const pp = pricing.perPiece.get(p.id);
              return (
                <tr key={p.id}>
                  <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6" }}>{p.name}</td>
                  <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6", textAlign: "right" }}>{Number(p.qty) || 1}</td>
                  <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6", textAlign: "right" }}>{pp ? money(pp.each) : ""}</td>
                  <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6", textAlign: "right" }}>{pp ? money(pp.total) : ""}</td>
                </tr>
              );
            })}
          {pricing.delivery > 0 && (
            <tr>
              <td colSpan={3} style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6" }}>Delivery</td>
              <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6", textAlign: "right" }}>{money(pricing.delivery)}</td>
            </tr>
          )}
          {pricing.setup > 0 && (
            <tr>
              <td colSpan={3} style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6" }}>Setup &amp; installation</td>
              <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6", textAlign: "right" }}>{money(pricing.setup)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <p style={{ textAlign: "right", fontSize: "15pt", margin: "4mm 0 1mm" }}>
        Total <strong>{money(pricing.total)}</strong>
      </p>
      {draft.kind === "wedding" && pricing.total > 0 && (
        <p style={{ textAlign: "right", margin: "0 0 6mm", fontSize: "11pt" }}>
          A 50% deposit ({money(pricing.deposit)}) with a signed contract saves your date.
        </p>
      )}
      {draft.kind === "funeral" && (
        <p style={{ margin: "4mm 0 0", fontSize: "10.5pt" }}>{site.delivery.funeralNote}</p>
      )}

      {/* Only policies the shop has published. A quote-validity window was
          drafted here and cut: their site states no such policy, and inventing
          one on a client document is the Sprinkles mistake in a suit. Ask the
          owner at the meeting; add it back in her words if she has one. */}
      <p style={{ marginTop: "8mm", fontSize: "9.5pt", color: "#4c463d" }}>{site.substitutionPolicy}</p>
    </div>
  );
}
