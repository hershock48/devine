"use client";

/**
 * The workroom's shared small parts. The workroom reuses the site's tokens
 * (same globals.css) but none of the marketing chrome: it is a working screen
 * on the counter's shared computer, so everything is large, plain and one tap
 * (the pjs kitchen screen's rule).
 */

import { useState } from "react";

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

export function todayISO(): string {
  // The shop device's own calendar, deliberately: "today" on the board means
  // today in Marshall, where the device is.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function MemoryWarning({ backend }: { backend: string }) {
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

/** The PIN gate. One field, big enough to tap with a thumb. */
export function PinGate({ onAuthed }: { onAuthed: () => void }) {
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
      setError("Wrong PIN.");
      return;
    }
    setPin("");
    onAuthed();
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
