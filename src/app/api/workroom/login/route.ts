import { NextResponse } from "next/server";
import { setWorkroomCookie, workroomOwnerPin, workroomPin, workroomSessionReady } from "@/lib/workroom/auth";

import {allowLogin,clearLoginAttempts,loginClient} from '@/lib/workroom/login-limit';
/** Persistent client limits prevent one remote address from locking out the shop. */
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

  let client:string;
  try {
    client=loginClient(req);
    if(!(await allowLogin(client)))return NextResponse.json({error:'Too many tries. Wait ten minutes.'},{status:429,headers:{'Retry-After':'600'}});
  }catch{return NextResponse.json({error:'Sign-in storage is unavailable. Please try again later.'},{status:503});}

  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  // One field, two PINs: staff or owner. The server issues a signed role session for whichever credential was
  // accepted; the cookie never contains the PIN.
  const owner = workroomOwnerPin();
  const isOwner = owner !== null && body?.pin === owner;
  if (typeof body?.pin !== "string" || body.pin.length>512 || (body.pin !== pin && !isOwner)) {
    return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });
  }

  try{await clearLoginAttempts(client);await setWorkroomCookie(body.pin);}
  catch{return NextResponse.json({error:'Sign-in could not finish. Please try again.'},{status:503});}
  return NextResponse.json({ ok: true, owner: isOwner });
}
