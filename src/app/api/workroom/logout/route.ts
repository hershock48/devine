import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/** Close the workroom on a shared counter screen. */
export const runtime = "nodejs";

export async function POST() {
  (await cookies()).delete("devine_workroom");
  return NextResponse.json({ ok: true });
}
