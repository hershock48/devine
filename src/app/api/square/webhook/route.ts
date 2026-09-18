import { paymentDatabase, recordProviderConflict, NoPaymentStore } from "@/lib/square/payment-attempts";
import { settleProviderPayment, PaymentIntentMismatch } from "@/lib/square/payment-service";
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { bySlug } from "@/lib/catalog";
import { square, type SquareConfig } from "@/lib/square/client";
import { resolveSquare, type ResolvedSquare } from "@/lib/square/oauth";
import { getStore, type SquareSale, type SquareSaleLine } from "@/lib/workroom/store";

/**
 * Sales in: Square calls this URL when a payment changes, and completed
 * payments become square_sales rows. This is the pipe that kills the double
 * entry: the counter is rung once, on the register, and the workroom finds
 * out by itself.
 *
 * SIGNATURE FIRST, ALWAYS. Square signs each delivery with the subscription's
 * signature key: HMAC-SHA256 over (notification url + raw body), base64, in
 * the x-square-hmacsha256-signature header. An unsigned or mis-signed POST is
 * refused before parsing, because this endpoint is public by necessity and
 * writes to the shop's database. With no signature key configured the
 * endpoint refuses everything rather than trusting anonymously; there is no
 * dev-mode bypass, since the sandbox signs too.
 *
 * THE URL IN THE SIGNATURE IS THE ONE TYPED INTO SQUARE'S DASHBOARD. Behind
 * Vercel's proxy, req.url can differ from it (scheme, host casing), and then
 * every real delivery fails verification while looking like an attack. So
 * SQUARE_WEBHOOK_URL holds the exact dashboard string and req.url is only the
 * fallback for local tunnels.
 *
 * STATUS CODES ARE THE RETRY CONTRACT: Square redelivers on any non-2xx, and
 * gives up after about a day. So the only thing that earns a 500 is a failure
 * that asking again could actually fix: a cold Neon start, a dropped
 * connection, a Square read that timed out. Everything else answers 200, even
 * when it is bad news, because a shop whose sale is stuck behind a retry loop
 * finds out when the loop ends and the sale is simply gone.
 *
 * Two cases used to be on the wrong side of that line. A shop running without
 * a database had every completed payment answered 500, forever, because the
 * payment store was required before the sale was written at all. And a payload
 * that disagreed with the saved intent threw into the same catch, so Square
 * redelivered the identical contradiction until it gave up. The second is now
 * filed on the attempt for the owner to read on /workroom/payments. The store
 * dedupes redeliveries by payment id.
 *
 * THE MISSING DATABASE ANSWERS DIFFERENTLY IN PRODUCTION THAN OUT OF IT, and
 * the two answers are both right for what they are.
 *
 *   production   no DATABASE_URL on a deployed shop is a misconfiguration:
 *                the integration is not attached yet, or was removed, or was
 *                lost in a rollout. That is fixable, and Square's day of
 *                retries is exactly the window somebody fixes it in. So 500,
 *                and the redelivery lands in the database once it exists.
 *                Answering 200 would take the sale into memory that dies with
 *                the lambda and throw away the row, its lines and its board
 *                link for good, leaving one console line behind.
 *
 *   anywhere else  development, a local run, the memory-backed demo. There is
 *                no Square on the other end to retry, and a database was never
 *                promised, so the sale is recorded in memory and said plainly.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PaymentEvent = {
  type?: string;
  data?: {
    object?: {
      payment?: {
        reference_id?: string;
        amount_money?: { amount?: number; currency?: string };
        receipt_url?: string;
        id?: string;
        status?: string;
        order_id?: string;
        location_id?: string;
        source_type?: string;
        created_at?: string;
        note?: string;
        total_money?: { amount?: number };
      };
    };
  };
};

type OrderResponse = {
  order?: {
    reference_id?: string;
    line_items?: {
      catalog_object_id?: string;
      name?: string;
      quantity?: string;
      base_price_money?: { amount?: number };
      total_money?: { amount?: number };
    }[];
  };
};

type BatchRetrieveResponse = {
  objects?: { id: string; item_variation_data?: { sku?: string } }[];
};

function verified(raw: string, header: string | null, url: string): boolean {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim();
  if (!key || !header) return false;
  const expected = createHmac("sha256", key).update(url + raw).digest();
  const got = Buffer.from(header, "base64");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Line items name what sold; variation SKUs say which are OUR products.
    The order's reference_id rides back too: our own API payments carry the
    workroom order id there, which is how a sale gets linked to its ticket. */
async function toLines(
  cfg: SquareConfig,
  orderId: string,
): Promise<{ lines: SquareSaleLine[]; referenceId: string }> {
  const { order } = await square<OrderResponse>(cfg, "GET", `/v2/orders/${orderId}`);
  const items = order?.line_items ?? [];
  const ids = [...new Set(items.map((l) => l.catalog_object_id).filter((id): id is string => !!id))];
  const skuById = new Map<string, string>();
  if (ids.length > 0) {
    const got = await square<BatchRetrieveResponse>(cfg, "POST", "/v2/catalog/batch-retrieve", {
      object_ids: ids,
    });
    for (const o of got.objects ?? []) {
      const sku = o.item_variation_data?.sku;
      if (sku) skuById.set(o.id, sku);
    }
  }
  const lines = items.map((l) => {
    const sku = l.catalog_object_id ? skuById.get(l.catalog_object_id) : undefined;
    return {
      // Only a SKU that is genuinely one of our slugs links to a recipe. A
      // custom-amount sale has no catalog object at all and lands as null,
      // which the workroom can then SHOW: "rung without an item" is the
      // habit that starves the inventory, and it should be visible, not
      // silently dropped.
      slug: sku && bySlug.has(sku) ? sku : null,
      name: l.name ?? "(unnamed)",
      qty: Math.max(1, Math.round(Number(l.quantity) || 1)),
      eachCents: l.base_price_money?.amount ?? 0,
      totalCents: l.total_money?.amount ?? 0,
    };
  });
  return { lines, referenceId: order?.reference_id ?? "" };
}

/**
 * Which board order this sale settles, if any. Two recognizers, strongest
 * first: the reference id our own API payments always carry, then a DV
 * number typed into a register ring's note (the fallback for the day staff
 * rings a board order at the counter anyway). "" means a plain walk-out.
 */
async function matchWorkroomOrder(referenceId: string, note: string): Promise<string> {
  const store = getStore();
  if (referenceId) {
    const o = await store.getOrder(referenceId).catch(() => null);
    if (o) return o.id;
  }
  const dv = note.match(/DV-\d{4}-\d{4}/)?.[0];
  if (dv) {
    const o = await store.getOrderByNumber(dv).catch(() => null);
    if (o) return o.id;
  }
  return "";
}

export async function POST(req: Request) {
  // The signature is checked before anything else is read or reached: this
  // endpoint is public by necessity, and an unsigned POST should not cost the
  // shop an OAuth lookup or a database connection either.
  const raw = await req.text();
  const url = process.env.SQUARE_WEBHOOK_URL?.trim() || req.url;
  if (!verified(raw, req.headers.get("x-square-hmacsha256-signature"), url)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  let event: PaymentEvent;
  try { event = JSON.parse(raw) as PaymentEvent; } catch { return NextResponse.json({ error: "Invalid event." }, { status: 400 }); }
  if (event.type !== "payment.created" && event.type !== "payment.updated") {
    return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" });
  }
  const payment = event.data?.object?.payment;
  // Payments arrive APPROVED first and COMPLETED after capture; only the
  // completed delivery is money in the drawer.
  if (!payment?.id || payment.status !== "COMPLETED") {
    return NextResponse.json({ ok: true, ignored: payment?.status ?? "no payment" });
  }

  let cfg: ResolvedSquare | null;
  try {
    cfg = await resolveSquare();
  } catch (err) {
    console.error("square webhook: the Square connection could not be read, Square will retry", err);
    return NextResponse.json({ error: "Not stored." }, { status: 500 });
  }
  if (!cfg) return NextResponse.json({ error: "Square is not configured." }, { status: 503 });

  // Reading the order's lines is a call to Square. A failure is transient by
  // nature, and the sale is worth redelivering for, so it keeps the 500.
  let detail: { lines: SquareSaleLine[]; referenceId: string };
  try {
    detail = payment.order_id ? await toLines(cfg, payment.order_id) : { lines: [], referenceId: "" };
  } catch (err) {
    console.error("square webhook: order lines unavailable, Square will retry", err);
    return NextResponse.json({ error: "Not stored." }, { status: 500 });
  }
  const referenceId = payment.reference_id || detail.referenceId;

  /*
    THE ATTEMPT THIS PAYMENT SETTLES, if the shop has a durable payment store
    at all. Four outcomes, and only the last is Square's business to retry:

      no durable store   no DATABASE_URL, so no saved intents exist to settle
                         against. Off production that is the memory backend
                         working as intended and the sale is still recorded
                         below; on production it is a misconfiguration and the
                         answer at the end of this handler is a 500.
      mismatch           the payload disagrees with what we saved. Filed for
                         the owner and answered 200: redelivering the same
                         contradiction for a day only buries the sale.
      settled, not saved the payment is recorded and only the board row is
                         missing. /workroom/payments finishes that, and
                         another delivery would fail at the same place.
      anything else      transient. 500, and Square asks again.
  */
  let settledOrderId = "";
  let durable = true;
  let conflicted = false;
  try {
    const db = await paymentDatabase();
    const saved = await db.query("SELECT attempt_key,snapshot FROM devine_payment_attempts WHERE snapshot->>'referenceId'=$1 LIMIT 1", [referenceId]);
    if (saved.rows[0]) {
      settledOrderId = saved.rows[0].snapshot.order.id || "";
      try {
        await settleProviderPayment(saved.rows[0].attempt_key, { ...payment, reference_id: referenceId }, cfg);
      } catch (err) {
        if (err instanceof PaymentIntentMismatch) {
          conflicted = true;
          await recordProviderConflict(saved.rows[0].attempt_key, {
            reason: err.reason,
            paymentId: payment.id,
            status: payment.status ?? "",
            amountCents: payment.amount_money?.amount ?? payment.total_money?.amount ?? null,
            locationId: payment.location_id ?? "",
          });
          console.error(`square webhook: payment ${payment.id} does not match the saved intent (${err.reason}); recorded for owner review`);
        } else {
          // Settling records the payment first and the board row second. If
          // the payment landed and the board did not, the money is safe and
          // /workroom/payments can finish the job; another delivery would only
          // fail at the same place and cost the shop its sale row as well.
          const after = await db.query("SELECT state FROM devine_payment_attempts WHERE attempt_key=$1", [saved.rows[0].attempt_key]);
          if (after.rows[0]?.state !== "completed") throw err;
          console.error(`square webhook: payment ${payment.id} is recorded but its order needs recovery on /workroom/payments`, err);
        }
      }
    }
  } catch (err) {
    if (err instanceof NoPaymentStore) {
      durable = false;
      console.log(`square webhook: no durable payment store is configured, so payment ${payment.id} settles no saved order.`);
    } else {
      console.error("square webhook: the payment store could not be read, Square will retry", err);
      return NextResponse.json({ error: "Not stored." }, { status: 500 });
    }
  }

  // A payload filed as a conflict does not get to claim a board ticket either.
  // derive.ts and the dashboard both skip a sale that carries a workroomOrderId,
  // because the ticket is taken to be telling that story already; linking one we
  // have just called unmatchable would take its amount and its stems out of
  // every total while the contradiction is still open. Unlinked, it shows up as
  // the register ring it is.
  const workroomOrderId = conflicted ? "" : settledOrderId || await matchWorkroomOrder(detail.referenceId, payment.note ?? "");
  const sale: SquareSale = {
    id: payment.id,
    workroomOrderId: workroomOrderId || undefined,
    orderId: payment.order_id ?? "",
    locationId: payment.location_id ?? "",
    source: payment.source_type ?? "UNKNOWN",
    totalCents: payment.total_money?.amount ?? 0,
    paidAt: payment.created_at ?? "",
    lines: detail.lines,
    createdAt: Date.now(),
  };
  const store = getStore();
  try {
    await store.upsertSquareSale(sale);
  } catch (err) {
    console.error("square webhook: sale not stored, Square will retry", err);
    return NextResponse.json({ error: "Not stored." }, { status: 500 });
  }
  if (store.backend !== "postgres" || !durable) {
    // On a deployed shop this is a database that should be there and is not,
    // which somebody can fix inside Square's retry window. Keep the sale alive
    // by asking Square to come back, rather than logging the loss and calling
    // it handled. Off production nothing is retrying, so say it plainly and go.
    if (process.env.NODE_ENV === "production") {
      console.error(`square webhook: sale ${payment.id} has no durable store to land in, so Square will retry. Attach the database.`);
      return NextResponse.json({ error: "Not stored." }, { status: 500 });
    }
    console.log(`square webhook: sale ${payment.id} was recorded without a durable store, so it will not reach the workroom.`);
  }

  // A linked sale marks its board order paid, unless the order already is
  // (our /pay route marks synchronously; this covers the register-rung
  // fallback and any race). Best effort: a failed mark is a log line, the
  // sale itself is already stored and Square must not redeliver over it.
  //
  // Never off a payment we just filed as a conflict. That payload did not
  // match the saved order, which is exactly why a person has to look at it;
  // marking the ticket paid from it would settle by the back door what the
  // front door refused.
  if (workroomOrderId && !conflicted) {
    try {
      const order = await store.getOrder(workroomOrderId);
      if (order && !order.payment) {
        await store.setOrderPayment(workroomOrderId, {
          at: Date.now(),
          method: payment.source_type === "CASH" ? "cash" : "register",
          squarePaymentId: payment.id,
          totalCents: payment.total_money?.amount ?? 0,
          feeCents: 0,
        });
      }
    } catch (err) {
      console.error(`square webhook: sale ${payment.id} stored but order ${workroomOrderId} not marked paid`, err);
    }
  }
  return NextResponse.json({ ok: true });
}

/** For a browser poke while wiring things up. Says whether the pieces exist. */
export async function GET() {
  return NextResponse.json({
    configured: !!(await resolveSquare()),
    signatureKey: !!process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
  });
}
