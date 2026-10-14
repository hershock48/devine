"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { deliveryFeeFor } from "@/lib/site";
import { isDeliveryLine, isTaxLine } from "@/lib/workroom/derive";
import { money, phoneKey, textButton, MemoryWarning, PinGate } from "@/components/workroom/ui";
import PayControls from "@/components/workroom/PayControls";

/**
 * HOUSE ACCOUNTS (Katy, 2026-10-14, and the proposal's "who owes what"):
 * every order written up with the On-account box ticked, grouped by the
 * customer, with what each one owes right now, what they have paid, and
 * the orders behind both. Payment is taken here the same way as on the
 * board (card, cash, or "paid another way" for a check or a transfer), so
 * settling an account is one tap per order, not a hunt through the board.
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
  zip: string;
  date: string;
  lines: Line[];
  subtotal: number;
  createdAt: number;
  payment?: Payment | null;
  account?: boolean;
  taxExempt?: boolean;
  takenBy?: string;
};

type Account = {
  key: string;
  name: string;
  phone: string;
  email: string;
  orders: Order[];
  owedCents: number;
  paidCents: number;
  open: number;
  lastAt: number;
};

const cents = (n: number) => Math.round(n * 100);
const when = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The delivery fee the pay route will append to a delivery ticket that
    never carried a line (same mirror as the board). */
const feeToAppend = (o: Order): number => {
  if (o.fulfillment !== "delivery" || o.lines.some(isDeliveryLine)) return 0;
  const sheet = deliveryFeeFor(o.zip);
  return sheet !== undefined ? Math.round(sheet * 100) : 0;
};
const owedOn = (o: Order): number => (o.payment || o.status === "canceled" ? 0 : cents(o.subtotal) + feeToAppend(o));

function groupAccounts(orders: Order[]): Account[] {
  const map = new Map<string, Account>();
  for (const o of orders) {
    const key = phoneKey(o.phone) || o.name.trim().toLowerCase() || o.id;
    const a = map.get(key) ?? { key, name: o.name, phone: o.phone, email: o.email, orders: [], owedCents: 0, paidCents: 0, open: 0, lastAt: 0 };
    a.orders.push(o);
    const owed = owedOn(o);
    a.owedCents += owed;
    if (owed > 0) a.open += 1;
    if (o.payment && !o.payment.refundedAt) a.paidCents += o.payment.totalCents;
    if (o.createdAt > a.lastAt) {
      a.lastAt = o.createdAt;
      // The newest order names the account: a corrected spelling wins.
      a.name = o.name || a.name;
      a.email = o.email || a.email;
      a.phone = o.phone || a.phone;
    }
    map.set(key, a);
  }
  return [...map.values()]
    .map((a) => ({ ...a, orders: [...a.orders].sort((x, y) => y.createdAt - x.createdAt) }))
    .sort((x, y) => y.owedCents - x.owedCents || y.lastAt - x.lastAt || x.name.localeCompare(y.name));
}

/** A plain-text statement for the unpaid orders, to paste into an email
    or print: what month-end looks like until invoices are built. */
function statementText(a: Account): string {
  const open = a.orders.filter((o) => owedOn(o) > 0);
  const rows = open.map((o) => {
    const items = o.lines.filter((l) => !isDeliveryLine(l) && !isTaxLine(l)).map((l) => `${l.qty} x ${l.name}`).join(", ");
    return `${o.date}  ${o.number}  ${items}${o.recipient && o.recipient !== o.name ? `  (for ${o.recipient})` : ""}  ${money(owedOn(o) / 100)}`;
  });
  return [
    `Statement for ${a.name}`,
    `As of ${when(Date.now())}`,
    "",
    ...rows,
    "",
    `Balance due: ${money(a.owedCents / 100)}`,
  ].join("\n");
}

export default function Accounts({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [orders, setOrders] = useState<Order[]>([]);
  const [backend, setBackend] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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
    setError("");
  }, []);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => setError("The accounts did not load."));
  }, [authed, pull]);

  const accounts = useMemo(() => groupAccounts(orders), [orders]);
  const owedAll = accounts.reduce((s, a) => s + a.owedCents, 0);

  async function copyStatement(a: Account) {
    try {
      await navigator.clipboard.writeText(statementText(a));
      setCopied(a.key);
      setTimeout(() => setCopied((k) => (k === a.key ? null : k)), 2500);
    } catch {
      setError("Could not copy. Select the orders and copy them by hand.");
    }
  }

  if (!authed) {
    return (
      <>
        <h1>Accounts</h1>
        <PinGate onAuthed={() => { setAuthed(true); pull().catch(() => {}); }} />
      </>
    );
  }

  return (
    <>
      <h1>Accounts</h1>
      <MemoryWarning backend={backend} />
      <p className="muted" style={{ margin: "0 0 22px", maxWidth: 640 }}>
        Every order written up with <strong>On account</strong> ticked, by customer. An order stays here, and in the
        board&rsquo;s owed list, until it is settled below: card, cash, or <em>Paid another way</em> for a check or a
        transfer.
      </p>
      {error && <p role="alert" style={{ color: "var(--rose-ink)", fontWeight: 600 }}>{error}</p>}

      {accounts.length === 0 ? (
        <p className="muted">No account orders yet. Tick <strong>On account</strong> when writing one up and it will appear here.</p>
      ) : (
        <>
          <p style={{ margin: "0 0 18px", fontSize: 15 }}>
            <strong>{money(owedAll / 100)}</strong> owed across {accounts.filter((a) => a.owedCents > 0).length} account
            {accounts.filter((a) => a.owedCents > 0).length === 1 ? "" : "s"} · {accounts.length} account{accounts.length === 1 ? "" : "s"} on file
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {accounts.map((a) => {
              const open = openKey === a.key;
              return (
                <section key={a.key} className="panel" style={{ padding: 16 }}>
                  <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                    <div>
                      <strong style={{ fontSize: 17 }}>{a.name || "No name"}</strong>
                      <p className="muted" style={{ margin: "2px 0 0", fontSize: 13.5 }}>
                        {[a.phone, a.email].filter(Boolean).join(" · ") || "no phone or email on file"}
                      </p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <strong style={{ fontSize: 17, color: a.owedCents > 0 ? "var(--rose-ink)" : "var(--green)" }}>
                        {a.owedCents > 0 ? `Owes ${money(a.owedCents / 100)}` : "Settled"}
                      </strong>
                      <p className="muted" style={{ margin: "2px 0 0", fontSize: 13.5 }}>
                        {a.orders.length} order{a.orders.length === 1 ? "" : "s"}
                        {a.open > 0 ? `, ${a.open} open` : ""} · paid {money(a.paidCents / 100)} to date · last {when(a.lastAt)}
                      </p>
                    </div>
                  </header>
                  <p style={{ margin: "10px 0 0", display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => setOpenKey(open ? null : a.key)} style={{ ...textButton, fontSize: 14 }}>
                      {open ? "Hide the orders" : "Show the orders"}
                    </button>
                    {a.owedCents > 0 && (
                      <button type="button" onClick={() => copyStatement(a)} style={{ ...textButton, fontSize: 14 }}>
                        {copied === a.key ? "Statement copied" : "Copy a statement"}
                      </button>
                    )}
                  </p>
                  {open && (
                    <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 10 }}>
                      {a.orders.map((o) => {
                        const owed = owedOn(o);
                        const items = o.lines.filter((l) => !isDeliveryLine(l) && !isTaxLine(l));
                        return (
                          <li key={o.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                              <span>
                                <strong>{o.number}</strong> · {o.date}
                                {o.recipient && o.recipient !== o.name ? ` · for ${o.recipient}` : ""}
                                {o.taxExempt ? " · tax exempt" : ""}
                                {o.takenBy ? ` · taken by ${o.takenBy}` : ""}
                                {o.status === "canceled" ? " · canceled" : ""}
                              </span>
                              <span style={{ whiteSpace: "nowrap" }}>
                                {o.payment
                                  ? <span style={{ color: "var(--green)", fontWeight: 600 }}>Paid {money(o.payment.totalCents / 100)}{o.payment.refundedAt ? ", refunded" : ""} · {when(o.payment.at)}</span>
                                  : o.status === "canceled"
                                    ? <span className="muted">nothing owed</span>
                                    : <strong>{money(owed / 100)} owed</strong>}
                              </span>
                            </div>
                            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13.5 }}>
                              {items.map((l) => `${l.qty} × ${l.name}`).join(", ")}
                            </p>
                            {owed > 0 && (
                              <PayControls
                                orderId={o.id}
                                subtotal={o.subtotal}
                                deliveryCents={feeToAppend(o)}
                                payment={o.payment}
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
            })}
          </div>
        </>
      )}
    </>
  );
}
