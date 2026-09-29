/** Sign-in throttling for the workroom, per connecting address.
 *
 * What it protects against: a four digit PIN being swept (10,000 guesses)
 * and, just as much, a stranger locking the shop out of its own board by
 * burning a shared counter. Ten tries per ten minutes per address, counted
 * in Postgres so every serverless instance sees the same number; a success
 * clears only that address. The address is only ever read from a header the
 * platform overwrites at its edge (x-vercel-forwarded-for when VERCEL=1, or
 * the one named in WORKROOM_TRUSTED_IP_HEADER behind a proxy that does the
 * same), because a header the client can set is not an identity. When no
 * trusted source exists in production, loginClient throws and the login
 * route tells the owner which hosting setting to flip. Local loopback
 * development uses a bounded in-memory map. The stored key is a hash of
 * the address, so the table never holds a visitor's IP in the clear. */
import 'server-only';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
const WINDOW_MS=10*60*1000,LIMIT=10;
type Pool={query:(sql:string,values?:unknown[])=>Promise<{rows:{attempts:number}[]}>};
const shared=globalThis as typeof globalThis & {__devineLoginPool?:Pool;__devineLoginSchema?:Promise<unknown>;__devineClientLogins?:Map<string,{started:number;attempts:number}>};
async function pool(){
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL;if(!url)throw Error('Persistent login throttling needs a database.');
 if(!shared.__devineLoginPool){const {Pool}=await import('pg');shared.__devineLoginPool=new Pool({connectionString:url,max:2,connectionTimeoutMillis:7000});}
 // A failed schema promise is dropped so the next request retries instead
 // of every later request awaiting the same rejection (the store.ts lesson).
 if(!shared.__devineLoginSchema)shared.__devineLoginSchema=shared.__devineLoginPool.query('CREATE TABLE IF NOT EXISTS devine_login_attempts (id text PRIMARY KEY, attempts integer NOT NULL, started bigint NOT NULL); CREATE INDEX IF NOT EXISTS devine_login_expiry ON devine_login_attempts(started)').catch(e=>{shared.__devineLoginSchema=undefined;throw e;});
 await shared.__devineLoginSchema;return shared.__devineLoginPool;
}

/** Only deployment-controlled proxy headers are identities. Never trust an
 * arbitrary forwarded header on a direct/self-hosted Node server. Vercel
 * overwrites x-vercel-forwarded-for at its edge. Other hosts must explicitly
 * configure an overwriting trusted proxy and WORKROOM_TRUSTED_IP_HEADER. */
export function loginClient(req:Request):string {
 const configured=process.env.WORKROOM_TRUSTED_IP_HEADER;
 // process.env.VERCEL only exists when the project exposes its system
 // variables; .env.example and the README say so, and the login route turns
 // the throw below into an owner-readable 503.
 const header=process.env.VERCEL==='1'?'x-vercel-forwarded-for':configured;
 if(header&&!['x-vercel-forwarded-for','x-forwarded-for','x-real-ip'].includes(header))throw Error('Invalid trusted client-address configuration.');
 if(!header){
  if(process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname))return 'local-loopback';
  throw Error('Trusted client address unavailable.');
 }
 // One address exactly. A comma-separated chain means something other than
 // the trusted proxy wrote the header, so it is refused rather than parsed.
 const raw=req.headers.get(header)?.trim()??'';
 if(!isIP(raw))throw Error('Trusted client address unavailable.');
 const canonical=isIP(raw)===6?new URL('http://['+raw+']/').hostname:raw;
 return createHash('sha256').update(canonical).digest('hex');
}

export async function allowLogin(client:string,now=Date.now()){
 if(!client)throw Error('Client identity required.');const key='workroom:'+client;
 if(process.env.NODE_ENV!=='production'&&!process.env.DATABASE_URL&&!process.env.POSTGRES_URL){
  const buckets=shared.__devineClientLogins??=new Map();
  for(const [id,bucket]of buckets)if(now-bucket.started>=WINDOW_MS)buckets.delete(id);
  if(!buckets.has(key)&&buckets.size>=4096)throw Error('Local sign-in capacity reached.');
  const old=buckets.get(key),bucket=old&&now>=old.started&&now-old.started<WINDOW_MS?old:{started:now,attempts:0};
  bucket.attempts=Math.min(bucket.attempts,LIMIT)+1;buckets.set(key,bucket);return bucket.attempts<=LIMIT;
 }
 // One atomic upsert: a fresh window starts at 1, an open window increments
 // (capped so the count cannot run away), and the window start never moves
 // while it is open. Two instances racing still land on one true count.
 const db=await pool();await db.query('DELETE FROM devine_login_attempts WHERE started<=$1',[now-WINDOW_MS]);
 const result=await db.query(`INSERT INTO devine_login_attempts(id,attempts,started) VALUES($1,1,$2)
 ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN devine_login_attempts.started<=$3 THEN 1 ELSE LEAST(devine_login_attempts.attempts,10)+1 END,
 started=CASE WHEN devine_login_attempts.started<=$3 THEN $2 ELSE devine_login_attempts.started END RETURNING attempts`,[key,now,now-WINDOW_MS]);return result.rows[0].attempts<=LIMIT;
}
export async function clearLoginAttempts(client:string){
 if(!client)throw Error('Client identity required.');const key='workroom:'+client;
 if(process.env.NODE_ENV!=='production'&&!process.env.DATABASE_URL&&!process.env.POSTGRES_URL){shared.__devineClientLogins?.delete(key);return;}
 await(await pool()).query('DELETE FROM devine_login_attempts WHERE id=$1',[key]);
}

/** Public forms (2026-09-28 audit: nothing limited them, and the inquiry form
 * emails the shop and files a draft quote for anyone). The same durable
 * counter as sign-in, under its own key per form, so a flood of inquiries
 * cannot eat a person's sign-in tries or the reverse.
 *
 * It fails OPEN, the opposite of sign-in: with no trusted address, no
 * database, or the database down, the post goes through. A limiter that
 * turns away a real customer when it cannot count is worse than the flood it
 * exists for; sign-in fails closed because a missed count there is a guess
 * at a PIN. */
export async function allowFormPost(form:'inquiry'|'order',req:Request,limit:number,now=Date.now()):Promise<boolean>{
 let client:string;
 try{client=loginClient(req);}catch{return true;}
 if(!process.env.DATABASE_URL&&!process.env.POSTGRES_URL)return true;
 try{
  const db=await pool();await db.query('DELETE FROM devine_login_attempts WHERE started<=$1',[now-WINDOW_MS]);
  const result=await db.query(`INSERT INTO devine_login_attempts(id,attempts,started) VALUES($1,1,$2)
  ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN devine_login_attempts.started<=$3 THEN 1 ELSE LEAST(devine_login_attempts.attempts,$4)+1 END,
  started=CASE WHEN devine_login_attempts.started<=$3 THEN $2 ELSE devine_login_attempts.started END RETURNING attempts`,[`${form}:${client}`,now,now-WINDOW_MS,limit]);
  return result.rows[0].attempts<=limit;
 }catch(err){console.error('[devine] form limit unavailable, allowing the post',err);return true;}
}
