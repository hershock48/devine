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

export const WORKROOM_COOKIE = "devine_workroom";
const COOKIE = WORKROOM_COOKIE;
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

/**
 * THE ONE PIN THROTTLE, for the login form and the PIN-as-header paths
 * alike: a four digit PIN is 10,000 guesses, and a review measured 30
 * unthrottled attempts landing in 43ms. Ten wrong tries per address per ten
 * minutes, counted in one place, on globalThis so a dev reload does not
 * forget. Per instance and in memory, which on serverless means a spread
 * attacker gets more than ten; still worth having, because it turns a
 * fifteen second sweep into something slow and noisy.
 */
export const PIN_WINDOW_MS = 10 * 60 * 1000;
export const PIN_MAX_FAILURES = 10;
type Bucket = { failures: number[] };
function buckets(): Map<string, Bucket> {
  const g = globalThis as typeof globalThis & { __devineLoginBuckets?: Map<string, Bucket> };
  if (!g.__devineLoginBuckets) g.__devineLoginBuckets = new Map();
  return g.__devineLoginBuckets;
}
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip"))?.trim() || "unknown";
}
/**
 * Two scopes, one rule each: the FORM (people at the counter) and the
 * HEADER (scripts: the catalog sync, the print helper). Separate buckets,
 * because a helper left with a wrong PIN would otherwise lock every phone
 * behind the shop's one public address out of the login form, and a
 * helper polling correctly every 30 seconds would otherwise wipe the
 * form's failure count twice a minute.
 */
export function pinThrottle(req: Request, scope: "form" | "header") {
  const key = `${scope}:${clientKey(req)}`;
  const now = Date.now();
  // The map is per address and lives as long as the process; a scan from
  // many addresses would grow it without end. Past a few hundred keys,
  // sweep the ones whose failures have all aged out.
  const all = buckets();
  if (all.size > 500) {
    for (const [k, b] of all) if (!b.failures.some((t) => now - t < PIN_WINDOW_MS)) all.delete(k);
  }
  const bucket = all.get(key) ?? { failures: [] };
  bucket.failures = bucket.failures.filter((t) => now - t < PIN_WINDOW_MS);
  return {
    tooMany: () => bucket.failures.length >= PIN_MAX_FAILURES,
    fail: () => {
      bucket.failures.push(now);
      buckets().set(key, bucket);
    },
    clear: () => buckets().delete(key),
  };
}

/**
 * The staff PIN as a request header, for scripts: the catalog sync by curl
 * and the print helper on the counter PC. Same throttle as the form.
 */
export function headerPinOk(req: Request): boolean {
  const pin = workroomPin();
  const given = req.headers.get("x-workroom-pin");
  if (!pin || !given) return false;
  const t = pinThrottle(req, "header");
  if (t.tooMany()) return false;
  // No clear on success: the helper polling correctly every 30 seconds
  // would otherwise wipe this bucket twice a minute and leave the header
  // unthrottled from its address. Failures age out of the window instead.
  if (given === pin) return true;
  t.fail();
  return false;
}

/** The gate for a route a script may call: the workroom cookie (a
    browser) or the staff PIN as a header (the helper, curl). */
export async function isWorkroomAuthedOrHeader(req: Request): Promise<boolean> {
  return (await isWorkroomAuthed()) || headerPinOk(req);
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
