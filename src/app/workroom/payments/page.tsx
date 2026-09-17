import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isWorkroomAuthed } from '@/lib/workroom/auth';
import { paymentDatabase } from '@/lib/square/payment-attempts';
import { reconcilePayment, type PaymentIntent } from '@/lib/square/payment-service';

export const dynamic = 'force-dynamic';

async function recover(data: FormData) {
  'use server';
  if (!(await isWorkroomAuthed())) redirect('/workroom');
  const key = String(data.get('key') || '');
  try { await reconcilePayment(key); }
  catch { redirect('/workroom/payments?notice=retry'); }
  redirect('/workroom/payments?notice=checked');
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  if (!(await isWorkroomAuthed())) redirect('/workroom');
  const { notice } = await searchParams;
  let rows: { attempt_key: string; state: string; snapshot: PaymentIntent; result: {status?:string}|null; fulfilled: boolean; notified: boolean; customer_notified: boolean; created_at: string }[] = [];
  let unavailable = false;
  try {
    const db = await paymentDatabase();
    rows = (await db.query(`SELECT attempt_key,state,snapshot,result,fulfilled,notified,customer_notified,created_at FROM devine_payment_attempts WHERE attempt_key NOT LIKE 'archived:%' AND (state<>'completed' OR fulfilled=false OR notified=false OR customer_notified=false) ORDER BY created_at ASC LIMIT 100`)).rows;
  } catch { unavailable = true; }
  return <section style={{ paddingBlock: 20 }}>
    <p><Link href="/workroom">Back to order board</Link></p>
    <h1>Payment recovery</h1>
    <p>Check uncertain payments with Square and retry delivery of confirmed orders to the board and shop inbox. This does not charge or refund a customer.</p>
    {notice && <p role="status">{notice === 'retry' ? 'Recovery could not finish. The saved attempt remains here; check the connection and try again.' : 'Status checked. Any unfinished work remains below.'}</p>}
    {unavailable ? <p role="alert">Payment storage is unavailable. Do not retry charges until the connection is restored.</p> : rows.length === 0 ? <p>No payment recovery work is waiting.</p> : rows.map(row => <section key={row.attempt_key} style={{ borderBottom: '1px solid var(--line)', paddingBlock: 20 }}>
      <h2>{row.snapshot.order.number} · {row.snapshot.order.name}</h2>
      <p>{row.state === 'completed' ? `Payment confirmed · Board ${row.fulfilled ? 'saved' : 'pending'} · Shop email ${row.notified ? 'sent' : 'pending'} · Customer receipt ${row.customer_notified ? 'sent or not needed' : 'pending'}` : row.state === 'failed' ? (row.result?.status==='NOT_SUBMITTED'?'No payment was submitted. Check the order and payment setup, then retry from the order board.':'The payment was declined or canceled. Staff can retry from the order board with another card or payment method.') : 'Payment unconfirmed. Do not collect it again until reconciled.'}</p>
      <p>Started {new Date(Number(row.created_at)).toLocaleString('en-US', { timeZone: 'America/Detroit' })} Eastern</p>
      <form action={recover}><input type="hidden" name="key" value={row.attempt_key}/><button className="btn">Check status and recover</button></form>
    </section>)}
    <p>If a payment remains unconfirmed, inspect the original Square location using its order number. An empty search is not proof that no charge occurred. Escalate unresolved attempts before collecting money again.</p>
  </section>;
}
