import Board from "@/components/workroom/Board";
import { CatalogProvider } from "@/components/CatalogContext";
import { getCatalog } from "@/lib/catalog-live";
import { isWorkroomAuthed } from "@/lib/workroom/auth";

/**
 * The workroom's front door is the ORDER BOARD. The dashboard held this spot
 * for a few hours on 2026-09-01 before Kevin put the board back the same
 * day: the counter opens the workroom to work orders, and the day's numbers
 * are the second stop, at /workroom/dashboard. Server wrapper so the first
 * paint already knows whether the cookie is good, instead of flashing the
 * PIN gate at someone who is signed in (pjs pattern).
 */
export const dynamic = "force-dynamic";

export default async function WorkroomPage() {
  // Signed out, the page carries no catalog (off-menu designs and hidden
  // shelves are not for a locked screen's source); the provider fetches it
  // once the PIN is in.
  const authed = await isWorkroomAuthed();
  const catalog = authed ? await getCatalog() : null;
  return (
    <CatalogProvider products={catalog?.products ?? []} categories={catalog?.categories ?? []} refreshUrl="/api/workroom/products">
      <Board initialAuthed={authed} />
    </CatalogProvider>
  );
}
