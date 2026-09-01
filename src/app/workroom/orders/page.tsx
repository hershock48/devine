import type { Metadata } from "next";
import Board from "@/components/workroom/Board";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

/**
 * The order board, at its own address since the dashboard took the front
 * door (2026-09-01). Server wrapper so the first paint already knows whether
 * the cookie is good (pjs pattern).
 */
export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  return <Board initialAuthed={await isWorkroomAuthed()} />;
}
