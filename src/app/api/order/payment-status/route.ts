import { NextResponse } from 'next/server';
import { reconcilePayment, pendingMessage, paymentRepo } from '@/lib/square/payment-service';
import { NoPaymentStore, releaseUnsubmitted } from '@/lib/square/payment-attempts';

/** The cart's "Check payment status" button, for an online attempt whose
 * answer the browser never got. Reads Square through reconcilePayment; when
 * the request provably never reached Square (no saved attempt, or one that
 * stopped before it was claimed) it records that and says so, so the cart
 * offers "Return to checkout" instead of a warning with no exit. */
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const key = typeof body?.attemptKey === 'string' ? body.attemptKey : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return NextResponse.json({ error: 'Invalid checkout reference.' }, { status: 400 });
  try {
    let attempt = await reconcilePayment(key);
    if (!attempt || attempt.state === 'prepared') {
      await releaseUnsubmitted(key);
      attempt = await paymentRepo().read(key);
    }
    if (attempt?.state === 'completed' && attempt.result) return NextResponse.json({ ok: true, number: attempt.snapshot.order.number, paid: { totalCents: attempt.result.totalCents, feeCents: attempt.result.feeCents, receiptUrl: attempt.result.receiptUrl } }, { headers: { 'Cache-Control': 'no-store' } });
    const failed=attempt?.state==='failed';
    const error=failed?(attempt?.result?.status==='OWNER_CONFIRMED_NO_PAYMENT'?'The shop verified no payment. You can return to checkout.':attempt?.result?.status==='NOT_SUBMITTED'?'Nothing was charged. Return to checkout to try again, or call the shop.':'The payment was declined or canceled. Return to checkout to try another card.'):pendingMessage;
    return NextResponse.json({ ok: false, failed, error }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    // No durable store at all means card checkout never started here: the
    // order route refuses cards before saving anything without one.
    if (err instanceof NoPaymentStore) return NextResponse.json({ ok: false, failed: true, error: 'Nothing was charged. Return to checkout to try again, or call the shop.' }, { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ ok: false, error: pendingMessage }, { status: 503 });
  }
}
