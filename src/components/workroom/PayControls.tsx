"use client";

import { useEffect, useRef, useState } from "react";
import { textButton } from "@/components/workroom/ui";
import { loadSquareSdk, type SquareCard } from "@/lib/square/web-sdk";

/**
 * The money corner of an order card: a PAID badge once settled, otherwise
 * "Take card" and "Record cash". Card entry is Square's Web Payments SDK
 * drawing its own iframe field, so no card number ever exists in our page
 * or on our server; we see a one-use token. The charge lands in the shop's
 * own Square account, itemized, linked to this order by id, and the
 * webhook + inventory treat it as the board order's money rather than a
 * second sale. NO FEE since the 2026-10-06 meeting: the shop's 3% card fee
 * is retired (she bakes processing into her prices; site.ts), and the 99
 * cent platform fee rides website orders only and never appears at this
 * board. Card and cash both charge exactly the lines.
 *
 * The SDK loads lazily, only when someone opens card entry: the board is a
 * counter tool that polls all day, and Square's script has no business on
 * it until the moment a card is in hand.
 */

type Payment = { at: number; method: string; totalCents: number; feeCents: number };

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function PayControls({
  orderId,
  subtotal,
  deliveryCents = 0,
  payment,
  onPaid,
}: {
  orderId: string;
  subtotal: number;
  /** The delivery fee the pay route will append for a delivery ticket
      that never carried one (zip on the owner's sheet). Display only;
      the server computes its own copy and the two must agree. */
  deliveryCents?: number;
  payment?: Payment | null;
  onPaid: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "card" | "cash" | "manual">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /** True once Square's card field is attached and typeable. The charge
      button stays disabled until then, because the first live test clicked
      into "The card field is not ready yet.", which is the code scolding
      the user for its own loading time. */
  const [ready, setReady] = useState(false);
  const cardRef = useRef<SquareCard | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);

  /* Display only; the pay route computes its own copy and Square's total
     check keeps the two honest. */
  const total = Math.round(subtotal * 100) + deliveryCents;

  // Mount Square's card field when card mode opens; tear it down when it
  // closes, because a destroyed iframe beats a leaked one on a page that
  // lives open behind a counter all day.
  useEffect(() => {
    if (mode !== "card") return;
    let dead = false;
    setReady(false);
    // If neither the field nor an error has shown in 12 seconds, say so:
    // a silent forever-spinner behind a counter is a phone call to Kevin.
    const stuck = setTimeout(() => {
      if (!dead && !cardRef.current) {
        setError("Square's card field did not open. Close this and try again, or refresh the page.");
      }
    }, 12000);
    (async () => {
      try {
        const r = await fetch("/api/workroom/square-web", { cache: "no-store" });
        const cfgJson = (await r.json()) as {
          applicationId?: string;
          locationId?: string;
          env?: string;
          feeCents?: number;
          error?: string;
        };
        if (!r.ok || !cfgJson.applicationId || !cfgJson.locationId) {
          throw new Error(cfgJson.error || "Card entry is unavailable.");
        }
        await loadSquareSdk(cfgJson.env ?? "sandbox");
        if (dead || !window.Square) return;
        const payments = await window.Square.payments(cfgJson.applicationId, cfgJson.locationId);
        const card = await payments.card();
        if (dead || !holderRef.current) {
          await card.destroy().catch(() => {});
          return;
        }
        await card.attach(holderRef.current);
        cardRef.current = card;
        if (!dead) setReady(true);
      } catch (err) {
        if (!dead) setError(err instanceof Error ? err.message : "Card entry did not open.");
      }
    })();
    return () => {
      dead = true;
      clearTimeout(stuck);
      cardRef.current?.destroy().catch(() => {});
      cardRef.current = null;
      setReady(false);
    };
  }, [mode]);

  async function pay(method: "card" | "cash" | "manual") {
    setBusy(true);
    setError("");
    try {
      let sourceId: string | undefined;
      if (method === "card") {
        if (!cardRef.current) throw new Error("The card field is not ready yet.");
        const t = await cardRef.current.tokenize();
        if (t.status !== "OK" || !t.token) {
          throw new Error(t.errors?.[0]?.message || "The card did not tokenize. Check the number.");
        }
        sourceId = t.token;
      }
      const r = await fetch("/api/workroom/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, method, sourceId }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; boardMissed?: boolean };
      if (!r.ok || !d.ok) throw new Error(d.error || "The payment did not go through.");
      setMode("idle");
      if (d.boardMissed) {
        // The charge is real; only the board missed it. Said loudly, so
        // nobody takes the card again. The webhook catches up by itself.
        setError("CHARGED, but the board did not save it. Do NOT charge again. Reload in a minute; the payment will appear.");
      }
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment did not go through.");
    } finally {
      setBusy(false);
    }
  }

  if (payment) {
    return (
      <p
        style={{
          margin: "8px 0 0",
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--green)",
        }}
      >
        Paid · {payment.method === "other" ? "another way" : payment.method} · {dollars(payment.totalCents)}
      </p>
    );
  }

  return (
    <div style={{ margin: "10px 0 0" }}>
      {mode === "idle" && (
        <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => setMode("card")}>
            Take card
          </button>
          <button type="button" onClick={() => setMode("cash")} style={{ ...textButton, fontSize: 14 }}>
            Record cash
          </button>
          {/* The escape hatch for money that moved outside the board (rung
              at the register without the DV note, a check, an account
              customer). Without it, orders paid off-system nag in the owed
              section forever, which teaches staff to ignore the section. */}
          <button type="button" onClick={() => setMode("manual")} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
            Paid another way
          </button>
        </p>
      )}

      {mode === "manual" && (
        <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14 }}>
            Marks it paid without touching Square. For money that already moved: the register, a
            check, an account.
          </span>
          <button type="button" className="btn btn--solid" disabled={busy} onClick={() => pay("manual")}>
            {busy ? "Marking…" : "Mark paid"}
          </button>
          <button type="button" disabled={busy} onClick={() => setMode("idle")} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
            Never mind
          </button>
        </p>
      )}

      {mode === "card" && (
        <div className="panel" style={{ padding: 12, marginTop: 4 }}>
          {/* A receipt, not a sentence. No fee row since 2026-10-06: the
              card is charged exactly the ticket. */}
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", fontSize: 14.5 }}>
            <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span>Subtotal</span>
              <span>{dollars(Math.round(subtotal * 100))}</span>
            </li>
            {deliveryCents > 0 && (
              <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>Delivery</span>
                <span>{dollars(deliveryCents)}</span>
              </li>
            )}
            <li style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
              <span>Total</span>
              <span>{dollars(total)}</span>
            </li>
          </ul>
          <div ref={holderRef} />
          <p style={{ margin: "10px 0 0", display: "flex", gap: 14, alignItems: "center" }}>
            <button type="button" className="btn btn--solid" disabled={busy || !ready} onClick={() => pay("card")}>
              {!ready ? "Opening card field…" : busy ? "Charging…" : `Charge ${dollars(total)}`}
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("idle")} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
              Never mind
            </button>
          </p>
        </div>
      )}

      {mode === "cash" && (
        <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn--solid" disabled={busy} onClick={() => pay("cash")}>
            {busy ? "Recording…" : `Record ${dollars(total)} cash`}
          </button>
          <button type="button" disabled={busy} onClick={() => setMode("idle")} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
            Never mind
          </button>
        </p>
      )}

      {error && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 14, fontWeight: 600, color: "var(--rose-ink)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
