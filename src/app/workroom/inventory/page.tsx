import { redirect } from "next/navigation";

/**
 * Inventory merged into the Stems page 2026-09-01 (one job, one tab: what
 * is in the cooler, what died, what it costs). The address survives because
 * a counter tab may still hold it.
 */
export default function InventoryPage() {
  redirect("/workroom/stems");
}
