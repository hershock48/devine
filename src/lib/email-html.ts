import "server-only";
import { site, addressOneLine } from "@/lib/site";
import { money } from "@/lib/catalog";
import { LOGO_PNG_BASE64 } from "@/lib/workroom/logo-png";

/**
 * THE BRANDED EMAIL (Kevin, 2026-10-13): the customer's copy of an order,
 * the phone-order receipt and the delivered note share one shell: the
 * shop's mark, the address line, a heading, a short paragraph, the order
 * as a tidy table, and the phone number at the foot. Tables and inline
 * styles because mail clients have not moved since 2005; the logo rides
 * along as an inline attachment (cid:) so nothing depends on a host being
 * up or a client fetching remote images. Every send still carries the
 * plain-text version as the alternative, which is also what the shop's
 * own ticket stays as.
 */

const INK = "#211b15";
const MUTED = "#6b6058";
const LINE = "#e2dacc";
const PAPER = "#faf7f1";
const PAPER_2 = "#f3ede1";
const GREEN = "#37543c";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export const LOGO_CID = "devines-logo";
/** Decoded once at module load, not once per email. */
const LOGO_BUF = Buffer.from(LOGO_PNG_BASE64, "base64");

/** nodemailer attachment for the mark; one per message. */
export const logoAttachment = () => ({
  filename: "devines.png",
  content: LOGO_BUF,
  contentType: "image/png",
  cid: LOGO_CID,
});

/** "Friday, October 16", from the order's ISO date, on no clock in
    particular: a date, not an instant. */
export const longDay = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

/** The shop's number as a tap-to-call link in the palette. */
export const phoneLink = () =>
  `<a href="${esc(site.phoneHref)}" style="color:${GREEN};font-weight:600;text-decoration:none;">${esc(site.phone)}</a>`;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Multi-line text into escaped HTML with <br>, for card messages and notes. */
const para = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

export type MoneyRow = { label: string; value: string; strong?: boolean; muted?: boolean };

/** The order as a table: one row per line, then the money rows. */
export function orderTable(lines: { qty: number; name: string; total: number }[], rows: MoneyRow[]): string {
  const items = lines
    .map(
      (l) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid ${LINE};font:15px/1.4 ${SANS};color:${INK};">${l.qty} &times; ${esc(l.name)}</td>
        <td align="right" style="padding:8px 0 8px 16px;border-bottom:1px solid ${LINE};font:15px/1.4 ${SANS};color:${INK};white-space:nowrap;">${money(l.total)}</td>
      </tr>`,
    )
    .join("");
  const sums = rows
    .map(
      (r) => `
      <tr>
        <td style="padding:${r.strong ? "10px 0 0" : "6px 0 0"};font:${r.strong ? "700 " : ""}15px/1.4 ${SANS};color:${r.muted ? MUTED : INK};">${esc(r.label)}</td>
        <td align="right" style="padding:${r.strong ? "10px 0 0" : "6px 0 0"} 0 0 16px;font:${r.strong ? "700 " : ""}15px/1.4 ${SANS};color:${r.muted ? MUTED : INK};white-space:nowrap;">${esc(r.value)}</td>
      </tr>`,
    )
    .join("");
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${items}
      ${sums}
    </table>`;
}

/** A labelled block: "Pickup", "Delivery", "Card message", "Notes". */
export function block(label: string, body: string): string {
  return `
    <tr>
      <td style="padding:18px 28px 0;">
        <div style="font:700 11px/1.4 ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${MUTED};">${esc(label)}</div>
        <div style="padding-top:4px;font:15px/1.6 ${SANS};color:${INK};">${body}</div>
      </td>
    </tr>`;
}

/** The shell. `sections` are <tr> rows already; `intro` and `outro` are HTML. */
export function shell(opts: { title: string; heading: string; intro: string; sections: string[]; outro?: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="light">
<title>${esc(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:${PAPER_2};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER_2};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${PAPER};border:1px solid ${LINE};">
        <tr>
          <td align="center" style="padding:28px 28px 6px;">
            <img src="cid:${LOGO_CID}" width="210" alt="${esc(site.name)}" style="display:block;width:210px;max-width:100%;height:auto;border:0;">
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:0 28px;font:13px/1.5 ${SANS};color:${MUTED};">${esc(addressOneLine)} &nbsp;&middot;&nbsp; ${esc(site.phone)}</td>
        </tr>
        <tr>
          <td style="padding:26px 28px 0;font:26px/1.25 ${SERIF};color:${INK};">${esc(opts.heading)}</td>
        </tr>
        <tr>
          <td style="padding:10px 28px 0;font:15px/1.6 ${SANS};color:${INK};">${opts.intro}</td>
        </tr>
        ${opts.sections.join("\n")}
        <tr>
          <td style="padding:22px 28px 0;">
            <div style="border-top:1px solid ${LINE};"></div>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 28px;font:14px/1.6 ${SANS};color:${MUTED};">
            ${opts.outro ?? `Questions or changes: call the shop at ${phoneLink()}.`}
            <br>${esc(site.name)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** The tidy version of a card message or note, or nothing. */
export const textBlock = (label: string, s: string) => (s.trim() ? block(label, para(s.trim())) : "");

export { para };
