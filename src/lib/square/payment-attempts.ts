import 'server-only';
import type {Attempt,AttemptRepository,AttemptState,PaymentResult} from './payment-engine';
import type {Pool} from 'pg';
let sharedPool:Pool|undefined,ready:Promise<unknown>|undefined;
export async function paymentDatabase(){
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL;
 if(!url)throw new Error('Payments require persistent storage before contacting the provider.');
 if(!sharedPool){const {Pool}=await import('pg');sharedPool=new Pool({connectionString:url,max:3,connectionTimeoutMillis:7000});}
 if(!ready)ready=sharedPool.query(`CREATE TABLE IF NOT EXISTS devine_payment_attempts (
 attempt_key text PRIMARY KEY, fingerprint text NOT NULL, state text NOT NULL,
 snapshot jsonb NOT NULL, result jsonb, created_at bigint NOT NULL,
 fulfilled boolean NOT NULL DEFAULT false, notified boolean NOT NULL DEFAULT false,
 updated_at bigint NOT NULL);
 ALTER TABLE devine_payment_attempts ADD COLUMN IF NOT EXISTS notify_until bigint NOT NULL DEFAULT 0;
 ALTER TABLE devine_payment_attempts ADD COLUMN IF NOT EXISTS customer_notified boolean NOT NULL DEFAULT false;
 CREATE INDEX IF NOT EXISTS devine_payment_reference ON devine_payment_attempts ((snapshot->>'referenceId'));
 CREATE INDEX IF NOT EXISTS devine_payment_recovery ON devine_payment_attempts (state,fulfilled,notified);`).catch(e=>{ready=undefined;throw e;});
 await ready;return sharedPool;
}
const mapped=<T>(row:Record<string,unknown>):Attempt<T>=>({key:row.attempt_key as string,fingerprint:row.fingerprint as string,state:row.state as AttemptState,snapshot:row.snapshot as T,result:row.result as PaymentResult|null,createdAt:Number(row.created_at)});
export function attemptRepository<T>():AttemptRepository<T>{return {
 async prepare(key,fingerprint,snapshot){const db=await paymentDatabase();await db.query(`INSERT INTO devine_payment_attempts(attempt_key,fingerprint,state,snapshot,created_at,updated_at) VALUES($1,$2,'prepared',$3,$4,$4) ON CONFLICT DO NOTHING`,[key,fingerprint,JSON.stringify(snapshot),Date.now()]);const result=await db.query('SELECT * FROM devine_payment_attempts WHERE attempt_key=$1',[key]);return mapped<T>(result.rows[0]);},
 async claim(key){const db=await paymentDatabase();const result=await db.query("UPDATE devine_payment_attempts SET state='processing',updated_at=$2 WHERE attempt_key=$1 AND state='prepared' RETURNING attempt_key",[key,Date.now()]);return result.rowCount===1;},
 async settle(key,state,result){const db=await paymentDatabase();await db.query("UPDATE devine_payment_attempts SET state=$2,result=$3,updated_at=$4 WHERE attempt_key=$1 AND state<>'completed'",[key,state,result?JSON.stringify(result):null,Date.now()]);},
 async read(key){const db=await paymentDatabase();const result=await db.query('SELECT * FROM devine_payment_attempts WHERE attempt_key=$1',[key]);return result.rows[0]?mapped<T>(result.rows[0]):null;},
};}
