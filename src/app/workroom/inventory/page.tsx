import type { Metadata } from "next";
import Inventory from "@/components/workroom/Inventory";
import { CatalogProvider } from "@/components/CatalogContext";
import { getCatalog } from "@/lib/catalog-live";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  // Signed out, the page carries no catalog (off-menu designs and hidden
  // shelves are not for a locked screen's source); the provider fetches it
  // once the PIN is in.
  const authed = await isWorkroomAuthed();
  const catalog = authed ? await getCatalog() : null;
  return (
    <CatalogProvider products={catalog?.products ?? []} categories={catalog?.categories ?? []} refreshUrl="/api/workroom/products">
      <Inventory initialAuthed={authed} />
    </CatalogProvider>
  );
}
