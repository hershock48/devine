const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript');
function load(file, mocks, env = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new vm.Script(code).runInNewContext({ module, exports: module.exports, require: name => {
    if (name === 'server-only') return {};
    if (name === 'node:crypto') return crypto;
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if(name==='./payment-engine')return load('src/lib/square/payment-engine.ts',{});
    throw Error(`Unexpected import: ${name}`);
  }, process: { env }, console: { error() {} }, URLSearchParams, Date });
  return module.exports;
}
const cfg = { env: 'sandbox', locationId: 'location', viaOAuth: true };
const key = 'bb3328c9-7bd1-4ef9-831e-46c57718d0c9';
const order = { number: 'DV-0914-1234', name: 'Test', phone: '5551234567', email: '', fulfillment: 'pickup', zip: '', subtotal: 20, lines: [{ slug: 'flowers', name: 'Flowers', qty: 1, each: 20, line: 20 }] };
const charged = { paymentId: 'p1', status: 'COMPLETED', receiptUrl: '', totalCents: 2159, feeCents: 159 };
const json = (value, options = {}) => ({ status: options.status || 200, value });
function online({ outcome = 'completed', storageError = false, fulfillmentError = false, enabled = true } = {}) {
  const calls = { take: [], fulfill: 0, unpaidMail: 0 };
  const service = {
    gatewayIdentity: c => ({ locationId: c.locationId }), paymentFingerprint: data => JSON.stringify(data), pendingMessage: 'Awaiting confirmation; do not pay again.',
    async takePayment(...args) { calls.take.push(args); if (storageError) throw Error('Database failed'); return { kind: outcome, attempt: { snapshot: args[2], result: charged } }; },
    async fulfillPayment() { calls.fulfill++; if (fulfillmentError) throw Error('SMTP failed'); },
  };
  const route = load('src/app/api/order/route.ts', {
    'next/server': { NextResponse: { json } }, '@/lib/square/payment-service': service,
    '@/lib/intake': { priceOrder: () => ({ order: { ...order } }), sendOrder: async () => { calls.unpaidMail++; return 'sent'; } },
    '@/lib/site': { site: { cardFeePct: 3, deliveryFees: {}, deliveryMinimums: {} } },
    '@/lib/square/oauth': { resolveSquare: async () => cfg }, '@/lib/square/payments': { appFeeCents: () => 99 },
    '@/lib/workroom/store': { newId: () => 'unused-random-id', getStore: () => ({ createOrder: async () => {} }) },
  }, { CHECKOUT_CARDS: enabled ? 'on' : 'off' });
  return { calls, post: (attemptKey = key) => route.POST({ json: async () => ({ card: { sourceId: 'token', attemptKey } }) }) };
}

test('online payment requires a stable checkout ID and enabled cards before any side effect', async () => {
  const badKey = online(); assert.equal((await badKey.post('missing')).status, 400); assert.equal(badKey.calls.take.length, 0);
  const off = online({ enabled: false }); assert.equal((await off.post()).status, 400); assert.equal(off.calls.take.length, 0);
});
test('online checkout saves server-priced intent without the card token and returns paid despite downstream failure', async () => {
  const app = online({ fulfillmentError: true });
  const response = await app.post();
  assert.equal(response.value.ok, true); assert.equal(app.calls.fulfill, 1); assert.equal(app.calls.unpaidMail, 0);
  const [id, fingerprint, saved, token] = app.calls.take[0];
  assert.equal(id, key); assert.equal(token, 'token'); assert.equal(JSON.stringify(saved).includes('token'), false);
  assert.equal(fingerprint.includes('DV-0914'), false);
  assert.equal(saved.order.id, 'web_' + key.replaceAll('-', '')); assert.equal(saved.cardFee.cents, 159);
});
test('ambiguous payment and storage failures never report unpaid intake or invite another charge', async () => {
  for (const options of [{ outcome: 'pending' }, { storageError: true }, { outcome: 'conflict' }]) {
    const app = online(options), response = await app.post();
    assert.equal(response.value.ok, false); assert.equal(response.value.pending, true);
    assert.equal(app.calls.unpaidMail, 0); assert.equal(app.calls.fulfill, 0);
  }
});
test('a confirmed online failure returns a retryable 402 and never sends an unpaid order',async()=>{
 const app=online({outcome:'failed'}),response=await app.post();
 assert.equal(response.status,402);assert.equal(response.value.failed,true);assert.equal(response.value.pending,false);assert.equal(app.calls.unpaidMail,0);assert.equal(app.calls.fulfill,0);
});
test('provider order and payment keys are stable, distinct, and different for another attempt', async () => {
  const calls = [];
  const payments = load('src/lib/square/payments.ts', { './client': { square: async (cfg, method, route, body) => { calls.push({ route, body }); return route === '/v2/orders' ? { order: { id: 'square-order', total_money: { amount: 2159 } } } : { payment: { id: 'p1', status: 'COMPLETED', amount_money: { amount: 2159, currency: 'USD' }, reference_id: 'reference', location_id: 'location' } }; } } });
  const request = { attemptKey: key, workroomOrderId: 'reference', orderNumber: order.number, lines: order.lines, method: 'card', sourceId: 'token', cardFee: { name: 'Convenience fee', cents: 159, appFeeCents: 99 } };
  await payments.chargeBoardOrder(cfg, request); await payments.chargeBoardOrder(cfg, request);
  assert.equal(calls[0].body.idempotency_key, calls[2].body.idempotency_key);
  assert.equal(calls[1].body.idempotency_key, calls[3].body.idempotency_key);
  assert.notEqual(calls[0].body.idempotency_key, calls[1].body.idempotency_key);
  assert.notEqual(payments.providerKey(key, 'payment'), payments.providerKey('different', 'payment'));
  assert.ok(calls[1].body.idempotency_key.length <= 45);
  assert.equal(calls[1].body.amount_money.amount, 2159); assert.equal(calls[1].body.app_fee_money.amount, 99);
});
test('a provider order-total mismatch stops before charging', async () => {
  let calls = 0;
  const payments = load('src/lib/square/payments.ts', { './client': { square: async () => { calls++; return { order: { id: 'order', total_money: { amount: 1 } } }; } } });
  await assert.rejects(payments.chargeBoardOrder(cfg, { attemptKey: key, workroomOrderId: 'ref', orderNumber: 'DV', lines: order.lines, method: 'cash', cardFee: { name: '', cents: 0, appFeeCents: 0 } }));
  assert.equal(calls, 1);
});

test('documented declines fail definitively while reused tokens and provider outages stay ambiguous', async () => {
  class SquareError extends Error { constructor(status, body) { super('Provider error'); this.status = status; this.body = body; } }
  for (const [code, status, failed] of [['GENERIC_DECLINE', 400, true], ['CVV_FAILURE', 400, true], ['CARD_TOKEN_USED', 400, false], ['TEMPORARY_ERROR', 503, false]]) {
    const payments = load('src/lib/square/payments.ts', { './client': { SquareError, square: async (cfg, method, route) => {
      if (route === '/v2/orders') return { order: { id: 'square-order', total_money: { amount: 2000 } } };
      throw new SquareError(status, { errors: [{ code }] });
    } } });
    const promise = payments.chargeBoardOrder(cfg, { attemptKey: key, workroomOrderId: 'ref', orderNumber: 'DV', lines: order.lines, method: 'card', sourceId: 'token', cardFee: { name: 'Fee', cents: 0, appFeeCents: 0 } });
    if (failed) assert.equal((await promise).status, 'FAILED'); else await assert.rejects(promise);
  }
});
