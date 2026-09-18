import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isWorkroomAuthed, isWorkroomOwner } from '@/lib/workroom/auth';
import { paymentDatabase } from '@/lib/square/payment-attempts';
import { expectedTotal, type PaymentIntent } from '@/lib/square/payment-service';
import { noticesForAttempts, noticeWording, type NoticeRow } from '@/lib/square/payment-notices';
import { recover, confirmNoPayment, sendNoticeAgain } from './actions';

export const dynamic = 'force-dynamic';

/** Eastern, because the shop is. Written out rather than repeated inline. */
const shopTime = (at: number | string) => new Date(Number(at)).toLocaleString('en-US', { timeZone: 'America/Detroit' });
const noticesOf = (all: NoticeRow[], attemptKey: string) => all.filter(item => item.attemptKey === attemptKey);

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (!(await isWorkroomAuthed())) redirect('/workroom');
  const owner = await isWorkroomOwner();
  const { notice } = await searchParams;
  const messages: Record<string, string> = {
    retry: 'Recovery could not finish. Check the connection and try again.',
    checked: 'Status checked. Any unfinished work remains below.',
    'verification-required': 'Confirm the payment check and record its evidence first.',
    'review-refused': 'Review was not saved. Reload, wait five minutes after the latest activity, and check the original payment location. Known payments, changed attempts and connection failures stay blocked.',
    released: 'Owner review saved. No money was moved. Staff can refresh the board and explicitly retry; online customers can return to checkout.',
    'notice-sent': 'The email went out. Nothing was charged.',
    'notice-failed': 'The email did not go out. Check the mail settings and try again. Nothing was charged.',
    'notice-refused': 'The email was not sent again. It may already have been delivered, or another attempt is still running. Reload and read its line below.',
  };
  type AttemptRow = { attempt_key: string; fingerprint: string; state: string; snapshot: PaymentIntent; result: {status?:string;paymentId?:string}|null; fulfilled: boolean; notified: boolean; customer_notified: boolean; created_at: string; updated_at: string; provider_conflict: {reason?:string;paymentId?:string;amountCents?:number|null;seenAt?:number}|null; review_evidence?: string; reviewed_at?: string };
  let rows: AttemptRow[] = [];
  let notices: NoticeRow[] = [];
  let unavailable = false;
  try {
    const db = await paymentDatabase();
    // One list, one query: everything a payment still owes somebody. A
    // completed, fulfilled payment whose email never went out is unfinished
    // work too, and so is one Square has since contradicted.
    rows = (await db.query(`SELECT a.*,r.evidence AS review_evidence,r.reviewed_at FROM devine_payment_attempts a
      LEFT JOIN devine_payment_reviews r ON r.reference_id=a.snapshot->>'referenceId'
      WHERE a.attempt_key NOT LIKE 'archived:%' AND (a.state<>'completed' OR a.fulfilled=false OR a.notified=false OR a.customer_notified=false OR a.provider_conflict IS NOT NULL)
      ORDER BY a.created_at ASC LIMIT 100`)).rows as AttemptRow[];
    notices = await noticesForAttempts(db, rows.map(row => row.attempt_key));
  } catch { unavailable = true; }
  return <section style={{ paddingBlock: 20 }}>
    <p><Link href="/workroom">Back to order board</Link></p>
    <h1>Payment recovery</h1>
    <p>Check uncertain payments with Square and retry delivery of confirmed orders to the board and shop inbox. This does not charge or refund a customer.</p>
    {notice && messages[notice] && <p role="status">{messages[notice]}</p>}
    {unavailable ? <p role="alert">Payment storage is unavailable. Do not retry charges until the connection is restored.</p> : rows.length === 0 ? <p>No payment recovery work is waiting.</p> : rows.map(row => <section key={row.attempt_key} style={{ borderBottom: '1px solid var(--line)', paddingBlock: 20 }}>
      <h2>{row.snapshot.order.number} · {row.snapshot.order.name}</h2>
      <p>{row.state === 'completed' ? `Payment confirmed · Board ${row.fulfilled ? 'saved' : 'pending'}` : row.state === 'failed' ? `${row.result?.status === 'OWNER_CONFIRMED_NO_PAYMENT' ? 'The owner recorded verified absence of payment.' : row.result?.status === 'NOT_SUBMITTED' ? 'No payment was submitted.' : 'The payment was declined or canceled.'} ${row.snapshot.online ? 'The customer can return to checkout.' : 'Staff can refresh the order board and explicitly retry with another card or payment method.'}` : 'Payment unconfirmed. Do not collect it again until reconciled.'}</p>
      <p>Started {shopTime(row.created_at)} Eastern · last activity {shopTime(row.updated_at)} Eastern</p>
      <p>Amount ${(expectedTotal(row.snapshot) / 100).toFixed(2)} · {row.snapshot.method} · {row.snapshot.gateway ? `${row.snapshot.gateway.env}, location ${row.snapshot.gateway.locationId}` : 'Recorded outside Square'}</p>
      <p style={{ overflowWrap: 'anywhere' }}>Payment reference: {row.snapshot.referenceId || 'Unavailable'}</p>
      {row.provider_conflict && <p role="alert">Square reported a payment on this reference that does not match the saved order ({row.provider_conflict.reason}). Square payment {row.provider_conflict.paymentId}{typeof row.provider_conflict.amountCents === 'number' ? ` for $${(row.provider_conflict.amountCents / 100).toFixed(2)}` : ''}, first seen {shopTime(row.provider_conflict.seenAt ?? row.updated_at)} Eastern. Nothing was settled from it. Check this payment at Square before anyone collects again.</p>}
      {row.review_evidence && <p>Owner review: {row.review_evidence} ({shopTime(row.reviewed_at ?? row.updated_at)} Eastern)</p>}
      {/* The emails this order owes. Older payments have no notice record, so
          their flags are the only thing to report and they are reported as
          they are, without pretending to a detail that was never kept. */}
      {noticesOf(notices, row.attempt_key).length === 0
        ? row.state === 'completed' && row.snapshot.online && <p>Shop email {row.notified ? 'sent' : 'not sent yet'} · Customer receipt {row.customer_notified ? 'sent or not needed' : 'not sent yet'}</p>
        : noticesOf(notices, row.attempt_key).map(item => <p key={item.key} style={{ overflowWrap: 'anywhere' }}>
            {noticeWording(item)} · {item.attempts} {item.attempts === 1 ? 'try' : 'tries'}, last {shopTime(item.updatedAt)} Eastern
            {item.providerResponse ? ` · mail server said: ${item.providerResponse}` : ''}
            {item.providerMessageId ? ` · message ${item.providerMessageId}` : ''}
            {item.lastError ? ` · ${item.lastError}` : ''}
          </p>)}
      <form action={recover}><input type="hidden" name="key" value={row.attempt_key}/><button className="btn">Check status and recover</button></form>
      {owner && noticesOf(notices, row.attempt_key).filter(item => ['failed', 'unconfirmed', 'unconfigured'].includes(item.state)).map(item => <form key={`resend-${item.key}`} action={sendNoticeAgain} style={{ marginTop: 12 }}>
        <input type="hidden" name="key" value={row.attempt_key}/>
        <input type="hidden" name="audience" value={item.audience}/>
        {item.state === 'unconfirmed' && <p>This one may already have been delivered. Sending it again can put a second copy of the same email in the inbox; it carries the same message id, so most mail programs file the two together. It cannot charge anyone.</p>}
        <button className="btn">Send the {item.audience === 'shop' ? 'shop ticket' : 'customer receipt'} again</button>
      </form>)}
      {owner && ['processing','unknown'].includes(row.state) && row.snapshot.referenceId && !row.result?.paymentId && <details style={{ marginTop: 16 }}>
        <summary>Record verified absence of payment</summary>
        <p>Check the original location, amount, date and reference with Square or the original payment records. An empty search or a timeout is not proof. Wait at least five minutes after the last payment activity. Escalate uncertainty before allowing another collection.</p>
        <form action={confirmNoPayment} style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
          <input type="hidden" name="key" value={row.attempt_key}/>
          <input type="hidden" name="referenceId" value={row.snapshot.referenceId}/>
          <input type="hidden" name="fingerprint" value={row.fingerprint}/>
          <label>Verification evidence, including who checked and any support reference
            <textarea name="evidence" required minLength={20} maxLength={2000} rows={4} style={{ display: 'block', width: '100%', boxSizing: 'border-box' }}/>
          </label>
          <label><input name="verified" type="checkbox" value="yes" required/> I verified that this attempt has no completed or pending payment at the original provider or payment source.</label>
          <button className="btn">Save owner review and allow explicit retry</button>
        </form>
      </details>}
    </section>)}
    <p>If a payment remains unconfirmed, inspect the original Square location using its order number. An empty search is not proof that no charge occurred. Escalate unresolved attempts before collecting money again.</p>
  </section>;
}
