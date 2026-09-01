import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { bySlug } from "@/lib/catalog";
import { square, type SquareConfig } from "@/lib/square/client";
import { resolveSquare } from "@/lib/square/oauth";
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
 * Status codes are the retry contract: Square redelivers on any non-2xx. So
 * "not for us" events return 200 (retrying them would change nothing) and
 * genuine processing failures return 500 on purpose, so the sale is not lost
 * to one cold Neon start. The store dedupes redeliveries by payment id.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PaymentEvent = {
  type?: string;
  data?: {
    object?: {
      payment?: {
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
  const cfg = await resolveSquare();
  if (!cfg) return NextResponse.json({ error: "Square is not configured." }, { status: 503 });

  const raw = await req.text();
  const url = process.env.SQUARE_WEBHOOK_URL?.trim() || req.url;
  if (!verified(raw, req.headers.get("x-square-hmacsha256-signature"), url)) {
    return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  }

  const event = JSON.parse(raw) as PaymentEvent;
  if (event.type !== "payment.created" && event.type !== "payment.updated") {
    return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" });
  }
  const payment = event.data?.object?.payment;
  // Payments arrive APPROVED first and COMPLETED after capture; only the
  // completed delivery is money in the drawer.
  if (!payment?.id || payment.status !== "COMPLETED") {
    return NextResponse.json({ ok: true, ignored: payment?.status ?? "no payment" });
  }

  try {
    const detail = payment.order_id
      ? await toLines(cfg, payment.order_id)
      : { lines: [], referenceId: "" };
    const workroomOrderId = await matchWorkroomOrder(detail.referenceId, payment.note ?? "");
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
    await getStore().upsertSquareSale(sale);

    // A linked sale marks its board order paid, unless the order already is
    // (our /pay route marks synchronously; this covers the register-rung
    // fallback and any race). Best effort: a failed mark is a log line, the
    // sale itself is already stored and Square must not redeliver over it.
    if (workroomOrderId) {
      try {
        const order = await getStore().getOrder(workroomOrderId);
        if (order && !order.payment) {
          await getStore().setOrderPayment(workroomOrderId, {
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
  } catch (err) {
    console.error("square webhook: sale not stored, Square will retry", err);
    return NextResponse.json({ error: "Not stored." }, { status: 500 });
  }
}

/** For a browser poke while wiring things up. Says whether the pieces exist. */
export async function GET() {
  return NextResponse.json({
    configured: !!(await resolveSquare()),
    signatureKey: !!process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
  });
}
