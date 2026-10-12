"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Quote } from "@/lib/workroom/store";
import { priceQuote } from "@/lib/workroom/quote-math";
import { field, money, textButton, MemoryWarning, PinGate } from "@/components/workroom/ui";

/**
 * The quote drawer. Two big buttons to start, then every quote as one row a
 * thumb can hit: who, when, how much, where it stands. Newest first, because
 * the quote being worked is almost always the quote touched last.
 *
 * FIND, SORT, PUT AWAY (Katy, 2026-10-06: "can we order these by days or
 * somehow organize these better? search through quotes bar"). A search box
 * over names, the deceased, venue, phone and dates; a sort between last
 * touched, event date soonest, and amount; and Archive, which hides a
 * quote without deleting it. Archived quotes come back under "Show
 * archived" with a Restore. Nothing on this page deletes.
 */

type Sort = "touched" | "event" | "amount";

function quoteLabel(q: Quote): string {
  return q.kind === "funeral" && q.deceased ? `Service for ${q.deceased}` : q.clientName || `Unnamed ${q.kind} quote`;
}

/* House tokens only: an invented --gold with a hex fallback is a color the
   auditor never validated on any ground. Sent reads as ink, bold; draft as
   muted; the two verdicts wear the two accents. */
const STATUS_COLOR: Record<Quote["status"], string> = {
  draft: "var(--muted)",
  sent: "var(--ink)",
  accepted: "var(--green)",
  declined: "var(--rose-ink)",
};

export default function Quotes({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [backend, setBackend] = useState<string | null>(null);
  const [starting, setStarting] = useState<"wedding" | "funeral" | null>(null);
  const [find, setFind] = useState("");
  const [sort, setSort] = useState<Sort>("touched");
  const [showArchived, setShowArchived] = useState(false);

  async function setArchived(id: string, archived: boolean) {
    await fetch("/api/workroom/quotes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, archived }),
    });
    pull().catch(() => {});
  }

  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    const hit = (x: Quote) =>
      !q ||
      [x.clientName, x.deceased ?? "", x.venue, x.eventDate, x.kind, x.status, x.notes]
        .some((v) => v.toLowerCase().includes(q)) ||
      (digits.length >= 3 && x.phone.replace(/\D/g, "").includes(digits));
    const list = quotes.filter((x) => (showArchived ? !!x.archivedAt : !x.archivedAt) && hit(x));
    const by: Record<Sort, (a: Quote, b: Quote) => number> = {
      touched: (a, b) => b.updatedAt - a.updatedAt,
      // Soonest first; undated quotes sink to the bottom rather than
      // sorting as the empty string, which would float them to the top.
      event: (a, b) => (a.eventDate || "9999").localeCompare(b.eventDate || "9999") || b.updatedAt - a.updatedAt,
      amount: (a, b) => priceQuote(b).total - priceQuote(a).total,
    };
    return [...list].sort(by[sort]);
  }, [quotes, find, sort, showArchived]);
  const archivedCount = quotes.filter((x) => !!x.archivedAt).length;

  const pull = useCallback(async () => {
    const r = await fetch("/api/workroom/quotes", { cache: "no-store" });
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    const d = await r.json();
    const list: Quote[] = d.quotes ?? [];
    setQuotes(list);
    setBackend(d.backend ?? "memory");
    setAuthed(true);
    // Seeing this list is what the Quotes tab badge counts down to. The
    // mark happens AFTER the render state is set, so the rows fetched
    // unseen still wear their "new" tag on this visit; the badge and the
    // tag clear on the next look.
    if (list.some((q) => q.source === "web" && !q.seenAt)) {
      fetch("/api/workroom/badges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seen: "quotes" }),
      }).catch(() => {});
    }
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

      {/* .btnrow, not a bare flex: below 480 it turns the hairline secondary
          into an outline pill beside the solid one, the house pairing rule,
          instead of an underlined line floating under a pill. */}
      <div className="btnrow" style={{ margin: "6px 0 30px" }}>
        <button className="btn btn--solid" type="button" disabled={starting !== null} onClick={() => start("wedding")}>
          {starting === "wedding" ? "Starting…" : "Start a wedding quote"}
        </button>
        <button className="btn" type="button" disabled={starting !== null} onClick={() => start("funeral")}>
          {starting === "funeral" ? "Starting…" : "Start a funeral quote"}
        </button>
      </div>

      {quotes.length > 0 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", margin: "-12px 0 16px" }}>
          <input
            type="search"
            aria-label="Find a quote"
            placeholder="Find: name, deceased, venue, phone, date"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            style={{ ...field, width: "auto", flex: "0 1 300px", minWidth: 0 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} style={{ ...field, width: "auto" }}>
              <option value="touched">Last touched</option>
              <option value="event">Event date, soonest</option>
              <option value="amount">Amount, largest</option>
            </select>
          </label>
          {(archivedCount > 0 || showArchived) && (
            <button type="button" onClick={() => setShowArchived((v) => !v)} style={{ ...textButton, fontSize: 14 }}>
              {showArchived ? "Back to open quotes" : `Show archived (${archivedCount})`}
            </button>
          )}
        </div>
      )}

      {quotes.length === 0 ? (
        <p className="lede">Nothing quoted yet. Start one above; it saves itself as you type.</p>
      ) : shown.length === 0 ? (
        <p className="muted" role="status">
          {showArchived ? "Nothing archived" : "Nothing"}{find.trim() ? ` matches "${find.trim()}"` : ""}.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {shown.map((q) => {
            const total = priceQuote(q).total;
            return (
              <li key={q.id} style={{ borderBottom: "1px solid var(--line)", display: "flex", alignItems: "baseline", gap: 10 }}>
                <a
                  href={`/workroom/quotes/${q.id}`}
                  style={{
                    display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap",
                    padding: "14px 2px", textDecoration: "none", color: "var(--ink)", flex: "1 1 auto", minWidth: 0,
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 17, flex: "1 1 180px" }}>
                    {/* A funeral is looked up by whose service it is, not by
                        which relative happened to be at the counter. */}
                    {quoteLabel(q)}
                    {q.source === "web" && !q.seenAt && (
                      <span style={{
                        marginLeft: 8, padding: "2px 7px", borderRadius: 9,
                        background: "var(--rose-ink)", color: "var(--paper)",
                        fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
                        verticalAlign: "2px",
                      }}>
                        New, from the website
                      </span>
                    )}
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
                {/* Outside the link, so a tap on it never opens the quote. */}
                <button
                  type="button"
                  aria-label={`${q.archivedAt ? "Restore" : "Archive"} ${quoteLabel(q)}`}
                  onClick={() => setArchived(q.id, !q.archivedAt)}
                  style={{ ...textButton, fontSize: 13.5, color: "var(--muted)", whiteSpace: "nowrap" }}
                >
                  {q.archivedAt ? "Restore" : "Archive"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
