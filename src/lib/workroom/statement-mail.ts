import "server-only";

import { site } from "@/lib/site";
import { shopMail } from "@/lib/mail";
import { block, esc, logoAttachment, phoneLink, shell } from "@/lib/email-html";

/** "DeVine Ventures LLC, 810 Industrial Dr, Marshall, MI 49068": the one
    email that says this address, because this is the one that asks for
    a check (Kevin, 2026-10-14). */
const mailTo = `${site.mailing.name}, ${site.mailing.street}, ${site.mailing.city}, ${site.mailing.state} ${site.mailing.zip}`;

/**
 * A HOUSE-ACCOUNT STATEMENT, sent from the shop's own mailbox (Kevin,
 * 2026-10-14: the mailto link opened whatever mail app Windows had, and
 * the shop lives in Gmail). The Accounts tab posts the rows it shows; this
 * sends them, branded like every other email, with the shop's number to
 * reply to. Best-effort like the receipts: unconfigured mail is an error
 * the tab shows, never a silent nothing.
 */
/** `number` is the shop's own order number and `po` the customer's purchase
    order number. Both are named on every statement and invoice (Katy,
    2026-11-19: "I need the PO and our DeVine's order number to be on all
    statements. That way when the customer gets the statement they can
    match it up on their end. This is a big deal with FireKeepers."). They
    were there before, but unlabeled, with the PO at the tail of the item
    text; now every row names each of them. */
export type StatementRow = { date: string; number: string; po?: string; items: string; owed: string };

export async function sendStatement(s: {
  to: string;
  name: string;
  /** The business the account belongs to, when there is one. */
  business?: string;
  company: string;
  rows: StatementRow[];
  balance: string;
  /** "invoice": ONE order, billed on its own (Katy, 2026-10-29: Gina at
      Kempf's asked for an invoice for just the Ward White service). Same
      email, same rows; the words say one order, not the whole account. */
  kind?: "statement" | "invoice";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const mail = shopMail();
  if (!mail) return { ok: false, error: "The shop's email is not set up on the server, so nothing was sent." };
  const invoice = s.kind === "invoice" && s.rows.length === 1;
  const who = [s.business, s.name, s.company].filter(Boolean).join(", ");
  // "October 21, 2026", as the receipts say it, when the row's date is ISO.
  const day = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : d);
  const asOf = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  // The table's date, short, so four columns fit a phone.
  const dayShort = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : d);
  const po = (r: StatementRow) => (r.po ?? "").trim();
  const text = [
    `${site.name}`,
    invoice ? `Invoice for ${who}: order no. ${s.rows[0].number}${po(s.rows[0]) ? `, PO no. ${po(s.rows[0])}` : ""}` : `Statement for ${who}`,
    `As of ${asOf}`,
    "",
    ...s.rows.map((r) => `${day(r.date)}  Order no. ${r.number}${po(r) ? `  PO no. ${po(r)}` : ""}  ${r.items}  ${r.owed}`),
    "",
    `Balance due: ${s.balance}`,
    "",
    `Checks can be mailed to ${mailTo}.`,
    `Questions: ${site.phone}. Thank you.`,
  ].join("\n");
  // Each row says both numbers by name, one under the other: "Order no."
  // is ours, "PO no." is the customer's own. Stacked, not side by side,
  // because a fourth column does not fit a phone and a long PO broke
  // across three lines there (rendered and looked at, 2026-11-19).
  const cell = `border-bottom:1px solid #e2dacc;font:14px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#211b15;vertical-align:top;`;
  const head = `border-bottom:2px solid #211b15;font:700 11.5px/1.3 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#6b6058;text-transform:uppercase;letter-spacing:0.06em;text-align:left;vertical-align:bottom;`;
  const table =
    `<table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">` +
    `<tr><th scope="col" style="padding:0 0 6px;${head}">Date</th><th scope="col" style="padding:0 12px 6px;${head}">Order</th><th scope="col" align="right" style="padding:0 0 6px;${head}text-align:right;">Owed</th></tr>` +
    s.rows
      .map(
        (r) =>
          `<tr><td style="padding:8px 0;white-space:nowrap;${cell}">${esc(dayShort(r.date))}</td>` +
          `<td style="padding:8px 12px;word-break:break-word;${cell}">Order no. <strong style="white-space:nowrap;">${esc(r.number)}</strong>` +
          (po(r) ? `<br>PO no. <strong>${esc(po(r))}</strong>` : "") +
          `<br><span style="color:#6b6058;">${esc(r.items)}</span></td>` +
          `<td align="right" style="padding:8px 0;white-space:nowrap;${cell}">${esc(r.owed)}</td></tr>`,
      )
      .join("") +
    `<tr><td colspan="2" style="padding:12px 0 0;font:700 15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#211b15;">Balance due</td><td align="right" style="padding:12px 0 0;font:700 15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#211b15;white-space:nowrap;">${esc(s.balance)}</td></tr></table>`;
  try {
    await mail.transport.sendMail({
      from: mail.from,
      to: s.to,
      replyTo: mail.replyTo,
      subject: invoice ? `Invoice from ${site.shortName}: order ${s.rows[0].number}${po(s.rows[0]) ? `, PO ${po(s.rows[0])}` : ""}, ${s.balance} due` : `Statement from ${site.shortName}: ${s.balance} due`,
      text,
      html: shell({
        title: `${invoice ? "Invoice" : "Statement"} from ${site.shortName}`,
        heading: invoice ? "Your invoice." : "Your statement.",
        intro: invoice
          ? `For ${esc(who)}, as of ${esc(asOf)}. This invoice covers one order only.`
          : `For ${esc(who)}, as of ${esc(asOf)}. These are the orders on your account that are still open.`,
        sections: [block(invoice ? "The order" : "Open orders", table), block("To pay by check", `Make it out to <strong>${esc(site.mailing.name)}</strong> and mail it to<br>${esc(site.mailing.street)}, ${esc(site.mailing.city)}, ${esc(site.mailing.state)} ${esc(site.mailing.zip)}`)],
        outro: `Questions, or to settle up by card: call the shop at ${phoneLink()}. Thank you for your business.`,
        addressLine: mailTo,
      }),
      attachments: [logoAttachment()],
    });
    return { ok: true };
  } catch (err) {
    console.error(`[devine] statement to ${s.to} not sent:`, err);
    return { ok: false, error: "The shop's mailbox refused the send. Try again in a minute, or copy the statement and send it by hand." };
  }
}
