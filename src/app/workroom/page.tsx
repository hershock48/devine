import Board from "@/components/workroom/Board";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

/**
 * The workroom's front door is the ORDER BOARD. The dashboard held this spot
 * for a few hours on 2026-09-01 before Kevin put the board back the same
 * day: the counter opens the workroom to work orders, and the day's numbers
 * are the second stop, at /workroom/dashboard. Server wrapper so the first
 * paint already knows whether the cookie is good, instead of flashing the
 * PIN gate at someone who is signed in (pjs pattern).
 */
export const dynamic = "force-dynamic";

export default async function WorkroomPage() {
  return <Board initialAuthed={await isWorkroomAuthed()} />;
}
