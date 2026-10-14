import { NextResponse } from "next/server";
import { isWorkroomAuthedOrHeader } from "@/lib/workroom/auth";
import { getStore, type WorkroomOrder } from "@/lib/workroom/store";
import { printLayoutFor, printPaperFor, waitingToPrint } from "@/lib/workroom/derive";
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

/** Opened in a tab by a button, so a refusal is a sentence, not JSON. */
const gone = (msg: string) =>
  new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Nothing to print</title>` +
      `<body style="font:16px/1.5 system-ui;padding:2rem;max-width:40rem"><p>${msg}</p><p><a href="/workroom">Back to the board</a></p>`,
    { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );

async function unprinted() {
  const now = Date.now();
  return (await getStore().listOrders(3))
    .filter((o) => waitingToPrint(o, now))
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function GET(req: Request) {
  if (!(await isWorkroomAuthedOrHeader(req))) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const url = new URL(req.url);
  const paper = url.searchParams.get("paper");
  if (paper === "forms" || paper === "plain") {
    // The banner names the ids it listed, and they only NARROW the waiting
    // set: an order that arrived between the list and the click waits for
    // the next banner rather than printing unlisted and unmarked, and one
    // another phone printed a moment ago is not printed again (the card's
    // own Print link is the reprint). Without ids (the address typed by
    // hand): whatever is waiting for that paper right now.
    const wanted = new Set((url.searchParams.get("ids") ?? "").split(",").filter(Boolean));
    const candidates = (await unprinted()).filter((o) => printPaperFor(o) === paper && (wanted.size === 0 || wanted.has(o.id)));
    const already = () =>
      gone(
        wanted.size
          ? "Those were already printed, perhaps from another phone a moment ago. Each order's own Print link on the board reprints it."
          : "Nothing is waiting for that paper.",
      );
    if (candidates.length === 0) return already();
    // Rendered FIRST, claimed second: a render that fails marks nothing,
    // so no order can vanish from every queue without paper coming out.
    // The claim is still the store's one conditional write, so two
    // requests racing for the same orders print them once between them;
    // the loser is told, and if the two overlapped only partly, the
    // winner's document is redrawn with just the orders it won. The tab
    // opening IS the print; the card's own Print link is the reprint if
    // the dialog was cancelled.
    const printedAt = Date.now();
    const draw = (orders: WorkroomOrder[]) => renderBatchPdf(orders.map((order) => ({ order, layout: printLayoutFor(order) })), printedAt);
    let batch: WorkroomOrder[] = candidates;
    let pdf = await draw(batch);
    const claimed = new Set(await store.claimForPrint(batch.map((o) => o.id), printedAt));
    if (claimed.size === 0) return already();
    if (claimed.size !== batch.length) {
      batch = batch.filter((o) => claimed.has(o.id));
      pdf = await draw(batch);
    }
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
  if (!(await isWorkroomAuthedOrHeader(req))) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { id?: unknown; ids?: unknown };
  const ids = [
    ...(typeof p.id === "string" && p.id ? [p.id] : []),
    ...(Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === "string" && !!x) : []),
  ].slice(0, 200);
  if (ids.length === 0) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const marked = (await getStore().claimForPrint(ids, Date.now())).length;
  return NextResponse.json({ ok: true, marked });
}
