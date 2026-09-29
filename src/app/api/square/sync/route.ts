import { NextResponse } from "next/server";
import { isWorkroomAuthed, isWorkroomOwner } from "@/lib/workroom/auth";
import { resolveSquare } from "@/lib/square/oauth";
import { syncCatalogToSquare } from "@/lib/square/sync";
import { getStore } from "@/lib/workroom/store";

/**
 * Catalog out: POST pushes all 57 products onto the register, GET reports
 * where the integration stands. Behind the workroom gate, same as everything
 * the shop operates.
 *
 * A signed workroom session only. The PIN used to be accepted as an
 * x-workroom-pin header for setup by curl, behind a per-instance memory
 * throttle keyed on a client-supplied address; the 2026-09-28 audit got the
 * PIN through it by changing that address on every guess. The push to the
 * register is the owner's, like connecting Square, and has a button on
 * /workroom/payments.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const cfg = await resolveSquare();
  const store = getStore();
  const sales = await store.listSquareSales(7).catch(() => []);
  const grant = await store.getSquareTokens().catch(() => null);
  return NextResponse.json({
    configured: !!cfg,
    env: cfg?.env ?? null,
    backend: store.backend,
    webhookKey: !!process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    salesLast7Days: sales.length,
    // The owner-connection story, so "is she connected" is one GET and
    // never a database spelunk.
    oauth: grant
      ? {
          connected: true,
          inUse: cfg?.viaOAuth ?? false,
          merchantId: grant.merchantId,
          location: grant.locationName || grant.locationId,
          tokenExpiresAt: grant.expiresAt,
        }
      : { connected: false, inUse: false },
  });
}

export async function POST() {
  if (!(await isWorkroomOwner())) return NextResponse.json({ error: "Only the owner can push the catalog to the register." }, { status: 403 });
  const cfg = await resolveSquare();
  if (!cfg) {
    return NextResponse.json(
      {
        error:
          "Square is not configured. Either connect the owner via /api/square/connect (SQUARE_APP_ID + SQUARE_APP_SECRET) or set SQUARE_ACCESS_TOKEN and SQUARE_LOCATION_ID.",
      },
      { status: 503 },
    );
  }
  try {
    const report = await syncCatalogToSquare(cfg);
    return NextResponse.json({ ok: true, env: cfg.env, ...report });
  } catch (err) {
    console.error("square sync failed", err);
    return NextResponse.json({ error: String(err).slice(0, 600) }, { status: 502 });
  }
}
