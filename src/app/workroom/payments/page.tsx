import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isWorkroomAuthed, isWorkroomOwner } from '@/lib/workroom/auth';
import { paymentDatabase } from '@/lib/square/payment-attempts';
import { expectedTotal, type PaymentIntent } from '@/lib/square/payment-service';
import { recover, confirmNoPayment } from './actions';

export const dynamic = 'force-dynamic';

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
  };
  let rows: { attempt_key: string; fingerprint: string; state: string; snapshot: PaymentIntent; result: {status?:string;paymentId?:string}|null; fulfilled: boolean; notified: boolean; customer_notified: boolean; created_at: string; updated_at: string; review_evidence?: string; reviewed_at?: string }[] = [];
  let unavailable = false;
  try {
    const db = await paymentDatabase();
    rows = (await db.query(`SELECT a.*,r.evidence AS review_evidence,r.reviewed_at FROM devine_payment_attempts a
      LEFT JOIN devine_payment_reviews r ON r.reference_id=a.snapshot->>'referenceId'
      WHERE a.attempt_key NOT LIKE 'archived:%' AND (a.state<>'completed' OR a.fulfilled=false OR a.notified=false OR a.customer_notified=false)
      ORDER BY a.created_at ASC LIMIT 100`)).rows;
  } catch { unavailable = true; }
  return <section style={{ paddingBlock: 20 }}>
    <p><Link href="/workroom">Back to order board</Link></p>
    <h1>Payment recovery</h1>
    <p>Check uncertain payments with Square and retry delivery of confirmed orders to the board and shop inbox. This does not charge or refund a customer.</p>
    {notice && messages[notice] && <p role="status">{messages[notice]}</p>}
    {unavailable ? <p role="alert">Payment storage is unavailable. Do not retry charges until the connection is restored.</p> : rows.length === 0 ? <p>No payment recovery work is waiting.</p> : rows.map(row => <section key={row.attempt_key} style={{ borderBottom: '1px solid var(--line)', paddingBlock: 20 }}>
      <h2>{row.snapshot.order.number} · {row.snapshot.order.name}</h2>
      <p>{row.state === 'completed' ? `Payment confirmed · Board ${row.fulfilled ? 'saved' : 'pending'} · Shop email ${row.notified ? 'sent' : 'pending'} · Customer receipt ${row.customer_notified ? 'sent or not needed' : 'pending'}` : row.state === 'failed' ? `${row.result?.status === 'OWNER_CONFIRMED_NO_PAYMENT' ? 'The owner recorded verified absence of payment.' : row.result?.status === 'NOT_SUBMITTED' ? 'No payment was submitted.' : 'The payment was declined or canceled.'} ${row.snapshot.online ? 'The customer can return to checkout.' : 'Staff can refresh the order board and explicitly retry with another card or payment method.'}` : 'Payment unconfirmed. Do not collect it again until reconciled.'}</p>
      <p>Started {new Date(Number(row.created_at)).toLocaleString('en-US', { timeZone: 'America/Detroit' })} Eastern</p>
      <p>Amount ${(expectedTotal(row.snapshot) / 100).toFixed(2)} · {row.snapshot.method} · {row.snapshot.gateway ? `${row.snapshot.gateway.env}, location ${row.snapshot.gateway.locationId}` : 'Recorded outside Square'}</p>
      <p style={{ overflowWrap: 'anywhere' }}>Payment reference: {row.snapshot.referenceId || 'Unavailable'}</p>
      {row.review_evidence && <p>Owner review: {row.review_evidence} ({new Date(Number(row.reviewed_at)).toLocaleString('en-US', { timeZone: 'America/Detroit' })} Eastern)</p>}
      <form action={recover}><input type="hidden" name="key" value={row.attempt_key}/><button className="btn">Check status and recover</button></form>
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
