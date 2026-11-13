"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { site } from "@/lib/site";
import { balanceCents, collectedCents, grossPaidCents, isDeliveryLine, isTaxLine, owedNowCents, paidByHandOnly, paidInParts, payWord, refundedCents, squareMoney, zipFeeCentsToAppend, refundableCents, takeBackablePayments, creditOn } from "@/lib/workroom/derive";
import { field, money, phoneKey, textButton, MemoryWarning, PinGate, RemoveDuplicate } from "@/components/workroom/ui";
import PayControls, { ApplyCredit, ReversedNote, TakeBack, parseDollars } from "@/components/workroom/PayControls";

/**
 * HOUSE ACCOUNTS (Katy, 2026-10-14, and the proposal's "who owes what"):
 * every order written up with the On-account box ticked (or put on account
 * from its card), grouped by the customer, with what each one owes right
 * now, what they have paid, and the orders behind both. Payment is taken
 * here the same way as on the board (card, cash, or "paid another way" for
 * a check or a transfer), so settling an account is one tap per order.
 *
 * ORGANISED FOR THE MONTH-END CHAIR: accounts that owe come first, the
 * one owing longest at the top, each with how old its oldest open order
 * is (a month and more is said in red); settled accounts sit folded below
 * so the list is the to-do list. A find box for a name, a phone number or
 * a company. A statement for each account that owes, to copy or to open
 * straight into an email to the address on file, until invoices exist.
 *
 * The customer key is the phone number when there is one (the board's
 * own rule for "returning customer"), else the name. Two spellings of a
 * school with no phone on file will show as two accounts; the fix is to
 * give the account a phone number, which the form keeps on every order.
 */

type Payment = { at: number; method: string; squarePaymentId?: string; totalCents: number; feeCents: number; refundedAt?: number; via?: string; checkNumber?: string; note?: string };
type Line = { slug: string | null; name: string; qty: number; each: number };
type Order = {
  id: string;
  number: string;
  source: "web" | "phone";
  status: string;
  name: string;
  phone: string;
  email: string;
  fulfillment: "delivery" | "pickup";
  recipient: string;
  company?: string;
  business?: string;
  zip: string;
  date: string;
  lines: Line[];
  subtotal: number;
  createdAt: number;
  payment?: Payment | null;
  topUps?: Payment[];
  refunds?: { at: number; cents: number; note: string; how?: string; kept?: boolean }[];
  reversedPayments?: (Payment & { reversed: { at: number; by: string; note: string } })[];
  account?: boolean;
  taxExempt?: boolean;
  taxId?: string;
  thirdParty?: boolean;
  takenBy?: string;
  poNumber?: string;
};

type Account = {
  key: string;
  name: string;
  /** The business ordering (a funeral home, a school), when there is one;
      its orders group under it however many people there call. */
  business: string;
  company: string;
  phone: string;
  email: string;
  orders: Order[];
  owedCents: number;
  paidCents: number;
  open: number;
  /** createdAt of the oldest order still owed, or 0. */
  oldestOpenAt: number;
  /** Paid for more than its tickets and not yet applied or given back
      (2026-11-09): credit the account is holding. */
  creditCents: number;
  lastAt: number;
};

const DAY = 86_400_000;
const cents = (n: number) => Math.round(n * 100);
const when = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const daysSince = (ms: number) => Math.max(0, Math.floor((Date.now() - ms) / DAY));

/** The delivery fee the pay route will append, in cents (derive.ts holds
    the one rule). */
/** What is collectable now. A held order is not: nothing is promised yet
    and the pay route refuses it, the board's own reading. */
const owedOn = (o: Order): number => (o.status === "canceled" || o.status === "hold" ? 0 : owedNowCents(o));
/** Credit moved onto another order, and money actually given back: the
    two things a row's refunds can be (2026-11-09). */
const movedCents = (o: Order) => (o.refunds ?? []).reduce((sum, r) => sum + (r.how === "transfer" ? r.cents : 0), 0);
const backCents = (o: Order) => refundedCents(o) - movedCents(o);
const itemsOf = (o: Order) => o.lines.filter((l) => !isDeliveryLine(l) && !isTaxLine(l));

function groupAccounts(orders: Order[]): Account[] {
  const map = new Map<string, Account>();
  for (const o of orders) {
    // A business is one account however many people there call (the
    // director's cell, the office line); a person is their phone, else
    // their name. Prefixed so a Mr. Kempf never lands in the funeral home.
    const biz = (o.business ?? "").trim().toLowerCase();
    const name = o.name.trim().toLowerCase();
    const key = biz ? `biz:${biz}` : phoneKey(o.phone) || (name ? `name:${name}` : o.id);
    const a = map.get(key) ?? {
      key, name: o.name, business: o.business ?? "", company: o.company ?? "", phone: o.phone, email: o.email,
      orders: [], owedCents: 0, paidCents: 0, open: 0, oldestOpenAt: 0, lastAt: 0, creditCents: 0,
    };
    a.orders.push(o);
    const owed = owedOn(o);
    a.owedCents += owed;
    if (o.status !== "canceled" && o.payment && balanceCents(o) < 0) a.creditCents += -balanceCents(o);
    if (owed > 0) {
      a.open += 1;
      if (!a.oldestOpenAt || o.createdAt < a.oldestOpenAt) a.oldestOpenAt = o.createdAt;
    }
    // Net of anything given back in part (a delivery fee off).
    if (o.payment && !o.payment.refundedAt) a.paidCents += Math.max(0, collectedCents(o) - refundedCents(o));
    if (o.createdAt > a.lastAt) {
      a.lastAt = o.createdAt;
      // The newest order names the account: a corrected spelling wins.
      a.name = o.name || a.name;
      a.business = o.business || a.business;
      a.email = o.email || a.email;
      a.phone = o.phone || a.phone;
      a.company = o.company || a.company;
    }
    map.set(key, a);
  }
  return [...map.values()]
    .map((a) => ({ ...a, orders: [...a.orders].sort((x, y) => y.createdAt - x.createdAt) }))
    // Owing first, the one owing longest at the top; then the rest by
    // most recent order.
    .sort((x, y) => {
      if ((x.owedCents > 0) !== (y.owedCents > 0)) return x.owedCents > 0 ? -1 : 1;
      if (x.owedCents > 0) return x.oldestOpenAt - y.oldestOpenAt;
      return y.lastAt - x.lastAt || x.name.localeCompare(y.name);
    });
}

/** A plain-text statement for the unpaid orders, to paste into an email
    or print: what month-end looks like until invoices are built. */
function statementText(a: Account): string {
  const open = a.orders.filter((o) => owedOn(o) > 0).sort((x, y) => x.createdAt - y.createdAt);
  const rows = open.map((o) => {
    const items = itemsOf(o).map((l) => `${l.qty} x ${l.name}`).join(", ");
    const to = o.recipient && o.recipient !== o.name ? `  for ${o.recipient}` : "";
    return `${o.date}  ${o.number}${o.poNumber ? `  PO ${o.poNumber}` : ""}  ${items}${to}  ${money(owedOn(o) / 100)}`;
  });
  return [
    `${site.name}`,
    `Statement for ${[a.business, a.name, a.company].filter(Boolean).join(", ")}`,
    `As of ${when(Date.now())}`,
    "",
    ...rows,
    "",
    `Balance due: ${money(a.owedCents / 100)}`,
    "",
    `Questions: ${site.phone}. Thank you.`,
  ].join("\n");
}

/** One statement row for one order; the same text the statement lists. */
const rowOf = (o: Order) => ({
  date: o.date,
  number: o.number,
  items: itemsOf(o).map((l) => `${l.qty} x ${l.name}`).join(", ") + (o.recipient && o.recipient !== o.name ? ` (for ${o.recipient})` : "") + (o.poNumber ? ` · PO ${o.poNumber}` : ""),
  owed: money(owedOn(o) / 100),
});

/** The rows the server emails (statement-mail.ts), the same ones the
    text statement lists. */
function statementRows(a: Account) {
  return a.orders
    .filter((o) => owedOn(o) > 0)
    .sort((x, y) => x.createdAt - y.createdAt)
    .map(rowOf);
}

/** AN INVOICE FOR ONE ORDER (Katy, 2026-10-29: "Gina Fox at Kempf's is
    requesting an invoice just for Ward White"). A funeral home pays per
    service, not per month, so the account's statement, which lists every
    open order, is the wrong paper for them. Same rows, same email, one
    order; the balance is that order's alone. */
function invoiceText(a: Account, o: Order): string {
  const r = rowOf(o);
  return [
    `${site.name}`,
    `Invoice for ${[a.business, a.name, a.company].filter(Boolean).join(", ")}: order ${o.number}`,
    `As of ${when(Date.now())}`,
    "",
    `${r.date}  ${r.number}  ${r.items}  ${r.owed}`,
    "",
    `Balance due: ${r.owed}`,
    "",
    `Questions: ${site.phone}. Thank you.`,
  ].join("\n");
}

/**
 * ONE PAYMENT FOR THE ACCOUNT (Katy, 2026-11-09: "in the accounts section
 * they need to be able to take checks", and "apply an overage to another
 * order of theirs as a partial payment"). An account pays the way it is
 * billed: one check against several orders. The amount on the check is
 * dealt out oldest order first, each filled before the next gets any, so
 * a check that covers one order and part of the next leaves exactly that
 * on the books; the preview says who gets what before anything is saved.
 * The pay route does the dealing (the same rule as one card for several
 * orders); twenty orders at a time is its limit, said here when it bites.
 */
function AccountPayment({ a, onDone }: { a: Account; onDone: (note: string) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"check" | "manual">("check");
  const [amountText, setAmountText] = useState("");
  const [checkNo, setCheckNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unpaidAll = a.orders.filter((o) => owedOn(o) > 0).sort((x, y) => x.createdAt - y.createdAt);
  const unpaid = unpaidAll.slice(0, 20);
  const due = unpaid.reduce((s, o) => s + owedOn(o), 0);
  if (unpaid.length === 0) return null;
  if (!open) {
    return (
      <p style={{ margin: "8px 0 0" }}>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setAmountText((due / 100).toFixed(2));
            setOpen(true);
          }}
        >
          Record a check for this account
        </button>
      </p>
    );
  }
  const amount = parseDollars(amountText);
  const problem =
    amount === null ? "Type the amount as a number, like 250 or 250.00." : amount <= 0 ? "The amount has to be more than zero." : amount > due + 500_000 ? `That is far more than the ${money(due / 100)} owed. Check the figure.` : "";
  // The route's own dealing, shown before it happens.
  let left = amount ?? 0;
  const shares = unpaid.map((o) => {
    const owed = owedOn(o);
    const share = Math.min(left, owed);
    left -= share;
    return { o, owed, share };
  });
  const over = left;
  async function save() {
    if (problem || amount === null) return;
    setBusy(true);
    setError("");
    try {
      const reached = shares.filter((x) => x.share > 0).map((x) => x.o.id);
      const r = await fetch("/api/workroom/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(reached.length >= 2 ? { ids: reached } : { id: reached[0] }), method: kind, amountCents: amount, checkNumber: kind === "check" ? checkNo.trim() : undefined }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !d?.ok) setError(d?.error || "That did not save.");
      else {
        setOpen(false);
        setCheckNo("");
        onDone(`${money(amount / 100)} recorded on ${reached.length} order${reached.length === 1 ? "" : "s"} for ${a.business || a.name}${over > 0 ? `; ${money(over / 100)} of it is credit on ${shares[shares.length - 1].o.number}` : ""}.`);
      }
    } catch {
      setError("The connection dropped. Reload the accounts and look before recording it again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="panel" style={{ margin: "10px 0 0", padding: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", fontSize: 14.5 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="radio" name={`acct-pay-${a.key}`} checked={kind === "check"} onChange={() => setKind("check")} />
          A check
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="radio" name={`acct-pay-${a.key}`} checked={kind === "manual"} onChange={() => setKind("manual")} />
          Another way (a transfer, money already in hand)
        </label>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 14.5 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          Amount
          <input value={amountText} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" disabled={busy} aria-label="Payment amount, in dollars" style={{ ...field, width: 120, padding: "6px 10px" }} />
        </label>
        {kind === "check" && (
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Check number
            <input value={checkNo} onChange={(e) => setCheckNo(e.target.value)} inputMode="numeric" disabled={busy} aria-label="Check number" style={{ ...field, width: 120, padding: "6px 10px" }} />
          </label>
        )}
        <span className="muted">of {money(due / 100)} owed</span>
      </div>
      {!problem && amount !== null && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 14, display: "grid", gap: 2 }}>
          {shares.map(({ o, owed, share }) => (
            <li key={o.id} style={{ display: "flex", justifyContent: "space-between", gap: 10 }} className={share === 0 ? "muted" : undefined}>
              <span>
                {o.number} · {o.date}
                {o.recipient && o.recipient !== o.name ? ` · for ${o.recipient}` : ""}
              </span>
              <span style={{ whiteSpace: "nowrap" }}>
                {share === 0 ? `not reached, ${money(owed / 100)} stays owed` : share < owed ? `${money(share / 100)} of ${money(owed / 100)}, ${money((owed - share) / 100)} stays owed` : `${money(share / 100)}, paid in full`}
              </span>
            </li>
          ))}
          {over > 0 && (
            <li style={{ fontWeight: 600 }}>
              {money(over / 100)} more than is owed: it stays on {shares[shares.length - 1].o.number} as credit, to apply to their next order.
            </li>
          )}
        </ul>
      )}
      {unpaidAll.length > unpaid.length && (
        <span className="muted" style={{ fontSize: 13.5 }}>
          The oldest 20 of {unpaidAll.length} open orders are shown; record a second payment for the rest.
        </span>
      )}
      {(problem || error) && (
        <span role="alert" style={{ fontWeight: 600, color: "var(--rose-ink)", fontSize: 14 }}>
          {problem || error}
        </span>
      )}
      <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn--solid" disabled={busy || !!problem} onClick={save}>
          {busy ? "Recording…" : `Record ${amount !== null && !problem ? money(amount / 100) : "it"}`}
        </button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
          Never mind
        </button>
      </p>
    </div>
  );
}

export default function Accounts({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [orders, setOrders] = useState<Order[]>([]);
  const [backend, setBackend] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [find, setFind] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  /** Per account: "sending", or the time it went, or an error line. */
  const [sent, setSent] = useState<Record<string, { at?: string; error?: string; busy?: boolean }>>({});
  /** The change to hand back after cash on an account order: said here,
      because the row's pay pane leaves the page once nothing is owed. */
  const [changeNote, setChangeNote] = useState("");
  /** EVERY STATEMENT AT ONCE (billing, 2026-10-22): the month-end run,
      one tap, to each account that owes and has an email on file; the
      ones with no email are named so they can be printed or called. */
  const [bulk, setBulk] = useState<{ busy: boolean; done: number; total: number; noEmail: string[]; failed: string[] } | null>(null);
  const [error, setError] = useState("");

  const pull = useCallback(async () => {
    const r = await fetch("/api/workroom/orders?account=1&days=400", { cache: "no-store" });
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    const d = (await r.json()) as { orders?: Order[]; backend?: string; error?: string };
    if (!r.ok) {
      setError(d.error || "The accounts did not load.");
      return;
    }
    setOrders((d.orders ?? []).filter((o) => o.account));
    setBackend(d.backend ?? "memory");
    setLoaded(true);
    setError("");
  }, []);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => setError("The accounts did not load."));
  }, [authed, pull]);

  const accounts = useMemo(() => groupAccounts(orders), [orders]);
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    if (!q) return accounts;
    return accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.business.toLowerCase().includes(q) ||
        a.company.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        (digits.length >= 3 && phoneKey(a.phone).includes(digits)) ||
        a.orders.some((o) => o.number.toLowerCase().includes(q)),
    );
  }, [accounts, find]);
  // An account holding credit is not done with: it stays in the open list.
  const owing = shown.filter((a) => a.owedCents > 0 || a.creditCents > 0);
  const settled = shown.filter((a) => a.owedCents === 0 && a.creditCents === 0);
  const owedAll = accounts.reduce((s, a) => s + a.owedCents, 0);
  const owingAll = accounts.filter((a) => a.owedCents > 0).length;

  /* EMAIL FROM THE SHOP, not from whatever mail app the PC has (Kevin,
     2026-10-14: the mailto link opened Edge's and Outlook's pickers and
     the shop lives in Gmail). The server sends it from the shop's own
     mailbox, branded like the receipts, and says when it went. */
  /** True when the statement went out; the row shows the time or the error either way. */
  async function emailStatement(a: Account): Promise<boolean> {
    setSent((s) => ({ ...s, [a.key]: { busy: true } }));
    try {
      const r = await fetch("/api/workroom/accounts/statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: a.email, name: a.name, business: a.business, company: a.company, rows: statementRows(a), balance: money(a.owedCents / 100) }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !d?.ok) throw new Error(d?.error || "The statement did not send.");
      setSent((s) => ({ ...s, [a.key]: { at: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) } }));
      return true;
    } catch (err) {
      setSent((s) => ({ ...s, [a.key]: { error: err instanceof Error ? err.message : "The statement did not send." } }));
      return false;
    }
  }

  /** One order's invoice, by the statement route with a single row. Keyed
      in the same sent map by order id, so the row says when it went. */
  async function emailInvoice(a: Account, o: Order): Promise<void> {
    setSent((s) => ({ ...s, [o.id]: { busy: true } }));
    try {
      const r = await fetch("/api/workroom/accounts/statement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: a.email, name: a.name, business: a.business, company: a.company, rows: [rowOf(o)], balance: money(owedOn(o) / 100), kind: "invoice" }),
      });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!r.ok || !d?.ok) throw new Error(d?.error || "The invoice did not send.");
      setSent((s) => ({ ...s, [o.id]: { at: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) } }));
    } catch (err) {
      setSent((s) => ({ ...s, [o.id]: { error: err instanceof Error ? err.message : "The invoice did not send." } }));
    }
  }

  /** WRITTEN UP TWICE (Katy, 2026-11-02): the duplicate off the account
      and every other screen, right here where she noticed it. The route
      decides what may go (unpaid, written up by the shop) and says why
      when it refuses; the control shows that. */
  async function removeDuplicate(o: Order, by: string): Promise<void> {
    const r = await fetch("/api/workroom/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: o.id, void: true, by }),
    });
    const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!r.ok || !d?.ok) throw new Error(d?.error || "That did not remove.");
    setChangeNote(`${o.number} is off the books as written up twice. The owner's dashboard can put it back.`);
    await pull();
  }

  async function copyInvoice(a: Account, o: Order) {
    try {
      await navigator.clipboard.writeText(invoiceText(a, o));
      setCopied(o.id);
      setTimeout(() => setCopied((k) => (k === o.id ? null : k)), 2500);
    } catch {
      setError("Could not copy. Email the invoice instead, or select the order line by hand.");
    }
  }

  async function copyStatement(a: Account) {
    try {
      await navigator.clipboard.writeText(statementText(a));
      setCopied(a.key);
      setTimeout(() => setCopied((k) => (k === a.key ? null : k)), 2500);
    } catch {
      setError("Could not copy. Open the statement by email instead, or select the orders by hand.");
    }
  }

  if (!authed) {
    return (
      <>
        <h1>Accounts</h1>
        <PinGate onAuthed={() => setAuthed(true)} />
      </>
    );
  }

  const card = (a: Account) => {
    const open = openKey === a.key;
    const age = a.oldestOpenAt ? daysSince(a.oldestOpenAt) : 0;
    const overdue = age >= 30;
    return (
      <section key={a.key} className="panel" style={{ padding: 16, borderLeft: overdue ? "3px solid var(--rose-ink)" : "3px solid transparent" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 17 }}>{a.business || a.name || "No name"}</strong>
            {a.business && a.name && <span className="muted" style={{ fontSize: 15 }}> · {a.name}</span>}
            {a.company && <span className="muted" style={{ fontSize: 15 }}> · {a.company}</span>}
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13.5 }}>
              {[a.phone, a.email].filter(Boolean).join(" · ") || "no phone or email on file"}
            </p>
          </div>
          <div style={{ textAlign: "right" }}>
            <strong style={{ fontSize: 17, color: a.owedCents > 0 ? "var(--rose-ink)" : "var(--green)" }}>
              {a.owedCents > 0 ? `Owes ${money(a.owedCents / 100)}` : a.creditCents > 0 ? `${money(a.creditCents / 100)} credit` : "Settled"}
              {a.owedCents > 0 && a.creditCents > 0 ? ` · ${money(a.creditCents / 100)} credit` : ""}
            </strong>
            <p className="muted" style={{ margin: "2px 0 0", fontSize: 13.5 }}>
              {a.owedCents > 0
                ? `${a.open} open order${a.open === 1 ? "" : "s"}, oldest ${age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}`
                : `${a.orders.length} order${a.orders.length === 1 ? "" : "s"}, last ${when(a.lastAt)}`}
              {a.paidCents > 0 ? ` · paid ${money(a.paidCents / 100)} this past year` : ""}
            </p>
          </div>
        </header>
        <p style={{ margin: "10px 0 0", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setOpenKey(open ? null : a.key)} style={{ ...textButton, fontSize: 14 }}>
            {open ? "Hide the orders" : `Show the orders (${a.orders.length})`}
          </button>
          {a.owedCents > 0 && (
            <>
              {a.email && (
                <button type="button" disabled={sent[a.key]?.busy} onClick={() => emailStatement(a)} style={{ ...textButton, fontSize: 14 }}>
                  {sent[a.key]?.busy ? "Sending…" : sent[a.key]?.at ? `Statement sent ${sent[a.key].at} · send again` : `Email the statement to ${a.email}`}
                </button>
              )}
              {sent[a.key]?.error && <span style={{ color: "var(--rose-ink)", fontSize: 14 }}>{sent[a.key].error}</span>}
              <button type="button" onClick={() => copyStatement(a)} style={{ ...textButton, fontSize: 14 }}>
                {copied === a.key ? "Statement copied" : "Copy a statement"}
              </button>
              <a href={`/workroom/invoice?statement=1&ids=${a.orders.filter((o) => owedOn(o) > 0).sort((x, y) => x.createdAt - y.createdAt).slice(0, 60).map((o) => o.id).join(",")}`} target="_blank" rel="noopener" style={{ fontSize: 14 }}>
                Print a statement
              </a>
            </>
          )}
        </p>
        <AccountPayment
          a={a}
          onDone={(note) => {
            setChangeNote(note);
            pull().catch(() => {});
          }}
        />
        {open && (
          <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 }}>
            {a.orders.map((o) => {
              const owed = owedOn(o);
              return (
                <li key={o.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <span>
                      <strong>{o.number}</strong> · {o.date} · {o.fulfillment}
                      {o.recipient && o.recipient !== o.name ? ` · for ${o.recipient}` : ""}
                      {o.poNumber ? ` · PO ${o.poNumber}` : ""}
                      {o.taxExempt ? ` · tax exempt${o.taxId ? ` (ID ${o.taxId})` : ""}` : ""}
                      {o.thirdParty ? " · third-party order, no tax" : ""}
                      {o.takenBy ? ` · taken by ${o.takenBy}` : ""}
                      {o.status === "canceled" ? " · canceled" : o.status === "hold" ? " · on hold, not yet owed" : ""}
                      {" · "}
                      <a href={`/api/workroom/print/${o.id}`} target="_blank" rel="noopener">Print the ticket</a>
                      {o.status !== "canceled" && o.status !== "hold" && (
                        <>
                          {" · "}
                          <a href={`/workroom/invoice?ids=${o.id}`} target="_blank" rel="noopener">Print an invoice</a>
                        </>
                      )}
                    </span>
                    {/* Wraps: with a refund in it the line is wider than a phone. */}
                    <span style={{ textAlign: "right", minWidth: 0 }}>
                      {o.payment && owed === 0
                        ? o.status === "canceled" && !o.payment.refundedAt
                          ? <span style={{ color: "var(--rose-ink)", fontWeight: 600 }}>Paid {money(grossPaidCents(o) / 100)}, canceled: {money(refundableCents(o) / 100)} refund due · {when(o.payment.at)}</span>
                          : balanceCents(o) < 0
                            /* The ticket shrank after it was paid (a fee off): not
                               settled. The board card is where the refund is marked. */
                            ? <span style={{ color: "var(--rose-ink)", fontWeight: 600 }}>Paid {money(grossPaidCents(o) / 100)}; {money(-balanceCents(o) / 100)} over: apply it to another order below, or give it back and mark that on the board card · {when(o.payment.at)}</span>
                            : <span style={{ color: "var(--green)", fontWeight: 600 }}>{o.payment.refundedAt ? `Refunded ${money(refundableCents(o) / 100)}` : `Paid ${money(Math.max(0, collectedCents(o) - refundedCents(o)) / 100)}${backCents(o) > 0 ? ` (${money(backCents(o) / 100)} refunded)` : ""}${movedCents(o) > 0 ? ` (${money(movedCents(o) / 100)} moved to another order)` : ""}`} · {when(o.payment.at)}</span>
                        : owed > 0
                          ? <strong>{money(owed / 100)} owed</strong>
                          : <span className="muted">nothing owed</span>}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
                    {itemsOf(o).map((l) => `${l.qty} × ${l.name}`).join(", ")}
                  </p>
                  {/* How it was paid, when that is worth saying: a check by
                      its number, credit by the order it came from. */}
                  {[o.payment, ...(o.topUps ?? [])].some((p) => p && p.via) && (
                    <p className="muted" style={{ margin: "2px 0 0", fontSize: 13.5 }}>
                      {[o.payment, ...(o.topUps ?? [])].filter((p): p is Payment => !!p).map((p) => `${money(p.totalCents / 100)} by ${payWord(p)}, ${when(p.at)}`).join(" · ")}
                    </p>
                  )}
                  {/* Paid for more than its ticket: the difference is credit,
                      and it can go onto another order this account owes on. */}
                  {o.status !== "canceled" && o.payment && balanceCents(o) < 0 && (
                    <p style={{ margin: "6px 0 0", fontSize: 14 }}>
                      <ApplyCredit
                        fromId={o.id}
                        creditCents={-balanceCents(o)}
                        targets={a.orders
                          .filter((x) => x.id !== o.id && owedOn(x) > 0)
                          .sort((x, y) => x.createdAt - y.createdAt)
                          .map((x) => ({ id: x.id, number: x.number, label: x.date, owedCents: owedOn(x) }))}
                        onDone={() => {
                          pull().catch(() => {});
                        }}
                      />
                    </p>
                  )}
                  {/* This order billed on its own: a funeral home pays per
                      service and asks for that service's invoice, not the
                      account's statement (Katy, 2026-10-29). */}
                  {owed > 0 && (
                    <p style={{ margin: "6px 0 0", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", fontSize: 14 }}>
                      {a.email && (
                        <button type="button" disabled={sent[o.id]?.busy} onClick={() => emailInvoice(a, o)} style={{ ...textButton, fontSize: 14 }}>
                          {sent[o.id]?.busy ? "Sending…" : sent[o.id]?.at ? `Invoice sent ${sent[o.id].at} · send again` : `Email an invoice for this order to ${a.email}`}
                        </button>
                      )}
                      <button type="button" onClick={() => copyInvoice(a, o)} style={{ ...textButton, fontSize: 14 }}>
                        {copied === o.id ? "Invoice copied" : "Copy an invoice for this order"}
                      </button>
                      {sent[o.id]?.error && <span role="alert" style={{ color: "var(--rose-ink)", fontWeight: 600 }}>{sent[o.id].error}</span>}
                    </p>
                  )}
                  {/* Written up twice (Katy, 2026-11-02): off the books from
                      here. Shop-written and unpaid only; the rest is the
                      cancel path on the board. */}
                  {o.source === "phone" && !o.payment && !(o.topUps?.length) && !(o.reversedPayments?.length) && (
                    <p style={{ margin: "6px 0 0", fontSize: 14 }}>
                      <RemoveDuplicate number={o.number} onRemove={(by) => removeDuplicate(o, by)} />
                    </p>
                  )}
                  {/* The money corner while anything is owed, and also for an
                      order marked paid by hand (Katy, 2026-10-15: two "show
                      settled but haven't been paid"), so the mark can be taken
                      back right here and the order goes back to owing. */}
                  {(owed > 0 || (o.status !== "canceled" && paidByHandOnly(o))) && (
                    <PayControls
                      orderId={o.id}
                      subtotal={o.subtotal}
                      deliveryCents={zipFeeCentsToAppend(o)}
                      payment={o.payment}
                      balanceCents={balanceCents(o)}
                      collectedCents={collectedCents(o)}
                      paidInParts={paidInParts(o)}
                      handPaid={paidByHandOnly(o)}
                      squareMoney={squareMoney(o)}
                      refundedCents={backCents(o)}
                      movedCents={movedCents(o)}
                      onPaid={(_m, _c, out) => {
                        setChangeNote(out?.changeCents ? `Change ${money(out.changeCents / 100)} back to the customer (${o.number}).` : "");
                        pull().catch(() => {});
                      }}
                    />
                  )}
                  {/* Recorded by mistake? One place on the row whatever the
                      order owes, so its answer survives the refresh. */}
                  <ReversedNote reversed={o.reversedPayments ?? []} />
                  {(!paidByHandOnly(o) || creditOn(o)) && <TakeBack orderId={o.id} number={o.number} payments={takeBackablePayments(o)} onDone={() => pull().catch(() => {})} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  };

  return (
    <>
      <h1>Accounts</h1>
      <MemoryWarning backend={backend} />
      {changeNote && (
        <p role="status" style={{ margin: "0 0 14px", fontSize: 17, fontWeight: 700, color: "var(--green)" }}>
          {changeNote}
        </p>
      )}
      <p className="muted" style={{ margin: "0 0 18px", maxWidth: 640 }}>
        Every order with <strong>On account</strong> ticked, by customer. An order stays here, and in the board&rsquo;s
        owed list, until it is settled below: card, cash, or <em>Paid another way</em> for a check or a transfer. A
        missed box is fixed on the board card with <em>Put on account</em>.
      </p>
      {error && <p role="alert" style={{ color: "var(--rose-ink)", fontWeight: 600 }}>{error}</p>}

      {!loaded ? (
        <p className="muted" aria-live="polite">{error ? "" : "Loading the accounts…"}</p>
      ) : accounts.length === 0 ? (
        <p className="muted">No account orders yet. Tick <strong>On account</strong> when writing one up and it will appear here.</p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", margin: "0 0 18px" }}>
            <input
              value={find}
              onChange={(e) => setFind(e.target.value)}
              placeholder="Find: name, company, phone, or order number"
              aria-label="Find an account"
              style={{ ...field, maxWidth: 360 }}
            />
            <span style={{ fontSize: 15 }}>
              <strong>{money(owedAll / 100)}</strong> owed across {owingAll} account{owingAll === 1 ? "" : "s"} · {accounts.length} on file
            </span>
            {owingAll > 0 && (
              <button
                type="button"
                className="btn"
                disabled={!!bulk?.busy}
                onClick={async () => {
                  // Every account that owes, not the find box's slice: a
                  // leftover search must not quietly shorten the month-end
                  // run (nor hide the button; owingAll is the unfiltered count).
                  const targets = accounts.filter((a) => a.owedCents > 0);
                  const hasEmail = (a: Account) => /^\S+@\S+\.\S+$/.test(a.email.trim());
                  const withEmail = targets.filter(hasEmail);
                  if (withEmail.length === 0) {
                    setBulk({ busy: false, done: 0, total: 0, noEmail: targets.map((a) => a.business || a.name), failed: [] });
                    return;
                  }
                  if (!window.confirm(`Email a statement to ${withEmail.length} account${withEmail.length === 1 ? "" : "s"} that owe? Each one lists its unpaid orders and the balance.`)) return;
                  setBulk({ busy: true, done: 0, total: withEmail.length, noEmail: targets.filter((a) => !hasEmail(a)).map((a) => a.business || a.name), failed: [] });
                  for (const a of withEmail) {
                    const ok = await emailStatement(a);
                    setBulk((b) => b && { ...b, done: b.done + 1, failed: ok ? b.failed : [...b.failed, a.business || a.name] });
                  }
                  setBulk((b) => b && { ...b, busy: false });
                }}
              >
                {bulk?.busy ? `Sending ${bulk.done} of ${bulk.total}…` : "Email every statement"}
              </button>
            )}
          </div>
          {bulk && !bulk.busy && (
            <p role="status" style={{ margin: "-8px 0 16px", fontSize: 14.5 }}>
              {bulk.total > 0 ? <>Statements sent to {bulk.total - bulk.failed.length} of {bulk.total} account{bulk.total === 1 ? "" : "s"}.</> : <>No statement could be emailed.</>}
              {bulk.failed.length ? <> Did not send: {bulk.failed.join(", ")}.</> : null}
              {bulk.noEmail.length ? <> No email on file (copy the statement instead): {bulk.noEmail.join(", ")}.</> : null}
            </p>
          )}

          <h2 style={{ fontSize: 15, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>
            Owing ({owing.length})
          </h2>
          {owing.length === 0 ? (
            <p className="muted" style={{ margin: "0 0 22px" }}>{find ? "No owing account matches." : "Nothing owed. Every account is settled."}</p>
          ) : (
            <div style={{ display: "grid", gap: 12, margin: "0 0 26px" }}>{owing.map(card)}</div>
          )}

          <h2 style={{ fontSize: 15, letterSpacing: "0.08em", textTransform: "uppercase", margin: "0 0 10px" }}>
            <button type="button" onClick={() => setShowSettled((s) => !s)} style={{ ...textButton, fontSize: 15, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {showSettled ? "Hide" : "Show"} settled ({settled.length})
            </button>
          </h2>
          {showSettled && (settled.length === 0 ? <p className="muted">None.</p> : <div style={{ display: "grid", gap: 12 }}>{settled.map(card)}</div>)}
        </>
      )}
    </>
  );
}
