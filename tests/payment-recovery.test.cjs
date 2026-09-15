const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript');
const gateway = { env: 'sandbox', locationId: 'location', viaOAuth: true };
function setup({ customerFails = false, boardFails = false, noMatch = false } = {}) {
  const order = { id: 'web-order', number: 'DV-0914-1000', name: 'Fixture', email: 'fixture@example.invalid', createdAt: 1, status: 'confirmed', subtotal: 20, lines: [{ name: 'Flowers', qty: 1, each: 20 }] };
  let attempt = { key: 'key', state: 'unknown', createdAt: 1700000000000, snapshot: { referenceId: 'provider-ref', order, online: { order, deliveryCents: 0 }, gateway, method: 'card', cardFee: { cents: 159 } }, result: null };
  const flags = { fulfilled: false, notified: false, customer_notified: false }, notices = [], transactions = [];
  const payment = { id: 'payment', reference_id: 'provider-ref', location_id: 'location', amount_money: { amount: 2159, currency: 'USD' }, status: 'COMPLETED' };
  const repo = { read: async () => attempt, settle: async (key, state, result) => { attempt = { ...attempt, state, result }; } };
  const client = { release() {}, async query(sql, params) {
    transactions.push(sql);
    if (sql.startsWith('SELECT fulfilled')) return { rows: [{ fulfilled: flags.fulfilled }] };
    if (sql.startsWith('SELECT data')) { if (boardFails) throw Error('Board unavailable'); return { rows: [{ data: order }] }; }
    if (sql.includes('SET fulfilled=true')) flags.fulfilled = true;
    return { rows: [] };
  } };
  const db = { connect: async () => client, async query(sql, params) {
    if (sql.includes('RETURNING notified')) return { rowCount: 1, rows: [{ ...flags }] };
    if (sql.includes('SET notified=notified OR')) { flags.notified ||= params[1]; flags.customer_notified ||= params[2]; }
    return { rows: [] };
  } };
  const mocks = {
    '@/lib/intake': { sendPaymentNotice: async (order, paid, audience) => { notices.push(audience); return audience === 'customer' && customerFails ? 'send-failed' : 'sent'; } },
    '@/lib/workroom/store': { getStore: () => ({ backend: 'postgres', getOrder: async () => order }) },
    './payment-attempts': { attemptRepository: () => repo, paymentDatabase: async () => db },
    './payment-engine': {}, './payments': {}, './oauth': { resolveSquare: async () => gateway },
    './client': { square: async () => ({ payments: noMatch ? [] : [payment] }) },
  };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/square/payment-service.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new vm.Script(source).runInNewContext({ module, exports: module.exports, require: name => name === 'server-only' ? {} : name === 'node:crypto' ? crypto : mocks[name] || (() => { throw Error(name); })(), URLSearchParams, Date, console: { error() {} } });
  return { service: module.exports, repo, flags, notices, transactions, payment };
}
test('reconciliation verifies merchant location, reference, amount and currency before recording payment', async () => {
  for (const mutation of [{ reference_id: 'other' }, { location_id: 'other' }, { amount_money: { amount: 1, currency: 'USD' } }, { amount_money: { amount: 2159, currency: 'CAD' } }]) {
    const app = setup();
    await assert.rejects(app.service.settleProviderPayment('key', { ...app.payment, ...mutation }, gateway));
    assert.equal((await app.repo.read()).state, 'unknown'); assert.equal(app.transactions.length, 0); assert.equal(app.notices.length, 0);
  }
});
test('confirmed recovery delivers one board ticket and independently tracks both notifications', async () => {
  const app = setup({ customerFails: true });
  await app.service.reconcilePayment('key');
  assert.equal((await app.repo.read()).state, 'completed');
  assert.deepEqual(app.flags, { fulfilled: true, notified: true, customer_notified: false });
  assert.deepEqual(app.notices, ['shop', 'customer']);
  await app.service.reconcilePayment('key');
  assert.deepEqual(app.notices, ['shop', 'customer', 'customer']);
  assert.equal(app.transactions.filter(sql => sql.startsWith('INSERT INTO workroom_orders')).length, 1);
});
test('board recovery rolls back on failure while the settled payment remains durable', async () => {
  const app = setup({ boardFails: true });
  await assert.rejects(app.service.reconcilePayment('key'));
  assert.equal((await app.repo.read()).state, 'completed'); assert.equal(app.flags.fulfilled, false);
  assert.ok(app.transactions.includes('ROLLBACK')); assert.equal(app.notices.length, 0);
  assert.equal((await app.service.reconcilePayment('key')).state, 'completed');
});
test('a provider search with no match leaves uncertainty intact and sends nothing', async () => {
  const app = setup({ noMatch: true });
  assert.equal((await app.service.reconcilePayment('key')).state, 'unknown');
  assert.equal(app.transactions.length, 0); assert.equal(app.notices.length, 0);
});
