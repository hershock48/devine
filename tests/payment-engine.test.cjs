const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/square/payment-engine.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new vm.Script(compiled).runInNewContext({ module: loaded, exports: loaded.exports });
const { runPayment } = loaded.exports;

function repository() {
  let row;
  return {
    async prepare(key, fingerprint, snapshot) {
      row ||= { key, fingerprint, snapshot, state: 'prepared', result: null, createdAt: 1 };
      return { ...row };
    },
    async claim() {
      if (row.state !== 'prepared') return false;
      row.state = 'processing';
      return true;
    },
    async settle(key, state, result) {
      if (row.state !== 'completed') Object.assign(row, { state, result });
    },
    async read() { return row ? { ...row } : null; },
  };
}
const result = { paymentId: 'payment-1', status: 'COMPLETED', receiptUrl: '', totalCents: 1500, feeCents: 99 };
const snapshot = { amountCents: 1500, orderId: 'order-1' };

test('concurrent submissions charge once and completed retries replay the original order', async () => {
  const repo = repository();
  let calls = 0;
  const charge = async saved => { calls++; assert.equal(saved.orderId, 'order-1'); return result; };
  const outcomes = await Promise.all(Array.from({ length: 20 }, () => runPayment(repo, 'key', 'same', snapshot, charge)));
  assert.equal(calls, 1);
  assert.equal(outcomes.filter(o => o.kind === 'completed').length, 1);
  const replay = await runPayment(repo, 'key', 'same', { ...snapshot, orderId: 'retry-generated-id' }, charge);
  assert.equal(replay.kind, 'completed');
  assert.equal(replay.attempt.snapshot.orderId, 'order-1');
  assert.equal(calls, 1);
});

test('lost provider response fences retries and never claims no charge occurred', async () => {
  const repo = repository();
  let calls = 0;
  const charge = async () => { calls++; throw new Error('Response lost after provider accepted payment'); };
  assert.equal((await runPayment(repo, 'key', 'same', snapshot, charge)).kind, 'pending');
  assert.equal((await runPayment(repo, 'key', 'same', snapshot, charge)).kind, 'pending');
  assert.equal((await repo.read()).state, 'unknown');
  assert.equal(calls, 1);
});

test('an attempt key cannot be reused for changed contents', async () => {
  const repo = repository();
  await repo.prepare('key', 'original', snapshot);
  const outcome = await runPayment(repo, 'key', 'changed', snapshot, async () => { throw new Error('Must not charge'); });
  assert.equal(outcome.kind, 'conflict');
  assert.equal((await repo.read()).state, 'prepared');
});

test('only COMPLETED is paid; authorization and unrecognized provider states stay pending', async () => {
  for (const status of ['APPROVED', 'PENDING', 'UNKNOWN', 'FAILED', 'CANCELED']) {
    const repo = repository();
    const outcome = await runPayment(repo, 'key', 'same', snapshot, async () => ({ ...result, status }));
    assert.equal(outcome.kind, ['FAILED', 'CANCELED'].includes(status) ? 'failed' : 'pending');
    let chargedAgain = false;
    await runPayment(repo, 'key', 'same', snapshot, async () => { chargedAgain = true; return result; });
    assert.equal(chargedAgain, false);
  }
});

test('storage failure before intent or claim prevents the provider call', async () => {
  for (const failure of ['prepare', 'claim']) {
    const repo = repository();
    repo[failure] = async () => { throw new Error('Database unavailable'); };
    let charged = false;
    await assert.rejects(runPayment(repo, 'key', 'same', snapshot, async () => { charged = true; return result; }));
    assert.equal(charged, false);
  }
});

test('crash or storage failure after charging leaves the attempt fenced for reconciliation', async () => {
  const repo = repository();
  repo.settle = async () => { throw new Error('Database disconnected after payment'); };
  let calls = 0;
  const charge = async () => { calls++; return result; };
  await assert.rejects(runPayment(repo, 'key', 'same', snapshot, charge));
  assert.equal((await repo.read()).state, 'processing');
  assert.equal((await runPayment(repo, 'key', 'same', snapshot, charge)).kind, 'pending');
  assert.equal(calls, 1);
});

test('a completed webhook wins over a late ambiguous charge response', async () => {
  const repo = repository();
  const outcome = await runPayment(repo, 'key', 'same', snapshot, async () => {
    await repo.settle('key', 'completed', result);
    throw Error('HTTP response lost after webhook delivery');
  });
  assert.equal(outcome.kind, 'completed'); assert.equal(outcome.attempt.result.paymentId, result.paymentId);
});
