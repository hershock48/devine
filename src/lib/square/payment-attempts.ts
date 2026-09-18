/** The Postgres side of payment-engine.ts: the devine_payment_attempts table
 * (one row per key with its state, snapshot and result) and the
 * devine_payment_reviews audit table behind the owner's stuck-row override.
 *
 * What it protects against: a retry, a late timeout or a replayed form
 * changing a row it should not. Row locks make concurrent staff clicks
 * converge; settle() never overwrites completed, never lets an old
 * fingerprint touch a newer generation, and never lets a late provider
 * timeout erase the owner's finding. A released row is archived under
 * archived:<key>:<reference>, not deleted, so the evidence outlives it.
 * The schema creates itself on first use, same as the workroom store. */
import 'server-only';
import type {Attempt,AttemptRepository,AttemptState,PaymentResult} from './payment-engine';
import {NOTICE_SCHEMA} from './payment-notices';
import type {Pool} from 'pg';
/** No durable store is configured at all, which is a different fact from a
 * store that is configured and unreachable. The first is the memory backend
 * and nothing about it improves by being asked again; the second is
 * transient. Callers that answer a provider need to tell them apart. */
export class NoPaymentStore extends Error {
 constructor(){super('Payments require persistent storage before contacting the provider.');}
}
let sharedPool:Pool|undefined,ready:Promise<unknown>|undefined;
export async function paymentDatabase(){
 const url=process.env.DATABASE_URL||process.env.POSTGRES_URL;
 if(!url)throw new NoPaymentStore();
 if(!sharedPool){const {Pool}=await import('pg');sharedPool=new Pool({connectionString:url,max:3,connectionTimeoutMillis:7000});}
 if(!ready)ready=sharedPool.query(`CREATE TABLE IF NOT EXISTS devine_payment_attempts (
 attempt_key text PRIMARY KEY, fingerprint text NOT NULL, state text NOT NULL,
 snapshot jsonb NOT NULL, result jsonb, created_at bigint NOT NULL,
 fulfilled boolean NOT NULL DEFAULT false, notified boolean NOT NULL DEFAULT false,
 updated_at bigint NOT NULL);
 ALTER TABLE devine_payment_attempts ADD COLUMN IF NOT EXISTS notify_until bigint NOT NULL DEFAULT 0;
 ALTER TABLE devine_payment_attempts ADD COLUMN IF NOT EXISTS customer_notified boolean NOT NULL DEFAULT false;
 ALTER TABLE devine_payment_attempts ADD COLUMN IF NOT EXISTS provider_conflict jsonb;
 ${NOTICE_SCHEMA}
 CREATE INDEX IF NOT EXISTS devine_payment_reference ON devine_payment_attempts ((snapshot->>'referenceId'));
 CREATE INDEX IF NOT EXISTS devine_payment_recovery ON devine_payment_attempts (state,fulfilled,notified);
 CREATE TABLE IF NOT EXISTS devine_payment_reviews (
 reference_id text PRIMARY KEY, attempt_key text NOT NULL, fingerprint text NOT NULL,
 actor text NOT NULL, evidence text NOT NULL, reviewed_at bigint NOT NULL,
 prior_state text NOT NULL, snapshot jsonb NOT NULL, prior_result jsonb);`).catch(e=>{ready=undefined;throw e;});
 await ready;return sharedPool;
}
const mapped=<T>(row:Record<string,unknown>):Attempt<T>=>({key:row.attempt_key as string,fingerprint:row.fingerprint as string,state:row.state as AttemptState,snapshot:row.snapshot as T,result:row.result as PaymentResult|null,createdAt:Number(row.created_at)});
export function attemptRepository<T>():AttemptRepository<T>{return {
 async prepare(key,fingerprint,snapshot,retryOf){
  const client=await (await paymentDatabase()).connect();
  try{
   await client.query('BEGIN');
   await client.query(`INSERT INTO devine_payment_attempts(attempt_key,fingerprint,state,snapshot,created_at,updated_at) VALUES($1,$2,'prepared',$3,$4,$4) ON CONFLICT DO NOTHING`,[key,fingerprint,JSON.stringify(snapshot),Date.now()]);
   let result=await client.query('SELECT * FROM devine_payment_attempts WHERE attempt_key=$1 FOR UPDATE',[key]);
   const prior=result.rows[0];
   // Explicitly acknowledge this exact failed attempt. The row lock makes two
   // staff retry clicks converge; pending/unknown/completed rows never release.
   if(key.startsWith('board_')&&prior.state==='failed'&&retryOf&&prior.snapshot.referenceId===retryOf){
    await client.query('UPDATE devine_payment_attempts SET attempt_key=$2 WHERE attempt_key=$1',[key,`archived:${key}:${retryOf}`]);
    result=await client.query(`INSERT INTO devine_payment_attempts(attempt_key,fingerprint,state,snapshot,created_at,updated_at) VALUES($1,$2,'prepared',$3,$4,$4) RETURNING *`,[key,fingerprint,JSON.stringify(snapshot),Date.now()]);
   }
   await client.query('COMMIT');return mapped<T>(result.rows[0]);
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 },
 async claim(key,fingerprint){const db=await paymentDatabase();const result=await db.query("UPDATE devine_payment_attempts SET state='processing',updated_at=$2 WHERE attempt_key=$1 AND state='prepared' AND ($3::text IS NULL OR fingerprint=$3) RETURNING attempt_key",[key,Date.now(),fingerprint??null]);return result.rowCount===1;},
 async settle(key,state,result,fingerprint){
  const db=await paymentDatabase();
  // A late timeout cannot erase the owner's review. Real completion still wins;
  // the fingerprint prevents an old request settling a new retry generation.
  await db.query(`UPDATE devine_payment_attempts SET state=$2,result=$3,updated_at=$4
   WHERE attempt_key=$1 AND state<>'completed' AND ($5::text IS NULL OR fingerprint=$5)
   AND (state<>'failed' OR result->>'status' IS DISTINCT FROM 'OWNER_CONFIRMED_NO_PAYMENT' OR $2='completed')`,
   [key,state,result?JSON.stringify(result):null,Date.now(),fingerprint??null]);
 },
 async read(key){const db=await paymentDatabase();const result=await db.query('SELECT * FROM devine_payment_attempts WHERE attempt_key=$1',[key]);return result.rows[0]?mapped<T>(result.rows[0]):null;},
};}

/** This is a manual finding, not a provider result. Keep it separately so a
 * later webhook or staff retry cannot erase who released which generation.
 * Callers must authenticate the owner and reconcile Square before entering. */
export async function recordNoPaymentReview(input: {
 key: string; referenceId: string; fingerprint: string; evidence: string;
}, now = Date.now()) {
 const evidence = input.evidence.trim();
 if (!input.key || !input.referenceId || !input.fingerprint || evidence.length < 20 || evidence.length > 2000) {
  throw new Error('Record how the original payment was verified, using 20 to 2000 characters.');
 }
 const client = await (await paymentDatabase()).connect();
 try {
  await client.query('BEGIN');
  const found = await client.query('SELECT * FROM devine_payment_attempts WHERE attempt_key=$1 FOR UPDATE', [input.key]);
  const reviewed = await client.query('SELECT fingerprint FROM devine_payment_reviews WHERE reference_id=$1', [input.referenceId]);
  // Retried form submission after a lost response is a read of its receipt. It
  // must not release a replacement attempt now occupying the same board key.
  if (reviewed.rows[0]?.fingerprint === input.fingerprint) {
   await client.query('COMMIT');
   return;
  }
  const row = found.rows[0];
  if (!row || row.snapshot.referenceId !== input.referenceId || row.fingerprint !== input.fingerprint) {
   throw new Error('The payment attempt changed. Reload and review the current attempt.');
  }
  if (!['processing', 'unknown'].includes(row.state) || row.result?.paymentId || row.fulfilled) {
   throw new Error('This attempt cannot be released as unpaid. Reconcile its payment first.');
  }
  // Let the bounded provider calls finish before an owner can override. Elapsed
  // time alone proves nothing; the owner must also supply independent evidence.
  if (now - Number(row.updated_at) < 5 * 60 * 1000) {
   throw new Error('Wait five minutes after the last payment activity, then verify it again.');
  }
  await client.query(`INSERT INTO devine_payment_reviews
   (reference_id,attempt_key,fingerprint,actor,evidence,reviewed_at,prior_state,snapshot,prior_result)
   VALUES($1,$2,$3,'owner',$4,$5,$6,$7,$8)`,
   [input.referenceId,input.key,input.fingerprint,evidence,now,row.state,JSON.stringify(row.snapshot),row.result ? JSON.stringify(row.result) : null]);
  await client.query(`UPDATE devine_payment_attempts SET state='failed',result=$2,updated_at=$3 WHERE attempt_key=$1`,
   [input.key,JSON.stringify({paymentId:'',status:'OWNER_CONFIRMED_NO_PAYMENT',receiptUrl:'',totalCents:0,feeCents:0}),now]);
  await client.query('COMMIT');
 } catch (error) {
  await client.query('ROLLBACK');
  throw error;
 } finally { client.release(); }
}

/** A provider payment that contradicts the saved intent, filed on the attempt
 * row for the owner to read on /workroom/payments.
 *
 * It is NOT put in devine_payment_reviews. That table is the record of a
 * human finding, one row per reference, and a machine-written row there would
 * both occupy the reference the owner may later need and make
 * recordNoPaymentReview's replay check treat the owner's own form as already
 * answered. This changes no payment state and settles nothing: a webhook body
 * that disagrees with what we saved is a question for a person, not a fact
 * about money. Only the first sighting is kept, so a redelivery does not
 * overwrite the date the shop first had a chance to see it.
 */
export async function recordProviderConflict(key:string,detail:{reason:string;paymentId:string;status:string;amountCents:number|null;locationId:string},now=Date.now()){
 const db=await paymentDatabase();
 await db.query(`UPDATE devine_payment_attempts SET provider_conflict=$2,updated_at=$3 WHERE attempt_key=$1 AND provider_conflict IS NULL`,
  [key,JSON.stringify({...detail,seenAt:now}),now]);
}
