const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ts=require('typescript'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');
function load(file,mocks={},env={}){
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(code,{filename:file}).runInNewContext({module,exports:module.exports,process:{env},Date,URL,URLSearchParams,Request,Response,Buffer,console:{error(){}},require:name=>{
  if(name==='server-only')return {};if(name==='node:crypto'||name==='node:net')return require(name);
  if(Object.hasOwn(mocks,name))return mocks[name];throw Error('Unexpected dependency '+name);
 }});return module.exports;
}
const engine=load('src/lib/square/payment-engine.ts');
const cfg={env:'sandbox',locationId:'fixture-location',viaOAuth:true};
const order={id:'fixture-order',number:'DV-TEST',status:'new',subtotal:20,lines:[{slug:'flowers',name:'Flowers',qty:1,each:20}],createdAt:1};
const intent={order,method:'card',gateway:cfg,cardFee:{name:'Card fee',cents:60,appFeeCents:0}};
const completed={paymentId:'fixture-payment',status:'COMPLETED',receiptUrl:'',totalCents:2060,feeCents:60};

// PGlite exercises PostgreSQL syntax and durable row changes. Its one connection
// needs a pool-shaped mutex so separate test requests cannot share a transaction.
async function database(){
 const db=new PGlite();let tail=Promise.resolve();
 const lock=async()=>{let release;const next=new Promise(resolve=>{release=resolve;});const prior=tail;tail=prior.then(()=>next);await prior;return release;};
 const query=async(sql,params)=>{const result=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1)||{rows:[]};return {...result,rowCount:result.affectedRows??result.rows.length};};
 const pool={query:async(...args)=>{const release=await lock();try{return await query(...args);}finally{release();}},connect:async()=>{const release=await lock();return {query,release};}};
 const repository=load('src/lib/square/payment-attempts.ts',{pg:{Pool:class{constructor(){return pool;}}}},{DATABASE_URL:'postgres://fixture.invalid/test'});
 return {db,pool,repository,repo:repository.attemptRepository()};
}

test('a definitive decline permits explicit staff retry or cash, archives evidence and fences concurrent/stale generations',async()=>{
 const f=await database();let calls=0;
 try{
  const first={...intent,referenceId:crypto.randomUUID()};
  const result=await engine.runPayment(f.repo,'board_fixture','card-1',first,async()=>{calls++;return {...completed,status:'FAILED'};});assert.equal(result.kind,'failed');
  assert.equal((await engine.runPayment(f.repo,'board_fixture','cash',intent,async()=>{calls++;return completed;})).kind,'failed');assert.equal(calls,1);
  const retry={...intent,method:'cash',referenceId:crypto.randomUUID()};
  const results=await Promise.all(Array.from({length:6},(_,i)=>engine.runPayment(f.repo,'board_fixture','cash-'+i,{...retry,referenceId:crypto.randomUUID()},async()=>{calls++;return completed;},first.referenceId)));
  assert.equal(calls,2);assert.equal(results.filter(r=>r.kind==='completed').length,1);
  const saved=await f.repo.read('board_fixture');assert.equal(saved.state,'completed');assert.equal(saved.snapshot.method,'cash');
  assert.equal((await f.pool.query("SELECT count(*) AS count FROM devine_payment_attempts WHERE attempt_key LIKE 'archived:%'")).rows[0].count,1);
  assert.equal(await f.repo.claim('board_fixture','card-1'),false);
  await f.repo.settle('board_fixture','unknown',null,'card-1');assert.equal((await f.repo.read('board_fixture')).state,'completed');
 }finally{await f.db.close();}
});
test('unknown payments remain blocked even with a forged retry acknowledgement',async()=>{
 const f=await database();let calls=0;try{
  const saved={...intent,referenceId:crypto.randomUUID()};
  const first=await engine.runPayment(f.repo,'board_unknown','one',saved,async()=>{calls++;throw Error('CreatePayment response lost');});assert.equal(first.kind,'pending');
  await engine.runPayment(f.repo,'board_unknown','two',intent,async()=>{calls++;return completed;},saved.referenceId);
  assert.equal(calls,1);assert.equal((await f.repo.read('board_unknown')).state,'unknown');
 }finally{await f.db.close();}
});
test('pre-payment validation, CreateOrder failures and mismatched totals fail without invoking CreatePayment',async()=>{
 for(const scenario of ['lines','token','fee','orders-400','orders-timeout','missing-order','total']){
  const f=await database(),calls=[];
  try{
   const payments=load('src/lib/square/payments.ts',{'./payment-engine':engine,'./client':{SquareError:class extends Error{},square:async(c,method,url)=>{
    calls.push(url);assert.notEqual(url,'/v2/payments');if(scenario.startsWith('orders-'))throw Error('Order API failed');
    return {order:scenario==='missing-order'?{}:{id:'fixture-square-order',total_money:{amount:1}}};
   }}});
   const opts={attemptKey:'saved',workroomOrderId:'saved',orderNumber:'TEST',lines:scenario==='lines'?[]:order.lines,method:'card',sourceId:scenario==='token'?undefined:'fixture-token',cardFee:scenario==='fee'?{...intent.cardFee,cents:NaN}:intent.cardFee};
   const result=await engine.runPayment(f.repo,'online_'+scenario,'one',intent,()=>payments.chargeBoardOrder(cfg,opts));
   assert.equal(result.kind,'failed',scenario);assert.equal(result.attempt.result.status,'NOT_SUBMITTED');assert.equal(result.attempt.state,'failed');
   if(['lines','token','fee'].includes(scenario))assert.equal(calls.length,0);
  }finally{await f.db.close();}
 }
});
test('order races and changed connection are recorded as not submitted, while CreatePayment timeout stays unknown',async()=>{
 for(const scenario of ['paid','canceled','missing','board-read','connection-null','connection-change','connection-error','payment-timeout']){
  const f=await database();let reads=0,charges=0;
  try{
   const service=load('src/lib/square/payment-service.ts',{
    './payment-attempts':f.repository,'./payment-engine':engine,'@/lib/intake':{},'./client':{},
    '@/lib/workroom/store':{getStore:()=>({backend:'postgres',getOrder:async()=>{if(++reads===1)return order;if(scenario==='board-read')throw Error('offline');if(scenario==='missing')return null;return {...order,...(scenario==='paid'?{payment:{method:'cash'}}:{}),...(scenario==='canceled'?{status:'canceled'}:{})};}})},
    './oauth':{resolveSquare:async()=>{if(scenario==='connection-error')throw Error('offline');return scenario==='connection-null'?null:{...cfg,...(scenario==='connection-change'?{locationId:'other'}:{})};}},
    './payments':{chargeBoardOrder:async()=>{charges++;throw Error('CreatePayment response lost');}}
   });
   const result=await service.takePayment('board_'+scenario,'one',intent,'fixture-token');
   assert.equal(result.kind,scenario==='payment-timeout'?'pending':'failed',scenario);assert.equal(charges,scenario==='payment-timeout'?1:0);
   if(scenario!=='payment-timeout')assert.equal(result.attempt.result.status,'NOT_SUBMITTED');
  }finally{await f.db.close();}
 }
});
test('workroom route returns a failed-attempt acknowledgement to staff and keeps uncertain attempts pending',async()=>{
 const referenceId=crypto.randomUUID();
 for(const kind of ['failed','pending','conflict','completed']){
  const calls=[];
  const route=load('src/app/api/workroom/pay/route.ts',{
   'next/server':{NextResponse:{json:(value,init)=>Response.json(value,init)}},'@/lib/site':{site:{deliveryFees:{},cardFeePct:3}},
   '@/lib/workroom/auth':{isWorkroomAuthed:async()=>true},'@/lib/workroom/store':{getStore:()=>({getOrder:async()=>order})},'@/lib/square/oauth':{resolveSquare:async()=>cfg},
   '@/lib/square/payment-service':{paymentFingerprint:JSON.stringify,gatewayIdentity:c=>c,pendingMessage:'Payment awaiting confirmation.',takePayment:async(...args)=>{calls.push(args);return {kind,attempt:{snapshot:{referenceId},result:{status:'NOT_SUBMITTED'}}};},fulfillPayment:async()=>{},settledPayment:()=>({})}
  });
  const response=await route.POST(new Request('https://fixture.invalid/api/workroom/pay',{method:'POST',body:JSON.stringify({id:order.id,method:'cash',attemptId:crypto.randomUUID(),retryOf:referenceId})}));
  const body=await response.json();assert.equal(calls[0][4],referenceId);
  assert.equal(response.status,{failed:402,pending:409,conflict:409,completed:200}[kind]);
  if(kind==='failed'){assert.equal(body.failed,true);assert.equal(body.pending,false);assert.equal(body.retryOf,referenceId);assert.match(body.error,/No payment was submitted/);}
 }
});
test('trusted-address throttling limits one attacker across instances without locking a different address',async()=>{
 const f=await database();try{
  const env={NODE_ENV:'production',VERCEL:'1',DATABASE_URL:'postgres://fixture.invalid/test'};
  const instance=()=>load('src/lib/workroom/login-limit.ts',{pg:{Pool:class{constructor(){return f.pool;}}}},env);
  const a=instance(),b=instance(),req=(ip,extra={})=>new Request('https://fixture.invalid/api/workroom/login',{headers:{'x-vercel-forwarded-for':ip,...extra}});
  const attacker=a.loginClient(req('192.0.2.1')),owner=a.loginClient(req('192.0.2.2'));
  assert.equal(a.loginClient(req('192.0.2.1',{'x-forwarded-for':'192.0.2.3'})),attacker);
  assert.equal(a.loginClient(req('2001:db8::1')),a.loginClient(req('2001:0db8:0:0:0:0:0:1')));
  assert.throws(()=>a.loginClient(req('192.0.2.1, 192.0.2.2')));
  const results=await Promise.all(Array.from({length:25},(_,i)=>(i%2?a:b).allowLogin(attacker,1000000)));
  assert.equal(results.filter(Boolean).length,10);assert.equal(await b.allowLogin(owner,1000000),true);
  await a.clearLoginAttempts(owner);assert.equal(await b.allowLogin(attacker,1000001),false);
  assert.equal(await b.allowLogin(attacker,1600000),true);
  assert.throws(()=>load('src/lib/workroom/login-limit.ts',{}, {NODE_ENV:'production'}).loginClient(req('192.0.2.1')),/unavailable/);
 }finally{await f.db.close();}
});
