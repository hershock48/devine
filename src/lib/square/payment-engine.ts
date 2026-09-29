/** Payment lifecycle shared by online checkout and the workroom.
 * Persist the intent before a provider call. An uncertain attempt is never
 * automatically charged again; signed provider events/reconciliation settle it.
 */
export type PaymentResult={paymentId:string;status:string;receiptUrl:string;totalCents:number;feeCents:number;failureCode?:string};
/** Only throw this before CreatePayment is invoked. Creating a Square order
 * does not collect money; losing a CreatePayment response is a different case. */
export class PaymentNotSubmitted extends Error {
 constructor(public code:string){super('No payment request was submitted.');}
}
export type AttemptState='prepared'|'processing'|'unknown'|'completed'|'failed';
export type Attempt<T>={key:string;fingerprint:string;state:AttemptState;snapshot:T;result:PaymentResult|null;createdAt:number};
export interface AttemptRepository<T>{
 prepare:(key:string,fingerprint:string,snapshot:T,retryOf?:string)=>Promise<Attempt<T>>;
 claim:(key:string,fingerprint?:string)=>Promise<boolean>;
 settle:(key:string,state:AttemptState,result:PaymentResult|null,fingerprint?:string)=>Promise<void>;
 read:(key:string)=>Promise<Attempt<T>|null>;
}
export type AttemptOutcome<T>={kind:'completed'|'pending'|'failed'|'conflict';attempt:Attempt<T>};
export async function runPayment<T>(repo:AttemptRepository<T>,key:string,fingerprint:string,snapshot:T,charge:(saved:T)=>Promise<PaymentResult>,retryOf?:string):Promise<AttemptOutcome<T>>{
 const attempt=await repo.prepare(key,fingerprint,snapshot,retryOf);
 // A confirmed failure is safe to retry explicitly, even with a different
 // card or cash. It is not an unresolved charge merely because the body changed.
 if(attempt.state==='failed')return {kind:'failed',attempt};
 if(attempt.fingerprint!==fingerprint)return {kind:'conflict',attempt};
 if(attempt.state==='completed')return {kind:'completed',attempt};
 if(attempt.state!=='prepared'||!(await repo.claim(key,fingerprint)))return {kind:'pending',attempt};
 let result:PaymentResult;
 try{result=await charge(attempt.snapshot);}catch(error){
  const notSubmitted=error instanceof PaymentNotSubmitted;
  const state=notSubmitted?'failed':'unknown';
  const failure=notSubmitted?{paymentId:'',status:'NOT_SUBMITTED',receiptUrl:'',totalCents:0,feeCents:0,failureCode:error.code}:null;
  await repo.settle(key,state,failure,fingerprint);
  const latest=await repo.read(key) || {...attempt,state,result:failure};
  return {kind:latest.state==='completed'?'completed':latest.state==='failed'?'failed':'pending',attempt:latest};
 }
 const state=result.status==='COMPLETED'?'completed':['FAILED','CANCELED'].includes(result.status)?'failed':'unknown';
 await repo.settle(key,state,result,fingerprint);
 const latest=await repo.read(key) || {...attempt,state,result};
 return {kind:latest.state==='completed'?'completed':latest.state==='failed'?'failed':'pending',attempt:latest};
}
