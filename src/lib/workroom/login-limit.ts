import 'server-only';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
const WINDOW_MS=10*60*1000,LIMIT=10;
type Pool={query:(sql:string,values?:unknown[])=>Promise<{rows:{attempts:number}[]}>};
const shared=globalThis as typeof globalThis & {__devineLoginPool?:Pool;__devineLoginSchema?:Promise<unknown>;__devineClientLogins?:Map<string,{started:number;attempts:number}>};
async function pool(){
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL;if(!url)throw Error('Persistent login throttling needs a database.');
 if(!shared.__devineLoginPool){const {Pool}=await import('pg');shared.__devineLoginPool=new Pool({connectionString:url,max:2,connectionTimeoutMillis:7000});}
 if(!shared.__devineLoginSchema)shared.__devineLoginSchema=shared.__devineLoginPool.query('CREATE TABLE IF NOT EXISTS devine_login_attempts (id text PRIMARY KEY, attempts integer NOT NULL, started bigint NOT NULL); CREATE INDEX IF NOT EXISTS devine_login_expiry ON devine_login_attempts(started)').catch(e=>{shared.__devineLoginSchema=undefined;throw e;});
 await shared.__devineLoginSchema;return shared.__devineLoginPool;
}

/** Only deployment-controlled proxy headers are identities. Never trust an
 * arbitrary forwarded header on a direct/self-hosted Node server. Vercel
 * overwrites x-vercel-forwarded-for at its edge. Other hosts must explicitly
 * configure an overwriting trusted proxy and WORKROOM_TRUSTED_IP_HEADER. */
export function loginClient(req:Request):string {
 const configured=process.env.WORKROOM_TRUSTED_IP_HEADER;
 const header=process.env.VERCEL==='1'?'x-vercel-forwarded-for':configured;
 if(header&&!['x-vercel-forwarded-for','x-forwarded-for','x-real-ip'].includes(header))throw Error('Invalid trusted client-address configuration.');
 if(!header){
  if(process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1','[::1]'].includes(new URL(req.url).hostname))return 'local-loopback';
  throw Error('Trusted client address unavailable.');
 }
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
