import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { agreement, money } from "@/lib/agreement";
import { getStore, newId, type AgreementAcceptance } from "@/lib/workroom/store";

/**
 * Where the acceptance lands. Clickwrap, the same mechanism as the glazedweb
 * menu-order flow: the client reads the published v1.0 terms plus the Exhibit
 * A on the page, types her name, ticks the box, and THE EMAIL IS THE RECORD.
 * Both parties get a copy carrying the version string, the exhibit, the typed
 * name and title, and the server's timestamp. The database row is the
 * queryable duplicate.
 *
 * The record goes to AGREEMENT_TO, not ORDER_TO, deliberately: ORDER_TO flips
 * to the shop's inbox at launch, and a countersignature record that suddenly
 * starts landing on the other party's desk is the wrong kind of surprise. The
 * fallback address is Kevin's, from the letter's own footer.
 *
 * Honesty states mirror the order intake: the full record is logged before
 * anything can fail, and when mail cannot be sent the page hands the visitor
 * a prefilled mailto carrying the same acceptance text rather than a false
 * "you're all set."
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function recordText(a: AgreementAcceptance): string {
  return [
    `AGREEMENT ACCEPTED`,
    ``,
    `${a.version}`,
    `${a.exhibit}`,
    ``,
    `Business:   ${a.business}`,
    `Accepted by: ${a.name}${a.title ? `, ${a.title}` : ""}`,
    `Email:      ${a.email}`,
    `Accepted at: ${a.acceptedAt} (server time)`,
    `Record id:  ${a.id}`,
    `From IP:    ${a.ip}`,
    ``,
    `Terms: ${agreement.termsUrl} (v1.0), incorporated by reference.`,
    `Exhibit A as shown at devine.glazedweb.com/agreement on the acceptance date:`,
    ``,
    `  Build fee ${money(agreement.buildFee)}, deposit ${money(agreement.deposit)} due on acceptance,`,
    `  balance on launch. Monthly service fee ${money(agreement.monthly)} from the first of the`,
    `  month after launch. Edit allowance ${agreement.editAllowance}. Additional work`,
    `  ${money(agreement.hourlyRate)}/hour, quoted and approved in advance. Remote card`,
    `  payments (phone orders keyed by the shop now, online checkout when enabled in`,
    `  writing) carry a $0.99 customer-paid order fee retained by Glazed Web; cash`,
    `  and in-person register sales never do. ${agreement.timeline}`,
    ``,
    ...agreement.scope.map((s, i) => `  Scope ${i + 1}. ${s}`),
  ].join("\n");
}

/** For a browser poke while wiring things up: says whether the pieces exist,
    never what they are. Booleans only, same shape as the square webhook GET. */
export async function GET() {
  return NextResponse.json({
    smtp: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    recordTo: process.env.AGREEMENT_TO ? "AGREEMENT_TO" : "default (kevin@glazedweb.com)",
    backend: getStore().backend,
  });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Empty submission." }, { status: 400 });
  }
  const p = (raw ?? {}) as Record<string, unknown>;

  const name = str(p.name, 120);
  const title = str(p.title, 120);
  const business = str(p.business, 160) || agreement.client;
  const email = str(p.email, 200);
  const agreed = p.agreed === true;

  if (!agreed) return NextResponse.json({ error: "The agreement box was not checked." }, { status: 400 });
  if (name.length < 2) return NextResponse.json({ error: "A full name is required." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "A working email is required; your copy of the record goes there." }, { status: 400 });
  }

  const acceptance: AgreementAcceptance = {
    id: newId("agr"),
    business,
    name,
    title,
    email,
    acceptedAt: new Date().toISOString(),
    version: agreement.version,
    exhibit: agreement.exhibit,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown",
    userAgent: str(req.headers.get("user-agent"), 300),
    createdAt: Date.now(),
  };

  const text = recordText(acceptance);
  // The log carries the whole record before anything can fail.
  console.log(`[devine] agreement acceptance ${acceptance.id}:\n${text}`);

  try {
    await getStore().addAgreementAcceptance(acceptance);
  } catch (err) {
    console.error(`[devine] acceptance ${acceptance.id} not stored (email still the record):`, err);
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const to = process.env.AGREEMENT_TO || "kevin@glazedweb.com";

  if (!host || !user || !pass) {
    console.log(`[devine] acceptance ${acceptance.id} NOT emailed: SMTP not configured.`);
    return NextResponse.json({ state: "unconfigured", record: text });
  }

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass },
  });

  try {
    // Glazed's copy decides success; it is the countersignature record.
    await transport.sendMail({
      from: process.env.ORDER_FROM || user,
      to,
      replyTo: email,
      subject: `Agreement accepted: ${business} (${agreement.version})`,
      text,
    });
  } catch (err) {
    console.error(`[devine] acceptance ${acceptance.id} send FAILED:`, err);
    return NextResponse.json({ state: "send-failed", record: text });
  }

  // The client's copy is best-effort (her acceptance already stands either
  // way) but it is AWAITED, because fire-and-forget dies on serverless: the
  // lambda freezes the moment the response returns, and the first live test
  // proved it by delivering exactly one of the two emails. The await costs a
  // second of latency; the catch keeps a failed copy from voiding anything.
  await transport
    .sendMail({
      from: process.env.ORDER_FROM || user,
      to: email,
      replyTo: to,
      subject: `Your signed copy: ${agreement.version}, ${business}`,
      text:
        `This is your record of acceptance. Keep this email.\n\n${text}\n\n` +
        `The full terms: ${agreement.termsUrl}\nPDF copy: ${agreement.pdfUrl}`,
    })
    .catch((err) => console.error(`[devine] acceptance ${acceptance.id} client copy not sent:`, err));

  return NextResponse.json({ state: "sent" });
}
