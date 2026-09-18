import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { sendPaymentNotice, noticeMessageId, type PricedOrder, type PaidOnline } from '@/lib/intake';
import { getStore, type WorkroomOrder, type OrderPayment } from '@/lib/workroom/store';
import { paymentDatabase, attemptRepository } from './payment-attempts';
import { beginNotice, finishNotice, noticeKey, type NoticeAudience, type NoticeSend } from './payment-notices';
import { runPayment, PaymentNotSubmitted, type Attempt, type PaymentResult } from './payment-engine';
import { chargeBoardOrder } from './payments';
import { resolveSquare, type ResolvedSquare } from './oauth';
import { square } from './client';

export type PaymentIntent = {
  referenceId?: string;
  order: WorkroomOrder;
  online?: { order: PricedOrder; deliveryCents: number };
  method: 'card' | 'cash' | 'manual';
  gateway: { env: string; locationId: string; viaOAuth: boolean } | null;
  cardFee: { name: string; cents: number; appFeeCents: number };
};
export const paymentFingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const gatewayIdentity = (cfg: ResolvedSquare) => ({ env: cfg.env, locationId: cfg.locationId, viaOAuth: cfg.viaOAuth });
// jsonb may reorder object keys. Identity is these values, never JSON byte order.
const sameGateway=(a:PaymentIntent['gateway'],b:PaymentIntent['gateway'])=>!!a&&!!b&&a.env===b.env&&a.locationId===b.locationId&&a.viaOAuth===b.viaOAuth;
export const paymentRepo = () => attemptRepository<PaymentIntent>();
export const pendingMessage = 'Payment is awaiting confirmation. Do not pay again or place a replacement order. Check payment status or contact the shop.';

export function expectedTotal(intent: PaymentIntent) {
  return intent.order.lines.reduce((sum, line) => sum + Math.round(line.each * 100) * line.qty, 0)
    + (intent.method === 'card' ? intent.cardFee.cents : 0);
}

export async function takePayment(key: string, fingerprint: string, intent: PaymentIntent, sourceId?: string, retryOf?: string) {
  if (getStore().backend !== 'postgres') throw new Error('Persistent workroom storage is required.');
  // Initialize the board before claiming an attempt. A storage outage cannot trigger a charge.
  await getStore().getOrder(intent.order.id);
  return runPayment(paymentRepo(), key, fingerprint, { ...intent, referenceId: randomUUID() }, async saved => {
    let current:WorkroomOrder|null;
    try{current=await getStore().getOrder(saved.order.id);}catch{throw new PaymentNotSubmitted('ORDER_CHECK_UNAVAILABLE');}
    if (current?.payment || current?.status === 'canceled'||(!saved.online&&!current)) throw new PaymentNotSubmitted('ORDER_CHANGED');
    if (saved.method === 'manual') return { paymentId: '', status: 'COMPLETED', receiptUrl: '', totalCents: expectedTotal(saved), feeCents: 0 };
    let cfg:ResolvedSquare|null;
    try{cfg=await resolveSquare();}catch{throw new PaymentNotSubmitted('CONNECTION_UNAVAILABLE');}
    if (!cfg || !sameGateway(gatewayIdentity(cfg),saved.gateway)) throw new PaymentNotSubmitted('CONNECTION_CHANGED');
    return chargeBoardOrder(cfg, {
      attemptKey: saved.referenceId!, workroomOrderId: saved.referenceId!, orderNumber: saved.order.number,
      lines: saved.order.lines, method: saved.method, sourceId, cardFee: saved.cardFee,
    });
  },retryOf);
}

export function settledPayment(attempt: Attempt<PaymentIntent>): OrderPayment {
  if (attempt.state !== 'completed' || !attempt.result) throw new Error('Payment is not completed.');
  return {
    at: attempt.createdAt, method: attempt.snapshot.method === 'manual' ? 'other' : attempt.snapshot.method,
    squarePaymentId: attempt.result.paymentId, totalCents: attempt.result.totalCents, feeCents: attempt.result.feeCents,
  };
}

/** Board delivery is transactional and replayable. Email is at-least-once:
 * a lost SMTP acknowledgement can cause a duplicate email with the SAME order number,
 * but never a second order or charge. A lease prevents concurrent retry sends.
 */
export async function fulfillPayment(key: string) {
  const attempt = await paymentRepo().read(key);
  if (!attempt || attempt.state !== 'completed' || !attempt.result) return;
  const db = await paymentDatabase();
  await getStore().getOrder(attempt.snapshot.order.id); // initialize board schema
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT fulfilled FROM devine_payment_attempts WHERE attempt_key=$1 FOR UPDATE', [key]);
    if (!locked.rows[0].fulfilled) {
      const order = { ...attempt.snapshot.order, payment: settledPayment(attempt) };
      if (attempt.snapshot.online) {
        await client.query(`INSERT INTO workroom_orders(id,status,created_at,data) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`, [order.id, order.status, order.createdAt, JSON.stringify(order)]);
      }
      const existing = await client.query('SELECT data FROM workroom_orders WHERE id=$1 FOR UPDATE', [order.id]);
      if (!existing.rows[0]) throw new Error('The paid order is missing from the board.');
      const prior = existing.rows[0].data as WorkroomOrder;
      if (prior.payment && prior.payment.squarePaymentId !== order.payment.squarePaymentId) throw new Error('A different payment is already recorded. Review required.');
      await client.query(`UPDATE workroom_orders SET data=data || $2::jsonb WHERE id=$1`, [order.id, JSON.stringify({ payment: order.payment, lines: order.lines, subtotal: order.subtotal })]);
      await client.query('UPDATE devine_payment_attempts SET fulfilled=true,updated_at=$2 WHERE attempt_key=$1', [key, Date.now()]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }

  if (!attempt.snapshot.online) {
    await db.query('UPDATE devine_payment_attempts SET notified=true,customer_notified=true WHERE attempt_key=$1', [key]);
    return;
  }
  const leaseUntil = Date.now() + 180000;
  const lease = await db.query(`UPDATE devine_payment_attempts SET notify_until=$2 WHERE attempt_key=$1 AND (notified=false OR customer_notified=false) AND notify_until<$3 RETURNING notified,customer_notified`, [key, leaseUntil, Date.now()]);
  if (!lease.rowCount) return;
  let sent = lease.rows[0].notified, customerSent = lease.rows[0].customer_notified;
  try {
    // The flag turns on when the audience is SETTLED, not when a send happened
    // here. A notice already recorded as sent whose flag write was lost is
    // settled; reading that refusal as a failure kept the payment on the
    // recovery board for work that was already done.
    if (!sent) sent = (await deliverNotice(db, attempt, 'shop')).settled;
    if (!customerSent) customerSent = (await deliverNotice(db, attempt, 'customer')).settled;
  } finally {
    await db.query('UPDATE devine_payment_attempts SET notified=notified OR $2,customer_notified=customer_notified OR $3,notify_until=0 WHERE attempt_key=$1 AND notify_until=$4', [key, sent, customerSent, leaseUntil]);
  }
}

const paidFigures = (attempt: Attempt<PaymentIntent>): PaidOnline => ({
  totalCents: attempt.result!.totalCents, feeCents: attempt.result!.feeCents,
  deliveryCents: attempt.snapshot.online!.deliveryCents,
});

/** Two different questions, and the code used to answer both with one boolean.
 * `settled` is whether the audience owes nothing now, which is what the
 * payment row's flag records. `sent` is whether a message was handed to the
 * mail server during this call, which is what the owner's screen reports back
 * after they press the button. A notice that was already delivered is settled
 * and not sent; a partly refused one is sent and not settled. `outcome` is
 * what the mail code said, kept so the board can name the partial case
 * instead of calling it a plain failure. */
type NoticeDelivery = { settled: boolean; sent: boolean; outcome: NoticeSend['outcome'] | null };

/**
 * One notification attempt, recorded before the mail server is contacted so
 * that a lost answer leaves evidence instead of nothing.
 *
 * Charges nothing. It reads a completed attempt and sends mail; no code path
 * from here reaches Square. `force` is the owner's resend from the board and
 * is the only way a notice whose answer was lost, or whose address list was
 * partly refused, is sent a second time.
 */
async function deliverNotice(db: Awaited<ReturnType<typeof paymentDatabase>>, attempt: Attempt<PaymentIntent>, audience: NoticeAudience, force = false): Promise<NoticeDelivery> {
  const order = attempt.snapshot.order;
  const key = noticeKey(order.id, audience);
  const begun = await beginNotice(db, {
    key, attemptKey: attempt.key, orderNumber: order.number, audience, messageId: noticeMessageId(key), force,
  });
  if (!begun.open) return { settled: begun.settled, sent: false, outcome: null };
  const result = await sendPaymentNotice(attempt.snapshot.online!.order, paidFigures(attempt), audience, begun.messageId);
  await finishNotice(db, key, result);
  // A partly refused send is deliberately NOT settled: a copy went out, the
  // address list is still wrong, and the owner has to see that on the board.
  return { settled: result.outcome === 'sent' || result.outcome === 'not-needed', sent: true, outcome: result.outcome };
}

/** A resend the records themselves refuse: this attempt has no notification to
 * send, or another delivery already holds the lease. It is a finding the owner
 * can act on, and it is NOT what a storage outage is, so the two must not
 * arrive at the board as the same sentence. */
export class NoticeNotResent extends Error {}

/** What the owner is told afterwards. `nothing-sent` covers a notice the
 * record refused, which is usually one that already went out. */
export type NoticeResend = 'sent' | 'partly-sent' | 'not-sent' | 'nothing-sent';

/**
 * The owner's resend from /workroom/payments. Moves no money: it takes an
 * attempt that is already completed and re-runs one of its two emails under
 * the same Message-ID, behind the same lease that stops two clicks sending
 * twice. A notice already delivered is refused by beginNotice, so a second
 * click on a send that worked does nothing.
 */
export async function resendNotice(key: string, audience: NoticeAudience): Promise<NoticeResend> {
  const attempt = await paymentRepo().read(key);
  if (!attempt || attempt.state !== 'completed' || !attempt.result || !attempt.snapshot.online) {
    throw new NoticeNotResent('Only a paid online order has a notification to send again.');
  }
  const db = await paymentDatabase();
  const leaseUntil = Date.now() + 180000;
  const lease = await db.query(`UPDATE devine_payment_attempts SET notify_until=$2 WHERE attempt_key=$1 AND notify_until<$3 RETURNING notified`, [key, leaseUntil, Date.now()]);
  if (!lease.rowCount) throw new NoticeNotResent('A delivery attempt is already running. Wait for it to finish.');
  let delivery: NoticeDelivery = { settled: false, sent: false, outcome: null };
  try {
    delivery = await deliverNotice(db, attempt, audience, true);
  } finally {
    // The flag follows what the record says the audience is owed, so a click on
    // a notice that had already gone out finally clears the row it was stuck on.
    await db.query('UPDATE devine_payment_attempts SET notified=notified OR $2,customer_notified=customer_notified OR $3,notify_until=0 WHERE attempt_key=$1 AND notify_until=$4',
      [key, audience === 'shop' && delivery.settled, audience === 'customer' && delivery.settled, leaseUntil]);
  }
  if (!delivery.sent) return 'nothing-sent';
  if (delivery.outcome === 'sent-with-refusals') return 'partly-sent';
  return delivery.settled ? 'sent' : 'not-sent';
}

type ProviderPayment = { id?: string; status?: string; reference_id?: string; location_id?: string; amount_money?: { amount?: number; currency?: string }; receipt_url?: string };

export async function reconcilePayment(key: string) {
  const attempt = await paymentRepo().read(key);
  if (!attempt) return null;
  if (attempt.state === 'completed') { await fulfillPayment(key).catch(() => console.error('[devine] paid order requires recovery', key)); return attempt; }
  if (!attempt.snapshot.gateway || attempt.state === 'prepared' || attempt.state === 'failed') return attempt;
  const cfg = await resolveSquare();
  if (!cfg || !sameGateway(gatewayIdentity(cfg),attempt.snapshot.gateway)) throw new Error('Reconnect the original Square location before reconciliation.');
  let found: ProviderPayment | undefined;
  if (attempt.result?.paymentId) {
    const response = await square<{ payment?: ProviderPayment }>(cfg, 'GET', `/v2/payments/${encodeURIComponent(attempt.result.paymentId)}`);
    found = response.payment;
  } else {
    // Bounded read-only search. No match is NOT proof that a charge failed.
    let cursor = '';
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({ location_id: cfg.locationId, begin_time: new Date(attempt.createdAt - 60000).toISOString(), end_time: new Date(attempt.createdAt + 86400000).toISOString(), sort_order: 'ASC', limit: '100' });
      if (cursor) params.set('cursor', cursor);
      const response = await square<{ payments?: ProviderPayment[]; cursor?: string }>(cfg, 'GET', `/v2/payments?${params}`);
      found = response.payments?.find(payment => payment.reference_id === attempt.snapshot.referenceId);
      if (found || !response.cursor) break;
      cursor = response.cursor;
    }
  }
  if (found) await settleProviderPayment(key, found, cfg);
  return paymentRepo().read(key);
}

/** A provider payment that contradicts the saved intent is a fact about the
 * provider, not a storage failure, and asking again will not change it. Typed
 * so a caller answering a webhook can file it for the owner and stop the
 * redeliveries instead of looping on a 500. The reason names which check
 * failed; it goes in the owner's record, never to a customer. */
export class PaymentIntentMismatch extends Error {
  constructor(public reason: string) { super('Payment does not match the saved intent.'); }
}

/** The same reason, for the person reading the board. The tokens above are the
 * code's own shorthand for which check failed, and printing one at a florist
 * ("does not match the saved order (amount)") tells her nothing she can do.
 * An unrecognised token falls back to the general statement rather than
 * leaking itself onto the screen. */
export function conflictWording(reason: string | undefined): string {
  const said: Record<string, string> = {
    reference: 'it names a different order',
    location: 'it was taken at a different Square location',
    connection: 'it came through a different Square connection than this order was set up with',
    amount: 'the amount is not what this order came to',
    currency: 'it is not in US dollars',
    'no saved attempt': 'there is no saved order behind it',
    'no provider payment id': 'Square sent it with no payment id',
    'incomplete payment': 'Square left out details the shop checks before settling',
  };
  return said[reason ?? ''] ?? 'it does not agree with what this order saved';
}

export async function settleProviderPayment(key: string, payment: ProviderPayment, cfg: ResolvedSquare) {
  const attempt = await paymentRepo().read(key);
  const reason = !attempt ? 'no saved attempt'
    : !payment.id ? 'no provider payment id'
    : payment.reference_id !== attempt.snapshot.referenceId ? 'reference'
    : payment.location_id !== cfg.locationId ? 'location'
    : !sameGateway(gatewayIdentity(cfg), attempt.snapshot.gateway) ? 'connection'
    : payment.amount_money?.amount !== expectedTotal(attempt.snapshot) ? 'amount'
    : payment.amount_money.currency !== 'USD' ? 'currency' : '';
  if (reason || !attempt || !payment.id || !payment.amount_money) throw new PaymentIntentMismatch(reason || 'incomplete payment');
  const state = payment.status === 'COMPLETED' ? 'completed' : ['FAILED', 'CANCELED'].includes(payment.status || '') ? 'failed' : 'unknown';
  const result: PaymentResult = { paymentId: payment.id, status: payment.status || '', receiptUrl: payment.receipt_url || '', totalCents: payment.amount_money.amount!, feeCents: attempt.snapshot.method === 'card' ? attempt.snapshot.cardFee.cents : 0 };
  await paymentRepo().settle(key, state, result, attempt.fingerprint);
  if (state === 'completed') await fulfillPayment(key);
}
