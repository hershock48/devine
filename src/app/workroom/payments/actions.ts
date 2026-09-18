'use server';

import { redirect } from 'next/navigation';
import { isWorkroomAuthed, isWorkroomOwner } from '@/lib/workroom/auth';
import { recordNoPaymentReview, clearProviderConflict } from '@/lib/square/payment-attempts';
import { reconcilePayment, resendNotice, NoticeNotResent, type NoticeResend } from '@/lib/square/payment-service';

export async function recover(data: FormData) {
 if (!(await isWorkroomAuthed())) redirect('/workroom');
 try { await reconcilePayment(String(data.get('key') || '')); }
 catch { redirect('/workroom/payments?notice=retry'); }
 redirect('/workroom/payments?notice=checked');
}

/** Send one order email again. It is the owner's because of the one case
 * recovery will not do by itself: a send whose answer never came back may
 * already be sitting in the shop's inbox, and asking for a second copy is a
 * judgement, not a repair. Nothing here can charge, refund or contact
 * Square; a notice that already went out is refused by the notice record. */
export async function sendNoticeAgain(data: FormData) {
 if (!(await isWorkroomOwner())) redirect('/workroom');
 let result: NoticeResend;
 try { result = await resendNotice(String(data.get('key') || ''), data.get('audience') === 'customer' ? 'customer' : 'shop'); }
 // A refusal on the record and a storage outage are different facts and the
 // owner is told which. Collapsing both into "it may already have been
 // delivered, or another attempt is still running" read as a judgement about
 // the email when the truth was that the database could not be reached.
 catch (error) { redirect(error instanceof NoticeNotResent ? '/workroom/payments?notice=notice-refused' : '/workroom/payments?notice=storage-unavailable'); }
 redirect(`/workroom/payments?notice=${{ sent: 'notice-sent', 'partly-sent': 'notice-partly-sent', 'not-sent': 'notice-failed', 'nothing-sent': 'notice-refused' }[result]}`);
}

/** The owner has checked a contradicted payment at Square and is done with it.
 * It closes a board entry and nothing else: no money moves, no attempt is
 * settled, and the finding stays on the row with the date it was cleared. */
export async function clearConflict(data: FormData) {
 if (!(await isWorkroomOwner())) redirect('/workroom');
 try { await clearProviderConflict(String(data.get('key') || '')); }
 catch { redirect('/workroom/payments?notice=storage-unavailable'); }
 redirect('/workroom/payments?notice=conflict-cleared');
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
