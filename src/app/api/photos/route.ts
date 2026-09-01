import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { getStore } from "@/lib/workroom/store";
import { neededSlugs } from "@/lib/photos";
import { bySlug } from "@/lib/catalog";

export const runtime = "nodejs";

/**
 * The owner's photo drop. POST receives one downscaled JPEG as a data URL,
 * emails it to Kevin, and records the slug as submitted so /photos can show
 * her a checkmark from any device.
 *
 * THE EMAIL IS THE DELIVERY; the database row is only the ledger. A database
 * this small should not hold megabytes of image, and Kevin's inbox is where
 * the photos are matched to the site anyway (the /photos page tells her
 * matching is his job). So: no SMTP configured means the drop is honestly
 * CLOSED (503, and the page says to text him instead), never a silent
 * swallow. A ledger write that fails after a successful send is logged and
 * tolerated: the photo reached a person, which is the part that matters.
 *
 * No PIN on this page, deliberately: it is for the owner, who has no login,
 * and the worst an abuser can do is email Kevin pictures. The throttle keeps
 * that boring: 40 posts per 10 minutes per IP covers her biggest batch and
 * starves a script.
 */

/*
  100, not the 40 it launched at: her real batch is 34 designs plus retakes,
  and an efficient afternoon at the camera roll can land 34 uploads inside
  ten minutes — throttling the OWNER mid-batch is the one failure this page
  must never have. 100 emailed images per 10 minutes per IP is still a
  boring haul for an abuser.
*/
const LIMIT = 100;
const WINDOW_MS = 10 * 60 * 1000;
/** ~3.5MB decoded. The client downscales to well under this; anything bigger
    is not one of our uploads. Vercel's own request cap is 4.5MB. */
const MAX_DATAURL_CHARS = 4_800_000;

function throttled(ip: string): boolean {
  const g = globalThis as typeof globalThis & { __devinePhotoBuckets?: Map<string, { n: number; resetAt: number }> };
  if (!g.__devinePhotoBuckets) g.__devinePhotoBuckets = new Map();
  const now = Date.now();
  const b = g.__devinePhotoBuckets.get(ip);
  if (!b || now > b.resetAt) {
    g.__devinePhotoBuckets.set(ip, { n: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.n += 1;
  return b.n > LIMIT;
}

export async function GET() {
  const store = getStore();
  const subs = await store.listPhotoSubmissions().catch(() => []);
  return NextResponse.json({
    backend: store.backend,
    mailReady: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
    submitted: subs.map((s) => s.slug),
  });
}

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (throttled(ip)) {
    return NextResponse.json({ error: "Too many uploads at once. Give it ten minutes and try again." }, { status: 429 });
  }

  let body: { slug?: unknown; filename?: unknown; dataUrl?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "That upload did not come through. Try again." }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug : "";
  const product = bySlug.get(slug);
  // Any catalog product that still needs a photo is accepted; the tiers are
  // presentation, not permission.
  if (!product || !neededSlugs().has(slug)) {
    return NextResponse.json({ error: "That design is not on the list (it may already have its photo)." }, { status: 400 });
  }

  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m || dataUrl.length > MAX_DATAURL_CHARS) {
    return NextResponse.json(
      { error: "That photo could not be read. Try again, or just text it to Kevin." },
      { status: 400 },
    );
  }
  const jpeg = Buffer.from(m[1], "base64");
  const filename =
    (typeof body.filename === "string" ? body.filename : "").replace(/[^\w.\- ]/g, "").slice(0, 80) || `${slug}.jpg`;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    console.log(`[devine] photo for ${slug} NOT emailed: SMTP incomplete.`);
    return NextResponse.json(
      { error: "The photo drop is not connected to a mailbox yet. Text the photo to Kevin instead." },
      { status: 503 },
    );
  }

  const to = process.env.PHOTO_TO || "kevin@glazedweb.com";
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
      subject: `Photo: ${product.name} (${slug})`,
      text: `One product photo from the DeVine's photo drop.\n\nDesign: ${product.name}\nSlug: ${slug}\nOriginal file: ${filename}\nSize as sent: ${Math.round(jpeg.length / 1024)}KB\n\nDrop it in public/img/product/${slug}.webp (convert + manifest) and its row leaves /photos on the next deploy.`,
      attachments: [{ filename: `${slug}.jpg`, content: jpeg, contentType: "image/jpeg" }],
    });
  } catch (err) {
    console.error(`[devine] photo for ${slug} send FAILED:`, err);
    return NextResponse.json(
      { error: "The photo did not send. Try again in a minute, or text it to Kevin." },
      { status: 502 },
    );
  }

  const store = getStore();
  let submitted: string[] = [];
  try {
    await store.upsertPhotoSubmission({
      slug,
      name: product.name,
      filename,
      bytes: jpeg.length,
      createdAt: Date.now(),
    });
    submitted = (await store.listPhotoSubmissions()).map((s) => s.slug);
  } catch (err) {
    // The photo is already in Kevin's inbox; a ledger miss only costs a
    // checkmark. Say so in the log, not to her.
    console.error(`[devine] photo ledger write failed for ${slug}:`, err);
    submitted = [slug];
  }

  // When the last needed design lands, Kevin gets one more email saying the
  // list is finished, which is the "once it's completed it can be sent to me"
  // part of the ask. Best-effort: the completion mail failing must not fail
  // the photo that triggered it.
  const remaining = [...neededSlugs()].filter((s) => !submitted.includes(s));
  if (remaining.length === 0) {
    await transport
      .sendMail({
        from: process.env.ORDER_FROM || user,
        to,
        subject: "Photo drop COMPLETE: every design on the list is in",
        text: "Every design on /photos has a submitted photograph. Match them up, run the og/product pipeline, and the page empties itself.",
      })
      .catch((err) => console.error("[devine] completion mail failed:", err));
  }

  return NextResponse.json({ ok: true, submitted, remaining: remaining.length });
}
