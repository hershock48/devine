import { redirect } from "next/navigation";

/**
 * "This week" grew into the dashboard (2026-09-01), which lives at
 * /workroom/dashboard. The address survives because a tab on the counter
 * computer may still hold it.
 */
export default function WeekPage() {
  redirect("/workroom/dashboard");
}
