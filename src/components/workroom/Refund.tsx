"use client";

import { useState } from "react";
import { field, money, textButton } from "@/components/workroom/ui";
import { parseDollars } from "@/components/workroom/PayControls";

/**
 * A REFUND, RECORDED WHERE THE ORDER IS (Katy, 2026-11-09: "how can she
 * refund? on workroom, that is. Full or partial or even refunding
 * delivery. She does it on Square, but wants to do it for her workroom
 * for her books").
 *
 * Until now the board knew two refunds: a canceled order given back
 * whole, and the difference after a paid ticket was edited down. Neither
 * covers the common one, where the order stands as it was and some of the
 * money goes back anyway: the delivery was late, the flowers were wrong,
 * the customer is owed a kindness. This records that: an amount (all of
 * it, the delivery fee, or a figure), what it was for, and how it went
 * back. The ticket is not changed, the day sheet counts it as money out,
 * and the customer gets the same refund note as any other.
 *
 * IT IS THE RECORD, NOT THE REFUND. The workroom moves no money out, by
 * design (the pay route's note). A card is still refunded in the Square
 * dashboard; cash comes out of the drawer; this is how the books hear of
 * it, and the panel says so before the button.
 */
type How = "square" | "hand" | "check";

const REASONS = ["Delivery fee", "Late delivery", "Wrong or damaged flowers", "Customer changed their mind"];

export default function RefundControl({
  orderId,
  number,
  refundableCents,
  deliveryCents,
  square,
  settled,
  cashOnly,
  onDone,
}: {
  orderId: string;
  number: string;
  /** Everything paid, less what has already gone back. */
  refundableCents: number;
  /** The ticket's delivery line, in cents; 0 when it has none. */
  deliveryCents: number;
  /** derive.ts squareMoney: Square holds some of this order's money. */
  square: boolean;
  /** Nothing still due on the order: the delivery fee can come off the
      ticket and be marked refunded in one go. */
  settled: boolean;
  /** Every payment on it was cash: a refund comes out of the drawer. */
  cashOnly: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState("");
  const [how, setHow] = useState<How>(cashOnly ? "hand" : square ? "square" : "hand");
  /** THE DELIVERY FEE COMES OFF THE TICKET (second review, 2026-11-10).
      Refunding the fee is a change to the order (the 2026-10-15 rule:
      "refund a delivery off of an order"), not a kindness beside it. Done
      as a change, the fee cannot be given back here and then again when
      someone takes it off the ticket. True while the amount is the fee
      the chip filled. */
  const [feeOff, setFeeOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (refundableCents <= 0) return null;
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...textButton, fontSize: 14 }}>
        Refund some or all of it
      </button>
    );
  }
  const cents = parseDollars(amountText);
  const problem =
    cents === null
      ? "Type the amount going back as a number, like 15 or 15.00."
      : cents <= 0
        ? "The amount has to be more than zero."
        : cents > refundableCents
          ? `Only ${money(refundableCents / 100)} of what was paid is left to refund.`
          : !reason.trim()
            ? "Say what the refund is for."
            : "";
  async function save() {
    if (problem || cents === null) return;
    setBusy(true);
    setError("");
    try {
      if (feeOff && cents === deliveryCents) {
        // Two steps the board already knows: the fee comes off the ticket,
        // then what the ticket lost is marked given back.
        const patch = (body: Record<string, unknown>) =>
          fetch("/api/workroom/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: orderId, ...body }) }).then(async (x) => ({ ok: x.ok, d: (await x.json().catch(() => null)) as { error?: string } | null }));
        const off = await patch({ deliveryFee: 0 });
        if (!off.ok) {
          setError(off.d?.error || "The fee did not come off the ticket. Nothing was recorded.");
          return;
        }
        const back = await patch({ refunded: cents, how, reason: reason.trim() });
        if (!back.ok) {
          setError(`${back.d?.error || "The refund did not record."} The fee is off the ticket; the card now shows it as money to return, and it can be marked there.`);
          onDone();
          return;
        }
        setOpen(false);
        setAmountText("");
        setReason("");
        setFeeOff(false);
        onDone();
        return;
      }
      const r = await fetch("/api/workroom/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, refund: { cents, how, reason: reason.trim() } }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !d?.ok) setError(d?.error || "That did not record.");
      else {
        setOpen(false);
        setAmountText("");
        setReason("");
        onDone();
      }
    } catch {
      setError("The connection dropped. Reload and look at the order before recording it again.");
    } finally {
      setBusy(false);
    }
  }
  const chip: React.CSSProperties = { ...textButton, fontSize: 13.5 };
  return (
    <div className="panel" style={{ margin: "8px 0 0", padding: 12, display: "grid", gap: 10 }}>
      <strong style={{ fontSize: 14.5 }}>Refund on {number}</strong>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", fontSize: 14.5 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Amount going back
          <input value={amountText} onChange={(e) => { setAmountText(e.target.value); setFeeOff(false); }} inputMode="decimal" disabled={busy} aria-label="Refund amount, in dollars" placeholder="$" style={{ ...field, width: 110, padding: "6px 10px" }} />
        </label>
        <button type="button" disabled={busy} onClick={() => { setAmountText((refundableCents / 100).toFixed(2)); setFeeOff(false); }} style={chip}>
          All of it ({money(refundableCents / 100)})
        </button>
        {settled && deliveryCents > 0 && deliveryCents <= refundableCents && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setAmountText((deliveryCents / 100).toFixed(2));
              setFeeOff(true);
              if (!reason.trim()) setReason("Delivery fee");
            }}
            style={chip}
          >
            The delivery fee ({money(deliveryCents / 100)})
          </button>
        )}
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 14.5 }}>
          What it is for
          <input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={120} aria-label="What the refund is for" style={{ ...field, flex: "1 1 220px", width: "auto", padding: "6px 10px" }} />
        </label>
        <span style={{ display: "flex", gap: "0 14px", flexWrap: "wrap" }}>
          {REASONS.map((w) => (
            <button key={w} type="button" disabled={busy} onClick={() => setReason(w)} style={chip}>
              {w}
            </button>
          ))}
        </span>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 14.5 }}>
        <legend style={{ padding: 0, marginBottom: 4, fontWeight: 600 }}>How it went back</legend>
        {(
          [
            ["square", "Through Square (card, or cash rung there)"],
            ["hand", "Cash from the drawer"],
            ["check", "A check we wrote"],
          ] as [How, string][]
        )
          // Not offered where Square holds none of the order's money.
          .filter(([v]) => v !== "square" || square)
          .map(([v, label]) => (
          <label key={v} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" name={`refund-how-${orderId}`} checked={how === v} disabled={busy} onChange={() => setHow(v)} />
            {label}
          </label>
        ))}
      </fieldset>
      <span className="muted" style={{ fontSize: 13.5 }}>
        {feeOff && cents === deliveryCents ? "This takes the delivery fee off the ticket, records it as refunded" : "This records the refund for the books"} and tells the customer by email if we have theirs. It does not move money:{" "}
        {how === "square" ? "make the refund in the Square dashboard (Transactions) as well." : how === "hand" ? "the cash comes out of the drawer, and the day sheet takes it off the cash to count." : "write and send the check as usual."}
      </span>
      {(error || (amountText && problem)) && (
        <span role="alert" style={{ fontWeight: 600, color: "var(--rose-ink)", fontSize: 14 }}>
          {error || problem}
        </span>
      )}
      <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn--solid" disabled={busy || !!problem} onClick={save}>
          {busy ? "Recording…" : `Record ${cents !== null && cents > 0 && cents <= refundableCents ? money(cents / 100) : "the"} refund`}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
          Never mind
        </button>
      </p>
    </div>
  );
}
