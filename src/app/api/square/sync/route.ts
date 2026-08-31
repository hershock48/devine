import { NextResponse } from "next/server";
import { isWorkroomAuthed, workroomPin } from "@/lib/workroom/auth";
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

const tries = new Map<string, { n: number; until: number }>();

function headerPinOk(req: Request): boolean {
  const pin = workroomPin();
  const given = req.headers.get("x-workroom-pin");
  if (!pin || !given) return false;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const t = tries.get(ip);
  if (t && t.n >= 10 && Date.now() < t.until) return false;
  if (given === pin) {
    tries.delete(ip);
    return true;
  }
  tries.set(ip, { n: (t && Date.now() < t.until ? t.n : 0) + 1, until: Date.now() + 10 * 60_000 });
  return false;
}

async function authed(req: Request): Promise<boolean> {
  return (await isWorkroomAuthed()) || headerPinOk(req);
}

export async function GET(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: "Locked." }, { status: 401 });
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

export async function POST(req: Request) {
  if (!(await authed(req))) return NextResponse.json({ error: "Locked." }, { status: 401 });
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
