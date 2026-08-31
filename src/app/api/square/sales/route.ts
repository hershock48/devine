import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";

/**
 * The ingested register sales, raw. Exists so a sandbox test payment can be
 * SEEN to have landed, and so the workroom pages have something to read when
 * the sales view gets built. 30 days, newest first, same
 * compute-in-the-browser stance as the stem tracker.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const store = getStore();
  const sales = await store.listSquareSales(30);
  return NextResponse.json({ sales, backend: store.backend });
}
