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
/** Local development only. See workroomPin(). */
const PIN_FALLBACK = "0830";
/** Local development only, same contract as PIN_FALLBACK. */
const OWNER_FALLBACK = "0831";

/**
 * The PIN, or null meaning "this deployment has no workroom".
 *
 * THE FALLBACK IS NOT ALLOWED IN PRODUCTION, and that is a change made after a
 * review found the old behaviour indefensible: the fallback is committed to
 * this repo AND it is the last four of the shop's published phone number, so a
 * deployed workroom with WORKROOM_PIN unset was guarding every customer's
 * name, phone, delivery address and card message behind a number printed in
 * the footer. The README listed setting it as a to-do, which is not a control.
 *
 * So in production an unset variable closes the door rather than fitting a
 * known lock: isWorkroomAuthed returns false and the login route says plainly
 * that the workroom is not configured. Nothing is guessable, and the failure
 * is loud to the operator instead of silent to everyone else.
 */
export function workroomPin(): string | null {
  const set = process.env.WORKROOM_PIN;
  if (set && set.trim()) return set.trim();
  return process.env.NODE_ENV === "production" ? null : PIN_FALLBACK;
}

/**
 * The owner's PIN, or null meaning "this deployment has no owner tier".
 *
 * TWO TIERS, ONE DOOR (Kevin, 2026-09-02: "maybe the owner doesn't really
 * want just any employee seeing that"). The staff PIN opens the working
 * screens: the board, the weekly order, inventory, quotes. The owner's PIN
 * opens everything the staff PIN does PLUS the money: the dashboard, and
 * the build-math drawers. One login field accepts either; the server
 * decides what the cookie is worth. Unset in production means the owner
 * tier is closed to everyone, same closed-door rule as WORKROOM_PIN: a
 * privacy control that silently stops applying is worse than a dark screen.
 */
export function workroomOwnerPin(): string | null {
  const set = process.env.WORKROOM_OWNER_PIN;
  if (set && set.trim()) return set.trim();
  return process.env.NODE_ENV === "production" ? null : OWNER_FALLBACK;
}

export async function isWorkroomAuthed(): Promise<boolean> {
  const pin = workroomPin();
  if (pin === null) return false;
  const jar = await cookies();
  const held = jar.get(COOKIE)?.value;
  // The owner's cookie opens every staff door too; a second sign-in to see
  // the board would teach the owner to stay signed in as staff.
  const owner = workroomOwnerPin();
  return held === pin || (owner !== null && held === owner);
}

export async function isWorkroomOwner(): Promise<boolean> {
  const owner = workroomOwnerPin();
  if (owner === null) return false;
  const jar = await cookies();
  return jar.get(COOKIE)?.value === owner;
}

export async function setWorkroomCookie(pin: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, pin, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 18, // a shop day plus the evening, not a season
    path: "/",
  });
}
