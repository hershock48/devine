import type { Metadata } from "next";
import Quotes from "@/components/workroom/Quotes";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Quotes" };
export const dynamic = "force-dynamic";

export default async function QuotesPage() {
  return <Quotes initialAuthed={await isWorkroomAuthed()} />;
}
