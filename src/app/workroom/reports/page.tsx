import type { Metadata } from "next";
import Reports from "@/components/workroom/Reports";
import { CatalogProvider } from "@/components/CatalogContext";
import { getCatalog } from "@/lib/catalog-live";
import { isWorkroomAuthed, isWorkroomOwner } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

/** The end-of-day and end-of-month sheets (Katy, 2026-10-22). The day
    sheet opens to the staff PIN (they close the drawer); the month sheet
    asks for the owner's, like the dashboard. */
export default async function ReportsPage() {
  // Signed out, the page carries no catalog (off-menu designs and hidden
  // shelves are not for a locked screen's source); the provider fetches it
  // once the PIN is in.
  const authed = await isWorkroomAuthed();
  const catalog = authed ? await getCatalog() : null;
  return (
    <CatalogProvider products={catalog?.products ?? []} categories={catalog?.categories ?? []} refreshUrl="/api/workroom/products">
      <Reports initialAuthed={authed} initialOwner={await isWorkroomOwner()} />
    </CatalogProvider>
  );
}
