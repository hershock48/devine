import { NextResponse } from "next/server";
import { setWorkroomCookie, workroomOwnerPin, workroomPin, workroomSessionReady } from "@/lib/workroom/auth";

import {allowLogin,clearLoginAttempts} from '@/lib/workroom/login-limit';
/** Account-wide persistent limit: cold starts and spoofed IPs cannot reset it.
 * A shared lockout is the deliberate tradeoff for this small workroom. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pin = workroomPin();
  if (pin === null || !workroomSessionReady()) {
    // Unset in production is a closed door, not an open one. Say so, because
    // this is the operator's problem to fix and nobody else's to work around.
    return NextResponse.json(
      { error: "The workroom is not set up on this deployment yet.", reason: "unconfigured" },
      { status: 503 },
    );
  }

  try {
    if(!(await allowLogin()))return NextResponse.json({error:'Too many tries. Wait ten minutes.'},{status:429,headers:{'Retry-After':'600'}});
  }catch{return NextResponse.json({error:'Sign-in storage is unavailable. Please try again later.'},{status:503});}

  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  // One field, two PINs: staff or owner. The server issues a signed role session for whichever credential was
  // accepted; the cookie never contains the PIN.
  const owner = workroomOwnerPin();
  const isOwner = owner !== null && body.pin === owner;
  if (typeof body.pin !== "string" || (body.pin !== pin && !isOwner)) {
    return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });
  }

  await clearLoginAttempts();
  await setWorkroomCookie(body.pin);
  return NextResponse.json({ ok: true, owner: isOwner });
}
