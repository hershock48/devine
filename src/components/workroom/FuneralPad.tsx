"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Quote } from "@/lib/workroom/store";
import { priceQuote, type QuotePricing } from "@/lib/workroom/quote-math";
import { FUNERAL_MENU, RIBBON_WORDS } from "@/lib/workroom/quote-templates";
import { site, addressOneLine } from "@/lib/site";
import { field, labelText, money, textButton, MemoryWarning, PinGate } from "@/components/workroom/ui";

/**
 * THE FUNERAL PAD. A different tool from the wedding builder, because the
 * owner told us funerals are "done on the spot... quotes in person, no
 * spreadsheet."
 *
 * So there is no document to digitize. What there is, is a conversation
 * happening across a counter with a family who just lost someone, and the
 * tool's only jobs are: don't slow her down, don't make her do arithmetic in
 * front of them, and don't let the service time get lost.
 *
 * Four things follow from that, and each one inverts something the wedding
 * builder does:
 *
 * 1. PRICE FIRST, STEMS NEVER. Funeral work is sold by naming a piece and a
 *    price — "a standing spray at $225" — and the flowers are worked out in
 *    the workroom later. So the menu is one tap per piece per price point,
 *    and quote-math runs backwards to tell the workroom what flower budget
 *    that price bought. The counter never sees a stem count.
 *
 * 2. THE BUDGET IS THE FRAME. Families name a number first ("we can do about
 *    $600") and the florist builds down to it. The target sits at the top and
 *    the running total is measured against it, out loud, the whole time.
 *
 * 3. THE SERVICE IS A DEADLINE, NOT A DATE. Flowers are expected about an
 *    hour before the family arrives; an early or Sunday service means
 *    delivering the day before. So service and viewing times are first-class
 *    fields, and the pad states the delivery deadline in words rather than
 *    leaving it to be inferred.
 *
 * 4. IT ENDS IN AN ORDER, NOT AN EMAIL. The family is standing right there
 *    agreeing to it, so "put it on the board" is the last button, not a
 *    separate errand a week later.
 *
 * The price points in FUNERAL_MENU are published industry ranges, not
 * DeVine's, and they are labelled as such on screen. Replacing them with hers
 * is the first edit after the meeting.
 */

type DraftPiece = {
  id: string;
  name: string;
  qty: string;
  hardgoods: string;
  price: string;
  ribbon: string;
  from: string;
  parts: { variety: string; stems: string }[];
};
type Draft = Omit<Quote, "pieces" | "flowers" | "markup" | "laborPct" | "delivery" | "setup" | "budgetTarget"> & {
  pieces: DraftPiece[];
  flowers: { variety: string; costPerStem: string }[];
  markup: string;
  laborPct: string;
  delivery: string;
  setup: string;
  budgetTarget: string;
};

const toDraft = (q: Quote): Draft => ({
  ...q,
  deceased: q.deceased ?? "",
  serviceTime: q.serviceTime ?? "",
  viewingTime: q.viewingTime ?? "",
  casket: q.casket ?? "",
  budgetTarget: q.budgetTarget ? String(q.budgetTarget) : "",
  pieces: q.pieces.map((p) => ({
    id: p.id,
    name: p.name,
    qty: String(p.qty),
    hardgoods: p.hardgoods ? String(p.hardgoods) : "",
    price: p.price ? String(p.price) : "",
    ribbon: p.ribbon ?? "",
    from: p.from ?? "",
    parts: p.parts.map((pt) => ({ variety: pt.variety, stems: pt.stems ? String(pt.stems) : "" })),
  })),
  flowers: q.flowers.map((f) => ({ variety: f.variety, costPerStem: f.costPerStem ? String(f.costPerStem) : "" })),
  markup: String(q.markup),
  laborPct: String(q.laborPct),
  delivery: q.delivery ? String(q.delivery) : "",
  setup: q.setup ? String(q.setup) : "",
});

/** "2:00 pm" from "14:00". Their site writes times this way. */
function prettyTime(hhmm: string): string {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * The delivery deadline in words, from the earliest thing happening that day.
 * An hour ahead is the trade's own rule of thumb; before 9am it cannot be met
 * on the day at all, because the shop opens at nine.
 */
function deadlineLine(draft: Draft): string | null {
  // The EARLIER of the two, not viewing-first by habit: a graveside service
  // before a later gathering happens, and the flowers answer to whichever
  // comes first. HH:MM sorts correctly as text.
  const times = [draft.viewingTime, draft.serviceTime].filter((t): t is string => !!t).sort();
  const first = times[0];
  if (!draft.eventDate || !first) return null;
  const [h, m] = first.split(":").map(Number);
  const total = h * 60 + m - 60;
  const label = first === draft.viewingTime ? "the viewing" : "the service";
  if (total < 9 * 60) {
    return `${label} starts at ${prettyTime(first)}, so this has to go out the day before — the shop is not open early enough to deliver an hour ahead.`;
  }
  const dh = Math.floor(total / 60);
  const dm = total % 60;
  return `Deliver by ${prettyTime(`${String(dh).padStart(2, "0")}:${String(dm).padStart(2, "0")}`)} on ${draft.eventDate}, an hour before ${label}.`;
}

export default function FuneralPad({ id, initialAuthed }: { id: string; initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState(false);
  const [backend, setBackend] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "failed">("saved");
  const [placed, setPlaced] = useState<string | null>(null);
  const [placeError, setPlaceError] = useState("");
  const [placing, setPlacing] = useState(false);
  const [openPiece, setOpenPiece] = useState<string | null>(null);
  /** The serialization last known to be on the server. */
  const savedRef = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pull = useCallback(async () => {
    // One quote, not the whole table: the ?id= form exists for exactly this.
    const r = await fetch(`/api/workroom/quotes?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    if (r.status === 404) {
      setMissing(true);
      setAuthed(true);
      return;
    }
    const d = await r.json();
    setBackend(d.backend ?? "memory");
    const loaded = toDraft(d.quote as Quote);
    savedRef.current = JSON.stringify(loaded);
    setDraft(loaded);
    setAuthed(true);
  }, [id]);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
  }, [authed, pull]);

  /* Skips on content rather than on a clock — see the long note on the same
     effect in QuoteBuilder.tsx for the edit this used to swallow. */
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
        <h1>Funeral quote</h1>
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
        <h1>Funeral quote</h1>
        <p className="lede" aria-live="polite">Opening…</p>
      </>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setPiece = (pid: string, patch: Partial<DraftPiece>) =>
    setDraft((d) => (d ? { ...d, pieces: d.pieces.map((p) => (p.id === pid ? { ...p, ...patch } : p)) } : d));

  function addFromMenu(name: string, price: number, hardgoods: number) {
    const pid = `pc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setDraft((d) =>
      d
        ? {
            ...d,
            pieces: [
              ...d.pieces,
              { id: pid, name, qty: "1", hardgoods: hardgoods ? String(hardgoods) : "", price: String(price), ribbon: "", from: "", parts: [] },
            ],
          }
        : d,
    );
    /*
      Deliberately NOT opening the ribbon panel here. Tried it: adding six
      boutonnieres and two sprays in a row made the page jump under the hand
      every time, which is the opposite of what this screen is for. The row
      is one tap away when the family gets to the ribbon, and quiet until.
    */
    void pid;
  }

  async function placeOrder() {
    if (!draft || placing) return; // `placing` also stops a double tap
    setPlaceError("");
    /*
      Check here rather than letting the API's 400 vanish. This button is
      pressed with a family watching; the old version swallowed the failure
      and did nothing at all, which reads as a broken screen at the worst
      possible moment.
    */
    if (!draft.eventDate) {
      setPlaceError("Add the service date first; the board sorts by it.");
      return;
    }
    const lines = draft.pieces
      .filter((p) => p.name.trim())
      .map((p) => ({ name: p.name + (p.ribbon ? ` — ribbon: ${p.ribbon}` : ""), each: Number(p.price) || 0, qty: Number(p.qty) || 1 }));
    /* Checked BEFORE setPlacing: an early return after it left the button
       stuck on "Sending…" forever, reachable when every piece was unnamed. */
    if (lines.length === 0) {
      setPlaceError("Name the pieces first; unnamed ones cannot go on the board.");
      return;
    }
    setPlacing(true);
    /*
      Delivery rides along as a line. Without it the board's subtotal came out
      $25 under the total the family was just shown and agreed to, which is
      exactly the kind of quiet disagreement between two screens that makes
      someone stop trusting both.
    */
    const deliveryCharge = Number(draft.delivery) || 0;
    if (deliveryCharge > 0) lines.push({ name: "Delivery to the service", each: deliveryCharge, qty: 1 });
    const notes = [
      draft.deceased ? `Service for ${draft.deceased}.` : "",
      draft.serviceTime ? `Service ${prettyTime(draft.serviceTime)}.` : "",
      draft.viewingTime ? `Viewing ${prettyTime(draft.viewingTime)}.` : "",
      deadlineLine(draft) ?? "",
      draft.notes,
    ]
      .filter(Boolean)
      .join(" ");
    const r = await fetch("/api/workroom/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.clientName || draft.deceased || "Funeral order",
        phone: draft.phone,
        email: draft.email,
        fulfillment: "delivery",
        // The funeral home is the recipient, not a street address. Writing it
        // into both printed it twice on the board card.
        recipient: draft.venue,
        street: "",
        town: "",
        date: draft.eventDate,
        occasion: "Sympathy or funeral",
        cardMessage: draft.pieces.map((p) => p.ribbon).filter(Boolean).join(" / "),
        notes,
        lines,
      }),
    });
    const d = (await r.json().catch(() => null)) as { ok?: boolean; order?: { number: string }; error?: string } | null;
    setPlacing(false);
    if (d?.ok && d.order) {
      setPlaced(d.order.number);
      set({ status: "accepted" });
    } else {
      setPlaceError(d?.error || "That did not reach the board. Try again, or write it up on the board directly.");
    }
  }

  const suggested = draft.casket === "open" ? "open" : draft.casket === "closed" ? "closed" : null;
  const overTarget = pricing.overTarget;

  return (
    <>
      <style>{`
        .fp-grid { display: grid; gap: 22px; grid-template-columns: minmax(0, 1fr); align-items: start; }
        @media (min-width: 1000px) {
          .fp-grid { grid-template-columns: minmax(0, 1fr) 330px; }
          .fp-side { position: sticky; top: 16px; }
        }
        .fp-menu { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); }
        .fp-chip { border: 1px solid var(--line); background: var(--paper); border-radius: 3px;
          font: inherit; font-size: 14.5px; padding: 6px 12px; cursor: pointer; color: var(--ink); }
        .fp-chip:hover { border-color: var(--green); color: var(--green); }
        .fp-bar { position: fixed; left: 0; right: 0; bottom: 0; display: flex; justify-content: space-between;
          align-items: center; gap: 12px; padding: 10px 18px; background: var(--paper-2);
          border-top: 1px solid var(--line); font-size: 15px; z-index: 5; }
        @media (min-width: 1000px) { .fp-bar { display: none; } }
        #quote-doc { display: none; }
        @media print {
          .fp-app, .fp-bar { display: none !important; }
          #quote-doc { display: block; }
          @page { margin: 18mm; }
        }
      `}</style>

      <div className="fp-app">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
          <div>
            <p className="kicker">
              <a href="/workroom/quotes" style={{ color: "inherit", display: "inline-block", padding: "6px 0" }}>Quotes</a> · funeral
            </p>
            <h1 style={{ marginBottom: 4 }}>{draft.deceased ? `Service for ${draft.deceased}` : "Funeral quote"}</h1>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <span aria-live="polite" className="muted" style={{ fontSize: 14, minWidth: 110, textAlign: "right", color: saveState === "failed" ? "var(--rose-ink)" : undefined }}>
              {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Not saved — check connection"}
            </span>
            <button className="btn" type="button" onClick={() => window.print()}>Print for the family</button>
          </div>
        </div>

        <MemoryWarning backend={backend} />

        <div className="fp-grid">
          <div style={{ display: "grid", gap: 20, minWidth: 0 }}>
            {/* -------- the service -------- */}
            <section className="panel" style={{ display: "grid", gap: 14, minWidth: 0 }}>
              <h2 style={{ fontSize: 20, margin: 0 }}>The service</h2>
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>Who it&rsquo;s for</span>
                  <input value={draft.deceased ?? ""} onChange={(e) => set({ deceased: e.target.value })} placeholder="Full name" style={field} />
                </label>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>Funeral home or church</span>
                  <input value={draft.venue} onChange={(e) => set({ venue: e.target.value })} style={field} />
                </label>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>Date</span>
                  <input type="date" value={draft.eventDate} onChange={(e) => set({ eventDate: e.target.value })} style={field} />
                </label>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>Viewing at</span>
                  <input type="time" value={draft.viewingTime ?? ""} onChange={(e) => set({ viewingTime: e.target.value })} style={field} />
                </label>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>Service at</span>
                  <input type="time" value={draft.serviceTime ?? ""} onChange={(e) => set({ serviceTime: e.target.value })} style={field} />
                </label>
              </div>

              <fieldset style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <legend style={labelText}>Casket</legend>
                <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
                  {([["open", "Open"], ["closed", "Closed"], ["cremation", "Cremation"]] as const).map(([v, l]) => (
                    <label key={v} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, padding: "4px 0" }}>
                      <input
                        type="radio"
                        name="fp-casket"
                        checked={draft.casket === v}
                        onChange={() => set({ casket: v })}
                        style={{ width: 20, height: 20, accentColor: "var(--green)" }}
                      />
                      {l}
                    </label>
                  ))}
                </div>
              </fieldset>

              {deadlineLine(draft) && (
                <p role="status" style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: "var(--green)" }}>
                  {deadlineLine(draft)}
                </p>
              )}

              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>Family contact</span>
                  <input value={draft.clientName} onChange={(e) => set({ clientName: e.target.value })} style={field} />
                </label>
                <label style={{ minWidth: 0 }}>
                  <span style={labelText}>Phone</span>
                  <input type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} style={field} />
                </label>
              </div>
            </section>

            {/* -------- the menu -------- */}
            <section style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 20, margin: "0 0 4px" }}>Add a piece</h2>
              <p className="muted" style={{ fontSize: 14.5, margin: "0 0 12px" }}>
                One tap adds it at that price, editable after. These are industry price
                points standing in until the shop&rsquo;s own replace them.
              </p>
              <div className="fp-menu">
                {FUNERAL_MENU.map((m) => {
                  /*
                    The casket answer MARKS the matching spray; it never dims
                    the other. Dimming was the first version and the auditor
                    killed it: opacity 0.45 dropped that text under the
                    contrast floor, and a piece a family might still ask for
                    must never be the hard-to-read one. Suggest, don't hide.
                  */
                  const fits = suggested != null && m.casket === suggested;
                  return (
                    <div key={m.name}>
                      <p style={{ margin: "0 0 4px", fontSize: 14.5, fontWeight: 600, color: fits ? "var(--green)" : "var(--ink)" }}>
                        {m.name}
                        {m.note && <span className="muted" style={{ fontWeight: 400 }}> · {m.note}</span>}
                        {fits && <span style={{ fontWeight: 700, color: "var(--green)" }}> · fits</span>}
                      </p>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {m.prices.map((price) => (
                          <button key={price} type="button" className="fp-chip" onClick={() => addFromMenu(m.name, price, m.hardgoods)}>
                            {money(price)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p style={{ margin: "12px 0 0" }}>
                <button
                  type="button"
                  style={textButton}
                  onClick={() => addFromMenu("", 0, 0)}
                >
                  Something else
                </button>
              </p>
            </section>

            {/* -------- what they chose -------- */}
            <section style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 20, margin: "0 0 12px" }}>
                What they chose{draft.pieces.length > 0 ? ` (${draft.pieces.length})` : ""}
              </h2>
              {draft.pieces.length === 0 ? (
                <p className="lede" style={{ fontSize: 17 }}>
                  Nothing yet. Tap a price above as the family names what they want.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {draft.pieces.map((p) => {
                    const pp = pricing.perPiece.get(p.id);
                    const open = openPiece === p.id;
                    return (
                      <article key={p.id} className="panel" style={{ padding: 14, display: "grid", gap: 10 }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <input
                            aria-label="Piece"
                            placeholder="What is it?"
                            value={p.name}
                            onChange={(e) => setPiece(p.id, { name: e.target.value })}
                            style={{ ...field, flex: "2 1 170px", minWidth: 0, width: "auto", fontWeight: 600 }}
                          />
                          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14.5 }}>
                            <span className="muted">×</span>
                            <input
                              aria-label={`Quantity of ${p.name || "piece"}`}
                              inputMode="numeric"
                              value={p.qty}
                              onChange={(e) => setPiece(p.id, { qty: e.target.value })}
                              style={{ ...field, width: 56 }}
                            />
                          </label>
                          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14.5 }}>
                            <span className="muted">$</span>
                            <input
                              aria-label={`Price of ${p.name || "piece"}`}
                              inputMode="decimal"
                              value={p.price}
                              onChange={(e) => setPiece(p.id, { price: e.target.value })}
                              style={{ ...field, width: 84, fontWeight: 600 }}
                            />
                          </label>
                          <strong style={{ marginLeft: "auto", fontVariantNumeric: "tabular-nums", fontSize: 16 }}>
                            {pp ? money(pp.total) : ""}
                          </strong>
                        </div>

                        {(p.ribbon || open) && (
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14, flex: "1 1 190px", minWidth: 0 }}>
                                <span className="muted" style={{ whiteSpace: "nowrap" }}>Ribbon</span>
                                <input
                                  aria-label={`Ribbon on ${p.name || "piece"}`}
                                  value={p.ribbon}
                                  onChange={(e) => setPiece(p.id, { ribbon: e.target.value })}
                                  style={{ ...field, minWidth: 0 }}
                                />
                              </label>
                              <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14, flex: "1 1 160px", minWidth: 0 }}>
                                <span className="muted" style={{ whiteSpace: "nowrap" }}>From</span>
                                <input
                                  aria-label={`Who ${p.name || "this piece"} is from`}
                                  value={p.from}
                                  onChange={(e) => setPiece(p.id, { from: e.target.value })}
                                  style={{ ...field, minWidth: 0 }}
                                />
                              </label>
                            </div>
                            {open && (
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {RIBBON_WORDS.map((w) => (
                                  <button key={w} type="button" className="fp-chip" style={{ fontSize: 13.5, padding: "5px 10px" }} onClick={() => setPiece(p.id, { ribbon: w })}>
                                    {w}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 13.5 }}>
                          {pp?.stemBudget != null && (
                            <span className="muted">
                              {money(pp.stemBudget)} of flowers to work with{pp.hardgoods > 0 ? `, after ${money(pp.hardgoods)} hardgoods` : ""}
                            </span>
                          )}
                          <button type="button" style={{ ...textButton, fontSize: 13.5 }} onClick={() => setOpenPiece(open ? null : p.id)}>
                            {open ? "Done" : "Ribbon & who it's from"}
                          </button>
                          <button
                            type="button"
                            style={{ ...textButton, fontSize: 13.5, color: "var(--muted)", marginLeft: "auto" }}
                            onClick={() => set({ pieces: draft.pieces.filter((x) => x.id !== p.id) })}
                          >
                            Remove
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <label style={{ maxWidth: 620 }}>
              <span style={labelText}>Notes <span className="muted" style={{ fontWeight: 400 }}>(internal, never printed)</span></span>
              <textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} style={field} />
            </label>
          </div>

          {/* -------- the running total -------- */}
          <aside className="fp-side panel" style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <label>
              <span style={labelText}>What the family can spend</span>
              <input
                inputMode="decimal"
                placeholder="optional"
                value={draft.budgetTarget}
                onChange={(e) => set({ budgetTarget: e.target.value })}
                style={{ ...field, fontSize: 18 }}
              />
            </label>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--serif)", fontSize: 20 }}>Total</span>
              <strong style={{ fontSize: 28, fontVariantNumeric: "tabular-nums" }}>{money(pricing.total)}</strong>
            </div>

            {overTarget != null && (
              <p
                role="status"
                style={{ margin: 0, fontSize: 15, fontWeight: 600, color: overTarget > 0 ? "var(--rose-ink)" : "var(--green)" }}
              >
                {overTarget > 0
                  ? `${money(overTarget)} over what they said.`
                  : overTarget === 0
                    ? "Right on their number."
                    : `${money(-overTarget)} still to spend.`}
              </p>
            )}

            <label>
              <span style={labelText}>Delivery $</span>
              <input inputMode="decimal" value={draft.delivery} onChange={(e) => set({ delivery: e.target.value })} style={field} />
            </label>

            <p className="muted" style={{ margin: 0, fontSize: 13.5, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              For the workroom: about <strong>{money(pricing.stemCost)}</strong> of flowers across the
              whole service, at ×{Number(draft.markup) || 1} and {Number(draft.laborPct) || 0}% labor.
            </p>

            <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10, display: "grid", gap: 8 }}>
              {placed ? (
                <p style={{ margin: 0, fontSize: 14.5, color: "var(--green)", fontWeight: 600 }}>
                  On the board as {placed}. <a href="/workroom">Open the board</a>.
                </p>
              ) : (
                <>
                  <button className="btn btn--solid" type="button" onClick={placeOrder} disabled={draft.pieces.length === 0 || placing}>
                    {placing ? "Sending…" : "Put it on the board"}
                  </button>
                  <span aria-live="polite" style={{ fontSize: 13.5 }}>
                    {placeError ? (
                      <strong style={{ color: "var(--rose-ink)" }}>{placeError}</strong>
                    ) : (
                      <span className="muted">Makes it a confirmed order on the board.</span>
                    )}
                  </span>
                </>
              )}
            </div>
          </aside>
        </div>

        <div className="fp-bar">
          <span aria-hidden="true" className="muted">
            {overTarget != null && overTarget > 0 ? `${money(overTarget)} over` : draft.pieces.length ? `${draft.pieces.length} pieces` : "nothing yet"}
          </span>
          <span style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{money(pricing.total)}</span>
        </div>
        <div style={{ height: 46 }} aria-hidden="true" />
      </div>

      <FuneralPrint draft={draft} pricing={pricing} />
    </>
  );
}

/**
 * The family's copy, printed at the counter before they leave. No stem
 * budgets, no markup, no internal notes. It reads as a summary of what was
 * just agreed, because that is what someone wants in their hand walking out.
 */
function FuneralPrint({ draft, pricing }: { draft: Draft; pricing: QuotePricing }) {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const rows = draft.pieces.filter((p) => p.name.trim() && (pricing.perPiece.get(p.id)?.each ?? 0) > 0);
  return (
    <div id="quote-doc" style={{ fontFamily: "var(--sans)", color: "#1a1611", fontSize: "12.5pt", lineHeight: 1.55 }}>
      <header style={{ borderBottom: "2px solid #1a1611", paddingBottom: "4mm", marginBottom: "6mm" }}>
        <p style={{ fontFamily: "var(--serif)", fontSize: "22pt", margin: 0 }}>{site.name}</p>
        <p style={{ margin: "1mm 0 0", fontSize: "10.5pt" }}>
          {addressOneLine} · {site.phone} · {site.email}
        </p>
      </header>

      <p style={{ fontSize: "10.5pt", letterSpacing: ".12em", textTransform: "uppercase", margin: "0 0 1mm" }}>
        Funeral flowers
      </p>
      <p style={{ fontFamily: "var(--serif)", fontSize: "17pt", margin: "0 0 1mm" }}>
        {draft.deceased ? `In memory of ${draft.deceased}` : draft.clientName || "—"}
      </p>
      <p style={{ margin: "0 0 6mm", fontSize: "11pt" }}>
        {[draft.venue, draft.eventDate, draft.serviceTime ? prettyTime(draft.serviceTime) : ""].filter(Boolean).join(" · ") || " "}
        <span style={{ float: "right" }}>{today}</span>
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
          {rows.map((p) => {
            const pp = pricing.perPiece.get(p.id)!;
            return (
              <tr key={p.id}>
                <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6" }}>
                  {p.name}
                  {p.ribbon && <span style={{ display: "block", fontSize: "9.5pt", fontStyle: "italic" }}>Ribbon: {p.ribbon}</span>}
                  {p.from && <span style={{ display: "block", fontSize: "9.5pt" }}>From {p.from}</span>}
                </td>
                <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6", textAlign: "right" }}>{Number(p.qty) || 1}</td>
                <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6", textAlign: "right" }}>{money(pp.each)}</td>
                <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6", textAlign: "right" }}>{money(pp.total)}</td>
              </tr>
            );
          })}
          {pricing.delivery > 0 && (
            <tr>
              <td colSpan={3} style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6" }}>Delivery to the service</td>
              <td style={{ padding: "2mm 1mm", borderBottom: "1px solid #d8d2c6", textAlign: "right" }}>{money(pricing.delivery)}</td>
            </tr>
          )}
        </tbody>
      </table>

      <p style={{ textAlign: "right", fontSize: "15pt", margin: "4mm 0 6mm" }}>
        Total <strong>{money(pricing.total)}</strong>
      </p>

      <p style={{ margin: "0 0 2mm", fontSize: "10.5pt" }}>{site.delivery.funeralNote}</p>
      <p style={{ marginTop: "6mm", fontSize: "9.5pt", color: "#4c463d" }}>{site.substitutionPolicy}</p>
    </div>
  );
}
