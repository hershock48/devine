'use server';

import { redirect } from 'next/navigation';
import { isWorkroomAuthed, isWorkroomOwner } from '@/lib/workroom/auth';
import { recordNoPaymentReview } from '@/lib/square/payment-attempts';
import { reconcilePayment } from '@/lib/square/payment-service';

export async function recover(data: FormData) {
 if (!(await isWorkroomAuthed())) redirect('/workroom');
 try { await reconcilePayment(String(data.get('key') || '')); }
 catch { redirect('/workroom/payments?notice=retry'); }
 redirect('/workroom/payments?notice=checked');
}

export async function confirmNoPayment(data: FormData) {
 if (!(await isWorkroomOwner())) redirect('/workroom');
 if (data.get('verified') !== 'yes') redirect('/workroom/payments?notice=verification-required');
 const key = String(data.get('key') || '');
 try {
  // This is only a read of Square. A match can complete/fence the attempt;
  // an empty result does not authorize the release without the owner's finding.
  await reconcilePayment(key);
  await recordNoPaymentReview({
   key, referenceId: String(data.get('referenceId') || ''),
   fingerprint: String(data.get('fingerprint') || ''), evidence: String(data.get('evidence') || ''),
  });
 } catch { redirect('/workroom/payments?notice=review-refused'); }
 redirect('/workroom/payments?notice=released');
}
