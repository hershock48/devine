import { NextResponse } from "next/server";
import { site } from "@/lib/site";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { resolveSquare } from "@/lib/square/oauth";
import { fulfillPayment, gatewayIdentity, paymentFingerprint, pendingMessage, settledPayment, takePayment } from "@/lib/square/payment-service";
import { getStore, type WorkroomLine } from "@/lib/workroom/store";

/** Signed workroom session; all payment methods share one durable order lock. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Empty request." }, { status: 400 });
  }
  const p = (raw ?? {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id : "";
  const method = p.method === "card" || p.method === "cash" || p.method === "manual" ? p.method : null;
  const sourceId = typeof p.sourceId === "string" ? p.sourceId : undefined;

  if (!id || !method) return NextResponse.json({ error: "Order id and method are required." }, { status: 400 });
  if (method === "card" && !sourceId) return NextResponse.json({ error: "No card token arrived." }, { status: 400 });

  const store = getStore();
  const order = await store.getOrder(id);
  if (!order) return NextResponse.json({ error: "No such order." }, { status: 404 });
  if (order.status === "canceled") return NextResponse.json({ error: "That order is canceled." }, { status: 409 });
  if (order.payment) {
    return NextResponse.json({ error: `Already paid (${order.payment.method}).` }, { status: 409 });
  }

  /*
    THE DELIVERY FEE RIDES EVERY DELIVERY CHARGE, whichever side takes it.
    Found via Kevin's own test ticket: an unpaid web delivery carried only
    its flower lines, so the workroom's Take-card would have quietly
    undercharged by the fee on every phoned-in delivery while the online
    checkout charged it correctly. If the ticket has no delivery line yet
    and the zip is on her sheet, one is appended (and persisted on
    success, so the ticket's rows agree with its payment). A zip off the
    sheet charges the lines as they stand; that fee is the confirm call's
    business, the way it always was.
  */
  const hasDeliveryLine = order.lines.some((l) => l.name.startsWith("Delivery ("));
  const zipFee = order.fulfillment === "delivery" && !hasDeliveryLine ? site.deliveryFees[order.zip] : undefined;
  const lines: WorkroomLine[] =
    zipFee !== undefined
      ? [...order.lines, { slug: null, name: `Delivery (${order.zip})`, qty: 1, each: zipFee }]
      : order.lines;
  const subtotal = zipFee !== undefined ? Math.round((order.subtotal + zipFee) * 100) / 100 : order.subtotal;

  const cfg = method === "manual" ? null : await resolveSquare();
  if (method !== "manual" && !cfg) return NextResponse.json({ error: "Square is not connected." }, { status: 503 });
  const key = `board_${order.id}`;
  const cardFee = { name: `Card fee (${site.cardFeePct}%)`, cents: method === "card" ? Math.round((Math.round(subtotal * 100) * site.cardFeePct) / 100) : 0, appFeeCents: 0 };
  try {
    const outcome = await takePayment(key, paymentFingerprint({ id: order.id, lines, method, cardFee }), {
      order: { ...order, lines, subtotal }, method, gateway: cfg ? gatewayIdentity(cfg) : null, cardFee,
    }, sourceId);
    if (outcome.kind !== "completed") return NextResponse.json({ error: outcome.kind === "failed" ? "Square confirmed the attempt failed. Review it under Payment recovery." : pendingMessage, pending: true }, { status: 409 });
    await fulfillPayment(key);
    return NextResponse.json({ ok: true, payment: settledPayment(outcome.attempt), receiptUrl: outcome.attempt.result?.receiptUrl });
  } catch {
    return NextResponse.json({ pending: true, error: pendingMessage }, { status: 503 });
  }
}
