const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const test = require('node:test'), assert = require('node:assert/strict'), ts = require('typescript');
function load(file, mocks = {}, env = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new vm.Script(code).runInNewContext({ module, exports: module.exports, require: name => {
    if (name === 'server-only') return {};
    if (name === './derive') return load('src/lib/workroom/derive.ts');
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw Error(`Unexpected import: ${name}`);
  }, process: { env }, Date, URL, console });
  return module.exports;
}
function route({ authed = true, owner = true, accepted = true, fail = false } = {}) {
  let writes = 0;
  const api = load('src/app/api/workroom/orders/route.ts', {
    'next/server': { NextResponse: { json: (body, opts = {}) => ({ body, status: opts.status || 200 }) } },
    '@/lib/workroom/auth': { isWorkroomAuthed: async () => authed, isWorkroomOwner: async () => owner },
    '@/lib/workroom/store': { getStore: () => ({ markOrderRefunded: async () => { writes++; if (fail) throw Error('offline'); return accepted; } }) },
    '@/lib/catalog': {}, '@/lib/intake': {},
  });
  return { patch: body => api.PATCH({ json: async () => body }), writes: () => writes };
}
test('refund confirmations require an owner and reject malformed requests', async () => {
  for (const [options, expected] of [[{ authed: false }, 401], [{ owner: false }, 403]]) {
    const api = route(options); assert.equal((await api.patch({ id: 'one', markRefunded: true })).status, expected); assert.equal(api.writes(), 0);
  }
  for (const body of [null, [], 'bad', {}]) assert.equal((await route().patch(body)).status, 400);
});
test('refund conflicts and storage outages are never reported as saved', async () => {
  for (const [options, expected] of [[{ accepted: false }, 409], [{ fail: true }, 503], [{}, 200]]) {
    assert.equal((await route(options).patch({ id: 'one', markRefunded: true })).status, expected);
  }
});
test('refund storage accepts only canceled paid orders and preserves the original confirmation', async () => {
  const store = load('src/lib/workroom/store.ts').getStore();
  const payment = { totalCents: 2000, method: 'cash' };
  for (const [id, status, paid, expected] of [['active', 'confirmed', true, false], ['unpaid', 'canceled', false, false], ['canceled', 'canceled', true, true]]) {
    await store.createOrder({ id, status, createdAt: Date.now(), payment: paid ? { ...payment } : undefined });
    assert.equal(await store.markOrderRefunded(id), expected);
  }
  assert.equal(await store.markOrderRefunded('missing'), false);
  const first = (await store.getOrder('canceled')).payment.refundedAt;
  assert.equal(await store.markOrderRefunded('canceled'), true);
  assert.equal((await store.getOrder('canceled')).payment.refundedAt, first);
  const production = load('src/lib/workroom/store.ts', {}, { NODE_ENV: 'production' }).getStore();
  await assert.rejects(production.markOrderRefunded('canceled'));
});
