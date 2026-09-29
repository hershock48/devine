import 'server-only';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { issueSession,sessionRole,SESSION_SECONDS } from './session';
const COOKIE='devine_workroom';
// Demo credentials apply only to local development. Production fails closed.
export function workroomPin():string|null{return process.env.WORKROOM_PIN?.trim()||(process.env.NODE_ENV==='production'?null:'0830');}
export function workroomOwnerPin():string|null{return process.env.WORKROOM_OWNER_PIN?.trim()||(process.env.NODE_ENV==='production'?null:'0831');}
function secret():string|null{
 const configured=process.env.WORKROOM_SESSION_SECRET;if(configured&&configured.length>=32)return configured;
 if(process.env.NODE_ENV==='production')return null;
 const state=globalThis as typeof globalThis & {__devineSessionSecret?:string};
 return state.__devineSessionSecret??(state.__devineSessionSecret=randomBytes(32).toString('hex'));
}
export function workroomSessionReady():boolean{
 const staff=workroomPin(),owner=workroomOwnerPin();
 return !!staff&&!!secret()&&(!owner||owner!==staff);
}
async function role(){
 if(!workroomSessionReady())return null;
 const jar=await cookies();return sessionRole(jar.get(COOKIE)?.value,secret(),{staff:workroomPin(),owner:workroomOwnerPin()});
}
export async function isWorkroomAuthed():Promise<boolean>{return (await role())!==null;}
export async function isWorkroomOwner():Promise<boolean>{return (await role())==='owner';}
export async function setWorkroomCookie(pin:string):Promise<void>{
 if(!workroomSessionReady())throw new Error('Workroom sessions are not configured.');
 const owner=workroomOwnerPin(),staff=workroomPin();
 const role=owner&&pin===owner?'owner':staff&&pin===staff?'staff':null;
 if(!role)throw new Error('Invalid workroom credential.');
 (await cookies()).set(COOKIE,issueSession(role,pin,secret()!),{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:SESSION_SECONDS,path:'/'});
}
