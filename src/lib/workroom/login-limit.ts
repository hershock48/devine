import 'server-only';
const WINDOW_MS=10*60*1000;
const LIMIT=10;
type Pool = { query:(sql:string,values?:unknown[])=>Promise<{rows:{attempts:number}[]}> };
const shared=globalThis as typeof globalThis & {__devineLoginPool?:Pool;__devineLoginSchema?:Promise<unknown>;__devineLocalLogin?:{started:number;attempts:number}};
async function pool(){
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL;
 if(!url)throw new Error('Persistent login throttling needs a database.');
 if(!shared.__devineLoginPool){const {Pool}=await import('pg');shared.__devineLoginPool=new Pool({connectionString:url,max:2,connectionTimeoutMillis:7000});}
 if(!shared.__devineLoginSchema)shared.__devineLoginSchema=shared.__devineLoginPool.query('CREATE TABLE IF NOT EXISTS devine_login_attempts (id text PRIMARY KEY, attempts integer NOT NULL, started bigint NOT NULL)').catch(e=>{shared.__devineLoginSchema=undefined;throw e;});
 await shared.__devineLoginSchema;return shared.__devineLoginPool;
}
export async function allowLogin(now=Date.now()){
 if(process.env.NODE_ENV!=='production'&&!process.env.DATABASE_URL&&!process.env.POSTGRES_URL){
  const current=shared.__devineLocalLogin;
  const bucket=current&&now-current.started<WINDOW_MS?current:{started:now,attempts:0};bucket.attempts++;shared.__devineLocalLogin=bucket;return bucket.attempts<=LIMIT;
 }
 const db=await pool();const result=await db.query(`INSERT INTO devine_login_attempts(id,attempts,started) VALUES('workroom',1,$1)
 ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN devine_login_attempts.started<=$2 THEN 1 ELSE devine_login_attempts.attempts+1 END,
 started=CASE WHEN devine_login_attempts.started<=$2 THEN $1 ELSE devine_login_attempts.started END RETURNING attempts`,[now,now-WINDOW_MS]);return result.rows[0].attempts<=LIMIT;
}
export async function clearLoginAttempts(){
 if(process.env.NODE_ENV!=='production'&&!process.env.DATABASE_URL&&!process.env.POSTGRES_URL){shared.__devineLocalLogin=undefined;return;}
 await (await pool()).query("DELETE FROM devine_login_attempts WHERE id='workroom'");
}
