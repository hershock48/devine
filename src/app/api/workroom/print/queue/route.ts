import { NextResponse } from "next/server";
import { headerPinOk, isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, type WorkroomOrder } from "@/lib/workroom/store";
import { layoutFor, renderBatchPdf } from "@/lib/workroom/print-pdf";

/**
 * THE PRINT QUEUE (2026-10-12): website orders from the last three days
 * that nothing has printed yet. Two readers:
 *
 *   the board's morning banner, which lists them and offers one PDF per
 *   paper (GET ?paper=forms|plain, every order that wants that paper as
 *   one document, a page each), then POST { ids } once it is opened;
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

const paperOf = (o: WorkroomOrder) => (layoutFor(o) === "sheet" ? "forms" : "plain");

async function unprinted() {
  const since = Date.now() - WINDOW_MS;
  return (await getStore().listOrders(3))
    .filter((o) => o.source === "web" && !o.printedAt && o.createdAt >= since && o.status !== "canceled")
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function GET(req: Request) {
  if (!(await isWorkroomAuthed()) && !headerPinOk(req)) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const paper = new URL(req.url).searchParams.get("paper");
  const orders = await unprinted();
  if (paper === "forms" || paper === "plain") {
    const batch = orders.filter((o) => paperOf(o) === paper);
    if (batch.length === 0) return NextResponse.json({ error: "Nothing waiting for that paper." }, { status: 404 });
    const pdf = await renderBatchPdf(batch.map((order) => ({ order, layout: layoutFor(order) })));
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${batch.length}-${paper === "forms" ? "order-forms" : "pickup-tickets"}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      number: o.number,
      name: o.name,
      recipient: o.recipient,
      date: o.date,
      fulfillment: o.fulfillment,
      layout: layoutFor(o),
      paper: paperOf(o),
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
  const store = getStore();
  const now = Date.now();
  let marked = 0;
  for (const id of ids) {
    const o = await store.getOrder(id);
    if (!o) continue;
    await store.patchOrder(id, { printedAt: now });
    marked += 1;
  }
  return NextResponse.json({ ok: true, marked });
}
