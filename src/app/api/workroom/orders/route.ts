import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, newId, type OrderStatus, type WorkroomLine, type WorkroomOrder } from "@/lib/workroom/store";
import { bySlug } from "@/lib/catalog";

/**
 * The board's orders. GET lists the last 60 days (a wedding sits on the board
 * for weeks; a birthday for a day). POST creates a phone/walk-in order — the
 * counter's version of the web checkout. PATCH moves one along.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: OrderStatus[] = ["new", "confirmed", "made", "out", "done", "canceled"];

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const [orders, contacts] = await Promise.all([store.listOrders(60), store.listOrderContacts()]);
  // contacts spans the whole history, so "her third order this year" still
  // counts after the first two age off the 60-day board.
  return NextResponse.json({ orders, contacts, backend: store.backend });
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ error: "Malformed." }, { status: 400 });

  /*
    Catalog lines are re-priced from the catalog, same rule as the web checkout.
    Custom lines ("casket spray, $250") keep the typed price: the person typing
    is the shop, and half of what a florist sells has no catalog entry.
  */
  const lines: WorkroomLine[] = [];
  for (const l of (Array.isArray(p.lines) ? p.lines : []).slice(0, 40)) {
    if (!l || typeof l !== "object") continue;
    const raw = l as Record<string, unknown>;
    const qty = Math.min(99, Math.max(1, Math.round(Number(raw.qty) || 1)));
    const slug = str(raw.slug, 80);
    const product = bySlug.get(slug);
    if (product) {
      lines.push({ slug, name: product.name, qty, each: product.price });
    } else {
      const name = str(raw.name, 120);
      const each = Math.max(0, Math.round((Number(raw.each) || 0) * 100) / 100);
      if (name) lines.push({ slug: null, name, qty, each });
    }
  }

  const name = str(p.name, 120);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(p.date, 10)) ? str(p.date, 10) : "";
  if (!name || !date || lines.length === 0) {
    return NextResponse.json(
      { error: "A phone order needs a name, a date, and at least one item (pick a product or type a custom one with a price)." },
      { status: 400 },
    );
  }

  const now = Date.now();
  const mmdd = date.slice(5).replace("-", "");
  const order: WorkroomOrder = {
    id: newId("wr"),
    // Same DV- shape as the email tickets, P for phone so the two streams
    // cannot collide on a number.
    number: `DV-${mmdd}-P${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`,
    source: "phone",
    // A phone order is born confirmed: the shop is already talking to the
    // customer, which is the whole thing "confirmed" means here.
    status: "confirmed",
    name,
    phone: str(p.phone, 40),
    email: str(p.email, 160),
    fulfillment: p.fulfillment === "pickup" ? "pickup" : "delivery",
    recipient: str(p.recipient, 120),
    street: str(p.street, 160),
    town: str(p.town, 80),
    zip: str(p.zip, 10),
    date,
    occasion: str(p.occasion, 40),
    cardMessage: str(p.cardMessage, 600),
    notes: str(p.notes, 600),
    lines,
    subtotal: Math.round(lines.reduce((s, l) => s + l.each * l.qty, 0) * 100) / 100,
    createdAt: now,
  };

  await getStore().createOrder(order);
  return NextResponse.json({ ok: true, order });
}

export async function PATCH(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { id?: unknown; status?: unknown };
  const id = typeof p.id === "string" ? p.id : "";
  const status = STATUSES.includes(p.status as OrderStatus) ? (p.status as OrderStatus) : null;
  if (!id || !status) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  if (status === "out") {
    // "out" means on the van. A pickup order cannot be en route; refusing
    // here keeps a stray client from inventing a state the flow cannot leave.
    const order = (await getStore().listOrders(60)).find((o) => o.id === id);
    if (order && order.fulfillment !== "delivery") {
      return NextResponse.json({ error: "A pickup order has no van to be out on." }, { status: 400 });
    }
  }
  await getStore().setOrderStatus(id, status);
  return NextResponse.json({ ok: true });
}
