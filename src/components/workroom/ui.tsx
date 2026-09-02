"use client";

/**
 * The workroom's shared small parts. The workroom reuses the site's tokens
 * (same globals.css) but none of the marketing chrome: it is a working screen
 * on the counter's shared computer, so everything is large, plain and one tap
 * (the pjs kitchen screen's rule).
 */

import { useEffect, useMemo, useState } from "react";
import { isoDate, normalizeVariety } from "@/lib/workroom/derive";

export const field: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  font: "inherit",
  fontSize: 15.5,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--paper)",
  color: "var(--ink)",
};

export const labelText: React.CSSProperties = {
  display: "block",
  fontSize: 14,
  fontWeight: 600,
  marginBottom: 4,
};

export const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * The customer-identity key: last ten digits of whatever was typed. The
 * board's "returning customer" badge and the dashboard's Returning tile both
 * match on this, and they must keep agreeing or the two screens count
 * different customers. One copy, here, for that reason.
 */
export const phoneKey = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
};

/**
 * A radio a thumb can hit. The browser default is 13x13px, which is fine for
 * a mouse and hopeless at a counter; 20px plus the wrapping label's text
 * clears the 24px target-size guidance with the shop's accent on it.
 */
export const radio: React.CSSProperties = {
  width: 20,
  height: 20,
  accentColor: "var(--green)",
};

/** Text-styled buttons and links still need 24px of vertical target. */
export const textButton: React.CSSProperties = {
  background: "none",
  border: 0,
  font: "inherit",
  fontSize: 14,
  color: "var(--ink)",
  cursor: "pointer",
  textDecoration: "underline",
  padding: "6px 0",
};

/** "September 8, 2026" from "2026-09-08", for the printed documents a
    client holds; an ISO date next to a written one reads as a glitch.
    Noon, not midnight, so no timezone can pull it to the day before. */
export function longDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

export function todayISO(): string {
  // The shop device's own calendar, deliberately: "today" on the board means
  // today in Marshall, where the device is.
  return isoDate(new Date());
}

/**
 * Shown only once the server has SAID which backend it is on. Every screen
 * starts its backend state at null; an early draft started it at "memory",
 * so a connected production dashboard flashed "No database is connected"
 * for the half second before its first fetch answered (Kevin saw it,
 * 2026-09-01). Unknown renders nothing, not a warning.
 */
export function MemoryWarning({ backend }: { backend: string | null }) {
  if (backend !== "memory") return null;
  return (
    <p
      role="alert"
      style={{
        background: "var(--paper-2)",
        borderLeft: "2px solid var(--rose-ink)",
        padding: "10px 14px",
        fontSize: 14.5,
        margin: "0 0 18px",
      }}
    >
      <strong style={{ color: "var(--rose-ink)" }}>No database is connected,</strong> so entries only
      live in this server&rsquo;s memory and can vanish or go missing between visits. Fine for a
      demonstration; not fine for a real day. Vercel &gt; Storage &gt; Create Database fixes it.
    </p>
  );
}


/* Small edit distance for did-you-mean, with an early out on hopeless
   length gaps. The library is ~115 short names; this is cheap. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** The closest library names to a typed one: distance-ranked, prefix and
    contains matches included, at most two offered. */
function suggestNames(name: string, library: string[]): string[] {
  const cap = name.length < 5 ? 1 : 2;
  return library
    .map((n) => {
      const d = editDistance(name, n);
      const related = n.startsWith(name) || name.startsWith(n) || (name.length >= 4 && n.includes(name));
      return { n, score: d <= cap ? d : related ? 3 : 9 };
    })
    .filter((x) => x.score < 9)
    .sort((a, b) => a.score - b.score || a.n.length - b.n.length)
    .slice(0, 2)
    .map((x) => x.n);
}

/**
 * The gate under every variety field. When the typed name is not in the
 * stem library it offers the CLOSEST existing names first (most strangers
 * are misspellings of a resident, and Kevin's worry was exactly that one
 * reflexive click would enshrine the typo), and behind them a small
 * deliberate add: the name shown again for a second look, its kind, and
 * the optional facts worth capturing while someone is standing there. A
 * finished add says so in words instead of just disappearing.
 *
 * Render it unconditionally under the field; it decides for itself whether
 * there is anything to say.
 */
export function VarietyGate({
  value,
  library,
  onReplace,
  onAdded,
}: {
  /** The field's raw typed value. */
  value: string;
  /** The library's names (plus any added this session by the caller). */
  library: string[];
  /** Put this name into the field (a suggestion tap, or the added name). */
  onReplace: (name: string) => void;
  /** The add succeeded; the caller refreshes or extends its library list. */
  onAdded: (name: string) => void;
}) {
  const name = normalizeVariety(value);
  const listed = useMemo(() => new Set(library), [library]);
  const [openForm, setOpenForm] = useState(false);
  const [draft, setDraft] = useState({ name: "", kind: "flower", sellStem: "", stemsPerBunch: "" });
  const [error, setError] = useState("");
  const [added, setAdded] = useState("");

  // A different name in the field closes the form; the confirmation stays
  // only while the field still holds the name it confirmed.
  useEffect(() => {
    setOpenForm(false);
    setError("");
  }, [name]);

  if (!name) return null;

  if (listed.has(name)) {
    if (added === name) {
      return (
        <p style={{ margin: "4px 0 0", fontSize: 13.5 }}>
          <strong style={{ color: "var(--green)" }}>Added.</strong>{" "}
          <span className="muted">
            &ldquo;{name}&rdquo; is in the stem library now; anything left blank can be filled there later.
          </span>
        </p>
      );
    }
    return null;
  }

  async function save() {
    setError("");
    const finalName = normalizeVariety(draft.name);
    if (!finalName) {
      setError("A name is required.");
      return;
    }
    const r = await fetch("/api/workroom/varieties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: finalName, kind: draft.kind, sellStem: draft.sellStem, sellBunch: "", stemsPerBunch: draft.stemsPerBunch }),
    });
    const d = (await r.json().catch(() => null)) as { variety?: { name?: string }; error?: string } | null;
    if (!r.ok) {
      setError(d?.error || "That did not save.");
      return;
    }
    const savedName = d?.variety?.name ?? finalName;
    setAdded(savedName);
    setOpenForm(false);
    onAdded(savedName);
    onReplace(savedName);
  }

  if (!openForm) {
    const suggestions = suggestNames(name, library);
    return (
      <p style={{ margin: "4px 0 0", fontSize: 13.5 }}>
        <span style={{ color: "var(--rose-ink)", fontWeight: 600 }}>Not in the stem library.</span>{" "}
        {suggestions.map((s) => (
          <span key={s}>
            <button type="button" onClick={() => onReplace(s)} style={{ ...textButton, fontSize: 13.5, fontWeight: 700 }}>
              Did you mean &ldquo;{s}&rdquo;?
            </button>{" "}
          </span>
        ))}
        <button
          type="button"
          onClick={() => {
            setDraft({ name, kind: "flower", sellStem: "", stemsPerBunch: "" });
            setOpenForm(true);
          }}
          style={{ ...textButton, fontSize: 13.5 }}
        >
          Add &ldquo;{name}&rdquo; as a new variety&hellip;
        </button>
      </p>
    );
  }

  const tiny: React.CSSProperties = { ...field, padding: "7px 9px", fontSize: 14 };
  return (
    <div style={{ margin: "6px 0 0", border: "1px solid var(--line)", borderRadius: 3, padding: "10px 12px", display: "grid", gap: 8 }}>
      <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600 }}>
        A new library entry. Check the spelling once; every ledger matches on it forever.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <label style={{ flex: "1 1 140px" }}>
          <span style={{ ...labelText, fontSize: 12.5 }}>Name</span>
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={tiny} />
        </label>
        <label>
          <span style={{ ...labelText, fontSize: 12.5 }}>Kind</span>
          <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} style={tiny}>
            <option value="flower">flower</option>
            <option value="green">green</option>
          </select>
        </label>
        <label>
          <span style={{ ...labelText, fontSize: 12.5 }}>Sell/stem</span>
          <input inputMode="decimal" value={draft.sellStem} onChange={(e) => setDraft({ ...draft, sellStem: e.target.value })} placeholder="$, if known" style={{ ...tiny, width: 92 }} />
        </label>
        <label>
          <span style={{ ...labelText, fontSize: 12.5 }}>Stems/bunch</span>
          <input inputMode="numeric" value={draft.stemsPerBunch} onChange={(e) => setDraft({ ...draft, stemsPerBunch: e.target.value })} placeholder="if known" style={{ ...tiny, width: 86 }} />
        </label>
      </div>
      <p style={{ margin: 0, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn--solid" type="button" onClick={save}>
          Add to the library
        </button>
        <button type="button" onClick={() => setOpenForm(false)} style={textButton}>
          Cancel
        </button>
        <span aria-live="polite" style={{ fontSize: 13.5, color: "var(--rose-ink)", fontWeight: 600 }}>{error}</span>
      </p>
    </div>
  );
}

/** The PIN gate. One field, big enough to tap with a thumb. The callback
    receives what the login said, so a screen that cares about the owner
    tier can read `info.owner`; every other caller ignores the argument. */
export function PinGate({ onAuthed }: { onAuthed: (info?: { owner?: boolean }) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const r = await fetch("/api/workroom/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (!r.ok) {
      // The three failures are different problems for different people: a
      // typo, a lockout, and an operator who has not set WORKROOM_PIN. One
      // "Wrong PIN." for all three sends the shop hunting for a PIN that does
      // not exist.
      const body = (await r.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error || "Wrong PIN.");
      return;
    }
    const d = (await r.json().catch(() => null)) as { owner?: boolean } | null;
    setPin("");
    onAuthed({ owner: !!d?.owner });
  }

  return (
    <form onSubmit={login} style={{ maxWidth: 320, marginTop: 32 }}>
      <label>
        <span style={labelText}>Workroom PIN</span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          style={{ ...field, fontSize: 22, letterSpacing: "0.3em", textAlign: "center" }}
        />
      </label>
      <p style={{ marginTop: 14 }}>
        <button className="btn btn--solid" type="submit">
          Open the workroom
        </button>
      </p>
      <p aria-live="polite" style={{ color: "var(--rose-ink)", fontWeight: 600, minHeight: "1.4em" }}>
        {error}
      </p>
    </form>
  );
}
