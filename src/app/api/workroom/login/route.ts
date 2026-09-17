import { NextResponse } from "next/server";
import { setWorkroomCookie, workroomOwnerPin, workroomPin, workroomSessionReady } from "@/lib/workroom/auth";

import {allowLogin,clearLoginAttempts,loginClient} from '@/lib/workroom/login-limit';

/**
 * The workroom door, with a bouncer.
 *
 * A four digit PIN is 10,000 guesses, and a review measured 30 unthrottled
 * attempts landing in 43ms, the whole space in about fifteen seconds. A PIN
 * is the right control for a shared screen behind a counter; leaving it
 * unthrottled on the public internet is not.
 *
 * The counter used to be per instance and in memory, which on serverless
 * meant an attacker spread across cold starts got more tries than the number
 * suggested. It now lives in Postgres (login-limit.ts): ten tries per ten
 * minutes per connecting address, shared by every instance. Per ADDRESS, not
 * global, so a stranger hammering the door cannot lock the shop out of its
 * own board (H7 in the September 2026 review).
 *
 * Knowing the address is the catch. Only the platform's own header is
 * trusted, and the code finds it through process.env.VERCEL, so when the
 * Vercel project is not exposing its system variables the door stays shut
 * and says so in words the owner can act on.
 */
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

  // Two different 503s on purpose. This one means the hosting setup, not the
  // database: the owner reads it on the sign-in screen and knows which
  // setting to flip. Same sentence as copperac.
  let client:string;
  try { client=loginClient(req); }
  catch { return NextResponse.json({ error: "Sign-in is off until the hosting settings let the site see your connection address.", reason: "trusted_address_unavailable" }, { status: 503 }); }
  // Counted before the body is read, so an empty or malformed request still
  // costs this address one of its ten tries.
  try {
    if(!(await allowLogin(client)))return NextResponse.json({error:'Too many tries. Wait ten minutes.'},{status:429,headers:{'Retry-After':'600'}});
  }catch{return NextResponse.json({error:'Sign-in storage is unavailable. Please try again later.'},{status:503});}

  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  // One field, two PINs: staff or owner. The server issues a signed role session for whichever credential was
  // accepted; the cookie never contains the PIN.
  const owner = workroomOwnerPin();
  const isOwner = owner !== null && body?.pin === owner;
  if (typeof body?.pin !== "string" || body.pin.length>512 || (body.pin !== pin && !isOwner)) {
    // The try was already counted above, so a wrong PIN needs no bookkeeping
    // here. The length cap keeps a megabyte "PIN" from costing a comparison.
    return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });
  }

  // A right PIN clears only this address's count; everyone else's stands.
  try{await clearLoginAttempts(client);await setWorkroomCookie(body.pin);}
  catch{return NextResponse.json({error:'Sign-in could not finish. Please try again.'},{status:503});}
  return NextResponse.json({ ok: true, owner: isOwner });
}
