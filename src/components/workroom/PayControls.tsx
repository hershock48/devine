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
  balanceCents = 0,
  batch,
  onPaid,
}: {
  orderId: string;
  subtotal: number;
  /** The delivery fee the pay route will append for a delivery ticket
      that never carried one (zip on the owner's sheet). Display only;
      the server computes its own copy and the two must agree. */
  deliveryCents?: number;
  payment?: Payment | null;
  /** Cents still due after the payments taken (derive.ts balanceCents).
      With a payment on the order this is what the buttons charge; a
      zero or negative balance shows no buttons. */
  balanceCents?: number;
  /** The orders placed together with this one that still need paying
      (the batch), so one card can settle all of them. */
  batch?: { ids: string[]; count: number; totalCents: number; name: string };
  onPaid: () => void;
}) {
  /** "one" or "all": which the buttons charge when a batch is offered. */
  const [scope, setScope] = useState<"one" | "all">("all");
  /** True after an unsure Square answer: the retry must send the same
      request, so the one/all choice is frozen until it is settled. */
  const [unsure, setUnsure] = useState(false);
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
  /** One id per card attempt, kept until Square answers for sure (paid or
      declined), so a second Charge after a lost answer cannot be a second
      charge: the pay route keys Square's idempotency on it. */
  const attemptRef = useRef<string>("");

  /* Display only; the pay route computes its own copy and Square's total
     check keeps the two honest. */
  const topUp = !!payment;
  const total = topUp ? balanceCents : Math.round(subtotal * 100) + deliveryCents;
  const forAll = !!batch && scope === "all";
  const amount = forAll ? batch!.totalCents : total;

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
        if (!attemptRef.current) attemptRef.current = crypto.randomUUID();
      }
      let r: Response;
      let d: { ok?: boolean; error?: string; boardMissed?: boolean; unsure?: boolean };
      try {
        r = await fetch("/api/workroom/pay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(forAll ? { ids: batch!.ids, method, sourceId, attempt: attemptRef.current || undefined } : { id: orderId, method, sourceId, attempt: attemptRef.current || undefined }),
        });
        d = (await r.json().catch(() => ({}))) as typeof d;
      } catch {
        // The request may have arrived and charged. Not "did not go
        // through": the attempt id stays, and Charge again settles it.
        setUnsure(true);
        throw new Error("The connection dropped after the charge was sent, so the card MAY have been charged. Tap Charge once more: if it went through, it will say so and not charge twice.");
      }
      if (!r.ok || !d.ok) {
        // A definite answer (declined, refused, already paid) ends this
        // attempt; an unsure one keeps it for the retry.
        if (!d.unsure) attemptRef.current = "";
        setUnsure(!!d.unsure);
        throw new Error(d.error || "The payment did not go through.");
      }
      attemptRef.current = "";
      setUnsure(false);
      setMode("idle");
      if (d.boardMissed) {
        // The charge is real; only the board missed it. Said loudly, so
        // nobody takes the card again. The webhook catches up by itself.
        setError(
          forAll
            ? `CHARGED ${dollars(amount)} for all ${batch!.count} orders, but the board did not save it. Do NOT charge again. Mark each of them "Paid another way" with this charge's amount.`
            : topUp
              ? "CHARGED the balance, but the board did not save it. Do NOT charge again. Square's notice will add it within a minute; if it does not, mark it by hand."
              : "CHARGED, but the board did not save it. Do NOT charge again. Reload in a minute; the payment will appear.",
        );
      }
      onPaid();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment did not go through.");
    } finally {
      setBusy(false);
    }
  }

  const paidLine = payment ? (
    <p
      style={{
        margin: "8px 0 0",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: balanceCents > 0 ? "var(--rose-ink)" : "var(--green)",
      }}
    >
      Paid · {payment.method === "other" ? "another way" : payment.method} · {dollars(payment.totalCents)}
      {balanceCents > 0 ? ` · ${dollars(balanceCents)} still due after changes` : balanceCents < 0 ? ` · ${dollars(-balanceCents)} to refund (Square dashboard)` : ""}
    </p>
  ) : null;
  if (payment && balanceCents <= 0) return paidLine;

  return (
    <div style={{ margin: "10px 0 0" }}>
      {paidLine}
      {mode === "idle" && (
        <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => setMode("card")}>
            {batch ? `Take card (${batch.count} orders)` : "Take card"}
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

      {/* ONE CARD FOR ALL OF THEM (Kevin, 2026-10-14): the orders written
          up together for this customer, paid in one go, each marked paid
          with its share. The choice sits above whichever way is open. */}
      {batch && mode !== "idle" && (
        <p style={{ margin: "0 0 10px", display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14.5 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" name={`pay-scope-${orderId}`} checked={scope === "all"} disabled={unsure} onChange={() => setScope("all")} />
            All {batch.count} orders for {batch.name} · {dollars(batch.totalCents)}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" name={`pay-scope-${orderId}`} checked={scope === "one"} disabled={unsure} onChange={() => setScope("one")} />
            This order only · {dollars(total)}
          </label>
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
              <span>{forAll ? `All ${batch!.count} orders for ${batch!.name}` : topUp ? "Still due after changes" : "Ticket (items and tax)"}</span>
              <span>{dollars(forAll ? batch!.totalCents : topUp ? balanceCents : Math.round(subtotal * 100))}</span>
            </li>
            {!forAll && deliveryCents > 0 && (
              <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span>Delivery</span>
                <span>{dollars(deliveryCents)}</span>
              </li>
            )}
            <li style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
              <span>Total</span>
              <span>{dollars(amount)}</span>
            </li>
          </ul>
          <div ref={holderRef} />
          <p style={{ margin: "10px 0 0", display: "flex", gap: 14, alignItems: "center" }}>
            <button type="button" className="btn btn--solid" disabled={busy || !ready} onClick={() => pay("card")}>
              {!ready ? "Opening card field…" : busy ? "Charging…" : `Charge ${dollars(amount)}`}
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
            {busy ? "Recording…" : `Record ${dollars(amount)} cash`}
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
