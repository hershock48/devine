/** Shared fixtures for the payment and notification regression tests.
 *
 * Usage: require('./harness.cjs') from a *.test.cjs in this folder. Nothing
 * here runs tests or touches the network; load() compiles one TypeScript file
 * into a sandbox with its imports replaced, and database() gives it a real
 * PostgreSQL through PGlite. No live Square, no live SMTP, no hosted database.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),{PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'../..');
function load(file,mocks={},env={}){
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(code,{filename:file}).runInNewContext({module,exports:module.exports,process:{env},Date,URL,URLSearchParams,Request,Response,Buffer,console:{error(){},log(){}},require:name=>{
  if(name==='server-only')return {};if(name==='node:crypto'||name==='node:net')return require(name);
  if(Object.hasOwn(mocks,name))return mocks[name];throw Error('Unexpected dependency '+name);
 }});return module.exports;
}
const engine=load('src/lib/square/payment-engine.ts');
const noticeStore=load('src/lib/square/payment-notices.ts');
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
 const repository=load('src/lib/square/payment-attempts.ts',{pg:{Pool:class{constructor(){return pool;}}},'./payment-notices':noticeStore},{DATABASE_URL:'postgres://fixture.invalid/test'});
 return {db,pool,repository,repo:repository.attemptRepository()};
}

module.exports={load,database,engine,noticeStore,cfg,order,intent,completed};
