import type { Metadata } from "next";
import Week from "@/components/workroom/Week";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "This week" };
export const dynamic = "force-dynamic";

export default async function WeekPage() {
  return <Week initialAuthed={await isWorkroomAuthed()} />;
}
