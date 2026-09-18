/** The webhook's retry contract and the order notification's recovery path,
 * both against a real PostgreSQL (PGlite) with a fake Square and a fake mail
 * server. Nothing here charges, sends or connects to anything.
 *
 * What these tests are for, in the order they appear:
 *  - a shop with no database gets its sale recorded and a 200 off production
 *  - the same shop in production gets a 500, because that database is fixable
 *  - a payload that contradicts the saved intent is filed, answered 200, and
 *    does not claim the board ticket it was supposed to settle
 *  - a storage failure still returns 500, because asking again can fix it
 *  - an email that fails after the charge is retried once, and charges nothing
 *  - an email whose answer was lost is recorded, and recovery will not repeat it
 *  - a second click sends nothing when the first send worked
 *  - a send the mail server only partly accepted, and what the owner can do
 *  - a delivered notice whose flag write was lost stops being listed as work
 *  - a notice row another transaction is holding refuses instead of throwing
 *  - a filed Square conflict the owner can finish with
 *  - the words the owner reads instead of the code's own reason tokens
 */
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load,database,engine,noticeStore,cfg,order,intent,completed}=require('./harness.cjs');

const WEBHOOK_URL='https://fixture.invalid/api/square/webhook';
const WEBHOOK_ENV={SQUARE_WEBHOOK_SIGNATURE_KEY:'fixture-signature-key',SQUARE_WEBHOOK_URL:WEBHOOK_URL};
const signed=raw=>crypto.createHmac('sha256',WEBHOOK_ENV.SQUARE_WEBHOOK_SIGNATURE_KEY).update(WEBHOOK_URL+raw).digest('base64');
const completedEvent=payment=>JSON.stringify({type:'payment.updated',data:{object:{payment:{status:'COMPLETED',...payment}}}});
const deliver=(route,raw,signature=signed(raw))=>route.POST(new Request(WEBHOOK_URL,{method:'POST',body:raw,headers:{'x-square-hmacsha256-signature':signature}}));

/** The board order as an online checkout saves it: a priced order rides along
 * so the two emails have something to render. */
const onlineIntent=(email='fixture@example.invalid')=>({
 ...intent,
 online:{order:{...order,number:order.number,name:'Fixture',email,fulfillment:'pickup',date:'2026-09-20',lines:order.lines,subtotal:20},deliveryCents:0},
});

/** A fake mail server that records every send and can be told to refuse. */
function mailer(){
 const sends=[];
 return {sends,module:{
  noticeMessageId:key=>`<${crypto.createHash('sha256').update(key).digest('hex').slice(0,40)}@fixture.invalid>`,
  sendPaymentNotice:async(priced,paid,audience,messageId)=>{
   const refuse=mailerState.refuse;
   sends.push({audience,messageId,refused:!!refuse});
   if(!priced.email&&audience==='customer')return {outcome:'not-needed',providerMessageId:null,providerResponse:null,error:null};
   if(refuse)return {outcome:'send-failed',providerMessageId:null,providerResponse:null,error:'Connection refused by the mail server.'};
   // ORDER_TO holding two shop addresses, one of which the server will not
   // take. The send resolves, so this is the answer intake.ts reads out of it.
   if(mailerState.partly)return {outcome:'sent-with-refusals',providerMessageId:`provider-${sends.length}`,providerResponse:'250 2.0.0 queued',
    error:'The mail server took orders@fixture.invalid and refused kitchen@fixture.invalid. Correct or remove the refused address, then send this one again.'};
   return {outcome:'sent',providerMessageId:`provider-${sends.length}`,providerResponse:'250 2.0.0 queued',error:null};
  },
 }};
}
const mailerState={refuse:false,partly:false};

/** payment-service wired to the real repository, the real notice record and a
 * charge that is counted rather than made. */
function service(f,mail,extra={}){
 let charges=0;
 const built=load('src/lib/square/payment-service.ts',{
  './payment-attempts':f.repository,'./payment-engine':engine,'./payment-notices':noticeStore,
  '@/lib/intake':mail.module,
  '@/lib/workroom/store':{getStore:()=>({backend:'postgres',getOrder:async()=>order})},
  './oauth':{resolveSquare:async()=>cfg},
  './client':{square:async()=>({payments:[]})},
  './payments':{chargeBoardOrder:async()=>{charges++;return completed;}},
  ...extra,
 });
 return {...built,charges:()=>charges};
}

const boardTable='CREATE TABLE IF NOT EXISTS workroom_orders (id text PRIMARY KEY, status text NOT NULL, created_at bigint NOT NULL, data jsonb NOT NULL)';
const notices=async f=>(await f.pool.query('SELECT * FROM devine_order_notices ORDER BY audience')).rows;

test('a completed payment answers 200 without a durable store off production, 500 on it, files a mismatch for the owner, and keeps 500 for a storage failure',async()=>{
 for(const scenario of ['no-store','no-store-production','mismatch','storage-failure','settles','board-row-missing']){
  const noStore=scenario.startsWith('no-store');
  const f=await database();
  try{
   await f.pool.query(boardTable);
   if(scenario!=='board-row-missing')await f.pool.query('INSERT INTO workroom_orders(id,status,created_at,data) VALUES($1,$2,$3,$4)',[order.id,order.status,order.createdAt,JSON.stringify(order)]);
   const reference=crypto.randomUUID();
   // A saved, unresolved attempt for this reference: the webhook is the late
   // answer to a CreatePayment whose response never came back.
   if(!noStore)await engine.runPayment(f.repo,'board_webhook','one',{...intent,referenceId:reference},async()=>{throw Error('response lost');});
   const sales=[];let marked=0;
   const failing={...f.pool,query:async(sql,params)=>{
    if(scenario==='storage-failure'&&sql.startsWith('SELECT attempt_key'))throw Error('connection lost');
    return f.pool.query(sql,params);
   }};
   const repository=noStore
    ? load('src/lib/square/payment-attempts.ts',{pg:{Pool:class{constructor(){return failing;}}},'./payment-notices':noticeStore},{})
    : load('src/lib/square/payment-attempts.ts',{pg:{Pool:class{constructor(){return failing;}}},'./payment-notices':noticeStore},{DATABASE_URL:'postgres://fixture.invalid/test'});
   const mail=mailer();
   const routeService=service({...f,repository},mail);
   // The only difference between the two no-store runs is which deployment it
   // is. On production the missing database is somebody's mistake and Square's
   // day of retries is the window to fix it in; anywhere else nothing is
   // retrying and memory was the promise.
   const routeEnv=scenario==='no-store-production'?{...WEBHOOK_ENV,NODE_ENV:'production'}:WEBHOOK_ENV;
   const route=load('src/app/api/square/webhook/route.ts',{
    'next/server':{NextResponse:{json:(value,init)=>Response.json(value,init)}},
    '@/lib/catalog':{bySlug:new Map([['flowers',{}]])},
    '@/lib/square/client':{square:async()=>({order:{reference_id:reference,line_items:[]}})},
    '@/lib/square/oauth':{resolveSquare:async()=>cfg},
    '@/lib/square/payment-attempts':repository,
    '@/lib/square/payment-service':routeService,
    '@/lib/workroom/store':{getStore:()=>({
     backend:noStore?'memory':'postgres',
     upsertSquareSale:async s=>{sales.push(s);},
     getOrder:async id=>(await f.pool.query('SELECT data FROM workroom_orders WHERE id=$1',[id])).rows[0]?.data??null,
     getOrderByNumber:async()=>null,
     setOrderPayment:async()=>{marked++;},
    })},
   },routeEnv);

   const body={id:'sq-webhook',order_id:'sq-order',reference_id:reference,location_id:cfg.locationId,
    source_type:'CARD',created_at:'2026-09-17T12:00:00Z',
    amount_money:{amount:scenario==='mismatch'?999:2060,currency:'USD'},
    total_money:{amount:scenario==='mismatch'?999:2060}};
   const response=await deliver(route,completedEvent(body));

   if(scenario==='storage-failure'){
    assert.equal(response.status,500,scenario);
    assert.equal(sales.length,0,'a sale Square will resend must not be half recorded');
   }else if(scenario==='no-store-production'){
    // The row this instance just wrote dies with the lambda, so the only thing
    // that can still save the sale is Square asking again once the database is
    // attached. A 200 here would throw the sale away and leave a log line.
    assert.equal(response.status,500,scenario);
    assert.equal(marked,0,'nothing is marked paid off a sale with nowhere to live');
   }else{
    assert.equal(response.status,200,scenario);
    assert.equal(sales.length,1,scenario);
    assert.equal(sales[0].id,'sq-webhook');
   }
   const row=noStore?null:await f.repo.read('board_webhook');
   if(noStore)assert.equal((await f.pool.query("SELECT to_regclass('devine_payment_attempts') AS table")).rows[0].table,null,'no store means no attempt table, and nothing invented to settle against');
   if(scenario==='mismatch'){
    const conflict=(await f.pool.query('SELECT provider_conflict FROM devine_payment_attempts WHERE attempt_key=$1',['board_webhook'])).rows[0].provider_conflict;
    assert.equal(conflict.reason,'amount');
    assert.equal(conflict.paymentId,'sq-webhook');
    assert.equal(conflict.amountCents,999);
    assert.ok(conflict.seenAt>0,'the owner needs to know when it was first seen');
    assert.equal(row.state,'unknown','a payload we cannot match must not settle an attempt');
    assert.equal(marked,0,'and must not mark the ticket paid by the back door either');
    // derive.ts and the dashboard skip a sale that carries a board order id, on
    // the grounds that the ticket already tells that story. Linking one we have
    // just called unmatchable would take its amount out of every total.
    assert.equal(sales[0].workroomOrderId,undefined,'a contradicted payment does not claim the board ticket');
    assert.equal((await f.pool.query('SELECT data FROM workroom_orders WHERE id=$1',[order.id])).rows[0].data.payment,undefined);
    assert.equal((await f.pool.query('SELECT count(*) AS n FROM devine_payment_reviews')).rows[0].n,0,'the owner review table is for human findings only');
   }
   if(scenario==='settles'){
    assert.equal(row.state,'completed');
    assert.equal(row.result.paymentId,'sq-webhook');
    assert.equal(sales[0].workroomOrderId,order.id,'a payment that does match still links to its ticket');
    assert.equal(marked,0,'the order is marked paid by fulfillment, not twice');
    assert.equal((await f.pool.query('SELECT data FROM workroom_orders WHERE id=$1',[order.id])).rows[0].data.payment.squarePaymentId,'sq-webhook');
   }
   if(scenario==='board-row-missing'){
    // The money is recorded; only the board write had nowhere to land. The
    // sale is still stored and /workroom/payments carries the rest.
    assert.equal(row.state,'completed');
    assert.equal((await f.pool.query('SELECT fulfilled FROM devine_payment_attempts WHERE attempt_key=$1',['board_webhook'])).rows[0].fulfilled,false);
   }
  }finally{await f.db.close();}
 }
});

test('an unsigned webhook is refused before any store or connection is touched',async()=>{
 let reached=0;
 const route=load('src/app/api/square/webhook/route.ts',{
  'next/server':{NextResponse:{json:(value,init)=>Response.json(value,init)}},
  '@/lib/catalog':{bySlug:new Map()},
  '@/lib/square/client':{square:async()=>{reached++;return {};}},
  '@/lib/square/oauth':{resolveSquare:async()=>{reached++;return cfg;}},
  '@/lib/square/payment-attempts':{paymentDatabase:async()=>{reached++;throw Error('should not be reached');},recordProviderConflict:async()=>{},NoPaymentStore:class extends Error{}},
  '@/lib/square/payment-service':{settleProviderPayment:async()=>{reached++;},PaymentIntentMismatch:class extends Error{}},
  '@/lib/workroom/store':{getStore:()=>({backend:'postgres',upsertSquareSale:async()=>{reached++;}})},
 },WEBHOOK_ENV);
 const raw=completedEvent({id:'sq-forged',amount_money:{amount:1,currency:'USD'}});
 assert.equal((await deliver(route,raw,signed('other body'))).status,401);
 assert.equal((await deliver(route,raw,'not-base64')).status,401);
 assert.equal(reached,0);
});

test('an email that fails after the charge is retried from the board, sends once, and charges nothing again',async()=>{
 const f=await database();
 try{
  await f.pool.query(boardTable);
  const mail=mailer();const app=service(f,mail);
  mailerState.refuse=true;
  const outcome=await app.takePayment('online_notify','one',onlineIntent(),'fixture-token');
  assert.equal(outcome.kind,'completed');
  await app.fulfillPayment('online_notify');
  assert.equal(app.charges(),1);
  assert.equal(mail.sends.length,2,'both notices were attempted');
  let saved=await notices(f);
  assert.deepEqual(saved.map(r=>r.state),['failed','failed']);
  assert.deepEqual(saved.map(r=>Number(r.attempts)),[1,1]);
  assert.equal(saved[0].last_error,'Connection refused by the mail server.');
  assert.equal((await f.pool.query('SELECT notified,customer_notified,fulfilled FROM devine_payment_attempts WHERE attempt_key=$1',['online_notify'])).rows[0].notified,false);

  // The mail server comes back and the board is worked: one more send each,
  // still one charge, and nothing left owed.
  mailerState.refuse=false;
  await app.reconcilePayment('online_notify');
  assert.equal(app.charges(),1,'recovery never charges');
  assert.equal(mail.sends.length,4);
  saved=await notices(f);
  assert.deepEqual(saved.map(r=>r.state),['sent','sent']);
  assert.deepEqual(saved.map(r=>Number(r.attempts)),[2,2]);
  assert.equal(saved[0].provider_response,'250 2.0.0 queued');
  assert.ok(saved[0].provider_message_id,'the provider identifier is kept');
  const flags=(await f.pool.query('SELECT notified,customer_notified FROM devine_payment_attempts WHERE attempt_key=$1',['online_notify'])).rows[0];
  assert.equal(flags.notified,true);assert.equal(flags.customer_notified,true);

  // A third pass sends nothing at all: this is the second click on a send
  // that already worked.
  await app.reconcilePayment('online_notify');
  assert.equal(mail.sends.length,4);
  assert.equal(await app.resendNotice('online_notify','shop'),'nothing-sent','a delivered notice is not sent again');
  assert.equal(mail.sends.length,4);
 }finally{mailerState.refuse=false;await f.db.close();}
});

test('a send whose record is lost is kept as unconfirmed, recovery leaves it alone, and only the owner repeats it under the same message id',async()=>{
 const f=await database();
 try{
  await f.pool.query(boardTable);
  // The storage outage lands on the write that closes the notice, which is
  // the one moment the send has happened and nothing has recorded how.
  let breakFinish=true;
  const failing={...f.pool,query:async(sql,params)=>{
   if(breakFinish&&sql.includes('UPDATE devine_order_notices SET state=$2'))throw Error('connection lost');
   return f.pool.query(sql,params);
  }};
  const repository=load('src/lib/square/payment-attempts.ts',{pg:{Pool:class{constructor(){return failing;}}},'./payment-notices':noticeStore},{DATABASE_URL:'postgres://fixture.invalid/test'});
  const mail=mailer();const app=service({...f,repository},mail);
  const outcome=await app.takePayment('online_lost','one',onlineIntent(''),'fixture-token');
  assert.equal(outcome.kind,'completed');
  await assert.rejects(app.fulfillPayment('online_lost'),/connection lost/);
  assert.equal(app.charges(),1);
  assert.equal(mail.sends.length,1,'the shop ticket went out; its answer is what was lost');
  let saved=await notices(f);
  assert.equal(saved.length,1);
  assert.equal(saved[0].state,'sending','the attempt is on record even though its result is not');
  assert.equal(Number(saved[0].attempts),1);
  const messageId=saved[0].message_id;
  assert.ok(messageId.startsWith('<'),'the attempt was recorded under a message id before the send');

  // Storage is back. Ordinary recovery must not put a second copy of a
  // possibly delivered email in the shop's inbox.
  breakFinish=false;
  await app.reconcilePayment('online_lost');
  assert.equal(app.charges(),1);
  assert.equal(mail.sends.length,2,'only the customer notice, which was never attempted');
  saved=await notices(f);
  assert.equal(saved.find(r=>r.audience==='shop').state,'unconfirmed');
  assert.equal(saved.find(r=>r.audience==='customer').state,'not-needed','no address on the order is nothing to chase');
  assert.equal((await f.pool.query('SELECT notified FROM devine_payment_attempts WHERE attempt_key=$1',['online_lost'])).rows[0].notified,false);

  // The owner decides a second copy is better than none. Same message id, so
  // the shop's mail program files the two together, and still no charge.
  assert.equal(await app.resendNotice('online_lost','shop'),'sent');
  assert.equal(app.charges(),1);
  assert.equal(mail.sends.length,3);
  assert.equal(mail.sends[2].messageId,messageId,'a repeat rides the same message id as the first attempt');
  saved=await notices(f);
  assert.equal(saved.find(r=>r.audience==='shop').state,'sent');
  assert.equal(Number(saved.find(r=>r.audience==='shop').attempts),2);
  assert.equal((await f.pool.query('SELECT notified FROM devine_payment_attempts WHERE attempt_key=$1',['online_lost'])).rows[0].notified,true);

  // And now it is settled, so even the owner's button sends nothing.
  assert.equal(await app.resendNotice('online_lost','shop'),'nothing-sent');
  assert.equal(mail.sends.length,3);
 }finally{await f.db.close();}
});

test('concurrent recovery of one order delivers each notice once, and a notice is never sent for an unpaid attempt',async()=>{
 const f=await database();
 try{
  await f.pool.query(boardTable);
  const mail=mailer();const app=service(f,mail);
  await app.takePayment('online_race','one',onlineIntent(),'fixture-token');
  await Promise.all([app.fulfillPayment('online_race'),app.fulfillPayment('online_race'),app.fulfillPayment('online_race')]);
  assert.equal(mail.sends.length,2,'the lease and the notice record both hold');
  assert.deepEqual((await notices(f)).map(r=>Number(r.attempts)),[1,1]);

  await engine.runPayment(f.repo,'online_unpaid','one',{...onlineIntent(),referenceId:crypto.randomUUID()},async()=>{throw Error('response lost');});
  await assert.rejects(app.resendNotice('online_unpaid','shop'),/paid online order/);
  await app.fulfillPayment('online_unpaid');
  assert.equal(mail.sends.length,2,'an unresolved payment has no receipt to send');
 }finally{await f.db.close();}
});

test('a shop ticket the mail server only partly accepted is recorded as sent with refusals, stays on the board, and is never repeated on its own',async()=>{
 const f=await database();
 try{
  await f.pool.query(boardTable);
  const mail=mailer();const app=service(f,mail);
  mailerState.partly=true;
  // No customer address on this one, so the shop ticket is the whole story.
  await app.takePayment('online_partial','one',onlineIntent(''),'fixture-token');
  await app.fulfillPayment('online_partial');
  const shopRow=async()=>(await notices(f)).find(r=>r.audience==='shop');
  let shop=await shopRow();
  assert.equal(shop.state,'sent-with-refusals','a copy went out and an address was refused, which is neither sent nor failed');
  assert.match(shop.last_error,/refused kitchen@fixture\.invalid/,'the owner is told which address the server would not take');
  assert.ok(shop.provider_message_id,'a copy did go out, so the provider identifier is kept');

  // Not settled, so the payment stays on /workroom/payments where the owner
  // can read the refused address instead of the board calling it delivered.
  const flag=async()=>(await f.pool.query('SELECT notified FROM devine_payment_attempts WHERE attempt_key=$1',['online_partial'])).rows[0].notified;
  assert.equal(await flag(),false);

  // Recovery must not drop a second copy on the address that did take it.
  await app.reconcilePayment('online_partial');
  assert.equal(mail.sends.length,2,'recovery never repeats a partly accepted send by itself');
  assert.equal(Number((await shopRow()).attempts),1);

  // The owner asks anyway, and the address list is still wrong.
  assert.equal(await app.resendNotice('online_partial','shop'),'partly-sent');
  assert.equal(mail.sends.length,3);
  assert.equal(await flag(),false);

  // The address is corrected and it goes out clean, which is what clears it.
  mailerState.partly=false;
  assert.equal(await app.resendNotice('online_partial','shop'),'sent');
  assert.equal(mail.sends.length,4);
  shop=await shopRow();
  assert.equal(shop.state,'sent');
  assert.equal(shop.last_error,null);
  assert.equal(await flag(),true);
  assert.equal(app.charges(),1,'none of this touches money');
 }finally{mailerState.partly=false;await f.db.close();}
});

test('a notice already recorded as sent clears the payment row whose flag write was lost',async()=>{
 const f=await database();
 try{
  await f.pool.query(boardTable);
  const mail=mailer();const app=service(f,mail);
  await app.takePayment('online_flag','one',onlineIntent(),'fixture-token');
  await app.fulfillPayment('online_flag');
  assert.deepEqual((await notices(f)).map(r=>r.state),['sent','sent']);

  // The finally that writes the flags did not land: the process died, or the
  // lease guard no longer matched. Both emails are on record as delivered and
  // the payment is listed as owing them anyway.
  await f.pool.query('UPDATE devine_payment_attempts SET notified=false,customer_notified=false WHERE attempt_key=$1',['online_flag']);
  await app.reconcilePayment('online_flag');
  assert.equal(mail.sends.length,2,'nothing is sent a second time');
  const flags=(await f.pool.query('SELECT notified,customer_notified FROM devine_payment_attempts WHERE attempt_key=$1',['online_flag'])).rows[0];
  assert.equal(flags.notified,true,'a delivered notice finally clears the row it was stuck on');
  assert.equal(flags.customer_notified,true);
 }finally{await f.db.close();}
});

test('a notice row another transaction is holding is refused rather than read as undefined',async()=>{
 const f=await database();
 try{
  await f.pool.query(noticeStore.NOTICE_SCHEMA);
  // Under READ COMMITTED a concurrent uncommitted insert of the same notice
  // key makes ON CONFLICT DO NOTHING insert nothing, and the SELECT then finds
  // no committed row to lock. The lease upstream is keyed on the payment
  // attempt while a notice is keyed on the board order, so it does not fence
  // two attempts on one order.
  const blind={...f.pool,connect:async()=>{
   const client=await f.pool.connect();
   return {...client,query:async(sql,params)=>sql.startsWith('SELECT * FROM devine_order_notices')?{rows:[],rowCount:0}:client.query(sql,params)};
  }};
  const begun=await noticeStore.beginNotice(blind,{key:'notice:contended:shop',attemptKey:'board_contended',orderNumber:'DV-TEST',audience:'shop',messageId:'<contended@fixture.invalid>'});
  assert.equal(begun.open,false,'no attempt is opened on a row we could not read');
  assert.equal(begun.settled,false,'and nothing is claimed settled from it either');
 }finally{await f.db.close();}
});

test('a filed Square conflict can be finished with, is kept as evidence, and a later contradiction files again',async()=>{
 const f=await database();
 const conflict=async()=>(await f.pool.query('SELECT provider_conflict FROM devine_payment_attempts WHERE attempt_key=$1',['board_conflict'])).rows[0].provider_conflict;
 try{
  await engine.runPayment(f.repo,'board_conflict','one',{...intent,referenceId:'ref-conflict'},async()=>{throw Error('response lost');});
  const filed={reason:'amount',paymentId:'sq-1',status:'COMPLETED',amountCents:999,locationId:'fixture-location'};
  await f.repository.recordProviderConflict('board_conflict',filed,1000);
  await f.repository.recordProviderConflict('board_conflict',filed,2000);
  assert.equal(Number((await conflict()).seenAt),1000,'a redelivery does not move the date the shop first saw it');

  assert.equal(await f.repository.clearProviderConflict('board_conflict',3000),true);
  const cleared=await conflict();
  assert.equal(Number(cleared.clearedAt),3000);
  assert.equal(cleared.paymentId,'sq-1','the finding itself outlives the board entry');
  assert.equal(await f.repository.clearProviderConflict('board_conflict',4000),false,'there is nothing left to clear');

  // Square contradicts the same order again after the owner is done with the
  // first one. That is a new finding, not the closed one reopening.
  await f.repository.recordProviderConflict('board_conflict',{reason:'location',paymentId:'sq-2',status:'COMPLETED',amountCents:2060,locationId:'other'},5000);
  const second=await conflict();
  assert.equal(second.reason,'location');
  assert.equal(Number(second.seenAt),5000);
  assert.equal(second.clearedAt,undefined);
  assert.equal((await f.repo.read('board_conflict')).state,'unknown','clearing a warning settles no payment');
 }finally{await f.db.close();}
});

test('the owner reads a sentence about the shop, never the name of the check that failed',async()=>{
 const f=await database();
 try{
  const app=service(f,mailer());
  // Every reason settleProviderPayment can raise, which is what the board prints.
  const tokens=['reference','location','connection','amount','currency','no saved attempt','no provider payment id','incomplete payment'];
  const said=tokens.map(token=>app.conflictWording(token));
  assert.equal(new Set(said).size,tokens.length,'each reason gets its own sentence');
  for(const [index,token] of tokens.entries()){
   assert.notEqual(said[index],token,`${token} is printed as itself`);
   assert.ok(said[index].length>15,`${token} has no real sentence`);
  }
  assert.equal(app.conflictWording('a reason added later'),'it does not agree with what this order saved','an unknown token falls back rather than leaking');
  assert.equal(app.conflictWording(undefined),'it does not agree with what this order saved');
 }finally{await f.db.close();}
});
