import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { WORKROOM_COOKIE } from "@/lib/workroom/auth";

/** Close the workroom on a shared counter screen. */
export const runtime = "nodejs";

export async function POST() {
  (await cookies()).delete(WORKROOM_COOKIE);
  return NextResponse.json({ ok: true });
}
