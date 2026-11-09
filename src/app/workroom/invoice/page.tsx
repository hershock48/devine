import type { Metadata } from "next";
import PrintButton from "@/components/workroom/PrintButton";
import { addressOneLine, site } from "@/lib/site";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { grossPaidCents, isDeliveryLine, isTaxLine, owedNowCents, payWord, refundedCents, zipFeeCentsToAppend } from "@/lib/workroom/derive";
import { getStore, type WorkroomOrder } from "@/lib/workroom/store";

/**
 * AN INVOICE ON PAPER (Katy, 2026-11-09: "in the accounts section they
 * also need to be able to print an invoice"). The Accounts tab could email
 * an invoice or copy one as text; a funeral home's office, Tribute and
 * FireKeepers want a sheet with a number, a PO and a balance on it.
 *
 * One order prints as an INVOICE: its lines as the ticket has them, what
 * was paid and how, and the balance due. Several orders print as a
 * STATEMENT: one row each and the balance across them. Both are the same
 * page, read from the orders themselves, so paper never disagrees with the
 * board. Behind the workroom PIN like every order screen.
 *
 * Printing is the browser's: the workroom layout already keeps its own
 * chrome off paper, and the button here is marked no-print.
 */
export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

const money = (n: number) => `$${n.toFixed(2)}`;
const c$ = (cents: number) => money(cents / 100);
const longDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d, 12).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : iso;
};
const stamp = (ms: number) => new Date(ms).toLocaleDateString("en-US", { timeZone: site.timeZone, month: "short", day: "numeric", year: "numeric" });
/** What is collectable now: nothing on a canceled or held order. */
const owedOn = (o: WorkroomOrder) => (o.status === "canceled" || o.status === "hold" ? 0 : owedNowCents(o));

const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px 6px 0", borderBottom: "2px solid #222", fontSize: 12.5, letterSpacing: "0.06em", textTransform: "uppercase" };
const td: React.CSSProperties = { padding: "6px 8px 6px 0", borderBottom: "1px solid #ccc", verticalAlign: "top" };
const num: React.CSSProperties = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", paddingRight: 0 };

export default async function InvoicePage({ searchParams }: { searchParams: Promise<{ ids?: string; statement?: string }> }) {
  if (!(await isWorkroomAuthed())) {
    return (
      <>
        <h1>Invoice</h1>
        <p className="lede">
          The workroom is locked. <a href="/workroom/accounts">Open Accounts</a>, enter the PIN, and print from the order&rsquo;s row.
        </p>
      </>
    );
  }
  const sp = await searchParams;
  const ids = [...new Set((sp.ids ?? "").split(",").map((s) => s.trim()).filter((s) => /^[A-Za-z0-9_-]{4,64}$/.test(s)))].slice(0, 60);
  const store = getStore();
  const found = (await Promise.all(ids.map((id) => store.getOrder(id)))).filter((o): o is WorkroomOrder => !!o && !o.voided);
  if (found.length === 0) {
    return (
      <>
        <h1>Invoice</h1>
        <p className="lede">
          No order was found to print. <a href="/workroom/accounts">Back to Accounts</a>.
        </p>
      </>
    );
  }
  const orders = [...found].sort((a, b) => a.createdAt - b.createdAt);
  const statement = sp.statement === "1" || orders.length > 1;
  // The newest order names the customer and carries the freshest bill-to.
  const newest = [...orders].sort((a, b) => b.createdAt - a.createdAt);
  const who = newest[0];
  // The bill-to typed on any of these orders; failing that, the one this
  // customer's other orders carry (it is typed once, on whichever order
  // the counter had it to hand).
  const digits = (v: string) => v.replace(/[^0-9]/g, "").slice(-10);
  let billTo = newest.find((o) => o.billTo)?.billTo;
  if (!billTo) {
    const biz = (who.business ?? "").trim().toLowerCase();
    const ph = digits(who.phone);
    billTo = (await store.listOrderContacts())
      .filter((c) => c.billTo && (biz ? (c.business ?? "").trim().toLowerCase() === biz : ph.length >= 7 && digits(c.phone) === ph))
      .sort((x, y) => y.createdAt - x.createdAt)[0]?.billTo;
  }
  const balance = orders.reduce((s, o) => s + owedOn(o), 0);
  const today = stamp(Date.now());

  return (
    <div className="invoice-sheet" style={{ maxWidth: 760, background: "#fff", color: "#111", padding: "clamp(14px, 4vw, 32px)", border: "1px solid var(--line)", overflowWrap: "anywhere" }}>
      <style>{`@media print { .invoice-sheet { border: 0 !important; padding: 0 !important; max-width: none !important; } .no-print { display: none !important; } body { background: #fff !important; } }`}</style>
      <p className="no-print" style={{ margin: "0 0 18px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <PrintButton label={statement ? "Print this statement" : "Print this invoice"} />
        <a href="/workroom/accounts">Back to Accounts</a>
      </p>

      <header style={{ display: "flex", justifyContent: "space-between", gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div>
          <p style={{ margin: 0, fontFamily: "var(--serif)", fontSize: 26, lineHeight: 1.15 }}>{site.name}</p>
          <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.5 }}>
            {addressOneLine}
            <br />
            {site.phone} · {site.email}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{statement ? "Statement" : "Invoice"}</p>
          <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.5 }}>
            {!statement && (
              <>
                Invoice no. <strong>{orders[0].number}</strong>
                <br />
              </>
            )}
            Date: {today}
            {!statement && orders[0].poNumber ? (
              <>
                <br />
                PO number: <strong>{orders[0].poNumber}</strong>
              </>
            ) : null}
          </p>
        </div>
      </header>

      <section style={{ display: "flex", gap: 40, flexWrap: "wrap", margin: "26px 0 20px", fontSize: 14.5, lineHeight: 1.5 }}>
        <div>
          <p style={{ margin: "0 0 4px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Bill to</p>
          {who.business ? <strong>{who.business}</strong> : <strong>{who.name}</strong>}
          {who.business && who.name ? (
            <>
              <br />
              {who.name}
            </>
          ) : null}
          {billTo ? (
            <>
              <br />
              {billTo.street}
              <br />
              {[billTo.town, billTo.zip].filter(Boolean).join(" ")}
            </>
          ) : null}
          {who.phone || who.email ? (
            <>
              <br />
              {[who.phone, who.email].filter(Boolean).join(" · ")}
            </>
          ) : null}
          {who.taxExempt && who.taxId ? (
            <>
              <br />
              Tax-exempt ID {who.taxId}
            </>
          ) : null}
        </div>
        {!statement && (
          <div>
            <p style={{ margin: "0 0 4px", fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{orders[0].fulfillment === "delivery" ? "Delivered to" : "Picked up"}</p>
            {orders[0].fulfillment === "delivery" ? (
              <>
                {orders[0].recipient || orders[0].name}
                {orders[0].company ? (
                  <>
                    <br />
                    {orders[0].company}
                  </>
                ) : null}
                <br />
                {[orders[0].street, orders[0].town, orders[0].zip].filter(Boolean).join(", ")}
              </>
            ) : (
              <>{orders[0].recipient && orders[0].recipient !== orders[0].name ? `For ${orders[0].recipient}` : "At the shop"}</>
            )}
            <br />
            {longDate(orders[0].date)}
          </div>
        )}
      </section>

      {statement ? (
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>
          <thead>
            <tr>
              <th style={th}>Date</th>
              <th style={th}>Order</th>
              <th style={th}>PO</th>
              <th style={th}>For</th>
              <th style={{ ...th, ...num }}>Total</th>
              <th style={{ ...th, ...num }}>Paid</th>
              <th style={{ ...th, ...num }}>Owed</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{o.date}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>{o.number}</td>
                <td style={td}>{o.poNumber || ""}</td>
                <td style={td}>
                  {o.lines.filter((l) => !isDeliveryLine(l) && !isTaxLine(l)).map((l) => `${l.qty} x ${l.name}`).join(", ")}
                  {o.recipient && o.recipient !== o.name ? ` (for ${o.recipient})` : ""}
                </td>
                <td style={{ ...td, ...num }}>{money(o.subtotal)}</td>
                <td style={{ ...td, ...num }}>{c$(grossPaidCents(o) - refundedCents(o))}</td>
                <td style={{ ...td, ...num, fontWeight: 700 }}>{c$(owedOn(o))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        orders.map((o) => (
          <table key={o.id} style={{ borderCollapse: "collapse", width: "100%", fontSize: 14.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 56 }}>Qty</th>
                <th style={th}>Description</th>
                <th style={{ ...th, ...num }}>Each</th>
                <th style={{ ...th, ...num }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l, i) => (
                <tr key={i}>
                  <td style={td}>{isTaxLine(l) || isDeliveryLine(l) ? "" : l.qty}</td>
                  <td style={td}>{l.name}</td>
                  <td style={{ ...td, ...num }}>{isTaxLine(l) || isDeliveryLine(l) ? "" : money(l.each)}</td>
                  <td style={{ ...td, ...num }}>{money(l.each * l.qty)}</td>
                </tr>
              ))}
              {/* A delivery ticket that never carried its fee line: the pay
                  route adds it at the first payment, so the invoice says it. */}
              {zipFeeCentsToAppend(o) > 0 && (
                <tr>
                  <td style={td} />
                  <td style={td}>Delivery</td>
                  <td style={{ ...td, ...num }} />
                  <td style={{ ...td, ...num }}>{c$(zipFeeCentsToAppend(o))}</td>
                </tr>
              )}
            </tbody>
          </table>
        ))
      )}

      <section style={{ display: "flex", justifyContent: "flex-end", margin: "16px 0 0" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 15, minWidth: "min(280px, 100%)" }}>
          <tbody>
            {!statement &&
              (() => {
                const o = orders[0];
                const total = Math.round(o.subtotal * 100) + zipFeeCentsToAppend(o);
                const pays = [o.payment, ...(o.topUps ?? [])].filter((p): p is NonNullable<typeof p> => !!p);
                return (
                  <>
                    <tr>
                      <td style={{ padding: "3px 16px 3px 0" }}>Total</td>
                      <td style={num}>{c$(total)}</td>
                    </tr>
                    {pays.map((p, i) => (
                      <tr key={i}>
                        <td style={{ padding: "3px 16px 3px 0" }}>
                          Paid by {payWord(p)}, {stamp(p.at)}
                        </td>
                        <td style={num}>−{c$(p.totalCents - p.feeCents)}</td>
                      </tr>
                    ))}
                    {(o.refunds ?? []).map((r, i) => (
                      <tr key={`r${i}`}>
                        <td style={{ padding: "3px 16px 3px 0" }}>
                          {r.how === "transfer" ? r.note : `Refunded${r.kept && r.note ? ` (${r.note})` : ""}`}, {stamp(r.at)}
                        </td>
                        <td style={num}>{r.kept ? `(${c$(r.cents)})` : c$(r.cents)}</td>
                      </tr>
                    ))}
                  </>
                );
              })()}
            <tr>
              <td style={{ padding: "8px 16px 3px 0", fontWeight: 700, borderTop: "2px solid #222" }}>Balance due</td>
              <td style={{ ...num, padding: "8px 0 3px", fontWeight: 700, fontSize: 18, borderTop: "2px solid #222" }}>{c$(balance)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <p style={{ margin: "30px 0 0", fontSize: 13.5, lineHeight: 1.5 }}>
        Thank you. Please send payment to {site.name}, {addressOneLine}, with the {statement ? "order numbers" : "invoice number"} on the check. Questions: {site.phone}.
      </p>
    </div>
  );
}
