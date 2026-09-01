import { redirect } from "next/navigation";

/**
 * "This week" grew into the dashboard and moved to the workroom's front
 * door (2026-09-01). The address survives because a tab on the counter
 * computer may still hold it.
 */
export default function WeekPage() {
  redirect("/workroom");
}
