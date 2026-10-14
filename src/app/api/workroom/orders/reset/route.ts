import { NextResponse } from "next/server";
import { isWorkroomOwner } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";

/**
 * THE LAUNCH RESET (Kevin, 2026-10-13): clear every order off the board
 * before the shop goes live, so the first real order is the first order
 * on it. Owner PIN, and the word CLEAR typed, because there is no undo.
 * Deletes orders only: register sales, her IRIS lists, quotes, stems and
 * the weekly order all stay. Square keeps its own record of any test
 * payment, refunded or not.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await isWorkroomOwner())) return NextResponse.json({ error: "The owner's PIN opens this." }, { status: 403 });
  const p = (await req.json().catch(() => ({}))) as { confirm?: unknown };
  if (p.confirm !== "CLEAR") return NextResponse.json({ error: "Type CLEAR to confirm." }, { status: 400 });
  const deleted = await getStore().deleteOrdersBefore(Date.now());
  console.log(`[devine] launch reset: ${deleted} order(s) cleared from the board`);
  return NextResponse.json({ ok: true, deleted });
}
