/** The public-form limiter (2026-09-28 audit): durable per-address counts on
 * PGlite, separate from sign-in, and failing OPEN whenever it cannot count. */
const test=require('node:test'),assert=require('node:assert/strict');
const {load,database}=require('./harness.cjs');
const production={NODE_ENV:'production',VERCEL:'1',DATABASE_URL:'postgres://fixture.invalid/test'};
const ask=address=>new Request('https://fixture.invalid/api/inquiry',{method:'POST',headers:address?{'x-vercel-forwarded-for':address}:{}});

test('five inquiries per address, the sixth refused, another address and sign-in unaffected',async()=>{
 const f=await database();try{
  const limit=load('src/lib/workroom/login-limit.ts',{pg:{Pool:class{constructor(){return f.pool;}}}},production);
  for(let i=0;i<5;i++)assert.equal(await limit.allowFormPost('inquiry',ask('192.0.2.7'),5),true,'post '+(i+1));
  assert.equal(await limit.allowFormPost('inquiry',ask('192.0.2.7'),5),false);
  assert.equal(await limit.allowFormPost('inquiry',ask('192.0.2.8'),5),true,'a different address has its own count');
  assert.equal(await limit.allowFormPost('order',ask('192.0.2.7'),20),true,'each form has its own count');
  assert.equal(await limit.allowLogin(limit.loginClient(ask('192.0.2.7'))),true,'sign-in is not charged for inquiries');
 }finally{await f.db.close();}
});

test('the limiter fails open when it cannot see an address or reach the database',async()=>{
 const noHeader=load('src/lib/workroom/login-limit.ts',{pg:{Pool:class{constructor(){throw Error('must not connect');}}}},production);
 assert.equal(await noHeader.allowFormPost('inquiry',ask(''),5),true);
 const down=load('src/lib/workroom/login-limit.ts',{pg:{Pool:class{constructor(){return {query:async()=>{throw Error('database offline');}};}}}},production);
 assert.equal(await down.allowFormPost('inquiry',ask('192.0.2.9'),5),true);
});
