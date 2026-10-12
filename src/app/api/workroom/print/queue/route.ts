import { NextResponse } from "next/server";
import { headerPinOk, isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, type WorkroomOrder } from "@/lib/workroom/store";
import { printLayoutFor, printPaperFor } from "@/lib/workroom/derive";
import { renderBatchPdf } from "@/lib/workroom/print-pdf";

/**
 * THE PRINT QUEUE (2026-10-12): website orders from the last three days
 * that nothing has printed yet. Two readers:
 *
 *   the board's morning banner, which lists them and offers one PDF per
 *   paper (GET ?paper=forms|plain&ids=a,b,c: exactly the orders the banner
 *   showed, as one document, a page each, marked printed as the PDF goes
 *   out so the list and the pages can never disagree);
 *
 *   the optional helper on the counter PC, which asks every half minute,
 *   prints each one silently, and POSTs { id }.
 *
 * Printed state lives on the order, server-side, so a second machine, a
 * reload or a restart never prints one twice. Staff PIN as a header,
 * throttled like login, or the workroom cookie.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 3 * 86_400_000;

async function unprinted() {
  const since = Date.now() - WINDOW_MS;
  return (await getStore().listOrders(3))
    .filter((o) => o.source === "web" && !o.printedAt && o.createdAt >= since && o.status !== "canceled")
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function GET(req: Request) {
  if (!(await isWorkroomAuthed()) && !headerPinOk(req)) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const url = new URL(req.url);
  const paper = url.searchParams.get("paper");
  if (paper === "forms" || paper === "plain") {
    // The banner names the ids it listed; an order that arrived between
    // the list and the click waits for the next banner rather than
    // printing unlisted and unmarked. Without ids (the address typed by
    // hand): whatever is waiting for that paper right now.
    const wanted = (url.searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 200);
    const pool = wanted.length ? await Promise.all(wanted.map((id) => store.getOrder(id))) : await unprinted();
    const batch: WorkroomOrder[] = [];
    for (const o of pool) if (o && o.status !== "canceled" && printPaperFor(o) === paper) batch.push(o);
    if (batch.length === 0) return NextResponse.json({ error: "Nothing waiting for that paper." }, { status: 404 });
    const printedAt = Date.now();
    const pdf = await renderBatchPdf(batch.map((order) => ({ order, layout: printLayoutFor(order) })), printedAt);
    // Marked as the document leaves, in one write: the tab opening IS the
    // print; the card's own Print link is the reprint if the dialog was
    // cancelled.
    await store.markOrdersPrinted(batch.map((o) => o.id), printedAt);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${batch.length}-${paper === "forms" ? "order-forms" : "pickup-tickets"}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }
  const orders = await unprinted();
  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      name: o.name,
      recipient: o.recipient,
      date: o.date,
      fulfillment: o.fulfillment,
      layout: printLayoutFor(o),
      paper: printPaperFor(o),
      createdAt: o.createdAt,
    })),
    backend: store.backend,
  });
}

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed()) && !headerPinOk(req)) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { id?: unknown; ids?: unknown };
  const ids = [
    ...(typeof p.id === "string" && p.id ? [p.id] : []),
    ...(Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === "string" && !!x) : []),
  ].slice(0, 200);
  if (ids.length === 0) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const marked = await getStore().markOrdersPrinted(ids, Date.now());
  return NextResponse.json({ ok: true, marked });
}
