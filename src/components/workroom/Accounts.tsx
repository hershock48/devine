"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { site } from "@/lib/site";
import { balanceCents, collectedCents, isDeliveryLine, isTaxLine, zipFeeToAppend } from "@/lib/workroom/derive";
import { field, money, phoneKey, textButton, MemoryWarning, PinGate } from "@/components/workroom/ui";
import PayControls from "@/components/workroom/PayControls";

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

type Payment = { at: number; method: string; totalCents: number; feeCents: number; refundedAt?: number };
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
  account?: boolean;
  taxExempt?: boolean;
  taxId?: string;
  takenBy?: string;
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
  lastAt: number;
};

const DAY = 86_400_000;
const cents = (n: number) => Math.round(n * 100);
const when = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const daysSince = (ms: number) => Math.max(0, Math.floor((Date.now() - ms) / DAY));

/** The delivery fee the pay route will append, in cents (derive.ts holds
    the one rule). */
const feeToAppend = (o: Order): number => Math.round((zipFeeToAppend(o) ?? 0) * 100);
/** What is collectable now. A held order is not: nothing is promised yet
    and the pay route refuses it, the board's own reading. */
const owedOn = (o: Order): number =>
  o.status === "canceled" || o.status === "hold" ? 0 : Math.max(0, balanceCents(o)) + (o.payment ? 0 : feeToAppend(o));
const itemsOf = (o: Order) => o.lines.filter((l) => !isDeliveryLine(l) && !isTaxLine(l));

function groupAccounts(orders: Order[]): Account[] {
  const map = new Map<string, Account>();
  for (const o of orders) {
    // A business is one account however many people there call (the
    // director's cell, the office line); a person is their phone, else
    // their name. Prefixed so a Mr. Kempf never lands in the funeral home.
    const biz = (o.business ?? "").trim().toLowerCase();
    const key = biz ? `biz:${biz}` : phoneKey(o.phone) || `name:${o.name.trim().toLowerCase()}` || o.id;
    const a = map.get(key) ?? {
      key, name: o.name, business: o.business ?? "", company: o.company ?? "", phone: o.phone, email: o.email,
      orders: [], owedCents: 0, paidCents: 0, open: 0, oldestOpenAt: 0, lastAt: 0,
    };
    a.orders.push(o);
    const owed = owedOn(o);
    a.owedCents += owed;
    if (owed > 0) {
      a.open += 1;
      if (!a.oldestOpenAt || o.createdAt < a.oldestOpenAt) a.oldestOpenAt = o.createdAt;
    }
    if (o.payment && !o.payment.refundedAt) a.paidCents += collectedCents(o);
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
    return `${o.date}  ${o.number}  ${items}${to}  ${money(owedOn(o) / 100)}`;
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

/** The rows the server emails (statement-mail.ts), the same ones the
    text statement lists. */
function statementRows(a: Account) {
  return a.orders
    .filter((o) => owedOn(o) > 0)
    .sort((x, y) => x.createdAt - y.createdAt)
    .map((o) => ({
      date: o.date,
      number: o.number,
      items: itemsOf(o).map((l) => `${l.qty} x ${l.name}`).join(", ") + (o.recipient && o.recipient !== o.name ? ` (for ${o.recipient})` : ""),
      owed: money(owedOn(o) / 100),
    }));
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
  const owing = shown.filter((a) => a.owedCents > 0);
  const settled = shown.filter((a) => a.owedCents === 0);
  const owedAll = accounts.reduce((s, a) => s + a.owedCents, 0);
  const owingAll = accounts.filter((a) => a.owedCents > 0).length;

  /* EMAIL FROM THE SHOP, not from whatever mail app the PC has (Kevin,
     2026-10-14: the mailto link opened Edge's and Outlook's pickers and
     the shop lives in Gmail). The server sends it from the shop's own
     mailbox, branded like the receipts, and says when it went. */
  async function emailStatement(a: Account) {
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
    } catch (err) {
      setSent((s) => ({ ...s, [a.key]: { error: err instanceof Error ? err.message : "The statement did not send." } }));
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
              {a.owedCents > 0 ? `Owes ${money(a.owedCents / 100)}` : "Settled"}
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
            </>
          )}
        </p>
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
                      {o.taxExempt ? ` · tax exempt${o.taxId ? ` (ID ${o.taxId})` : ""}` : ""}
                      {o.takenBy ? ` · taken by ${o.takenBy}` : ""}
                      {o.status === "canceled" ? " · canceled" : o.status === "hold" ? " · on hold, not yet owed" : ""}
                      {" · "}
                      <a href={`/api/workroom/print/${o.id}`} target="_blank" rel="noopener">Print</a>
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>
                      {o.payment && owed === 0
                        ? <span style={{ color: "var(--green)", fontWeight: 600 }}>Paid {money(collectedCents(o) / 100)}{o.payment.refundedAt ? ", refunded" : ""} · {when(o.payment.at)}</span>
                        : owed > 0
                          ? <strong>{money(owed / 100)} owed</strong>
                          : <span className="muted">nothing owed</span>}
                    </span>
                  </div>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
                    {itemsOf(o).map((l) => `${l.qty} × ${l.name}`).join(", ")}
                  </p>
                  {owed > 0 && (
                    <PayControls
                      orderId={o.id}
                      subtotal={o.subtotal}
                      deliveryCents={o.payment ? 0 : feeToAppend(o)}
                      payment={o.payment}
                      balanceCents={balanceCents(o)}
                      collectedCents={collectedCents(o)}
                      onPaid={() => pull().catch(() => {})}
                    />
                  )}
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
          </div>

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
