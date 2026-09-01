import { redirect } from "next/navigation";

/**
 * The plant par sheet moved onto the Weekly order page 2026-09-01 (same
 * weekly buying motion, one tab). The address survives because a counter
 * tab may still hold it.
 */
export default function PlantsPage() {
  redirect("/workroom/weekly-order");
}
