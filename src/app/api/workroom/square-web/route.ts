import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { resolveSquare } from "@/lib/square/oauth";
import { appFeeCents } from "@/lib/square/payments";

/**
 * What the Web Payments SDK needs to draw a card form in the workroom: the
 * application id (a public identifier by design; it appears in the page
 * source of every site using the SDK), the location the payment targets,
 * and which environment's script to load. Gated anyway, because the only
 * page that needs it is gated.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const appId = process.env.SQUARE_APP_ID?.trim();
  const cfg = await resolveSquare();
  if (!appId || !cfg) {
    return NextResponse.json(
      { error: "Square is not connected; card entry is unavailable." },
      { status: 503 },
    );
  }
  // The fee too, so the browser quotes the same number the server charges
  // rather than hardcoding its own copy of 99.
  return NextResponse.json({ applicationId: appId, locationId: cfg.locationId, env: cfg.env, feeCents: appFeeCents() });
}
