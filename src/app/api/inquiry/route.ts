import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { site } from "@/lib/site";
import { getStore, newId, type Quote } from "@/lib/workroom/store";

/**
 * The site's two business inquiries, landed for real: the wedding form and
 * the greening brief. Both were honest mailto handoffs while no SMTP
 * existed; SMTP exists now, so the email to the shop is sent server-side
 * with the same honesty states as the order intake (sent means sent;
 * anything else the form tells the visitor plainly and hands back the
 * mailto that always worked).
 *
 * A sent WEDDING inquiry also seeds a draft quote on /workroom/quotes with
 * the couple's details, because the owner's own process turns every
 * inquiry into a quote and the builder should not start blank. Best
 * effort: a quote miss is a log line; the email is the record. The
 * provisional dials (markup x3, labor 25%) are the quote model's own
 * stand-ins. Greening seeds nothing; it is recurring service work with no
 * workroom shape yet.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

export async function POST(req: Request) {
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ ok: false, error: "That did not look like an inquiry." }, { status: 400 });

  const kind = p.kind === "greening" ? "greening" : "wedding";
  const email = str(p.email, 200);
  if (!emailOk(email)) {
    return NextResponse.json({ ok: false, error: "A working email is required." }, { status: 400 });
  }

  let subject = "";
  let body = "";
  let quote: Quote | null = null;

  if (kind === "wedding") {
    const name = str(p.name, 120);
    const phone = str(p.phone, 40);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(str(p.date, 10)) ? str(p.date, 10) : "";
    const venue = str(p.venue, 200);
    const guests = str(p.guests, 20);
    const vision = str(p.vision, 4000);
    if (name.length < 2) return NextResponse.json({ ok: false, error: "A name is required." }, { status: 400 });

    subject = `Wedding inquiry: ${name}${date ? `, ${date}` : ""}`;
    body = [
      "WEDDING INQUIRY", "",
      `From: ${name}`,
      `Email: ${email}`,
      phone ? `Phone: ${phone}` : null,
      date ? `Wedding date: ${date}` : "Wedding date: (not set yet)",
      venue ? `Venue: ${venue}` : null,
      guests ? `Guest count: ${guests}` : null,
      "",
      vision ? `Their vision:\n${vision}` : "(no vision notes typed)",
      "",
      "A draft quote with these details is waiting on the workroom's Quotes tab.",
    ].filter((l): l is string => l !== null).join("\n");

    const now = Date.now();
    quote = {
      id: newId("q"),
      kind: "wedding",
      status: "draft",
      clientName: name,
      phone,
      email,
      eventDate: date,
      venue,
      notes: [guests ? `${guests} guests` : null, vision ? `Their vision: ${vision}` : null, "From the website's wedding inquiry."]
        .filter((l): l is string => l !== null)
        .join("\n"),
      flowers: [],
      pieces: [],
      markup: 3,
      laborPct: 25,
      delivery: 0,
      setup: 0,
      createdAt: now,
      updatedAt: now,
    };
  } else {
    const business = str(p.business, 160);
    const contact = str(p.contact, 120);
    const space = str(p.space, 200);
    const size = str(p.size, 200);
    const locations = str(p.locations, 20);
    const light = str(p.light, 40);
    if (business.length < 2 || contact.length < 2) {
      return NextResponse.json({ ok: false, error: "A business name and a contact name are required." }, { status: 400 });
    }
    subject = `Greening brief: ${business}`;
    body = [
      "GREENING BRIEF", "",
      `Business: ${business}`,
      `Contact: ${contact}`,
      `Email: ${email}`,
      space ? `Space: ${space}` : null,
      size ? `Size: ${size}` : null,
      locations ? `Locations: ${locations}` : null,
      light ? `Natural light: ${light}` : null,
      "",
      "Photos, if any, arrive separately; the form asks them to email or bring them up on the call.",
    ].filter((l): l is string => l !== null).join("\n");
  }

  // The log carries the whole inquiry before anything can fail.
  console.log(`[devine] ${subject}:\n${body}`);

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  /*
    Inquiries are HER leads, not order tickets, so they go to the shop's
    own published inbox by default (Kevin's ruling, 2026-09-01), not to
    the ORDER_TO catch-all. INQUIRY_TO overrides for QA, so test
    submissions during a build session do not land in her real business
    Gmail; unset it and the default is the shop.
  */
  const to = process.env.INQUIRY_TO?.trim() || site.email;
  if (!host || !user || !pass || !to) {
    return NextResponse.json({ ok: false, reason: "unconfigured" }, { status: 503 });
  }

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user, pass },
  });
  try {
    await transport.sendMail({
      from: process.env.ORDER_FROM || user,
      to,
      replyTo: email,
      subject,
      text: body,
    });
  } catch (err) {
    console.error(`[devine] ${subject} send FAILED:`, err);
    return NextResponse.json({ ok: false, reason: "send-failed" }, { status: 502 });
  }

  if (quote) {
    try {
      await getStore().upsertQuote(quote);
    } catch (err) {
      console.error(`[devine] ${subject}: draft quote not created (email is the record)`, err);
    }
  }

  return NextResponse.json({ ok: true });
}
