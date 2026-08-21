import "server-only";

import { cookies } from "next/headers";

/**
 * Workroom auth: a PIN and a cookie. A gate, not a vault (pjs's words).
 *
 * Nothing behind it moves money or reads a card: the board and the stem
 * tracker. The people using it are behind the counter on a shared screen, and
 * a password nobody remembers mid-rush gets written on the wall, which is
 * worse than a PIN.
 *
 * What it must not become: the gate on anything that can refund or charge.
 * When Stripe lands, that stays behind a real login.
 *
 * The fallback is the shop phone's last four, so the demo works with zero
 * setup and the owner can be told the PIN over the counter. Set WORKROOM_PIN
 * in Vercel before this carries a real day's orders.
 */

const COOKIE = "devine_workroom";
const PIN_FALLBACK = "0830";

export function workroomPin(): string {
  return process.env.WORKROOM_PIN || PIN_FALLBACK;
}

export async function isWorkroomAuthed(): Promise<boolean> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value === workroomPin();
}

export async function setWorkroomCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, workroomPin(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 18, // a shop day plus the evening, not a season
    path: "/",
  });
}
