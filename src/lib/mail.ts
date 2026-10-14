import "server-only";

import nodemailer from "nodemailer";

/**
 * THE SHOP'S MAILBOX, once. Every email the site sends (tickets, receipts,
 * the delivered note, statements) leaves through this: the SMTP settings
 * in Vercel (her Gmail with an app password since 2026-10-14), the From
 * line (ORDER_FROM, the shop's name on her address) and the Reply-To
 * (ORDER_TO, her inbox). Null when mail is not set up, which each caller
 * says in its own words rather than failing the thing it was doing.
 */
export function shopMail(): { transport: nodemailer.Transporter; from: string; replyTo: string | undefined } | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return {
    transport: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }),
    from: process.env.ORDER_FROM || user,
    replyTo: process.env.ORDER_TO || undefined,
  };
}
