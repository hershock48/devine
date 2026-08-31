import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { authorizeUrl, revokeAndClear, squareApp } from "@/lib/square/oauth";
import { getStore } from "@/lib/workroom/store";

/**
 * Where the owner connects her Square account. GET sends the signed-in
 * workroom browser to Square's authorize page; Square sends it back to
 * /api/square/oauth/callback. DELETE disconnects: revoke, then forget.
 *
 * Workroom cookie only, no PIN header here: this is a browser redirect
 * dance, so the caller is by definition a browser that can log into the
 * workroom first. And the callback landing in the database needs postgres;
 * refusing HERE, before Square is ever involved, beats collecting a grant
 * that evaporates with the lambda that held it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
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
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const app = squareApp();
  if (!app) return NextResponse.json({ error: "The Glazed Square app is not configured." }, { status: 503 });
  await revokeAndClear(app);
  return NextResponse.json({ ok: true, disconnected: true });
}
