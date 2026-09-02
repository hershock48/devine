import type { Metadata } from "next";
import QuoteBuilder from "@/components/workroom/QuoteBuilder";
import FuneralPad from "@/components/workroom/FuneralPad";
import { isWorkroomAuthed, isWorkroomOwner } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";

export const metadata: Metadata = { title: "Quote" };
export const dynamic = "force-dynamic";

/**
 * Two tools behind one URL, chosen by the quote's own kind. A wedding is
 * built up from a wish list over weeks; a funeral is priced down to a number
 * across a counter in ten minutes. They share the store, the math and the
 * print shell, and nothing else, because pretending one screen serves both
 * is what makes floral software feel like it was written for neither.
 */
export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const authed = await isWorkroomAuthed();
  // The kind is read server-side so the right tool is in the FIRST paint. Only
  // when signed in: the store is not something a locked page should touch.
  let kind: "wedding" | "funeral" = "wedding";
  if (authed) {
    const q = await getStore().getQuote(id);
    if (q) kind = q.kind;
  }
  // The owner flag feeds the funeral pad's For-the-workroom drawer (build
  // math is owner-tier); the wedding builder does not take it, because its
  // markup and labor inputs ARE the tool a staff member composes with.
  const owner = await isWorkroomOwner();
  return kind === "funeral" ? <FuneralPad id={id} initialAuthed={authed} initialOwner={owner} /> : <QuoteBuilder id={id} initialAuthed={authed} />;
}
