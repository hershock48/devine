import type { Metadata } from "next";
import Stems from "@/components/workroom/Stems";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Stems & shrink" };
export const dynamic = "force-dynamic";

export default async function StemsPage() {
  return <Stems initialAuthed={await isWorkroomAuthed()} />;
}
