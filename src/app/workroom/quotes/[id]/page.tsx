import type { Metadata } from "next";
import QuoteBuilder from "@/components/workroom/QuoteBuilder";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Quote" };
export const dynamic = "force-dynamic";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuoteBuilder id={id} initialAuthed={await isWorkroomAuthed()} />;
}
