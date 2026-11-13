"use client";

import { useEffect, useRef, useState } from "react";
import { InitialsInput, field, isInitials, textButton } from "@/components/workroom/ui";
import { loadSquareSdk, type SquareCard } from "@/lib/square/web-sdk";
import { payWord } from "@/lib/workroom/derive";

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

type Payment = { at: number; method: string; totalCents: number; feeCents: number; via?: string; checkNumber?: string; note?: string };

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
/** "40", "40.5", "$1,200.00" to cents; null when it is not a money amount. */
export const parseDollars = (s: string): number | null => {
  const t = s.trim().replace(/^\$/, "").replace(/,/g, "");
  return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null;
};
/** What a customer is likely to hand over for an amount: the exact figure,
    then the amount rounded up to the next $5, $20, $50 and $100, each
    once ($42.40 offers 42.40, 45, 60, 50 and 100, sorted; $120 offers
    120, 125, 140, 150 and 200). The $10 step is left out: the $20 step
    covers the twenties a customer actually holds. */
export const billChips = (dueCents: number): number[] => {
  const out = new Set<number>();
  if (dueCents > 0) out.add(dueCents);
  for (const bill of [500, 2000, 5000, 10000]) {
    const up = Math.ceil(dueCents / bill) * bill;
    if (up > dueCents) out.add(up);
  }
  return [...out].sort((a, b) => a - b);
};
/** The change owed, in cents, for cash given against an amount due; null
    when nothing (or not a number) was typed. Negative means short. */
export const changeFor = (given: string, dueCents: number): number | null => {
  const g = parseDollars(given);
  return g === null ? null : g - dueCents;
};

/**
 * CHANGE AT THE COUNTER (Kevin, 2026-10-16: "input how much cash is given
 * and it calculates our change"). Display only: what is recorded is the
 * amount due, and this box is the arithmetic the till used to do. Shown
 * wherever cash is recorded (a card's money corner, the quick sale), so
 * the figure is in the same place every time.
 */
export function CashTendered({ dueCents, value, onChange, disabled = false }: { dueCents: number; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const change = changeFor(value, dueCents);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 14.5 }}>
        Cash given
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          disabled={disabled}
          placeholder={(dueCents / 100).toFixed(2)}
          aria-label="Cash given, in dollars"
          style={{ ...field, width: 84, padding: "6px 10px" }}
        />
        {billChips(dueCents).map((c) => (
          <button key={c} type="button" disabled={disabled} onClick={() => onChange((c / 100).toFixed(2))} style={{ ...textButton, fontSize: 13.5 }}>
            {c % 100 === 0 ? `$${c / 100}` : dollars(c)}
          </button>
        ))}
      </label>
      {change !== null && (
        <p role="status" style={{ margin: 0, fontSize: 18, fontWeight: 700, color: change < 0 ? "var(--rose-ink)" : "var(--green)" }}>
          {change < 0 ? `${dollars(-change)} short of ${dollars(dueCents)}` : change === 0 ? "Exact. No change." : `Change ${dollars(change)}`}
        </p>
      )}
    </div>
  );
}

export default function PayControls({
  orderId,
  subtotal,
  deliveryCents = 0,
  payment,
  balanceCents = 0,
  collectedCents = 0,
  paidInParts = false,
  batch,
  start = "idle",
  partPay = true,
  handPaid = false,
  squareMoney = true,
  refundedCents = 0,
  movedCents = 0,
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
  /** Cents taken so far (derive.ts collectedCents), for the "Paid $40 of
      $70.90" line on a ticket paid in part. */
  collectedCents?: number;
  /** derive.ts paidInParts: settled or part-paid in more than one go. */
  paidInParts?: boolean;
  /** The orders placed together with this one that still need paying
      (the batch), so one card can settle all of them. `owed` is each
      order's number and cents due, in the order the route deals a part
      payment out, so a lost board write can say which got what. */
  batch?: { ids: string[]; count: number; totalCents: number; name: string; owed: { number: string; cents: number }[] };
  /** Open straight into card entry (the Quick sale panel's Take card,
      2026-10-14: the card is already in hand, so no second tap). */
  start?: "idle" | "card";
  /** False hides "Pay part of it now": a walk-in pays in full. */
  partPay?: boolean;
  /** derive.ts paidByHandOnly: every payment on it was a by-hand mark, so
      the mark can be taken back (nothing moved in Square). */
  handPaid?: boolean;
  /** derive.ts squareMoney: Square holds some of this order's money, so
      anything owed back is refunded from the Square dashboard; false, it
      is given back by hand. */
  squareMoney?: boolean;
  /** derive.ts refundedCents: part of the payment already given back. */
  refundedCents?: number;
  /** Credit moved from this order onto another of the same customer:
      not a refund, and said apart from one. The caller leaves it out of
      refundedCents. */
  movedCents?: number;
  /** Paid: which way, how many cents, and what that leaves. `settled` is
      whether this payment covered everything due; `boardMissed` is the
      charge that went through while the board write failed (said in red
      here too). A caller that clears itself on "paid" must read both:
      a part payment is not a finished sale, and a missed board write is
      a card that must NOT be taken again. */
  onPaid: (method?: "card" | "cash" | "manual", cents?: number, outcome?: { settled: boolean; boardMissed: boolean; changeCents: number | null }) => void;
}) {
  /** "one" or "all": which the buttons charge when a batch is offered. */
  const [scope, setScope] = useState<"one" | "all">("all");
  /** True after an unsure Square answer: the retry must send the same
      request, so the one/all choice is frozen until it is settled. */
  const [unsure, setUnsure] = useState(false);
  const [mode, setMode] = useState<"idle" | "card" | "cash" | "manual" | "check">(start);
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

  /* PART OF IT NOW (Kevin, 2026-10-14: "x amount cash and the rest on
     card, or half on this card and half on another"). A link under the
     amount opens a box prefilled with the whole amount; what is typed is
     what the buttons charge, and the rest stays due on the card, where
     Take card and Record cash take it later by the top-up path. Checked
     here in words, and again by the pay route. */
  const [part, setPart] = useState(false);
  const [partText, setPartText] = useState("");
  /** Cash given at the counter (CashTendered), and the change it left
      once the cash was recorded: shown here until the next payment is
      opened, because the drawer is counted after the tap, not before.
      The same figure goes up through onPaid, for the screens where this
      pane does not stay on the page after the payment (the board's
      notice, the quick sale's Done line, the Accounts tab). */
  const [tendered, setTendered] = useState("");
  const [changeBack, setChangeBack] = useState<number | null>(null);
  /* A CHECK (Katy, 2026-11-09: "they need to be able to take checks").
     Its own amount box, because a check is whatever was written on it:
     less than what is due leaves a balance, and more leaves credit on
     the order, which its card offers to move to another order of theirs.
     Recorded for the books; a check never goes through Square. */
  const [checkText, setCheckText] = useState("");
  const [checkNo, setCheckNo] = useState("");
  const openMode = (m: "card" | "cash" | "manual" | "check") => {
    setChangeBack(null);
    if (m === "check") setCheckText((amount / 100).toFixed(2));
    setMode(m);
  };
  const checkCents = parseDollars(checkText);
  const checkError =
    mode !== "check"
      ? ""
      : checkCents === null
        ? "Type the check's amount as a number, like 250 or 250.00."
        : checkCents <= 0
          ? "The amount has to be more than zero."
          : checkCents > amount + 500_000
            ? `That is far more than what is due (${dollars(amount)}). Check the figure.`
            : "";
  const partCents = part ? parseDollars(partText) : null;
  const partError = !part
    ? ""
    : partCents === null
      ? "Type the amount as a number, like 40 or 40.50."
      : partCents <= 0
        ? "The amount has to be more than zero."
        : partCents > amount
          ? `That is more than what is due (${dollars(amount)}).`
          : "";
  const charge = part && !partError ? partCents! : amount;
  const openPart = () => {
    setPart(true);
    setPartText((amount / 100).toFixed(2));
  };
  /* Flipping All / This order after the box opened: the box follows the
     new amount, so a figure typed against the group cannot be charged
     against one order (or the reverse) unnoticed. */
  const pickScope = (s: "one" | "all") => {
    setScope(s);
    if (part) setPartText(((s === "all" ? batch!.totalCents : total) / 100).toFixed(2));
    if (mode === "check") setCheckText(((s === "all" ? batch!.totalCents : total) / 100).toFixed(2));
  };
  /* Not while unsure: the retry must resend the same attempt with the
     same amount, so the pane stays exactly as it is (box, figure, scope)
     until Square gives a definite answer. Never mind is disabled too;
     closing and reopening with a different figure would be refused by
     Square as a key reuse, with the counter none the wiser. */
  const close = () => {
    setMode("idle");
    setPart(false);
    setTendered("");
  };

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

  /* LESS CASH GIVEN THAN IS DUE (Katy, 2026-11-13: she typed a smaller
     figure in Cash given, saw "short", and Record still took the whole
     balance). What was handed over is what is recorded: a part payment,
     the rest still due. A walk-in pays in full, so there it is refused. */
  const tenderedCents = mode === "cash" ? parseDollars(tendered) : null;
  const shortCash = tenderedCents !== null && tenderedCents > 0 && tenderedCents < charge ? tenderedCents : null;
  // "0" typed in Cash given is nothing handed over, not "the whole amount".
  const noCash = tenderedCents === 0 && charge > 0;

  async function pay(method: "card" | "cash" | "manual" | "check") {
    setBusy(true);
    setError("");
    setChangeBack(null);
    try {
      if (method === "check" ? checkError : partError) throw new Error(method === "check" ? checkError : partError);
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
          body: JSON.stringify({
            ...(forAll ? { ids: batch!.ids } : { id: orderId }),
            method,
            sourceId,
            attempt: attemptRef.current || undefined,
            // Only when the box is open: a closed box means the whole of
            // what is due, the route's own default.
            amountCents: method === "check" ? checkCents ?? undefined : method === "cash" && shortCash !== null ? shortCash : part ? charge : undefined,
            checkNumber: method === "check" ? checkNo.trim() : undefined,
          }),
        });
        d = (await r.json().catch(() => ({}))) as typeof d;
      } catch {
        // The request may have arrived and charged. Not "did not go
        // through": the attempt id stays, and Charge again settles it.
        if (method === "check" || method === "manual") {
          throw new Error("The connection dropped, so this may or may not have been recorded. Reload and look at the order before recording it again.");
        }
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
      const back = method === "cash" ? changeFor(tendered, charge) : null;
      const changeCents = back !== null && back > 0 ? back : null;
      setChangeBack(changeCents);
      close();
      if (d.boardMissed) {
        // The charge is real; only the board missed it. Said loudly, so
        // nobody takes the card again. The webhook catches up by itself.
        // For a group, the charge is dealt out the way the route does it
        // (each order's due filled in order), and the message names each
        // order's share, so a part payment is not marked on orders that
        // got nothing.
        // What was actually sent: less than the charge when less cash was given.
        const sent = method === "cash" && shortCash !== null ? shortCash : charge;
        let left = sent;
        const shares = (batch?.owed ?? []).map((x) => {
          const share = Math.min(left, x.cents);
          left -= share;
          return { number: x.number, share };
        }).filter((x) => x.share > 0);
        setError(
          forAll
            ? `CHARGED ${dollars(sent)} on ${shares.length} of ${batch!.count} orders, but the board did not save it. Do NOT charge again. Mark "Paid another way": ${shares.map((x) => `${dollars(x.share)} on ${x.number}`).join(", ")}.`
            : topUp
              ? `CHARGED ${dollars(sent)}, but the board did not save it. Do NOT charge again. Square's notice will add it within a minute; if it does not, mark it by hand.`
              : "CHARGED, but the board did not save it. Do NOT charge again. Reload in a minute; the payment will appear.",
        );
      }
      const sum = method === "check" ? checkCents ?? charge : method === "cash" && shortCash !== null ? shortCash : charge;
      // A check is a by-hand mark to the screens above this one.
      onPaid(method === "check" ? "manual" : method, sum, { settled: sum >= amount, boardMissed: !!d.boardMissed, changeCents });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment did not go through.");
    } finally {
      setBusy(false);
    }
  }

  /* Never a bare PAID on a ticket paid in part: it says what came in, of
     what, and what is still due, in the owed color, with the buttons
     below for the rest. Settled in more than one payment (cash then
     card) says so instead of naming the first payment alone. */
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
      {balanceCents > 0
        ? `Paid ${dollars(collectedCents)} of ${dollars(Math.round(subtotal * 100))} · ${dollars(balanceCents)} still due`
        : paidInParts
          ? `Paid in full · ${dollars(collectedCents)} · in parts`
          : `Paid · ${payment.method === "manual" || (payment.method === "other" && !payment.via) ? "marked by hand" : payWord(payment)} · ${dollars(payment.totalCents)}`}
      {refundedCents > 0 ? ` · ${dollars(refundedCents)} refunded` : ""}
      {movedCents > 0 ? ` · ${dollars(movedCents)} moved to another order` : ""}
      {balanceCents < 0 ? ` · ${dollars(-balanceCents)} ${squareMoney ? "to refund (Square dashboard)" : "to give back"}` : ""}
    </p>
  ) : null;
  /* THE MARK CAN BE TAKEN BACK (Katy, 2026-10-15: "two that show settled
     but haven't been paid"). "Paid another way" is a hand mark with no
     money behind it in Square, so undoing it loses nothing; the order goes
     back to owed (and stays on its account). Card and cash never offer
     this: that money is real and is refunded from Square, not erased. */
  const undoMark = payment && handPaid ? (
    <p style={{ margin: "4px 0 0" }}>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("Take back the paid mark? The order goes back to owed; nothing in Square changes.")) return;
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/workroom/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: orderId, unmarkPaid: true }) });
            const d = await r.json().catch(() => null);
            if (!r.ok) setError(d?.error || "That did not save.");
            else onPaid();
          } catch {
            setError("The connection dropped. Reload the board and look at the card.");
          } finally {
            setBusy(false);
          }
        }}
        style={{ ...textButton, fontSize: 13, color: "var(--muted)" }}
      >
        Marked paid by mistake? Undo
      </button>
      {error && <span style={{ marginLeft: 10, fontSize: 13.5, color: "var(--rose-ink)", fontWeight: 600 }}>{error}</span>}
    </p>
  ) : null;
  if (payment && balanceCents <= 0) {
    return (
      <>
        {paidLine}
        {undoMark}
      </>
    );
  }

  const partBlock = !partPay ? null : (
    <div style={{ margin: "0 0 10px", fontSize: 14 }}>
      {!part ? (
        <button type="button" disabled={busy || unsure} onClick={openPart} style={{ ...textButton, fontSize: 14 }}>
          Pay part of it now
        </button>
      ) : (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            Amount now
            <input
              value={partText}
              onChange={(e) => setPartText(e.target.value)}
              inputMode="decimal"
              disabled={busy || unsure}
              aria-label="Amount to pay now, in dollars"
              style={{ ...field, width: 110, padding: "6px 10px" }}
            />
            of {dollars(amount)}
          </label>
          <span style={{ display: "block", margin: "4px 0 0", fontSize: 13.5, color: "var(--muted)" }}>
            The rest stays due on the card; take it by cash or card after.
          </span>
          {partError && (
            <span role="alert" style={{ display: "block", margin: "4px 0 0", fontWeight: 600, color: "var(--rose-ink)" }}>
              {partError}
            </span>
          )}
        </>
      )}
    </div>
  );

  return (
    <div style={{ margin: "10px 0 0" }}>
      {paidLine}
      {undoMark}
      {mode === "idle" && (
        <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn" onClick={() => openMode("card")}>
            {batch ? `Take card (${batch.count} orders)` : "Take card"}
          </button>
          <button type="button" onClick={() => openMode("cash")} style={{ ...textButton, fontSize: 14 }}>
            Record cash
          </button>
          <button type="button" onClick={() => openMode("check")} style={{ ...textButton, fontSize: 14 }}>
            Record a check
          </button>
          {/* The escape hatch for money that moved outside the board (rung
              at the register without the DV note, a check, an account
              customer). Without it, orders paid off-system nag in the owed
              section forever, which teaches staff to ignore the section. */}
          <button type="button" onClick={() => openMode("manual")} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
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
            <input type="radio" name={`pay-scope-${orderId}`} checked={scope === "all"} disabled={unsure} onChange={() => pickScope("all")} />
            All {batch.count} orders for {batch.name} · {dollars(batch.totalCents)}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="radio" name={`pay-scope-${orderId}`} checked={scope === "one"} disabled={unsure} onChange={() => pickScope("one")} />
            This order only · {dollars(total)}
          </label>
        </p>
      )}

      {mode === "manual" && (
        <>
          {partBlock}
          <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 14 }}>
              Marks it paid without touching Square, for money the shop already has: a check in hand,
              a ring at the register. Not for a customer who will pay later: that is{" "}
              <strong>Put on account</strong> on the card, and it stays owed until the money comes.
            </span>
            <button type="button" className="btn btn--solid" disabled={busy || !!partError} onClick={() => pay("manual")}>
              {busy ? "Marking…" : part ? `Mark ${dollars(charge)} paid` : "Mark paid"}
            </button>
            <button type="button" disabled={busy || unsure} onClick={close} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
              Never mind
            </button>
          </p>
        </>
      )}

      {mode === "check" && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 14.5 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Check amount
              <input value={checkText} onChange={(e) => setCheckText(e.target.value)} inputMode="decimal" disabled={busy} aria-label="Check amount, in dollars" style={{ ...field, width: 110, padding: "6px 10px" }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              Check number
              <input value={checkNo} onChange={(e) => setCheckNo(e.target.value)} inputMode="numeric" disabled={busy} aria-label="Check number" style={{ ...field, width: 110, padding: "6px 10px" }} />
            </label>
          </div>
          <span className="muted" style={{ fontSize: 13.5 }}>
            {checkCents !== null && checkCents > amount
              ? `${dollars(checkCents - amount)} more than the ${dollars(amount)} due. The extra stays on ${forAll ? "the last of these orders" : "this order"} as credit, and its card offers to move it to another order of theirs.`
              : checkCents !== null && checkCents > 0 && checkCents < amount
                ? `${dollars(amount - checkCents)} of the ${dollars(amount)} stays due.`
                : `${dollars(amount)} is due. Recorded here for the books; a check does not go through Square.`}
          </span>
          {checkError && (
            <span role="alert" style={{ fontWeight: 600, color: "var(--rose-ink)", fontSize: 14 }}>
              {checkError}
            </span>
          )}
          <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn--solid" disabled={busy || !!checkError} onClick={() => pay("check")}>
              {busy ? "Recording…" : `Record ${checkCents !== null && !checkError ? dollars(checkCents) : ""} check`}
            </button>
            <button type="button" disabled={busy} onClick={close} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
              Never mind
            </button>
          </p>
        </div>
      )}

      {mode === "card" && (
        <div className="panel" style={{ padding: 12, marginTop: 4 }}>
          {/* A receipt, not a sentence. No fee row since 2026-10-06: the
              card is charged exactly the ticket. */}
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", fontSize: 14.5 }}>
            <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span>{forAll ? `All ${batch!.count} orders for ${batch!.name}` : topUp ? "Still due" : "Ticket (items and tax)"}</span>
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
          {partBlock}
          <div ref={holderRef} />
          <p style={{ margin: "10px 0 0", display: "flex", gap: 14, alignItems: "center" }}>
            <button type="button" className="btn btn--solid" disabled={busy || !ready || !!partError} onClick={() => pay("card")}>
              {!ready ? "Opening card field…" : busy ? "Charging…" : `Charge ${dollars(charge)}`}
            </button>
            <button type="button" disabled={busy || unsure} onClick={close} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
              Never mind
            </button>
          </p>
        </div>
      )}

      {mode === "cash" && (
        <>
          {partBlock}
          <CashTendered dueCents={charge} value={tendered} onChange={setTendered} disabled={busy} />
          {shortCash !== null && (
            <p role="status" style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--rose-ink)" }}>
              {partPay
                ? `Less than is due: ${dollars(shortCash)} is recorded, and ${dollars(amount - shortCash)} stays owed.`
                : "Less than the sale. Take the rest in cash or by card, or change the sale."}
            </p>
          )}
          {noCash && (
            <p role="status" style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--rose-ink)" }}>
              Nothing given, so there is nothing to record. Type what was handed over, or clear the box.
            </p>
          )}
          <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn--solid" disabled={busy || !!partError || noCash || (shortCash !== null && !partPay)} onClick={() => pay("cash")}>
              {busy ? "Recording…" : shortCash !== null ? `Record ${dollars(shortCash)} cash · ${dollars(amount - shortCash)} stays due` : `Record ${dollars(charge)} cash`}
            </button>
            <button type="button" disabled={busy || unsure} onClick={close} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
              Never mind
            </button>
          </p>
        </>
      )}

      {changeBack !== null && mode === "idle" && (
        <p role="status" style={{ margin: "8px 0 0", fontSize: 18, fontWeight: 700, color: "var(--green)" }}>
          Change {dollars(changeBack)} back to the customer.
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

/**
 * CREDIT, MOVED TO ANOTHER ORDER (Katy, 2026-11-09: "need to be able to
 * apply an overage to another order of theirs, as a partial payment"). An
 * order paid for more than its ticket (a check written for too much, or a
 * ticket trimmed after it was paid) holds the difference as credit. This
 * moves it onto another order the same customer owes on: the overpaid
 * order records it as applied there, the other order records it as a
 * payment, and no money-in figure counts it twice. The pay route does
 * both halves; this only asks which order and how much.
 */
export function ApplyCredit({
  fromId,
  creditCents,
  targets,
  onDone,
}: {
  fromId: string;
  creditCents: number;
  /** The same customer's other orders that still owe, oldest first. */
  targets: { id: string; number: string; label: string; owedCents: number }[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (creditCents <= 0 || targets.length === 0) return null;
  const target = targets.find((t) => t.id === to) ?? targets[0];
  const move = Math.min(creditCents, target.owedCents);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workroom/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, method: "credit", fromId, amountCents: move }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !d?.ok) setError(d?.error || "The credit did not move.");
      else {
        setOpen(false);
        onDone();
      }
    } catch {
      setError("The connection dropped. Reload and look at both orders before trying again.");
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ ...textButton, fontSize: 14 }}>
        Apply the {dollars(creditCents)} to another order of theirs
      </button>
    );
  }
  return (
    <div style={{ display: "grid", gap: 8, margin: "6px 0 0" }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 14.5 }}>
        Apply it to
        <select value={target.id} onChange={(e) => setTo(e.target.value)} disabled={busy} aria-label="The order to apply the credit to" style={{ ...field, width: "auto", padding: "6px 10px" }}>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.number} · {t.label} · {dollars(t.owedCents)} owed
            </option>
          ))}
        </select>
      </label>
      <span className="muted" style={{ fontSize: 13.5 }}>
        Moves {dollars(move)} onto {target.number} as a payment
        {move < target.owedCents ? `; ${dollars(target.owedCents - move)} stays due there` : ", which settles it"}
        {move < creditCents ? `. ${dollars(creditCents - move)} of credit stays here.` : "."}
      </span>
      {error && (
        <span role="alert" style={{ fontWeight: 600, color: "var(--rose-ink)", fontSize: 14 }}>
          {error}
        </span>
      )}
      <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn--solid" disabled={busy} onClick={apply}>
          {busy ? "Moving…" : `Move ${dollars(move)}`}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
          Never mind
        </button>
      </p>
    </div>
  );
}

/* ----------------------- a payment taken back ----------------------- */

export type TakeBackPayment = { at: number; method: string; via?: string; checkNumber?: string; squarePaymentId?: string; totalCents: number };
export type ReversedLine = TakeBackPayment & { reversed: { at: number; by: string; note: string } };

const whenShort = (ms: number) => new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const kindOf = (p: TakeBackPayment) => (p.method === "cash" ? "cash" : payWord(p));

/** What was taken back on this order, said plainly on the card. */
export function ReversedNote({ reversed }: { reversed: ReversedLine[] }) {
  if (!reversed.length) return null;
  return (
    <p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>
      {reversed.map((r) => `Taken back: ${dollars(r.totalCents)} ${kindOf(r)} recorded ${whenShort(r.at)}, by ${r.reversed.by} ${whenShort(r.reversed.at)} (${r.reversed.note.toLowerCase()})${r.method === "cash" && r.squarePaymentId ? `. It was also recorded in Square as cash: refund ${dollars(r.totalCents)} of that sale there if that is not done yet` : ""}.`).join(" ")}
    </p>
  );
}

/**
 * RECORDED BY MISTAKE? TAKE IT BACK (Katy, 2026-11-13: cash recorded for
 * a whole account invoice that nobody paid). Cash, a check or a by-hand
 * mark, one at a time, with initials. The order owes again, the payment
 * leaves every figure and stays on the card as taken back, and a cash one
 * says to refund the matching cash sale in Square so Square's books agree.
 */
export function TakeBack({ orderId, number, payments, onDone }: { orderId: string; number: string; payments: TakeBackPayment[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  // Picked by the payment itself, not its place in the list: the board
  // re-reads every 30 seconds and the list can change under the radio.
  const [pickAt, setPickAt] = useState<number | null>(null);
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ cents: number; square: number } | null>(null);
  const doneNote = done && (
    <p role="status" style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 600 }}>
      {dollars(done.cents)} taken back. {number} owes it again.
      {done.square ? ` It was also recorded in Square as cash: refund ${dollars(done.square)} of that sale in the Square dashboard (Transactions, the sale, Issue refund), so Square's books match. No cash moves.` : ""}
    </p>
  );
  if (!payments.length) return doneNote || null;
  if (!open) {
    return (
      <>
        {doneNote}
        <p style={{ margin: "4px 0 0" }}>
          <button type="button" onClick={() => { setDone(null); setPickAt(null); setOpen(true); }} style={{ ...textButton, fontSize: 13, color: "var(--muted)" }}>
            Recorded a payment by mistake? Take it back
          </button>
        </p>
      </>
    );
  }
  const p = payments.find((q) => q.at === pickAt) ?? payments[0];
  async function go() {
    if (!isInitials(by)) return setError("Your initials, two or three letters, so it has a name on it.");
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/workroom/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, reversePayment: { at: p.at, method: p.method, totalCents: p.totalCents }, by: by.trim().toUpperCase() }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; squareRefund?: number } | null;
      if (!r.ok || !d?.ok) setError(d?.error || "That did not change.");
      else {
        setDone({ cents: p.totalCents, square: Number(d.squareRefund) || 0 });
        setOpen(false);
        setBy("");
        onDone();
      }
    } catch {
      setError("The connection dropped. Reload and look at the card before trying again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel" style={{ margin: "8px 0 0", padding: 12, display: "grid", gap: 10 }}>
      <strong style={{ fontSize: 14.5 }}>Take back a payment on {number}</strong>
      {payments.length > 1 ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6, fontSize: 14.5 }}>
          <legend style={{ padding: 0, marginBottom: 4, fontWeight: 600 }}>Which one</legend>
          {payments.map((q) => (
            <label key={`${q.at}-${q.method}-${q.totalCents}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="radio" name={`take-back-${orderId}`} checked={q.at === p.at} disabled={busy} onChange={() => setPickAt(q.at)} />
              {dollars(q.totalCents)} {kindOf(q)}, recorded {whenShort(q.at)}
            </label>
          ))}
        </fieldset>
      ) : (
        <span style={{ fontSize: 14.5 }}>
          {dollars(p.totalCents)} {kindOf(p)}, recorded {whenShort(p.at)}
        </span>
      )}
      <span className="muted" style={{ fontSize: 13.5 }}>
        For a payment that never happened. The order owes {dollars(p.totalCents)} again, the payment leaves every figure, and the card keeps a note of it with your initials.
        {p.method === "cash" && p.squarePaymentId ? ` It was also recorded in Square as cash: after this, refund ${dollars(p.totalCents)} of that sale in the Square dashboard so Square's books match. No cash moves. Taking back cash needs the owner's PIN.` : ""}
      </span>
      {error && (
        <span role="alert" style={{ fontWeight: 600, color: "var(--rose-ink)", fontSize: 14 }}>
          {error}
        </span>
      )}
      <p style={{ margin: 0, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <InitialsInput value={by} onChange={setBy} />
        <button type="button" className="btn btn--solid" disabled={busy} onClick={go}>
          {busy ? "Taking it back…" : `Take back ${dollars(p.totalCents)}`}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
          Never mind
        </button>
      </p>
    </div>
  );
}
