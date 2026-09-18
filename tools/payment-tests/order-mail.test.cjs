/** What sendPaymentNotice makes of the answer nodemailer hands back.
 *
 * The state machine's own tests run on PGlite and mock this file out; this one
 * goes the other way and runs the real intake code against a fake transport, so
 * the reading of `accepted` and `rejected` is tested where it actually happens.
 * Nothing here opens a socket.
 *
 * The case that matters is PARTIAL acceptance. ORDER_TO is a raw env string,
 * nodemailer splits it on commas, and a send resolves as soon as ONE of those
 * addresses is taken. A send where NOBODY was accepted does not arrive here at
 * all: nodemailer rejects it with EENVELOPE, which is why reading `accepted`
 * alone was very nearly dead code.
 */
const test = require('node:test'), assert = require('node:assert/strict');
const { load } = require('./harness.cjs');

const TWO_ADDRESSES = 'orders@fixture.invalid, kitchen@fixture.invalid';
const SMTP = {
  SMTP_HOST: 'mail.fixture.invalid', SMTP_USER: 'sender@fixture.invalid', SMTP_PASS: 'secret',
  SMTP_PORT: '465', ORDER_FROM: 'sender@fixture.invalid', ORDER_TO: TWO_ADDRESSES,
};

const priced = {
  number: 'DV-TEST', name: 'Fixture', phone: '555-0100', email: 'guest@fixture.invalid',
  fulfillment: 'pickup', date: '2026-09-20', recipient: '', street: '', town: '', zip: '',
  occasion: '', cardMessage: '', notes: '',
  lines: [{ slug: 'flowers', name: 'Flowers', qty: 1, each: 20, line: 20 }], subtotal: 20,
};
const paid = { totalCents: 2060, feeCents: 60, deliveryCents: 0 };

/** The site's own modules, reduced to the handful of values a ticket renders. */
const SITE = {
  site: { name: 'DeVine Flowers', shortName: 'DeVine', phone: '555-0100', deliveryZips: [] },
  addressOneLine: '1 Fixture Street',
};

/** A transport that answers however the test says, and records what it was
 * asked to send. `close` exists because the code always closes it. */
function transport(answer) {
  const sent = [];
  const fake = {
    createTransport: () => ({
      sendMail: async (message) => { sent.push(message); return typeof answer === 'function' ? answer(message) : answer; },
      close() {},
    }),
  };
  return { sent, module: { ...fake, default: fake } };
}

const intake = (answer, env = SMTP) => {
  const mail = transport(answer);
  return {
    ...mail,
    api: load('src/lib/intake.ts', {
      nodemailer: mail.module,
      '@/lib/catalog': { bySlug: new Map(), money: (n) => `$${Number(n).toFixed(2)}` },
      '@/lib/site': SITE,
      '@/lib/occasions': { occasions: [] },
    }, env),
  };
};

test('a send both shop addresses took is recorded as sent', async () => {
  const app = intake({ accepted: ['orders@fixture.invalid', 'kitchen@fixture.invalid'], rejected: [], response: '250 2.0.0 Ok', messageId: '<fixture@fixture.invalid>' });
  const result = await app.api.sendPaymentNotice(priced, paid, 'shop', '<notice@fixture.invalid>');
  assert.equal(result.outcome, 'sent');
  assert.equal(result.error, null);
  assert.equal(result.providerResponse, '250 2.0.0 Ok');
  assert.equal(app.sent[0].to, TWO_ADDRESSES, 'the raw env string is what nodemailer splits');
});

test('a send one of the two shop addresses refused is sent with refusals, and names both sides of it', async () => {
  const app = intake({ accepted: ['orders@fixture.invalid'], rejected: ['kitchen@fixture.invalid'], response: '250 2.0.0 Ok', messageId: '<fixture@fixture.invalid>' });
  const result = await app.api.sendPaymentNotice(priced, paid, 'shop', '<notice@fixture.invalid>');
  assert.equal(result.outcome, 'sent-with-refusals', 'a copy is in one mailbox and an address is wrong, which is neither sent nor failed');
  assert.match(result.error, /refused kitchen@fixture\.invalid/, 'the owner is told which address was refused');
  assert.match(result.error, /took orders@fixture\.invalid/, 'and which one did take it, so the shop knows a copy exists');
  assert.equal(result.providerMessageId, '<fixture@fixture.invalid>', 'a message did go out, so its identifier is kept');
  assert.equal(result.providerResponse, '250 2.0.0 Ok');
});

test('an address list nodemailer answers with objects rather than strings reads the same', async () => {
  const app = intake({ accepted: [{ address: 'orders@fixture.invalid' }], rejected: [{ address: 'kitchen@fixture.invalid' }], response: '250 2.0.0 Ok' });
  const result = await app.api.sendPaymentNotice(priced, paid, 'shop', '<notice@fixture.invalid>');
  assert.equal(result.outcome, 'sent-with-refusals');
  assert.match(result.error, /refused kitchen@fixture\.invalid/);
});

test('a 250 that took nobody is a failure, and a refusal of every address arrives as a throw', async () => {
  const polite = intake({ accepted: [], rejected: ['orders@fixture.invalid'], response: '250 2.0.0 Ok' });
  const first = await polite.api.sendPaymentNotice(priced, paid, 'shop', '<notice@fixture.invalid>');
  assert.equal(first.outcome, 'send-failed');
  assert.equal(first.error, 'The mail server accepted no address on it.');

  // What nodemailer really does when nobody is accepted, which is the reason
  // the branch above is the rare one and `rejected` is the live one.
  const refused = intake(() => { const error = new Error("Can't send mail - all recipients were rejected"); error.code = 'EENVELOPE'; throw error; });
  const second = await refused.api.sendPaymentNotice(priced, paid, 'shop', '<notice@fixture.invalid>');
  assert.equal(second.outcome, 'send-failed');
  assert.match(second.error, /all recipients were rejected/);
});

test('an unset mailbox says so in the shop and never in setting names', async () => {
  const app = intake({ accepted: ['orders@fixture.invalid'], rejected: [] }, { SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', ORDER_TO: '' });
  const result = await app.api.sendPaymentNotice(priced, paid, 'shop', '<notice@fixture.invalid>');
  assert.equal(result.outcome, 'unconfigured');
  assert.equal(app.sent.length, 0);
  for (const name of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'ORDER_TO']) {
    assert.ok(!result.error.includes(name), `${name} is printed at the owner`);
  }
});

test('a customer with no address on the order is settled, not owed', async () => {
  const app = intake({ accepted: [], rejected: [] });
  const result = await app.api.sendPaymentNotice({ ...priced, email: '' }, paid, 'customer', '<notice@fixture.invalid>');
  assert.equal(result.outcome, 'not-needed');
  assert.equal(app.sent.length, 0);
});
