/** Signed workroom sessions.
 *
 * What it protects against: the cookie being the credential. The cookie
 * carries {role, expires, nonce} and an HMAC over that payload keyed by the
 * server secret AND the current PIN for the role, so the cookie never
 * contains the PIN, a stolen cookie cannot be read for it, forging a role
 * needs the secret, and rotating either the PIN or the secret signs
 * everyone out at once. Constant-time comparison keeps the signature check
 * from leaking by timing. Pure functions, no I/O, so the tests cover every
 * branch without a browser. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export type WorkroomRole = 'staff' | 'owner';
export const SESSION_SECONDS = 60 * 60 * 18;
function sign(payload:string,secret:string,pin:string){return createHmac('sha256',secret).update(payload+'\0'+pin).digest('base64url');}
export function issueSession(role:WorkroomRole,pin:string,secret:string,now=Date.now()){
 if(secret.length<32)throw new Error('Workroom session secret must be at least 32 characters.');
 const payload=Buffer.from(JSON.stringify({role,expires:now+SESSION_SECONDS*1000,nonce:randomBytes(24).toString('base64url')})).toString('base64url');
 return payload+'.'+sign(payload,secret,pin);
}
export function sessionRole(token:string|undefined,secret:string|null,pins:{staff:string|null;owner:string|null},now=Date.now()):WorkroomRole|null{
 if(!token||token.length>1024||!secret||secret.length<32)return null;
 try{
  const parts=token.split('.');if(parts.length!==2)return null;const [payload,signature]=parts;
  const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  if(data.role!=='staff'&&data.role!=='owner')return null;
  const role=data.role as WorkroomRole,pin=pins[role];if(!pin)return null;
  const expected=sign(payload,secret,pin);const provided=Buffer.from(signature),wanted=Buffer.from(expected);
  if(provided.length!==wanted.length||!timingSafeEqual(provided,wanted))return null;
  // An expiry further out than one session length is a forged or corrupted
  // payload, not a long session, and is refused the same way.
  if(!Number.isFinite(data.expires)||data.expires<=now||data.expires>now+SESSION_SECONDS*1000||typeof data.nonce!=='string'||data.nonce.length<24)return null;
  return role;
 }catch{return null;}
}
