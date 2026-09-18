/** The webhook's retry contract and the order notification's recovery path,
 * both against a real PostgreSQL (PGlite) with a fake Square and a fake mail
 * server. Nothing here charges, sends or connects to anything.
 *
 * What these tests are for, in the order they appear:
 *  - a shop with no database gets its sale recorded and a 200, not a retry loop
 *  - a payload that contradicts the saved intent is filed and answered 200
 *  - a storage failure still returns 500, because asking again can fix it
 *  - an email that fails after the charge is retried once, and charges nothing
 *  - an email whose answer was lost is recorded, and recovery will not repeat it
 *  - a second click sends nothing when the first send worked
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
   return {outcome:'sent',providerMessageId:`provider-${sends.length}`,providerResponse:'250 2.0.0 queued',error:null};
  },
 }};
}
const mailerState={refuse:false};

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

test('a completed payment answers 200 without a durable store, files a mismatch for the owner, and keeps 500 for a storage failure',async()=>{
 for(const scenario of ['no-store','mismatch','storage-failure','settles','board-row-missing']){
  const f=await database();
  try{
   await f.pool.query(boardTable);
   if(scenario!=='board-row-missing')await f.pool.query('INSERT INTO workroom_orders(id,status,created_at,data) VALUES($1,$2,$3,$4)',[order.id,order.status,order.createdAt,JSON.stringify(order)]);
   const reference=crypto.randomUUID();
   // A saved, unresolved attempt for this reference: the webhook is the late
   // answer to a CreatePayment whose response never came back.
   if(scenario!=='no-store')await engine.runPayment(f.repo,'board_webhook','one',{...intent,referenceId:reference},async()=>{throw Error('response lost');});
   const sales=[];let marked=0;
   const failing={...f.pool,query:async(sql,params)=>{
    if(scenario==='storage-failure'&&sql.startsWith('SELECT attempt_key'))throw Error('connection lost');
    return f.pool.query(sql,params);
   }};
   const repository=scenario==='no-store'
    ? load('src/lib/square/payment-attempts.ts',{pg:{Pool:class{constructor(){return failing;}}},'./payment-notices':noticeStore},{})
    : load('src/lib/square/payment-attempts.ts',{pg:{Pool:class{constructor(){return failing;}}},'./payment-notices':noticeStore},{DATABASE_URL:'postgres://fixture.invalid/test'});
   const mail=mailer();
   const routeService=service({...f,repository},mail);
   const route=load('src/app/api/square/webhook/route.ts',{
    'next/server':{NextResponse:{json:(value,init)=>Response.json(value,init)}},
    '@/lib/catalog':{bySlug:new Map([['flowers',{}]])},
    '@/lib/square/client':{square:async()=>({order:{reference_id:reference,line_items:[]}})},
    '@/lib/square/oauth':{resolveSquare:async()=>cfg},
    '@/lib/square/payment-attempts':repository,
    '@/lib/square/payment-service':routeService,
    '@/lib/workroom/store':{getStore:()=>({
     backend:scenario==='no-store'?'memory':'postgres',
     upsertSquareSale:async s=>{sales.push(s);},
     getOrder:async id=>(await f.pool.query('SELECT data FROM workroom_orders WHERE id=$1',[id])).rows[0]?.data??null,
     getOrderByNumber:async()=>null,
     setOrderPayment:async()=>{marked++;},
    })},
   },WEBHOOK_ENV);

   const body={id:'sq-webhook',order_id:'sq-order',reference_id:reference,location_id:cfg.locationId,
    source_type:'CARD',created_at:'2026-09-17T12:00:00Z',
    amount_money:{amount:scenario==='mismatch'?999:2060,currency:'USD'},
    total_money:{amount:scenario==='mismatch'?999:2060}};
   const response=await deliver(route,completedEvent(body));

   if(scenario==='storage-failure'){
    assert.equal(response.status,500,scenario);
    assert.equal(sales.length,0,'a sale Square will resend must not be half recorded');
   }else{
    assert.equal(response.status,200,scenario);
    assert.equal(sales.length,1,scenario);
    assert.equal(sales[0].id,'sq-webhook');
   }
   const row=scenario==='no-store'?null:await f.repo.read('board_webhook');
   if(scenario==='no-store')assert.equal((await f.pool.query("SELECT to_regclass('devine_payment_attempts') AS table")).rows[0].table,null,'no store means no attempt table, and nothing invented to settle against');
   if(scenario==='mismatch'){
    const conflict=(await f.pool.query('SELECT provider_conflict FROM devine_payment_attempts WHERE attempt_key=$1',['board_webhook'])).rows[0].provider_conflict;
    assert.equal(conflict.reason,'amount');
    assert.equal(conflict.paymentId,'sq-webhook');
    assert.equal(conflict.amountCents,999);
    assert.ok(conflict.seenAt>0,'the owner needs to know when it was first seen');
    assert.equal(row.state,'unknown','a payload we cannot match must not settle an attempt');
    assert.equal(marked,0,'and must not mark the ticket paid by the back door either');
    assert.equal((await f.pool.query('SELECT data FROM workroom_orders WHERE id=$1',[order.id])).rows[0].data.payment,undefined);
    assert.equal((await f.pool.query('SELECT count(*) AS n FROM devine_payment_reviews')).rows[0].n,0,'the owner review table is for human findings only');
   }
   if(scenario==='settles'){
    assert.equal(row.state,'completed');
    assert.equal(row.result.paymentId,'sq-webhook');
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
  assert.equal(await app.resendNotice('online_notify','shop'),false,'a delivered notice is not sent again');
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
  assert.equal(await app.resendNotice('online_lost','shop'),true);
  assert.equal(app.charges(),1);
  assert.equal(mail.sends.length,3);
  assert.equal(mail.sends[2].messageId,messageId,'a repeat rides the same message id as the first attempt');
  saved=await notices(f);
  assert.equal(saved.find(r=>r.audience==='shop').state,'sent');
  assert.equal(Number(saved.find(r=>r.audience==='shop').attempts),2);
  assert.equal((await f.pool.query('SELECT notified FROM devine_payment_attempts WHERE attempt_key=$1',['online_lost'])).rows[0].notified,true);

  // And now it is settled, so even the owner's button sends nothing.
  assert.equal(await app.resendNotice('online_lost','shop'),false);
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
