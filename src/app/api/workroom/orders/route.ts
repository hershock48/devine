import { NextResponse } from "next/server";
import { deliveryFeeFor, site } from "@/lib/site";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, newId, type OrderStatus, type WorkroomLine, type WorkroomOrder } from "@/lib/workroom/store";
import { bySlug } from "@/lib/catalog";
import { balanceCents, deliveryLineName, isDeliveryLine, isTaxLine, normalizeVariety, squareMoney, withTaxLine } from "@/lib/workroom/derive";
import { INITIALS_ERROR } from "@/lib/workroom/initials";
import { sendDeliveredEmail, sendRefundEmail, sendWorkroomReceipt } from "@/lib/intake";

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
/** The stem library's prices, read once per request and shared by every
    order on a write-up (a ten-stop sale with by-stems pieces read the
    whole table ten times before this). */
type PriceCache = { stemPrices: Map<string, number> | null };
async function parseBody(p: Record<string, unknown>, cache: PriceCache = { stemPrices: null }): Promise<ParsedBody> {
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
  const priceParts = async (rawParts: unknown): Promise<{ parts: WorkroomLine["parts"]; each: number } | { error: string } | null> => {
    if (!Array.isArray(rawParts) || rawParts.length === 0) return null;
    if (!cache.stemPrices) {
      cache.stemPrices = new Map();
      for (const v of await getStore().listVarieties()) {
        if (v.sellStem != null && v.sellStem > 0) cache.stemPrices.set(v.name, v.sellStem);
      }
    }
    const stemPrices = cache.stemPrices;
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
    // A quick sale has its name and date filled in by the route, so its
    // only possible miss is the items.
    return { error: "An order needs a name, a date, and at least one item (pick a product or type a custom one with a price)." };
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
  // NEEDED BY: HH:MM on the clock, "9:30" padded to "09:30", anything
  // else refused in words rather than dropped, so a time the form showed
  // cannot quietly vanish from the saved order.
  const neededByRaw = str(p.neededBy, 8);
  const neededByMatch = /^(\d{1,2}):(\d{2})$/.exec(neededByRaw);
  const neededBy = neededByMatch ? `${neededByMatch[1].padStart(2, "0")}:${neededByMatch[2]}` : "";
  if (neededByRaw && (!neededByMatch || Number(neededByMatch[1]) > 23 || Number(neededByMatch[2]) > 59)) {
    return { error: "The needed-by time did not read as a time. Use the clock picker, or clear it." };
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
      batchId: /^[A-Za-z0-9_-]{4,48}$/.test(str(p.batchId, 48)) ? str(p.batchId, 48) : "",
      account,
      taxExempt,
      taxId: taxExempt ? str(p.taxId, 40) : "",
      name,
      business: str(p.business, 120),
      phone: str(p.phone, 40),
      email: str(p.email, 160),
      fulfillment,
      recipient: str(p.recipient, 120),
      recipientPhone: fulfillment === "delivery" ? str(p.recipientPhone, 40) : "",
      company: str(p.company, 120),
      street: str(p.street, 160),
      town: str(p.town, 80),
      zip,
      date,
      neededBy,
      occasion: str(p.occasion, 40),
      cardMessage: str(p.cardMessage, site.cardMessageMax),
      notes: str(p.notes, 600),
      lines,
      subtotal: Math.round(lines.reduce((s, l) => s + l.each * l.qty, 0) * 100) / 100,
    },
  };
}

/** A DV- number nobody on the board has. Same shape as the email tickets,
    P for phone so the two streams cannot collide. A thousand values per
    date is few enough that a busy holiday would repeat one, so each
    candidate is checked against the board before it is used. */
async function freshNumber(date: string, taken: Set<string>): Promise<string> {
  const mmdd = date.slice(5).replace("-", "");
  for (let tries = 0; tries < 4; tries++) {
    const candidate = `DV-${mmdd}-P${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;
    if (taken.has(candidate)) continue;
    if (!(await getStore().getOrderByNumber(candidate).catch(() => null))) {
      taken.add(candidate);
      return candidate;
    }
  }
  // Four digits, checked the same way: two orders on one write-up must
  // never draw the same number, nor one already on the board.
  for (;;) {
    const fallback = `DV-${mmdd}-P${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    if (taken.has(fallback)) continue;
    if (await getStore().getOrderByNumber(fallback).catch(() => null)) continue;
    taken.add(fallback);
    return fallback;
  }
}

/**
 * ONE SALE, ONE OR MORE ORDERS (Kevin, 2026-10-14: "oaklawn hospital calls
 * and they want to place multiple orders, but use one card"). The form
 * sends the customer once and a `deliveries` list, one entry per recipient
 * or stop; each entry becomes its own order (its own ticket, card, driver
 * stub and make-list line, because the workroom makes and drives them one
 * at a time) and all of them share a batch id, so the board can take one
 * card for the lot and the customer gets one receipt. A flat body (the
 * quote pads, a single write-up) is one delivery. Adding to a group that
 * is already on the board sends that group's batch id.
 */
export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  /*
    A QUICK SALE (Kevin, 2026-10-14: "when someone walks in and just
    purchases something small it just goes through and we don't have to
    ask them a million questions"). The panel sends items, initials and
    the tax-exempt box, nothing else; the route fills in the rest: a
    pickup for "Walk-in", dated today, born DONE because it walked out
    the door, one order and never a group. No phone and no email, so no
    receipt goes out and nothing is waiting to print. Paid right after,
    by the pay route, from the same panel.
  */
  // An allowlist, not the body with holes punched in it: only the three
  // things the panel asks for ride through, so a stated tax, a tax ID, a
  // delivery fee or any field added later cannot slip onto a walk-in.
  const quick = raw.quick === true;
  // A quick sale's name and date are the route's; its only possible miss
  // is the items, said in its own words before the shared parse.
  if (quick && (!Array.isArray(raw.lines) || raw.lines.length === 0)) {
    return NextResponse.json({ error: "A quick sale needs at least one item (pick a product or type a custom one with a price)." }, { status: 400 });
  }
  const p: Record<string, unknown> = quick
    ? { lines: raw.lines, taxExempt: raw.taxExempt, takenBy: raw.takenBy, name: "Walk-in", fulfillment: "pickup", date: site.todayISO() }
    : raw;
  const stops: Record<string, unknown>[] = Array.isArray(p.deliveries)
    ? p.deliveries.map((d) => (d && typeof d === "object" ? (d as Record<string, unknown>) : {}))
    : [p];
  if (stops.length === 0) return NextResponse.json({ error: "Nothing to write up: add at least one order." }, { status: 400 });
  if (stops.length > 20) return NextResponse.json({ error: "Twenty orders at most on one write-up. Put the rest on a second one." }, { status: 400 });
  // Every entry is read by the one set of rules before anything is written,
  // so a typo in the fourth delivery stops the whole sale and nothing is
  // half on the board. The error names the order it is about.
  // The customer's own fields come from the body, never from an entry:
  // one sale is one customer, one way of paying, one receipt address.
  const shared: Record<string, unknown> = {};
  for (const k of ["name", "business", "phone", "email", "takenBy", "account", "taxExempt", "taxId", "batchId", "tax", "hold"]) {
    if (k in p) shared[k] = p[k];
  }
  const cache: PriceCache = { stemPrices: null };
  const parsedAll: Extract<ParsedBody, { fields: unknown }>["fields"][] = [];
  for (let i = 0; i < stops.length; i++) {
    const parsed = await parseBody({ ...stops[i], ...shared }, cache);
    if ("error" in parsed) {
      return NextResponse.json({ error: stops.length > 1 ? `Order ${i + 1}: ${parsed.error}` : parsed.error }, { status: 400 });
    }
    parsedAll.push(parsed.fields);
  }
  // A $0 quick sale would be born done, never paid, and so invisible on
  // the board (nothing owed, nothing finished). The panel refuses it in
  // the same words; the route refuses it too.
  if (quick && parsedAll[0].lines.some((l) => !isTaxLine(l) && !(l.each > 0))) {
    return NextResponse.json({ error: "A quick sale needs a price on every item." }, { status: 400 });
  }
  const now = Date.now();
  const ids = parsedAll.map(() => newId("wr"));
  // The group: the one the form was adding to, else the first order's own
  // id when there are several, else none (a single order is not a group).
  const batchId = parsedAll[0].batchId || (ids.length > 1 ? ids[0] : "");
  const taken = new Set<string>();
  const orders: WorkroomOrder[] = [];
  for (let i = 0; i < parsedAll.length; i++) {
    orders.push({
      id: ids[i],
      number: await freshNumber(parsedAll[i].date, taken),
      source: "phone",
      // A phone order is born confirmed: the shop is already talking to the
      // customer, which is the whole thing "confirmed" means here. ON HOLD
      // (Katy, 2026-10-12) is the exception: written up with questions still
      // open, parked until someone finishes it. A group holds together,
      // and is then finished one card at a time, on whatever days the
      // questions close; each sends its own receipt as it is released.
      status: p.hold === true ? "hold" : quick ? "done" : "confirmed",
      ...parsedAll[i],
      ...(quick ? { quick: true } : {}),
      batchId,
      // A millisecond apart, so "order 2 of 3" is the second one typed,
      // on every reload (the store lists by creation time).
      createdAt: now + i,
    });
  }
  const placed: WorkroomOrder[] = [];
  for (const order of orders) {
    try {
      await getStore().createOrder(order);
      placed.push(order);
    } catch (err) {
      console.error(`[devine] write-up failed after ${placed.length} of ${orders.length}:`, err);
      // What landed is real and gets its receipt; the form drops those
      // entries and retries the rest into the same group.
      if (placed.length && placed[0].email && placed[0].status !== "hold") await sendWorkroomReceipt(placed);
      return NextResponse.json(
        {
          error: placed.length
            ? `${placed.map((o) => o.number).join(", ")} went on the board; order ${placed.length + 1} did not save. The form keeps the rest: look it over and put them on again.`
            : "That did not save. Look it over and try again.",
          orders: placed,
        },
        { status: 500 },
      );
    }
  }
  // The form asks for an email "for their receipt"; this is the receipt,
  // one for the whole sale. Best-effort and awaited; a bounced copy never
  // fails the write-up. Not for a held order: nothing has been promised yet.
  if (orders[0].email && orders[0].status !== "hold") await sendWorkroomReceipt(orders);
  return NextResponse.json({ ok: true, order: orders[0], orders });
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
  // EDITABLE UNTIL CANCELED (Kevin, 2026-10-14): a paid, made or
  // delivered order can still take a tax ID, a new address, a longer
  // card message or another item. The payment taken stays what it was;
  // the balance after the edit is derive.ts's to say, and the board and
  // the ticket show it. Only a canceled order is a closed book.
  if (existing.status === "canceled") return NextResponse.json({ error: "That order is canceled. Uncancel it first, or write up a new one." }, { status: 409 });
  const parsed = await parseBody(p);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  // Hold is for a ticket nobody has made or paid yet; anywhere else the
  // status stays where it is.
  const canHold = !existing.payment && ["hold", "new", "confirmed"].includes(existing.status);
  const status: OrderStatus = p.hold === true && canHold ? "hold" : existing.status === "hold" ? "confirmed" : existing.status;
  // A quick sale stays one only while it is still anonymous: give the
  // walk-in a name, a phone, an email, or make it a delivery, and it is
  // an ordinary order again (printable, suggestible, groupable).
  const stillQuick = existing.quick && parsed.fields.name === "Walk-in" && !parsed.fields.phone && !parsed.fields.email && parsed.fields.fulfillment === "pickup";
  const order: WorkroomOrder = { ...existing, ...parsed.fields, status, quick: stillQuick ? true : undefined };
  await getStore().replaceOrder(order);
  if (existing.status === "hold" && status === "confirmed" && order.email) await sendWorkroomReceipt(order);
  return NextResponse.json({ ok: true, order });
}

export async function PATCH(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as {
    id?: unknown; status?: unknown; markRefunded?: unknown; unmarkPaid?: unknown; refunded?: unknown; deliveryFee?: unknown; uncancel?: unknown; madeBy?: unknown; takenBy?: unknown; account?: unknown;
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
  // subtotal. On a paid order too (2026-10-15): the balance then says what
  // is still due or owed back, and the card asks for the refund.
  if (p.deliveryFee !== undefined) {
    const fee = typeof p.deliveryFee === "number" && Number.isFinite(p.deliveryFee) && p.deliveryFee >= 0 ? Math.round(p.deliveryFee * 100) / 100 : null;
    if (!id || fee === null) return NextResponse.json({ error: "A delivery fee is a number, zero or more." }, { status: 400 });
    const o = await getStore().getOrder(id);
    if (!o) return NextResponse.json({ error: "No such order." }, { status: 404 });
    if (o.fulfillment !== "delivery") return NextResponse.json({ error: "A pickup order has no delivery fee." }, { status: 400 });
    if (o.status === "canceled") return NextResponse.json({ error: "That order is canceled." }, { status: 409 });
    // A paid ticket's fee can still change (Katy, 2026-10-15: the customer
    // picks up instead): the card then says what is owed back, and the
    // refund is marked once Square has given it.
    const lines: WorkroomLine[] = [...o.lines.filter((l) => !isDeliveryLine(l)), { slug: null, name: deliveryLineName(o.zip), qty: 1, each: fee }];
    const subtotal = Math.round(lines.reduce((s, l) => s + l.each * l.qty, 0) * 100) / 100;
    await getStore().setOrderLines(id, lines, subtotal);
    return NextResponse.json({ ok: true, lines, subtotal });
  }

  // The refund attestation: the shop says the Square refund happened, and
  // the money-to-return section clears. Guarded in the store to orders
  // that actually carry a payment. The customer hears that it is done
  // (Kevin, 2026-10-14): once, on the mark that actually transitions, so
  // a second tap or an order already stamped sends nothing. Best-effort
  // after the stamp is safely stored.
  // PART OF IT GIVEN BACK (Katy, 2026-10-15: "refund a delivery off of an
  // order... we did it off Square but I also want to run it through our
  // system so they match up"). The shop refunds in Square; this records
  // that it did, for the amount the card said was owed back, so the
  // balance returns to zero and the order leaves "Money to return".
  if (typeof p.refunded === "number") {
    if (!id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
    const o = await getStore().getOrder(id);
    if (!o) return NextResponse.json({ error: "No such order." }, { status: 404 });
    if (!o.payment) return NextResponse.json({ error: "That order has no payment to refund from." }, { status: 409 });
    if (o.status === "canceled") return NextResponse.json({ error: "A canceled order is refunded whole: use \"Refunded in Square\" on its card." }, { status: 409 });
    const cents = Math.round(p.refunded);
    const owedBack = -balanceCents(o);
    if (!Number.isInteger(cents) || cents <= 0) return NextResponse.json({ error: "The refund has to be more than zero." }, { status: 400 });
    if (cents > owedBack) return NextResponse.json({ error: owedBack > 0 ? `Only ${(owedBack / 100).toFixed(2)} is owed back on this order.` : "Nothing is owed back on this order." }, { status: 409 });
    // Where the money went back from: Square for a card, cash or register
    // payment; by hand (cash or a check) for a by-hand mark.
    const how = squareMoney(o) ? "square" : "hand";
    const written = await getStore().addOrderRefund(id, { at: Date.now(), cents, how, note: how === "square" ? "Refunded from the Square dashboard" : "Given back by hand" });
    if (!written) return NextResponse.json({ error: "That refund is already recorded, or more than is owed back. Reload the board and look at the card." }, { status: 409 });
    // The customer hears that it is done (Kevin, 2026-10-14), for a part
    // as for the whole.
    if (o.email) await sendRefundEmail(o, cents);
    return NextResponse.json({ ok: true });
  }
  // UNDO A BY-HAND MARK (Katy, 2026-10-15: two account orders marked "Paid
  // another way" that nobody had paid). Only a mark with no Square money
  // behind it can be taken back; a card or cash payment is real and stays.
  if (p.unmarkPaid === true) {
    if (!id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
    const o = await getStore().getOrder(id);
    if (!o) return NextResponse.json({ error: "No such order." }, { status: 404 });
    if (!o.payment) return NextResponse.json({ error: "That order is not marked paid." }, { status: 409 });
    // A refunded mark is a closed book (the customer was told): it stays.
    if (o.payment.refundedAt) return NextResponse.json({ error: "That payment was marked refunded, so it stays as it is." }, { status: 409 });
    // Part of it was given back already: the mark is a record now, not a slip.
    if ((o.refunds ?? []).length) return NextResponse.json({ error: "Part of that payment was refunded, so the paid mark stays." }, { status: 409 });
    const cleared = await getStore().clearHandPayments(id);
    if (!cleared) {
      return NextResponse.json(
        {
          error: squareMoney(o)
            ? "That payment is Square's record (a card, cash or a register ring), so it cannot be undone here. If it was wrong, refund it from the Square dashboard."
            : "That did not change. Reload the board and look at the card.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true });
  }
  if (p.markRefunded === true) {
    if (!id) return NextResponse.json({ error: "Malformed." }, { status: 400 });
    const o = await getStore().getOrder(id);
    if (!o) return NextResponse.json({ error: "No such order." }, { status: 404 });
    // Only a canceled order is refunded whole; anything else still has
    // its money, and the note would tell the customer a thing that is
    // not so.
    if (o.status !== "canceled") return NextResponse.json({ error: "Only a canceled order is marked refunded." }, { status: 409 });
    const changed = await getStore().markOrderRefunded(id);
    if (changed && o?.email) await sendRefundEmail(o);
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
