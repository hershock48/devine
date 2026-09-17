import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { issueSession,sessionRole,SESSION_SECONDS } from './session';

/**
 * Workroom auth: two PINs and a signed role cookie. A gate, not a vault.
 *
 * The people using it are behind the counter on a shared screen, and a
 * password nobody remembers mid-rush gets written on the wall, which is
 * worse than a PIN. Since the September 2026 review the cookie no longer
 * holds the PIN itself: the server issues an HMAC-signed session naming the
 * role (see session.ts), so a stolen cookie cannot be read for the PIN and a
 * rotated PIN or secret signs everyone out at once.
 *
 * What sits behind it has grown past "the board and the stem tracker": the
 * workroom takes card and cash payments through Square (api/workroom/pay),
 * and the owner tier can release a stuck payment attempt. That is why the
 * fallbacks below are local-only and production fails closed.
 */

const COOKIE='devine_workroom';

/**
 * The staff PIN, or null meaning "this deployment has no workroom".
 *
 * THE FALLBACK IS NOT ALLOWED IN PRODUCTION, a change made after a review
 * found the old behavior indefensible: the fallback is committed to this
 * repo AND it is the last four of the shop's published phone number, so a
 * deployed workroom with WORKROOM_PIN unset was guarding every customer's
 * name, phone, delivery address and card message behind a number printed
 * in the footer. So in production an unset variable closes the door rather
 * than fitting a known lock: isWorkroomAuthed returns false and the login
 * route says plainly that the workroom is not configured. Nothing is
 * guessable, and the failure is loud to the operator instead of silent to
 * everyone else.
 */
export function workroomPin():string|null{return process.env.WORKROOM_PIN?.trim()||(process.env.NODE_ENV==='production'?null:'0830');}

/**
 * The owner's PIN, or null meaning "this deployment has no owner tier".
 *
 * TWO TIERS, ONE DOOR (Kevin, 2026-09-02: "maybe the owner doesn't really
 * want just any employee seeing that"). The staff PIN opens the working
 * screens: the board, the weekly order, inventory, quotes. The owner's PIN
 * opens everything the staff PIN does PLUS the money: the dashboard, the
 * build-math drawers, refund confirmation, and the payment-recovery
 * override. One login field accepts either; the server decides what the
 * session is worth. Unset in production means the owner tier is closed to
 * everyone, same closed-door rule as WORKROOM_PIN: a privacy control that
 * silently stops applying is worse than a dark screen.
 */
export function workroomOwnerPin():string|null{return process.env.WORKROOM_OWNER_PIN?.trim()||(process.env.NODE_ENV==='production'?null:'0831');}

// The HMAC key for session cookies. Production requires WORKROOM_SESSION_SECRET
// (32 or more characters). Local development mints one per process so the
// demo works with zero setup; every restart signs everyone out, which is fine.
function secret():string|null{
 const configured=process.env.WORKROOM_SESSION_SECRET;if(configured&&configured.length>=32)return configured;
 if(process.env.NODE_ENV==='production')return null;
 const state=globalThis as typeof globalThis & {__devineSessionSecret?:string};
 return state.__devineSessionSecret??(state.__devineSessionSecret=randomBytes(32).toString('hex'));
}

// Everything the door needs before it can open: a staff PIN, a signing
// secret, and owner and staff PINs that differ (identical PINs would turn
// every staff sign-in into an owner sign-in).
export function workroomSessionReady():boolean{
 const staff=workroomPin(),owner=workroomOwnerPin();
 return !!staff&&!!secret()&&(!owner||owner!==staff);
}

// The session's role, or null. session.ts verifies the signature against the
// CURRENT PINs, which is what makes a PIN change a log-everyone-out.
async function role(){
 if(!workroomSessionReady())return null;
 const jar=await cookies();return sessionRole(jar.get(COOKIE)?.value,secret(),{staff:workroomPin(),owner:workroomOwnerPin()});
}

// The owner's session opens every staff door too; a second sign-in to see
// the board would teach the owner to stay signed in as staff.
export async function isWorkroomAuthed():Promise<boolean>{return (await role())!==null;}
export async function isWorkroomOwner():Promise<boolean>{return (await role())==='owner';}

// Eighteen hours: a shop day plus the evening, not a season. sameSite strict
// because nothing off-site ever needs to arrive carrying this cookie.
export async function setWorkroomCookie(pin:string):Promise<void>{
 if(!workroomSessionReady())throw new Error('Workroom sessions are not configured.');
 const owner=workroomOwnerPin(),staff=workroomPin();
 const role=owner&&pin===owner?'owner':staff&&pin===staff?'staff':null;
 if(!role)throw new Error('Invalid workroom credential.');
 (await cookies()).set(COOKIE,issueSession(role,pin,secret()!),{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:SESSION_SECONDS,path:'/'});
}
