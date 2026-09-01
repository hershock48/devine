import { redirect } from "next/navigation";

/**
 * The board held this address for a few hours on 2026-09-01 before moving
 * back to the workroom's front door, and that layout deployed. A counter
 * tab, bookmark, or autocomplete entry may still hold it; same courtesy as
 * /workroom/week.
 */
export default function OrdersPage() {
  redirect("/workroom");
}
