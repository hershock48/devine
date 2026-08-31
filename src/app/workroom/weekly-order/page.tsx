import type { Metadata } from "next";
import WeeklyOrderScreen from "@/components/workroom/WeeklyOrderScreen";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Weekly order" };
export const dynamic = "force-dynamic";

export default async function WeeklyOrderPage() {
  return <WeeklyOrderScreen initialAuthed={await isWorkroomAuthed()} />;
}
