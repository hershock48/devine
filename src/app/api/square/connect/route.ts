import { NextResponse } from "next/server";
import { isWorkroomOwner } from "@/lib/workroom/auth";
import { authorizeUrl, revokeAndClear, squareApp } from "@/lib/square/oauth";
import { getStore } from "@/lib/workroom/store";

/**
 * Where the owner connects her Square account. GET sends the signed-in
 * workroom browser to Square's authorize page; Square sends it back to
 * /api/square/oauth/callback. DELETE disconnects: revoke, then forget.
 *
 * OWNER ONLY (2026-09-28 audit): whoever connects decides whose Square
 * account receives every card payment, so a staff session must not be able
 * to connect a different account or disconnect hers. Buttons for both live
 * on /workroom/payments, shown to the owner. And the callback landing in the database needs postgres;
 * refusing HERE, before Square is ever involved, beats collecting a grant
 * that evaporates with the lambda that held it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomOwner())) return NextResponse.json({ error: "Only the owner can connect or disconnect Square." }, { status: 403 });
  const app = squareApp();
  if (!app) {
    return NextResponse.json(
      { error: "The Glazed Square app is not configured. SQUARE_APP_ID and SQUARE_APP_SECRET are the missing keys." },
      { status: 503 },
    );
  }
  if (getStore().backend !== "postgres") {
    return NextResponse.json(
      { error: "No database. The OAuth grant must outlive a lambda; create the Neon database (DATABASE_URL) first." },
      { status: 503 },
    );
  }
  return NextResponse.redirect(authorizeUrl(app), 302);
}

export async function DELETE() {
  if (!(await isWorkroomOwner())) return NextResponse.json({ error: "Only the owner can connect or disconnect Square." }, { status: 403 });
  const app = squareApp();
  if (!app) return NextResponse.json({ error: "The Glazed Square app is not configured." }, { status: 503 });
  await revokeAndClear(app);
  return NextResponse.json({ ok: true, disconnected: true });
}
