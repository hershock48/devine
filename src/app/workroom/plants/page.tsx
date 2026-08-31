import type { Metadata } from "next";
import Plants from "@/components/workroom/Plants";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Plants" };
export const dynamic = "force-dynamic";

export default async function PlantsPage() {
  return <Plants initialAuthed={await isWorkroomAuthed()} />;
}
