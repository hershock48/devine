import type { Metadata } from "next";
import Dashboard from "@/components/workroom/Dashboard";
import { isWorkroomAuthed, isWorkroomOwner } from "@/lib/workroom/auth";

/**
 * The dashboard: what the ledgers and the register add up to, over any
 * window. Second tab, not the front door (Kevin's call, 2026-09-01): the
 * board is where the work is, this is where the so-what is. Server wrapper
 * so the first paint already knows whether the cookie is good (pjs pattern).
 */
export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  return <Dashboard initialAuthed={await isWorkroomAuthed()} initialOwner={await isWorkroomOwner()} />;
}
