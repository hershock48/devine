"use client";

import { useCallback, useEffect, useState } from "react";
import type { Quote } from "@/lib/workroom/store";
import { priceQuote } from "@/lib/workroom/quote-math";
import { money, MemoryWarning, PinGate } from "@/components/workroom/ui";

/**
 * The quote drawer. Two big buttons to start, then every quote as one row a
 * thumb can hit: who, when, how much, where it stands. Newest first, because
 * the quote being worked is almost always the quote touched last.
 */

const STATUS_COLOR: Record<Quote["status"], string> = {
  draft: "var(--muted)",
  sent: "var(--gold, #8a6d2f)",
  accepted: "var(--green)",
  declined: "var(--rose-ink)",
};

export default function Quotes({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [backend, setBackend] = useState("memory");
  const [starting, setStarting] = useState<"wedding" | "funeral" | null>(null);

  const pull = useCallback(async () => {
    const r = await fetch("/api/workroom/quotes", { cache: "no-store" });
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    const d = await r.json();
    setQuotes(d.quotes ?? []);
    setBackend(d.backend ?? "memory");
    setAuthed(true);
  }, []);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
  }, [authed, pull]);

  async function start(kind: "wedding" | "funeral") {
    setStarting(kind);
    const r = await fetch("/api/workroom/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const d = await r.json().catch(() => null);
    if (d?.quote?.id) {
      window.location.href = `/workroom/quotes/${d.quote.id}`;
      return;
    }
    setStarting(null);
  }

  if (!authed) {
    return (
      <>
        <h1>Quotes</h1>
        <PinGate onAuthed={() => pull().catch(() => {})} />
      </>
    );
  }

  return (
    <>
      <h1>Quotes</h1>

      <MemoryWarning backend={backend} />

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "6px 0 30px" }}>
        <button className="btn btn--solid" type="button" disabled={starting !== null} onClick={() => start("wedding")}>
          {starting === "wedding" ? "Starting…" : "Start a wedding quote"}
        </button>
        <button className="btn" type="button" disabled={starting !== null} onClick={() => start("funeral")}>
          {starting === "funeral" ? "Starting…" : "Start a funeral quote"}
        </button>
      </div>

      {quotes.length === 0 ? (
        <p className="lede">
          Nothing quoted yet. Start one above; it saves itself as you type, and the two
          buttons carry different starting pieces because weddings and funerals are
          different models.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {quotes.map((q) => {
            const total = priceQuote(q).total;
            return (
              <li key={q.id} style={{ borderBottom: "1px solid var(--line)" }}>
                <a
                  href={`/workroom/quotes/${q.id}`}
                  style={{
                    display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap",
                    padding: "14px 2px", textDecoration: "none", color: "var(--ink)",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 17, flex: "1 1 180px" }}>
                    {q.clientName || `Unnamed ${q.kind} quote`}
                  </span>
                  <span className="muted" style={{ fontSize: 14 }}>
                    {q.kind}{q.eventDate ? ` · ${q.eventDate}` : ""}
                  </span>
                  <span style={{ fontWeight: 600, minWidth: 90, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {money(total)}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: STATUS_COLOR[q.status] }}>
                    {q.status}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
