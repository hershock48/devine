import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { sendPaymentNotice, type PricedOrder } from '@/lib/intake';
import { getStore, type WorkroomOrder, type OrderPayment } from '@/lib/workroom/store';
import { paymentDatabase, attemptRepository } from './payment-attempts';
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
    const paid = {
      totalCents: attempt.result.totalCents, feeCents: attempt.result.feeCents,
      deliveryCents: attempt.snapshot.online.deliveryCents,
    };
    if (!sent) sent = await sendPaymentNotice(attempt.snapshot.online.order, paid, 'shop') === 'sent';
    if (!customerSent) customerSent = await sendPaymentNotice(attempt.snapshot.online.order, paid, 'customer') === 'sent';
  } finally {
    await db.query('UPDATE devine_payment_attempts SET notified=notified OR $2,customer_notified=customer_notified OR $3,notify_until=0 WHERE attempt_key=$1 AND notify_until=$4', [key, sent, customerSent, leaseUntil]);
  }
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

export async function settleProviderPayment(key: string, payment: ProviderPayment, cfg: ResolvedSquare) {
  const attempt = await paymentRepo().read(key);
  if (!attempt || !payment.id || payment.reference_id !== attempt.snapshot.referenceId || payment.location_id !== cfg.locationId
    || !sameGateway(gatewayIdentity(cfg),attempt.snapshot.gateway)
    || payment.amount_money?.amount !== expectedTotal(attempt.snapshot) || payment.amount_money.currency !== 'USD') throw new Error('Payment does not match the saved intent.');
  const state = payment.status === 'COMPLETED' ? 'completed' : ['FAILED', 'CANCELED'].includes(payment.status || '') ? 'failed' : 'unknown';
  const result: PaymentResult = { paymentId: payment.id, status: payment.status || '', receiptUrl: payment.receipt_url || '', totalCents: payment.amount_money.amount!, feeCents: attempt.snapshot.method === 'card' ? attempt.snapshot.cardFee.cents : 0 };
  await paymentRepo().settle(key, state, result, attempt.fingerprint);
  if (state === 'completed') await fulfillPayment(key);
}
