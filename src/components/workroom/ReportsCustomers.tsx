"use client";

import { Fragment, useMemo, useState } from "react";
import { site } from "@/lib/site";
import { HISTORY_DAYS, balanceCents, isDeliveryLine, isTaxLine, isoDate, owedNowCents } from "@/lib/workroom/derive";
import { field, phoneKey, textButton, todayISO } from "@/components/workroom/ui";
import { Block, Rows, Scroll, Tiles, c$, csv$, dayAt, downloadCsv, table, td, tdR, thL, thR, type ReportOrder } from "@/components/workroom/report-parts";

/**
 * THE CUSTOMER SHEET (Katy, 2026-11-09: "top customer report, etc.,
 * different types of customer reports"; made fuller 2026-11-10 at Kevin's
 * "can they be improved?"). Every answer comes from the orders already on
 * the board, no separate customer table:
 *
 *   who spends the most, orders the most often, or ordered most recently,
 *   with each customer's own order history one tap away;
 *   who is new, and which regulars have gone quiet;
 *   where the flowers go (the places delivered to most);
 *   who ordered about this time last year and has nothing coming up, which
 *   is the call a florist most wants to make and appears by itself once
 *   the orders are a year old;
 *   and the whole list as a spreadsheet file.
 *
 * A customer is the Accounts tab's grouping: the business when there is
 * one, else the phone, else the name. Quick sales are nobody and are left
 * out; canceled and held orders are not sales. THE PERIOD IS WHEN THE
 * ORDER WAS PLACED, so a wedding ordered this month for next spring
 * counts this month (the first cut went by the order's own date and left
 * every upcoming order out of "the last 90 days"). Spend is ticket totals,
 * tax and delivery included.
 */
export type Span = "30" | "90" | "365" | "year" | "all";
export const SPANS: [Span, string][] = [
  ["30", "the last 30 days"],
  ["90", "the last 90 days"],
  ["year", "this year"],
  ["365", "the last 12 months"],
  ["all", "everything on file"],
];

const DAY = 86_400_000;
const short = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const shortIso = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? dayAt(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");
const itemsOf = (o: ReportOrder) => o.lines.filter((l) => !isDeliveryLine(l) && !isTaxLine(l)).map((l) => `${l.qty} x ${l.name}`).join(", ");
const keyOf = (o: ReportOrder) => (o.business?.trim() ? `biz:${o.business.trim().toLowerCase()}` : phoneKey(o.phone) ? `ph:${phoneKey(o.phone)}` : `name:${o.name.trim().toLowerCase()}`);

type Row = {
  key: string;
  label: string;
  phone: string;
  email: string;
  account: boolean;
  /** In the period. */
  orders: number;
  cents: number;
  /** On file, all of it. */
  everOrders: number;
  everCents: number;
  firstAt: number;
  lastAt: number;
  /** Of the period's spend, what was put on a house account. */
  accountCents: number;
  /** An order dated today or later: something is coming up. */
  upcoming: boolean;
  owed: number;
  all: ReportOrder[];
};

export default function CustomersView({ orders, span }: { orders: ReportOrder[]; span: Span }) {
  const [sort, setSort] = useState<"spend" | "orders" | "recent">("spend");
  const [find, setFind] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const today = todayISO();
  const now = dayAt(today).getTime();
  const from = span === "all" ? 0 : span === "year" ? new Date(dayAt(today).getFullYear(), 0, 1).getTime() : now - 12 * 3_600_000 - (Number(span) - 1) * DAY;

  const data = useMemo(() => {
    const rows = new Map<string, Row>();
    const sales = orders.filter((o) => o.status !== "canceled" && o.status !== "hold" && !o.quick && (o.name.trim() || o.business?.trim()));
    for (const o of sales) {
      const key = keyOf(o);
      const cur: Row = rows.get(key) ?? { key, label: "", phone: "", email: "", account: false, orders: 0, cents: 0, accountCents: 0, everOrders: 0, everCents: 0, firstAt: Infinity, lastAt: 0, upcoming: false, owed: 0, all: [] };
      const cents = Math.round(o.subtotal * 100);
      cur.everOrders += 1;
      cur.everCents += cents;
      cur.all.push(o);
      if (o.createdAt > cur.lastAt) {
        cur.lastAt = o.createdAt;
        cur.label = o.business ? `${o.business}${o.name ? ` · ${o.name}` : ""}` : o.name;
        cur.phone = o.phone || cur.phone;
        cur.email = o.email || cur.email;
      }
      if (o.createdAt < cur.firstAt) cur.firstAt = o.createdAt;
      if (o.createdAt >= from) {
        cur.orders += 1;
        cur.cents += cents;
        if (o.account) cur.accountCents += cents;
      }
      if (o.date >= today) cur.upcoming = true;
      if (o.account) cur.account = true;
      cur.owed += balanceCents(o) > 0 ? owedNowCents(o) : 0;
      rows.set(key, cur);
    }
    const all = [...rows.values()];
    for (const r of all) r.all.sort((a, b) => b.createdAt - a.createdAt);
    const inSpan = all.filter((r) => r.orders > 0);
    const total = inSpan.reduce((s, r) => s + r.cents, 0);
    const orderCount = inSpan.reduce((s, r) => s + r.orders, 0);
    const accounts = inSpan.filter((r) => r.accountCents > 0);

    // WHERE THE FLOWERS GO: the places delivered to most, in the period.
    const places = new Map<string, { label: string; count: number; cents: number }>();
    for (const o of sales) {
      const place = (o.company ?? "").trim();
      if (o.createdAt < from || o.fulfillment !== "delivery" || !place) continue;
      const cur = places.get(place.toLowerCase()) ?? { label: place, count: 0, cents: 0 };
      places.set(place.toLowerCase(), { label: cur.label, count: cur.count + 1, cents: cur.cents + Math.round(o.subtotal * 100) });
    }

    // ABOUT THIS TIME LAST YEAR: an order dated a year ago within the next
    // six weeks, from a customer with nothing coming up. Empty until the
    // orders on file are a year old.
    const lastYear = (iso: string, plusDays: number) => isoDate(new Date(dayAt(iso).getTime() - 365 * DAY + plusDays * DAY));
    const lo = lastYear(today, 0);
    const hi = lastYear(today, 45);
    const due = sales
      .filter((o) => o.date >= lo && o.date <= hi)
      .map((o) => ({ o, row: rows.get(keyOf(o))! }))
      .filter((x) => !x.row.upcoming)
      .sort((a, b) => a.o.date.localeCompare(b.o.date));

    return {
      all,
      inSpan,
      total,
      orderCount,
      accounts: { count: accounts.length, cents: accounts.reduce((s, r) => s + r.accountCents, 0) },
      fresh: all.filter((r) => r.firstAt >= from).sort((a, b) => b.firstAt - a.firstAt),
      quiet: all.filter((r) => r.everOrders >= 2 && r.lastAt < now - 90 * DAY && !r.upcoming).sort((a, b) => b.everCents - a.everCents).slice(0, 25),
      repeat: inSpan.filter((r) => r.everOrders >= 2).length,
      places: [...places.values()].sort((a, b) => b.count - a.count || b.cents - a.cents).slice(0, 10),
      due,
    };
  }, [orders, from, today, now]);

  const q = find.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const ranked = [...data.inSpan].sort((a, b) => (sort === "spend" ? b.cents - a.cents : sort === "orders" ? b.orders - a.orders || b.cents - a.cents : b.lastAt - a.lastAt));
  // A search looks through everyone on file, period or not; the list is the top 25 otherwise.
  const top = q
    ? [...data.all].filter((r) => r.label.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || (digits.length >= 3 && phoneKey(r.phone).includes(digits))).sort((a, b) => b.everCents - a.everCents).slice(0, 50)
    : ranked.slice(0, 25);
  const label = SPANS.find(([v]) => v === span)?.[1] ?? "";

  const download = () =>
    downloadCsv(
      `devine-customers-${today}.csv`,
      ["Customer", "Phone", "Email", "House account", "Orders in the period", "Spent in the period", "Average order", "Orders on file", "Spent on file", "First ordered", "Last ordered", "Owes now"],
      ranked.map((r) => [r.label, r.phone, r.email, r.account ? "yes" : "", r.orders, csv$(r.cents), csv$(Math.round(r.cents / r.orders)), r.everOrders, csv$(r.everCents), isoDate(new Date(r.firstAt)), isoDate(new Date(r.lastAt)), csv$(r.owed)]),
    );

  return (
    <div className="sheet" style={{ maxWidth: 860 }}>
      <p style={{ margin: "0 0 14px", fontSize: 15 }}>
        <strong>{site.shortName}</strong> · Customers · <strong>orders placed in {label}</strong>
        <span className="muted"> · printed {new Date().toLocaleString("en-US", { timeZone: site.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
      </p>
      <Tiles
        items={[
          { label: "Customers who ordered", value: String(data.inSpan.length), sub: `${data.repeat} have ordered more than once` },
          { label: "What they spent", value: c$(data.total), sub: data.inSpan.length ? `${c$(Math.round(data.total / data.inSpan.length))} a customer` : undefined },
          { label: "Average order", value: data.orderCount ? c$(Math.round(data.total / data.orderCount)) : c$(0), sub: `${data.orderCount} order${data.orderCount === 1 ? "" : "s"}` },
          { label: "House accounts", value: c$(data.accounts.cents), sub: `${data.accounts.count} account${data.accounts.count === 1 ? "" : "s"}${data.total > 0 ? `, ${Math.round((data.accounts.cents / data.total) * 100)}% of the spend` : ""}` },
          // On "everything on file" every customer is new to the file: not a figure.
          ...(span === "all" ? [] : [{ label: "New customers", value: String(data.fresh.length), sub: "first order on file is in this period" }]),
        ]}
      />
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "minmax(0, 1fr)" }}>
        <Block
          title={q ? "Customers found" : `Top customers · ${sort === "spend" ? "by what they spent" : sort === "orders" ? "by how often they order" : "most recent first"}`}
          note={q ? "A search looks through everyone on file, and its figures are everything on file, not only this period. Tap a name for their orders." : "The top 25. Tap a name for their orders. Spend is ticket totals with tax and delivery; canceled orders and quick sales are left out."}
        >
          <div className="no-print" style={{ margin: "0 0 10px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 14 }}>
            <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a customer: name, phone or email" aria-label="Find a customer" style={{ ...field, maxWidth: 300, padding: "6px 10px" }} />
            {!q && (
              <span style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                Sort by
                {(
                  [
                    ["spend", "what they spent"],
                    ["orders", "number of orders"],
                    ["recent", "most recent order"],
                  ] as ["spend" | "orders" | "recent", string][]
                ).map(([v, w]) => (
                  <button key={v} type="button" onClick={() => setSort(v)} aria-pressed={sort === v} style={{ ...textButton, fontSize: 14, fontWeight: sort === v ? 700 : 400 }}>
                    {w}
                  </button>
                ))}
              </span>
            )}
            <button type="button" onClick={download} disabled={ranked.length === 0} style={{ ...textButton, fontSize: 14 }}>
              Download the list (spreadsheet)
            </button>
          </div>
          {top.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>{q ? "Nobody on file matches." : "No orders in this period."}</p>
          ) : (
            <Scroll label="Customers table">
              <table style={{ ...table, minWidth: 580 }}>
                <thead>
                  <tr>
                    <th style={thL}>Customer</th>
                    <th style={thR}>Orders</th>
                    <th style={thR}>Spent</th>
                    <th style={thR}>Average</th>
                    <th style={thR}>Last ordered</th>
                    <th style={thR}>Owes now</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r, i) => {
                    // In a search the figures are everything on file; in the ranking, the period's.
                    const n = q ? r.everOrders : r.orders;
                    const spent = q ? r.everCents : r.cents;
                    const isOpen = open === r.key;
                    return (
                      <Fragment key={r.key}>
                        <tr>
                          <td style={td}>
                            <button type="button" onClick={() => setOpen(isOpen ? null : r.key)} aria-expanded={isOpen} style={{ ...textButton, fontSize: 14.5, textAlign: "left" }}>
                              {q ? "" : `${i + 1}. `}
                              {r.label || "No name"}
                            </button>
                            <span className="muted" style={{ display: "block", fontSize: 13 }}>
                              {[r.phone, r.email, r.account ? "house account" : "", r.upcoming ? "has an order coming up" : ""].filter(Boolean).join(" · ")}
                            </span>
                          </td>
                          <td style={tdR}>{n}</td>
                          <td style={tdR}>{c$(spent)}</td>
                          <td style={tdR}>{n ? c$(Math.round(spent / n)) : ""}</td>
                          <td style={tdR}>{short(r.lastAt)}</td>
                          <td style={tdR}>{r.owed > 0 ? c$(r.owed) : ""}</td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={6} style={{ ...td, padding: "4px 0 12px 16px" }}>
                              <table style={{ ...table, fontSize: 13.5 }}>
                                <thead>
                                  <tr>
                                    <th style={thL}>Ordered</th>
                                    <th style={thL}>Order</th>
                                    <th style={thL}>For</th>
                                    <th style={thL}>What</th>
                                    <th style={thR}>Total</th>
                                    <th style={thR}>Owed</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {r.all.slice(0, 40).map((o) => (
                                    <tr key={o.id}>
                                      <td style={{ ...td, whiteSpace: "nowrap" }}>{short(o.createdAt)}</td>
                                      <td style={{ ...td, whiteSpace: "nowrap" }}>{o.number}</td>
                                      <td style={td}>
                                        {shortIso(o.date)}
                                        {o.occasion ? ` · ${o.occasion}` : ""}
                                        {o.recipient && o.recipient !== o.name ? ` · ${o.recipient}` : ""}
                                      </td>
                                      <td style={td}>{itemsOf(o)}</td>
                                      <td style={tdR}>{c$(Math.round(o.subtotal * 100))}</td>
                                      <td style={tdR}>{balanceCents(o) > 0 ? c$(owedNowCents(o)) : ""}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              {r.all.length > 40 && <span className="muted" style={{ fontSize: 13 }}>The newest 40 of {r.all.length} orders.</span>}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </Scroll>
          )}
        </Block>

        {data.due.length > 0 && (
          <Block title="About this time last year" note="They ordered for a date in the next six weeks a year ago, and have nothing coming up. Worth a call before the day comes round again.">
            <Rows
              rows={data.due.slice(0, 30).map(({ o, row }) => [
                `${row.label || "No name"}${row.phone ? ` · ${row.phone}` : ""}`,
                c$(Math.round(o.subtotal * 100)),
                `${shortIso(o.date)}${o.occasion ? ` · ${o.occasion}` : ""}${o.recipient && o.recipient !== o.name ? ` · for ${o.recipient}` : ""} · ${itemsOf(o)}`,
              ] as [string, string, string])}
            />
          </Block>
        )}

        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))" }}>
          <Block title="New customers" note="Their first order on file was placed in this period.">
            {data.fresh.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>None in this period.</p>
            ) : (
              <Rows rows={data.fresh.slice(0, 25).map((r) => [r.label || "No name", c$(r.everCents), `first ordered ${short(r.firstAt)} · ${r.everOrders} order${r.everOrders === 1 ? "" : "s"} on file`] as [string, string, string])} />
            )}
          </Block>
          <Block title="Regulars gone quiet" note="Two or more orders on file, none placed in the last 90 days, and nothing coming up. By what they have spent in all; worth a call or a card.">
            {data.quiet.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nobody: every regular has ordered in the last 90 days or has an order coming up.</p>
            ) : (
              <Rows rows={data.quiet.map((r) => [r.label || "No name", c$(r.everCents), `${r.everOrders} orders · last ordered ${short(r.lastAt)}${r.phone ? ` · ${r.phone}` : ""}${r.email ? ` · ${r.email}` : ""}`] as [string, string, string])} />
            )}
          </Block>
          <Block title="Where the flowers go" note="The places delivered to most in this period: funeral homes, hospitals, churches, offices. By the Company or place line on the order.">
            {data.places.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No delivery in this period named a place.</p>
            ) : (
              <Rows rows={data.places.map((p) => [p.label, c$(p.cents), `${p.count} deliver${p.count === 1 ? "y" : "ies"}`] as [string, string, string])} />
            )}
          </Block>
        </div>
      </div>
      <p className="muted" style={{ margin: "14px 0 0", fontSize: 13 }}>
        From the orders on the board, which go back {HISTORY_DAYS} days at most; older history is not counted. A customer is their business when they have one, otherwise their phone number, otherwise their name. The period is when the order was placed.
      </p>
    </div>
  );
}
