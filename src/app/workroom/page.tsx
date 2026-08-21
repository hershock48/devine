import Board from "@/components/workroom/Board";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

/**
 * Server wrapper so the first paint already knows whether the cookie is good,
 * instead of flashing the PIN gate at someone who is signed in (pjs pattern).
 */
export const dynamic = "force-dynamic";

export default async function WorkroomPage() {
  return <Board initialAuthed={await isWorkroomAuthed()} />;
}
