/** Payment lifecycle shared by online checkout and the workroom.
 * Persist the intent before a provider call. An uncertain attempt is never
 * automatically charged again; signed provider events/reconciliation settle it.
 */
export type PaymentResult={paymentId:string;status:string;receiptUrl:string;totalCents:number;feeCents:number};
export type AttemptState='prepared'|'processing'|'unknown'|'completed'|'failed';
export type Attempt<T>={key:string;fingerprint:string;state:AttemptState;snapshot:T;result:PaymentResult|null;createdAt:number};
export interface AttemptRepository<T>{
 prepare:(key:string,fingerprint:string,snapshot:T)=>Promise<Attempt<T>>;
 claim:(key:string)=>Promise<boolean>;
 settle:(key:string,state:AttemptState,result:PaymentResult|null)=>Promise<void>;
 read:(key:string)=>Promise<Attempt<T>|null>;
}
export type AttemptOutcome<T>={kind:'completed'|'pending'|'failed'|'conflict';attempt:Attempt<T>};
export async function runPayment<T>(repo:AttemptRepository<T>,key:string,fingerprint:string,snapshot:T,charge:(saved:T)=>Promise<PaymentResult>):Promise<AttemptOutcome<T>>{
 const attempt=await repo.prepare(key,fingerprint,snapshot);
 if(attempt.fingerprint!==fingerprint)return {kind:'conflict',attempt};
 if(attempt.state==='completed')return {kind:'completed',attempt};
 if(attempt.state==='failed')return {kind:'failed',attempt};
 if(attempt.state!=='prepared'||!(await repo.claim(key)))return {kind:'pending',attempt};
 let result:PaymentResult;
 try{result=await charge(attempt.snapshot);}catch{
  // A thrown response is ambiguous, even when the customer sees a timeout.
  await repo.settle(key,'unknown',null);
  const latest=await repo.read(key) || {...attempt,state:'unknown' as const};
  return {kind:latest.state==='completed'?'completed':'pending',attempt:latest};
 }
 const state=result.status==='COMPLETED'?'completed':['FAILED','CANCELED'].includes(result.status)?'failed':'unknown';
 await repo.settle(key,state,result);
 const latest=await repo.read(key) || {...attempt,state,result};
 return {kind:latest.state==='completed'?'completed':latest.state==='failed'?'failed':'pending',attempt:latest};
}
