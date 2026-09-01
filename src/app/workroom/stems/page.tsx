import { redirect } from "next/navigation";

/**
 * The Stems tab became Inventory 2026-09-01 (Kevin: the page is inventory
 * management, and "Stems" named only one of the things on it). The address
 * survives because a counter tab may still hold it.
 */
export default function StemsPage() {
  redirect("/workroom/inventory");
}
