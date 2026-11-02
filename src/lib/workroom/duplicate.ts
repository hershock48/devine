import type { WorkroomOrder } from "@/lib/workroom/store";

/**
 * WRITTEN UP TWICE, CAUGHT AT THE DOOR (Katy, 2026-11-02: a Kempf's order
 * for Joseph Garlite was written up a second time and put on the account,
 * and the question was how to delete it). The answer after the fact is
 * Remove it (store.ts, voided). The answer before the fact is this: when a
 * write-up names the same customer, the same recipient and the same day as
 * an order already open on the board, the route says so and the form asks
 * before saving. Two real orders on one day for one family do happen (a
 * casket spray and a standing spray), so the form can insist.
 *
 * Pure, so it can be reasoned about here: no store, no dates from the
 * clock. The caller hands it the open orders it wants compared against.
 */

/** What a write-up looks like before it is an order. */
export type DuplicateCandidate = {
  name: string;
  phone: string;
  business?: string;
  recipient: string;
  date: string;
};

const words = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "");

/** The same customer: the same phone when both have one worth comparing,
    else the same business, else the same name. */
function sameCustomer(a: DuplicateCandidate, b: WorkroomOrder): boolean {
  const pa = digits(a.phone);
  const pb = digits(b.phone);
  if (pa.length >= 7 && pb.length >= 7) return pa.slice(-10) === pb.slice(-10);
  const ba = words(a.business);
  if (ba && ba === words(b.business)) return true;
  const na = words(a.name);
  return na !== "" && na === words(b.name);
}

/** The same piece of work: the same day, and the same recipient (or no
    recipient on either, the customer being the recipient). */
function sameJob(a: DuplicateCandidate, b: WorkroomOrder): boolean {
  if (a.date !== b.date) return false;
  return words(a.recipient) === words(b.recipient);
}

/**
 * The open order this write-up looks like a second copy of, or null.
 * Canceled and removed orders never count (a canceled order being written
 * up again is the point of canceling), nor does a quick sale.
 */
export function looksLikeDuplicate(candidate: DuplicateCandidate, open: WorkroomOrder[]): WorkroomOrder | null {
  for (const o of open) {
    if (o.status === "canceled" || o.voided || o.quick) continue;
    if (sameJob(candidate, o) && sameCustomer(candidate, o)) return o;
  }
  return null;
}

/** The sentence the form shows, in the counter's words. */
export function duplicateMessage(o: WorkroomOrder): string {
  const who = o.recipient && o.recipient !== o.name ? `${o.name} for ${o.recipient}` : o.name;
  return `This looks like ${o.number}, already on the board: ${who} on ${o.date}. If it is a second order for the same day, write it up anyway.`;
}
