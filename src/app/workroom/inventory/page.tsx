import type { Metadata } from "next";
import Inventory from "@/components/workroom/Inventory";
import { CatalogProvider } from "@/components/CatalogContext";
import { getCatalog } from "@/lib/catalog-live";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

export const metadata: Metadata = { title: "Inventory" };
export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const catalog = await getCatalog();
  return (
    <CatalogProvider products={catalog.products} categories={catalog.categories}>
      <Inventory initialAuthed={await isWorkroomAuthed()} />
    </CatalogProvider>
  );
}
