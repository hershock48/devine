import type { Metadata } from "next";
import Reports from "@/components/workroom/Reports";
import { isWorkroomAuthed, isWorkroomOwner } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

/** The end-of-day and end-of-month sheets (Katy, 2026-10-22). The day
    sheet opens to the staff PIN (they close the drawer); the month sheet
    asks for the owner's, like the dashboard. */
export default async function ReportsPage() {
  return <Reports initialAuthed={await isWorkroomAuthed()} initialOwner={await isWorkroomOwner()} />;
}
