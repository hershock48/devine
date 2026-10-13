import { NextResponse } from "next/server";
import { isWorkroomAuthedOrHeader } from "@/lib/workroom/auth";
import { resolveSquare } from "@/lib/square/oauth";
import { syncCatalogToSquare } from "@/lib/square/sync";
import { getStore } from "@/lib/workroom/store";

/**
 * Catalog out: POST pushes all 57 products onto the register, GET reports
 * where the integration stands. Behind the workroom gate, same as everything
 * the shop operates.
 *
 * The PIN is ALSO accepted as an x-workroom-pin header, because during setup
 * this gets driven by curl and a cookie jar is a silly requirement for that.
 * Same throttle as the login route: 10 wrong tries per 10 minutes per IP,
 * because a header check with no throttle is a 10,000-guess keyspace.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isWorkroomAuthedOrHeader(req))) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const cfg = await resolveSquare();
  const store = getStore();
  const sales = await store.listSquareSales(7).catch(() => []);
  const grant = await store.getSquareTokens().catch(() => null);
  return NextResponse.json({
    configured: !!cfg,
    // The OAuth app itself (id + secret), which the Connect button needs
    // before the connect route can do anything but answer 503.
    appConfigured: !!process.env.SQUARE_APP_ID?.trim() && !!process.env.SQUARE_APP_SECRET?.trim(),
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

export async function POST(req: Request) {
  if (!(await isWorkroomAuthedOrHeader(req))) return NextResponse.json({ error: "Locked." }, { status: 401 });
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
