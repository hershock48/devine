const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
function load(file,mocks={},env={}){const module={exports:{}};const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new vm.Script(source).runInNewContext({module,exports:module.exports,require:n=>{if(n==='server-only')return {};if(n==='node:crypto')return crypto;if(Object.hasOwn(mocks,n))return mocks[n];throw Error(n);},process:{env},Buffer,Date});return module.exports;}
const session=load('src/lib/workroom/session.ts'),secret='fixture-secret-'.repeat(4),pins={staff:'2468',owner:'9753'},now=1700000000000;
test('issued sessions authorize the correct role without storing credentials',()=>{
 for(const role of ['staff','owner']){const token=session.issueSession(role,pins[role],secret,now);assert.equal(session.sessionRole(token,secret,pins,now),role);const payload=JSON.parse(Buffer.from(token.split('.')[0],'base64url'));assert.equal(payload.role,role);assert.equal(payload.pin,undefined);assert.equal(session.sessionRole(pins[role],secret,pins,now),null);}
});
test('forgery, role mutation, expiry and credential/secret rotation fail',()=>{
 const token=session.issueSession('staff',pins.staff,secret,now);
 assert.equal(session.sessionRole(token+'x',secret,pins,now),null);
 const [raw,sig]=token.split('.'),payload=JSON.parse(Buffer.from(raw,'base64url'));payload.role='owner';assert.equal(session.sessionRole(Buffer.from(JSON.stringify(payload)).toString('base64url')+'.'+sig,secret,pins,now),null);
 assert.equal(session.sessionRole(token,secret,pins,now+(session.SESSION_SECONDS+1)*1000),null);
 assert.equal(session.sessionRole(token,secret,{...pins,staff:'different'},now),null);
 assert.equal(session.sessionRole(token,'rotated'.repeat(8),pins,now),null);
});
test('production closes without session configuration or with identical roles',async()=>{
 for(const env of [{NODE_ENV:'production'},{NODE_ENV:'production',WORKROOM_PIN:pins.staff},{NODE_ENV:'production',WORKROOM_PIN:pins.staff,WORKROOM_OWNER_PIN:pins.staff,WORKROOM_SESSION_SECRET:secret}]){
 const auth=load('src/lib/workroom/auth.ts',{'./session':session,'next/headers':{cookies:async()=>{throw Error('Must fail before cookies');}}},env);
 assert.equal(auth.workroomSessionReady(),false);assert.equal(await auth.isWorkroomAuthed(),false);assert.equal(await auth.isWorkroomOwner(),false);
 }
});
test('auth helpers retain owner/staff boundaries and set secure signed cookies',async()=>{
 let held;const jar={get:()=>({value:held}),set:(name,value,options)=>{held=value;assert.equal(name,'devine_workroom');assert.equal(options.httpOnly,true);assert.equal(options.secure,true);assert.equal(options.sameSite,'strict');}};
 const auth=load('src/lib/workroom/auth.ts',{'./session':session,'next/headers':{cookies:async()=>jar}},{NODE_ENV:'production',WORKROOM_PIN:pins.staff,WORKROOM_OWNER_PIN:pins.owner,WORKROOM_SESSION_SECRET:secret});
 held=pins.owner;assert.equal(await auth.isWorkroomOwner(),false);
 await auth.setWorkroomCookie(pins.staff);assert.equal(await auth.isWorkroomAuthed(),true);assert.equal(await auth.isWorkroomOwner(),false);
 await auth.setWorkroomCookie(pins.owner);assert.equal(await auth.isWorkroomAuthed(),true);assert.equal(await auth.isWorkroomOwner(),true);
 await assert.rejects(()=>auth.setWorkroomCookie('wrong'));
});

test('login limiter rejects attempt eleven and recovers after its window or a successful login',async()=>{
 const limiter=load('src/lib/workroom/login-limit.ts',{}, {NODE_ENV:'test'});
 for(let i=0;i<10;i++)assert.equal(await limiter.allowLogin(1000),true);
 assert.equal(await limiter.allowLogin(1000),false);
 assert.equal(await limiter.allowLogin(601001),true);
 await limiter.clearLoginAttempts();assert.equal(await limiter.allowLogin(601001),true);
});
test('production sign-in limiter fails closed without a persistent database',async()=>{
 const limiter=load('src/lib/workroom/login-limit.ts',{}, {NODE_ENV:'production'});
 await assert.rejects(()=>limiter.allowLogin(),/database/);
});
