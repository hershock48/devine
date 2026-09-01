import Dashboard from "@/components/workroom/Dashboard";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

/**
 * The workroom's front door is the dashboard (Kevin's call, 2026-09-01):
 * walk in, see the day. The board moved to /workroom/orders. Server wrapper
 * so the first paint already knows whether the cookie is good, instead of
 * flashing the PIN gate at someone who is signed in (pjs pattern).
 */
export const dynamic = "force-dynamic";

export default async function WorkroomPage() {
  return <Dashboard initialAuthed={await isWorkroomAuthed()} />;
}
