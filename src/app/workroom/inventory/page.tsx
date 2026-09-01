import type { Metadata } from "next";
import Inventory from "@/components/workroom/Inventory";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  return <Inventory initialAuthed={await isWorkroomAuthed()} />;
}
