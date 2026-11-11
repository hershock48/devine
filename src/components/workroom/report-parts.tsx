"use client";

import { money } from "@/components/workroom/ui";

/**
 * What the report sheets share (Reports.tsx, ReportsCustomers.tsx): the
 * order as the sheets read it, the small table parts, and the CSV download.
 * One copy, so the day sheet, the month sheet and the customer sheet look
 * and add up alike.
 */

/* The order as the sheets read it is defined beside the function that
   makes it (lib/workroom/report-rows.ts), so the server's rows and the
   sheets' type are one thing. */
export type { ReportLine, ReportOrder, ReportPayment, ReportSale } from "@/lib/workroom/report-rows";

/** Cents as dollars; a negative figure reads "−$8.95", not "$-8.95". */
export const c$ = (cents: number) => (cents < 0 ? `−${money(-cents / 100)}` : money(cents / 100));
/** A local Date at noon on an ISO day, for labels (never UTC midnight,
    which is the evening before in Marshall). */
export const dayAt = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
};
/** Who an order is for, as every sheet names them. */
export const whoOf = (o: { business?: string; name: string; quick?: boolean }) => (o.quick ? "Quick sale" : o.business ? `${o.business}${o.name ? ` · ${o.name}` : ""}` : o.name || "No name");

export const kicker: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 6px" };
export const table: React.CSSProperties = { borderCollapse: "collapse", width: "100%", fontSize: 14.5 };
export const td: React.CSSProperties = { padding: "5px 8px 5px 0", borderBottom: "1px solid var(--line)", overflowWrap: "anywhere" };
export const tdR: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
export const tdTotal: React.CSSProperties = { ...td, fontWeight: 700, borderBottom: 0 };
export const tdTotalR: React.CSSProperties = { ...tdR, fontWeight: 700, borderBottom: 0 };
export const thL: React.CSSProperties = { ...td, ...kicker, textAlign: "left", fontSize: 12, margin: 0 };
export const thR: React.CSSProperties = { ...tdR, ...kicker, fontSize: 12, margin: 0 };

export function Rows({ rows, total }: { rows: [string, string, string?][]; total?: [string, string] }) {
  return (
    <table style={table}>
      <tbody>
        {rows.map(([k, v, sub], i) => (
          <tr key={i}>
            <td style={td}>
              {k}
              {sub ? <span className="muted" style={{ display: "block", fontSize: 13 }}>{sub}</span> : null}
            </td>
            <td style={tdR}>{v}</td>
          </tr>
        ))}
        {total && (
          <tr>
            <td style={tdTotal}>{total[0]}</td>
            <td style={tdTotalR}>{total[1]}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/** `wide` spans the sheet's two columns: the tables that need the room. */
export function Block({ title, children, note, wide }: { title: string; children: React.ReactNode; note?: string; wide?: boolean }) {
  return (
    <section className="panel" style={{ padding: 16, breakInside: "avoid", minWidth: 0, ...(wide ? { gridColumn: "1 / -1" } : {}) }}>
      <h2 style={{ ...kicker, margin: "0 0 10px" }}>{title}</h2>
      {children}
      {note && <p className="muted" style={{ margin: "10px 0 0", fontSize: 13 }}>{note}</p>}
    </section>
  );
}

/** A wide table scrolls inside its own block on a phone instead of
    widening the page; reachable by keyboard, named for a screen reader. */
export function Scroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} style={{ overflowX: "auto" }}>
      {children}
    </div>
  );
}

/** The few figures a sheet leads with. */
export function Tiles({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", margin: "0 0 14px" }}>
      {items.map((t) => (
        <div key={t.label} className="panel" style={{ padding: "12px 14px", breakInside: "avoid" }}>
          <p style={{ ...kicker, margin: "0 0 4px" }}>{t.label}</p>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{t.value}</p>
          {t.sub ? <p className="muted" style={{ margin: "2px 0 0", fontSize: 13 }}>{t.sub}</p> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * A SHEET AS A SPREADSHEET FILE, for the bookkeeper. Made in the browser
 * from what is already on the screen; nothing is sent anywhere. Opens in
 * Excel as it is (the leading mark tells Excel the text is UTF-8). A cell
 * that starts like a formula is written as text, so a customer's name
 * cannot be run by a spreadsheet.
 */
export function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    if (typeof v === "number") return String(v);
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = String.fromCharCode(0xfeff) + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
/** Cents as a plain number for a spreadsheet cell. */
export const csv$ = (cents: number) => Number((cents / 100).toFixed(2));
