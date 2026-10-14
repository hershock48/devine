import { NextResponse } from "next/server";
import { deliveryFeeFor, site } from "@/lib/site";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, newId, type OrderStatus, type WorkroomLine, type WorkroomOrder } from "@/lib/workroom/store";
import { bySlug } from "@/lib/catalog";
import { deliveryLineName, isDeliveryLine, normalizeVariety, withTaxLine } from "@/lib/workroom/derive";
import { INITIALS_ERROR } from "@/lib/workroom/initials";
import { sendDeliveredEmail, sendWorkroomReceipt } from "@/lib/intake";

/**
 * The board's orders. GET lists the last 60 days (a wedding sits on the board
 * for weeks; a birthday for a day). POST creates a phone/walk-in order — the
 * counter's version of the web checkout. PATCH moves one along.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: OrderStatus[] = ["hold", "new", "confirmed", "made", "out", "done", "canceled"];

export async function GET(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  // The board reads its 60 days; the dashboard's year view asks for 400.
  const params = new URL(req.url).searchParams;
  const days = Math.min(400, Math.max(1, Math.round(Number(params.get("days"))) || 60));
  const store = getStore();
  // The Accounts tab asks for account orders only (open ones never age
  // off the list, the store's own rule, so a year-old unpaid account
  // order is still here) and has no use for the contacts projection.
  const accountOnly = params.get("account") === "1";
  const [all, contacts] = await Promise.all([store.listOrders(days), accountOnly ? Promise.resolve([]) : store.listOrderContacts()]);
  const orders = accountOnly ? all.filter((o) => o.account) : all;
  // contacts spans the whole history, so "her third order this year" still
  // counts after the first two age off the 60-day board.
  return NextResponse.json({ orders, contacts, backend: store.backend });
}

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");


type ParsedBody = { fields: Omit<WorkroomOrder, "id" | "number" | "source" | "status" | "createdAt" | "payment" | "canceledFrom" | "madeBy">; } | { error: string };

/**
 * One reading of a written-up order, shared by POST (new) and PUT (edit),
 * so an edited order is parsed by exactly the rules that made it.
 */
async function parseBody(p: Record<string, unknown>): Promise<ParsedBody> {
  /*
    Catalog lines are re-priced from the catalog, same rule as the web checkout.
    Custom lines ("casket spray, $250") keep the typed price: the person typing
    is the shop, and half of what a florist sells has no catalog entry.
  */
  /*
    BUILT BY STEMS (Katy, 2026-10-06): a line may carry parts, variety and
    stem count, and then its price is the sum of stems times her per-stem
    retail from the stem library, never the catalog price and never a
    number the browser sent. This is the wedding builder's arithmetic at
    the counter, for Designer's Choice and custom pieces. A variety the
    library does not price is refused by name rather than priced at zero:
    a $0 rose on a $100 arrangement is the kind of wrong that ships.
  */
  let stemPrices: Map<string, number> | null = null;
  const priceParts = async (rawParts: unknown): Promise<{ parts: WorkroomLine["parts"]; each: number } | { error: string } | null> => {
    if (!Array.isArray(rawParts) || rawParts.length === 0) return null;
    if (!stemPrices) {
      stemPrices = new Map();
      for (const v of await getStore().listVarieties()) {
        if (v.sellStem != null && v.sellStem > 0) stemPrices.set(v.name, v.sellStem);
      }
    }
    const parts: { variety: string; stems: number }[] = [];
    const unpriced: string[] = [];
    let cents = 0;
    for (const rp of rawParts.slice(0, 30)) {
      const r = (rp ?? {}) as Record<string, unknown>;
      const variety = normalizeVariety(str(r.variety, 80));
      const stems = Math.min(999, Math.max(0, Math.round(Number(r.stems) || 0)));
      if (!variety || stems === 0) continue;
      const price = stemPrices.get(variety);
      if (price === undefined) unpriced.push(variety);
      else cents += Math.round(price * 100) * stems;
      parts.push({ variety, stems });
    }
    if (parts.length === 0) return null;
    if (unpriced.length) return { error: `No per-stem price in the stem library for: ${unpriced.join(", ")}. Add it on the Inventory tab, then try again.` };
    return { parts, each: cents / 100 };
  };

  const lines: WorkroomLine[] = [];
  for (const l of (Array.isArray(p.lines) ? p.lines : []).slice(0, 40)) {
    if (!l || typeof l !== "object") continue;
    const raw = l as Record<string, unknown>;
    const qty = Math.min(99, Math.max(1, Math.round(Number(raw.qty) || 1)));
    const slug = str(raw.slug, 80);
    const product = bySlug.get(slug);
    const built = await priceParts(raw.parts);
    if (built && "error" in built) return { error: built.error };
    // Parts were sent but none had a flower and a count: the form refuses
    // this first; the route refuses it too rather than writing a $0 piece.
    if (!built && Array.isArray(raw.parts) && !product && !(Number(raw.each) > 0)) {
      return { error: `"${str(raw.name, 120) || "An item"}" is marked by stems but has no flowers with a count. Add one, or give it a price.` };
    }
    if (product) {
      lines.push(built ? { slug, name: product.name, qty, each: built.each, parts: built.parts } : { slug, name: product.name, qty, each: product.price });
    } else {
      const name = str(raw.name, 120) || (built ? "Custom arrangement" : "");
      const each = built ? built.each : Math.max(0, Math.round((Number(raw.each) || 0) * 100) / 100);
      if (name) lines.push(built ? { slug: null, name, qty, each, parts: built.parts } : { slug: null, name, qty, each });
    }
  }
  const name = str(p.name, 120);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(str(p.date, 10)) ? str(p.date, 10) : "";
  if (!name || !date || lines.length === 0) {
    return { error: "A phone order needs a name, a date, and at least one item (pick a product or type a custom one with a price)." };
  }
  /*
    THE DELIVERY FEE IS A LINE ON THE TICKET, set while the order is rung up
    (Katy, 2026-10-06 meeting: the zip sheet is the default, and the person
    on the phone can change it while quoting the price). The form sends the
    number it showed, sheet or adjusted; a missing number falls back to the
    sheet, and a zip off the sheet with nothing typed gets no line, which
    the pay route also leaves alone (that fee is the call's business). 0 is
    a real answer ("no charge for delivery") and writes a $0 line, so the
    pay route does not later append the sheet fee over the top of it.
  */
  const fulfillment = p.fulfillment === "pickup" ? "pickup" : "delivery";
  const zip = str(p.zip, 10);
  if (fulfillment === "delivery") {
    const typed = typeof p.deliveryFee === "number" && Number.isFinite(p.deliveryFee) && p.deliveryFee >= 0 ? p.deliveryFee : undefined;
    const fee = typed !== undefined ? Math.round(typed * 100) / 100 : deliveryFeeFor(zip);
    if (fee !== undefined) lines.push({ slug: null, name: deliveryLineName(zip), qty: 1, each: fee });
  }
  // SALES TAX, as a line (Kevin, 2026-10-14: on every order). Computed
  // here from the items, so the quote pads, the phone form and an edit
  // all tax by one rule; a tax line that arrived with a quote is replaced.
  // Tax exempt means no line at all, and the box is remembered.
  // A quote pad states its tax (its own rate, on the unrounded piece
  // money); the phone form does not, and the route computes it.
  const account = p.account === true;
  const taxExempt = p.taxExempt === true;
  const stated = typeof p.tax === "number" && Number.isFinite(p.tax) && p.tax >= 0 ? p.tax : undefined;
  const taxed = withTaxLine(lines, taxExempt, stated);
  lines.splice(0, lines.length, ...taxed);
  // WHO TOOK IT (Katy, 2026-10-14): initials, two or three letters, on
  // every order written up here, so a question later knows who to ask.
  // Required, not merely asked for: an order with nobody's name on it is
  // the one nobody can answer for. An edit keeps asking (the form carries
  // the original initials, so the person fixing a typo is not re-blamed).
  // Checked whole, not clipped first: "KEVIN" is refused, not stored as KEV.
  const takenBy = str(p.takenBy, 12).toUpperCase();
  if (!/^[A-Z]{2,3}$/.test(takenBy)) return { error: INITIALS_ERROR };
  return {
    fields: {
      takenBy,
      account,
      taxExempt,
      taxId: taxExempt ? str(p.taxId, 40) : "",
      name,
      phone: str(p.phone, 40),
      email: str(p.email, 160),
      fulfillment,
      recipient: str(p.recipient, 120),
      company: str(p.company, 120),
      street: str(p.street, 160),
      town: str(p.town, 80),
      zip,
      date,
      neededBy: /^([01]\d|2[0-3]):[0-5]\d$/.test(str(p.neededBy, 5)) ? str(p.neededBy, 5) : "",
      occasion: str(p.occasion, 40),
      cardMessage: str(p.cardMessage, site.cardMessageMax),
      notes: str(p.notes, 600),
      lines,
      subtotal: Math.round(lines.reduce((s, l) => s + l.each * l.qty, 0) * 100) / 100,
    },
  };
}

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const parsed = await parseBody(p);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const now = Date.now();
  const mmdd = parsed.fields.date.slice(5).replace("-", "");
  // Same DV- shape as the email tickets, P for phone so the two streams
  // cannot collide on a number. A thousand values per date is few enough
  // that a busy holiday would repeat one, so the number is checked against
  // the board before it is used.
  let number = "";
  for (let tries = 0; tries < 4 && !number; tries++) {
    const candidate = `DV-${mmdd}-P${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    if (!(await getStore().getOrderByNumber(candidate).catch(() => null))) number = candidate;
  }
  if (!number) number = `DV-${mmdd}-P${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
  const order: WorkroomOrder = {
    id: newId("wr"),
    number,
    source: "phone",
    // A phone order is born confirmed: the shop is already talking to the
    // customer, which is the whole thing "confirmed" means here. ON HOLD
    // (Katy, 2026-10-12) is the exception: written up with questions still
    // open, parked until someone finishes it.
    status: p.hold === true ? "hold" : "confirmed",
    ...parsed.fields,
    createdAt: now,
  };
  await getStore().createOrder(order);
  // The form asks for an email "for their receipt"; this is the receipt.
  // Best-effort and awaited; a bounced copy never fails the write-up. Not
  // for a held order: nothing has been promised yet.
  if (order.email && order.status !== "hold") await sendWorkroomReceipt(order);
  return NextResponse.json({ ok: true, order });
}

/**
 * EDITING A WRITTEN-UP ORDER (Katy, 2026-10-12, from the on-hold story:
 * "she went back in, found the order that was on hold, edited it and
 * finished it"). Allowed while the order is on hold, new, or confirmed and
 * unpaid: nothing has been made and no money has moved, so the ticket is
 * still a conversation. Once it is made, paid, out or done, the ticket is
 * a record and the counter writes a fresh one. The number, source, who
 * made it and the created time survive the edit; everything typed is
 * re-read by the same rules as a new order. A held order released here
 * becomes confirmed and gets its receipt then.
 */
export async function PUT(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = p && typeof p.id === "string" ? p.id : "";
  if (!p || !id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const existing = await getStore().getOrder(id);
  if (!existing) return NextResponse.json({ error: "No such order." }, { status: 404 });
  if (existing.payment) return NextResponse.json({ error: "Already paid; the ticket is settled. Write up a new one for changes." }, { status: 409 });
  if (!["hold", "new", "confirmed"].includes(existing.status)) {
    return NextResponse.json({ error: `Already ${existing.status}; too late to edit. Write up a new one for changes.` }, { status: 409 });
  }
  const parsed = await parseBody(p);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const status: OrderStatus = p.hold === true ? "hold" : existing.status === "hold" ? "confirmed" : existing.status;
  const order: WorkroomOrder = { ...existing, ...parsed.fields, status };
  await getStore().replaceOrder(order);
  if (existing.status === "hold" && status === "confirmed" && order.email) await sendWorkroomReceipt(order);
  return NextResponse.json({ ok: true, order });
}

export async function PATCH(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as {
    id?: unknown; status?: unknown; markRefunded?: unknown; deliveryFee?: unknown; uncancel?: unknown; madeBy?: unknown; takenBy?: unknown; account?: unknown;
  };
  const id = typeof p.id === "string" ? p.id : "";
  // UNCANCEL (Katy, 2026-10-06): a canceled order goes back to the status
  // it was canceled from, or to confirmed when that was never recorded
  // (orders canceled before this shipped). Refused once the money has been
  // refunded: the PAID badge would lie, and a refunded sale is a closed
  // book; the counter writes that one up again.
  if (p.uncancel === true) {
    if (!id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
    const o = await getStore().getOrder(id);
    if (!o) return NextResponse.json({ error: "No such order." }, { status: 404 });
    if (o.status !== "canceled") return NextResponse.json({ error: "That order is not canceled." }, { status: 409 });
    if (o.payment?.refundedAt) {
      return NextResponse.json({ error: "Its payment was refunded, so this one stays canceled. Write it up again." }, { status: 409 });
    }
    const back: OrderStatus = o.canceledFrom && o.canceledFrom !== "canceled" ? o.canceledFrom : "confirmed";
    await getStore().patchOrder(id, { status: back });
    return NextResponse.json({ ok: true, status: back });
  }
  // ON OR OFF ACCOUNT, after the fact (Katy, 2026-10-14). Unpaid orders
  // only: a paid order is settled, and "on account" means billed instead.
  if (typeof p.account === "boolean") {
    if (!id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
    const o = await getStore().getOrder(id);
    if (!o) return NextResponse.json({ error: "No such order." }, { status: 404 });
    if (o.payment) return NextResponse.json({ error: "Already paid; it is settled, not on account." }, { status: 409 });
    if (o.status === "canceled") return NextResponse.json({ error: "That order is canceled." }, { status: 409 });
    await getStore().patchOrder(id, { account: p.account });
    return NextResponse.json({ ok: true, account: p.account });
  }
  // INITIALS alone (fixing or adding who made it, or who took it, after
  // the fact: a typo in the taker's initials would otherwise be permanent
  // once the order is made or paid, exactly when the field matters).
  const madeBy = typeof p.madeBy === "string" ? p.madeBy.trim().toUpperCase().slice(0, 4) : undefined;
  const takenBy = typeof p.takenBy === "string" ? p.takenBy.trim().toUpperCase() : undefined;
  if (takenBy !== undefined && !/^[A-Z]{2,3}$/.test(takenBy)) return NextResponse.json({ error: INITIALS_ERROR }, { status: 400 });
  if (p.status === undefined && (madeBy !== undefined || takenBy !== undefined)) {
    if (!id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
    await getStore().patchOrder(id, { ...(madeBy !== undefined ? { madeBy } : {}), ...(takenBy !== undefined ? { takenBy } : {}) });
    return NextResponse.json({ ok: true });
  }
  // Adjusting the delivery fee on an order already on the board (Katy,
  // 2026-10-06): web orders arrive with no delivery line and phone orders
  // with the sheet's, and either may need changing before the card is
  // taken. Replaces the Delivery line (or adds one) and recomputes the
  // subtotal. Refused once paid: the ticket and the payment must agree.
  if (p.deliveryFee !== undefined) {
    const fee = typeof p.deliveryFee === "number" && Number.isFinite(p.deliveryFee) && p.deliveryFee >= 0 ? Math.round(p.deliveryFee * 100) / 100 : null;
    if (!id || fee === null) return NextResponse.json({ error: "A delivery fee is a number, zero or more." }, { status: 400 });
    const o = await getStore().getOrder(id);
    if (!o) return NextResponse.json({ error: "No such order." }, { status: 404 });
    if (o.fulfillment !== "delivery") return NextResponse.json({ error: "A pickup order has no delivery fee." }, { status: 400 });
    if (o.status === "canceled") return NextResponse.json({ error: "That order is canceled." }, { status: 409 });
    if (o.payment) return NextResponse.json({ error: "Already paid; the fee is settled with the payment." }, { status: 409 });
    const lines: WorkroomLine[] = [...o.lines.filter((l) => !isDeliveryLine(l)), { slug: null, name: deliveryLineName(o.zip), qty: 1, each: fee }];
    const subtotal = Math.round(lines.reduce((s, l) => s + l.each * l.qty, 0) * 100) / 100;
    await getStore().setOrderLines(id, lines, subtotal);
    return NextResponse.json({ ok: true, lines, subtotal });
  }

  // The refund attestation: the shop says the Square refund happened, and
  // the money-to-return section clears. Guarded in the store to orders
  // that actually carry a payment.
  if (p.markRefunded === true) {
    if (!id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
    await getStore().markOrderRefunded(id);
    return NextResponse.json({ ok: true });
  }

  const status = STATUSES.includes(p.status as OrderStatus) ? (p.status as OrderStatus) : null;
  if (!id || !status) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  // Looked up by id, not scanned from a windowed list: the old 60-day scan
  // quietly skipped the checks for any order older than its window.
  const before = await getStore().getOrder(id);
  if (!before) return NextResponse.json({ error: "No such order." }, { status: 404 });
  if (status === "out" && before.fulfillment !== "delivery") {
    // "out" means on the van. A pickup order cannot be en route; refusing
    // here keeps a stray client from inventing a state the flow cannot leave.
    return NextResponse.json({ error: "A pickup order has no van to be out on." }, { status: 400 });
  }
  if (status === "hold" && (before.payment || (before.status !== "new" && before.status !== "confirmed" && before.status !== "hold"))) {
    // Hold is for an order nothing has happened to yet (2026-10-12). A made
    // or paid one cannot go back into limbo from a stale tab.
    return NextResponse.json({ error: `Already ${before.payment ? "paid" : before.status}; it cannot go on hold.` }, { status: 409 });
  }
  // The delivered note (Kevin, 2026-09-04): a DELIVERY order marked done
  // tells its customer so by email. A real transition into done, not a
  // repeat tap; best-effort after the status is safely stored.
  const deliveredNote =
    status === "done" && before.fulfillment === "delivery" && before.status !== "done" && before.email
      ? { number: before.number, name: before.name, email: before.email, recipient: before.recipient }
      : null;
  // Released from hold by the Ready-to-make button: the receipt a new phone
  // order would have had goes now, same as a release through the form.
  const released = before.status === "hold" && status === "confirmed" && !!before.email;

  if (status === "canceled") {
    // Remember where it came from, for Uncancel. A repeat tap on an
    // already-canceled order must not overwrite that with "canceled".
    await getStore().patchOrder(id, {
      status,
      ...(before.status !== "canceled" ? { canceledFrom: before.status } : {}),
    });
  } else if (madeBy !== undefined) {
    await getStore().patchOrder(id, { status, madeBy });
  } else {
    await getStore().setOrderStatus(id, status);
  }
  if (deliveredNote) await sendDeliveredEmail(deliveredNote);
  if (released) await sendWorkroomReceipt(before);
  return NextResponse.json({ ok: true });
}
