import { NextResponse } from 'next/server';
import { reconcilePayment, pendingMessage } from '@/lib/square/payment-service';

export const runtime = 'nodejs';
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const key = typeof body?.attemptKey === 'string' ? body.attemptKey : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) return NextResponse.json({ error: 'Invalid checkout reference.' }, { status: 400 });
  try {
    const attempt = await reconcilePayment(key);
    if (attempt?.state === 'completed' && attempt.result) return NextResponse.json({ ok: true, number: attempt.snapshot.order.number, paid: { totalCents: attempt.result.totalCents, feeCents: attempt.result.feeCents, receiptUrl: attempt.result.receiptUrl } }, { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ ok: false, failed: attempt?.state === 'failed', error: pendingMessage }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ ok: false, error: pendingMessage }, { status: 503 }); }
}
