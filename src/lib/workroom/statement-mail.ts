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
export type StatementRow = { date: string; number: string; items: string; owed: string };

export async function sendStatement(s: {
  to: string;
  name: string;
  company: string;
  rows: StatementRow[];
  balance: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const mail = shopMail();
  if (!mail) return { ok: false, error: "The shop's email is not set up on the server, so nothing was sent." };
  const who = [s.name, s.company].filter(Boolean).join(", ");
  // "October 21, 2026", as the receipts say it, when the row's date is ISO.
  const day = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : d);
  const asOf = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const text = [
    `${site.name}`,
    `Statement for ${who}`,
    `As of ${asOf}`,
    "",
    ...s.rows.map((r) => `${day(r.date)}  ${r.number}  ${r.items}  ${r.owed}`),
    "",
    `Balance due: ${s.balance}`,
    "",
    `Checks can be mailed to ${mailTo}.`,
    `Questions: ${site.phone}. Thank you.`,
  ].join("\n");
  const table = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${s.rows
    .map(
      (r) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #e2dacc;font:14px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#211b15;white-space:nowrap;vertical-align:top;">${esc(day(r.date))}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #e2dacc;font:14px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#211b15;vertical-align:top;">${esc(r.number)}<br><span style="color:#6b6058;">${esc(r.items)}</span></td>` +
        `<td align="right" style="padding:8px 0;border-bottom:1px solid #e2dacc;font:14px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#211b15;white-space:nowrap;vertical-align:top;">${esc(r.owed)}</td></tr>`,
    )
    .join("")}<tr><td colspan="2" style="padding:12px 0 0;font:700 15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#211b15;">Balance due</td><td align="right" style="padding:12px 0 0;font:700 15px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#211b15;">${esc(s.balance)}</td></tr></table>`;
  try {
    await mail.transport.sendMail({
      from: mail.from,
      to: s.to,
      replyTo: mail.replyTo,
      subject: `Statement from ${site.shortName}: ${s.balance} due`,
      text,
      html: shell({
        title: `Statement from ${site.shortName}`,
        heading: "Your statement.",
        intro: `For ${esc(who)}, as of ${esc(asOf)}. These are the orders on your account that are still open.`,
        sections: [block("Open orders", table), block("To pay by check", `Make it out to <strong>${esc(site.mailing.name)}</strong> and mail it to<br>${esc(site.mailing.street)}, ${esc(site.mailing.city)}, ${esc(site.mailing.state)} ${esc(site.mailing.zip)}`)],
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
