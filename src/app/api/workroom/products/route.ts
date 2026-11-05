import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getCatalog } from "@/lib/catalog-live";

/**
 * THE CATALOG FOR AN OPEN WORKROOM SCREEN, staff PIN. The board on the
 * counter iPad is opened in the morning and left open; the catalog it was
 * handed at page load would go stale the moment the owner changed a price
 * on the Products tab, and the write-up would quote the old price while
 * the route wrote the ticket at the new one. The screens ask here every
 * minute and when the tab comes back to the front (CatalogContext).
 *
 * Every design, off the menu included: the counter can sell one by name.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const cat = await getCatalog();
  return NextResponse.json({ products: cat.products, categories: cat.categories });
}
