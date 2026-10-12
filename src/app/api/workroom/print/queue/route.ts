import { NextResponse } from "next/server";
import { headerPinOk, isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";
import { layoutFor } from "@/lib/workroom/print-pdf";

/**
 * THE PRINT QUEUE (2026-10-12): what the helper on the counter PC asks
 * every half minute. GET lists website orders from the last three days
 * that nothing has printed yet, each with the layout and paper it wants;
 * POST { id } marks one printed, so a second helper or a restart never
 * prints it again. Printed state lives on the order, server-side, not in a
 * browser: the whole point is that nobody is at the screen overnight.
 * Staff PIN as a header, throttled like login, or the workroom cookie.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 3 * 86_400_000;

export async function GET(req: Request) {
  if (!(await isWorkroomAuthed()) && !headerPinOk(req)) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const since = Date.now() - WINDOW_MS;
  const orders = (await store.listOrders(3))
    .filter((o) => o.source === "web" && !o.printedAt && o.createdAt >= since && o.status !== "canceled")
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((o) => ({
      id: o.id,
      number: o.number,
      fulfillment: o.fulfillment,
      layout: layoutFor(o),
      paper: layoutFor(o) === "sheet" ? "forms" : "plain",
      createdAt: o.createdAt,
    }));
  return NextResponse.json({ orders, backend: store.backend });
}

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed()) && !headerPinOk(req)) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { id?: unknown };
  if (typeof p.id !== "string" || !p.id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const store = getStore();
  const o = await store.getOrder(p.id);
  if (!o) return NextResponse.json({ error: "No such order." }, { status: 404 });
  await store.patchOrder(p.id, { printedAt: Date.now() });
  return NextResponse.json({ ok: true });
}
