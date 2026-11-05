import type { Metadata } from "next";
import Products from "@/components/workroom/Products";
import { isWorkroomAuthed, isWorkroomOwner } from "@/lib/workroom/auth";

/**
 * THE PRODUCTS TAB (Kevin, 2026-11-05): the shop's catalog, edited by the
 * owner. Prices, names, descriptions, shelves, on or off the menu, and a
 * photograph from her phone. Owner's PIN, like the dashboard. Server
 * wrapper so the first paint already knows whether the cookie is good.
 */
export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  return <Products initialAuthed={await isWorkroomAuthed()} initialOwner={await isWorkroomOwner()} />;
}
