import type { Metadata } from "next";
import Accounts from "@/components/workroom/Accounts";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  return <Accounts initialAuthed={await isWorkroomAuthed()} />;
}
