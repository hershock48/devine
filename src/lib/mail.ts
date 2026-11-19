import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

/**
 * THE SHOP'S MAILBOX, once. Every email the site sends (tickets, receipts,
 * the delivered note, statements) leaves through this: the SMTP settings
 * in Vercel (her Gmail with an app password since 2026-10-14), the From
 * line (ORDER_FROM, the shop's name on her address) and the Reply-To
 * (ORDER_TO, her inbox). Null when mail is not set up, which each caller
 * says in its own words rather than failing the thing it was doing.
 */
export function shopMail(): { transport: Transporter; from: string; replyTo: string | undefined } | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  return {
    // Bounded (2026-11-19): nodemailer's own limits are two minutes to
    // connect and ten on the socket, and every send here is awaited by a
    // request someone is watching (a Delivered tap, a statement).
    transport: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 }),
    from: process.env.ORDER_FROM || user,
    replyTo: process.env.ORDER_TO || undefined,
  };
}
