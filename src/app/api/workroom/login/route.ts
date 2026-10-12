import { NextResponse } from "next/server";
import { PIN_WINDOW_MS, pinThrottle, setWorkroomCookie, workroomOwnerPin, workroomPin } from "@/lib/workroom/auth";

/**
 * The workroom door, with a bouncer.
 *
 * A four digit PIN is 10,000 guesses, and a review measured 30 unthrottled
 * attempts landing in 43ms — the whole space in about fifteen seconds. A PIN
 * is the right control for a shared screen behind a counter; leaving it
 * unthrottled on the public internet is not.
 *
 * The counter is per instance and in memory, which on serverless means an
 * attacker spread across enough cold starts gets more attempts than the
 * number below suggests. That is a real limit and it is still worth having:
 * it turns a fifteen second sweep into something slow, noisy and obvious,
 * which is all a counter PIN needs to survive. A shared store is the upgrade
 * if this ever guards more than the order board.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pin = workroomPin();
  if (pin === null) {
    // Unset in production is a closed door, not an open one. Say so, because
    // this is the operator's problem to fix and nobody else's to work around.
    return NextResponse.json(
      { error: "The workroom is not set up on this deployment yet.", reason: "unconfigured" },
      { status: 503 },
    );
  }

  const throttle = pinThrottle(req, "form");
  if (throttle.tooMany()) {
    return NextResponse.json(
      { error: "Too many tries. Wait a few minutes." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(PIN_WINDOW_MS / 1000)) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { pin?: unknown };
  // One field, two PINs: staff or owner. The cookie holds whichever was
  // typed, and the auth helpers decide per request what it is worth.
  const owner = workroomOwnerPin();
  const isOwner = owner !== null && body.pin === owner;
  if (typeof body.pin !== "string" || (body.pin !== pin && !isOwner)) {
    throttle.fail();
    return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });
  }

  throttle.clear();
  await setWorkroomCookie(body.pin);
  return NextResponse.json({ ok: true, owner: isOwner });
}
