/** The 2026-09-28 audit's lockout, and the way out of it.
 *
 * A card checkout whose request never reached Square used to leave the cart on
 * "Payment is awaiting confirmation. Do not pay again" forever: the status
 * check found no saved attempt, or one still 'prepared', and could only say
 * "pending". These run the real repository on PGlite and the real engine.
 */
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load,database,engine,intent,completed}=require('./harness.cjs');

test('no saved attempt: the release plants a failed marker, and a late copy of the request cannot charge',async()=>{
 const f=await database();try{
  const key=crypto.randomUUID();
  await f.repository.releaseUnsubmitted(key);
  const marker=await f.repo.read(key);
  assert.equal(marker.state,'failed');assert.equal(marker.result.status,'NOT_SUBMITTED');
  // The original request arriving after the customer gave up on it.
  let charged=0;
  const late=await engine.runPayment(f.repo,key,'late',{...intent,referenceId:crypto.randomUUID()},async()=>{charged++;return completed;});
  assert.equal(late.kind,'failed');assert.equal(charged,0);
 }finally{await f.db.close();}
});

test('a stalled prepared attempt is released only after 15 seconds, and never once claimed',async()=>{
 const f=await database();try{
  const key=crypto.randomUUID(),saved={...intent,referenceId:crypto.randomUUID()};
  await f.repo.prepare(key,'one',saved);
  await f.repository.releaseUnsubmitted(key);
  assert.equal((await f.repo.read(key)).state,'prepared','a request between prepare and claim is not raced');
  await f.pool.query('UPDATE devine_payment_attempts SET updated_at=$1 WHERE attempt_key=$2',[Date.now()-60000,key]);
  await f.repository.releaseUnsubmitted(key);
  const released=await f.repo.read(key);
  assert.equal(released.state,'failed');assert.equal(released.result.failureCode,'STOPPED_BEFORE_CHARGE');
  assert.equal(await f.repo.claim(key,'one'),false,'the claim that would precede CreatePayment now fails');

  const busy=crypto.randomUUID();
  await f.repo.prepare(busy,'one',{...intent,referenceId:crypto.randomUUID()});await f.repo.claim(busy,'one');
  await f.pool.query('UPDATE devine_payment_attempts SET updated_at=$1 WHERE attempt_key=$2',[Date.now()-60000,busy]);
  await f.repository.releaseUnsubmitted(busy);
  assert.equal((await f.repo.read(busy)).state,'processing','a claimed attempt may have reached Square and stays fenced');
 }finally{await f.db.close();}
});

test('the status route turns a never-submitted checkout into Return to checkout, and keeps a real pending one pending',async()=>{
 const f=await database();try{
  const serviceFor=repo=>({pendingMessage:'Awaiting confirmation; do not pay again.',paymentRepo:()=>repo,reconcilePayment:async key=>repo.read(key)});
  const route=load('src/app/api/order/payment-status/route.ts',{
   'next/server':{NextResponse:{json:(value,init)=>Response.json(value,init)}},
   '@/lib/square/payment-service':serviceFor(f.repo),
   '@/lib/square/payment-attempts':f.repository,
  });
  const ask=async key=>(await route.POST(new Request('https://fixture.invalid/api/order/payment-status',{method:'POST',body:JSON.stringify({attemptKey:key})}))).json();

  const never=await ask(crypto.randomUUID());
  assert.equal(never.failed,true);assert.match(never.error,/Nothing was charged/);

  const inFlight=crypto.randomUUID();
  await f.repo.prepare(inFlight,'one',{...intent,referenceId:crypto.randomUUID()});await f.repo.claim(inFlight,'one');
  const pending=await ask(inFlight);
  assert.equal(pending.failed,false,'a claimed attempt is the ambiguous case and is never released here');
 }finally{await f.db.close();}
});

test('the owner payments list skips release markers, which carry no order to show',async()=>{
 const f=await database();try{
  await f.repository.releaseUnsubmitted(crypto.randomUUID());
  const shown=await f.pool.query(`SELECT attempt_key FROM devine_payment_attempts a WHERE a.attempt_key NOT LIKE 'archived:%' AND a.snapshot ? 'order'`);
  assert.equal(shown.rows.length,0);
 }finally{await f.db.close();}
});
