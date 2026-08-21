import { NextResponse } from "next/server";
import { setWorkroomCookie, workroomPin } from "@/lib/workroom/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  if (typeof body.pin !== "string" || body.pin !== workroomPin()) {
    return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });
  }
  await setWorkroomCookie();
  return NextResponse.json({ ok: true });
}
