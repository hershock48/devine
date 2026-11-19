import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { HISTORY_DAYS } from "@/lib/workroom/derive";
import { REPORT_MAX_ROWS, REPORT_PAGE_ROWS } from "@/lib/workroom/report-rows";
import { getStore, type PageMark } from "@/lib/workroom/store";

/**
 * WHAT THE SCREENS THAT ADD UP A WHOLE LEDGER READ. Each list comes a page
 * at a time, newest first, cut down to what its readers add up
 * (report-rows.ts):
 *
 *   ?list=orders          the report sheets and the dashboard: every order
 *                         on file with its money (the default)
 *   ?list=sales           the report sheets: register rings that belong to
 *                         no order, as money only
 *   ?list=ledger-orders   the inventory and the weekly order sheet: orders
 *                         not canceled, as status, date and lines
 *   ?list=ledger-sales    the dashboard and both stem screens: the same
 *                         unlinked rings, with their lines
 *   ?list=events          all three: every stem buy and toss
 *
 * and two small reads that are not paged: `?list=book` (the recipes and
 * the stem library, which the stem arithmetic needs beside the ledgers)
 * and `?list=earlier` (who ordered before the ledger's first day, for the
 * dashboard's Returning tile).
 *
 * WHY ITS OWN ROUTE. These screens used to read the board's lists through
 * the stems and orders routes. Those lists stop at a fixed count and drop
 * the oldest past it, which suits a board and silently shorts everything
 * that adds up a ledger: a month's books, a year's orders, the stems on
 * hand (a made order that fell off the list never left the cooler, as far
 * as the arithmetic could tell). Here nothing is dropped: the reader
 * follows `next` until it is null and has every row on file. The board
 * keeps its own polling list as it was.
 *
 * A screen that is left open all day asks for the first page again on its
 * timer and lays it over what it holds (ledger-read.ts), so a poll is one
 * page however long the ledger grows.
 *
 * `truncated` IS THE ONLY WAY A SCREEN LEARNS IT IS SHORT. It is true on
 * the page where REPORT_MAX_ROWS was reached with rows still left, and
 * that page's `next` is null. Each screen's warning is driven by this
 * flag and by nothing else.
 *
 * The staff PIN opens it, like the lists it replaces: the day sheet, the
 * inventory and the weekly order are the staff's, and the month sheet,
 * the customer sheet and the dashboard are gated on the screen (Reports.tsx
 * says why).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** `after` is the previous page's `next`: how many rows have been handed
    over so far, then the mark of the last one ("seen-at-id"). The count
    rides in the cursor so the route keeps no state between pages. */
function readCursor(raw: string | null): { seen: number; mark: PageMark | null } | null {
  if (!raw) return { seen: 0, mark: null };
  const m = /^(\d{1,9})-(\d{1,16})-(.{1,200})$/.exec(raw);
  return m ? { seen: Number(m[1]), mark: { at: Number(m[2]), id: m[3] } } : null;
}

const LISTS = ["orders", "sales", "ledger-orders", "ledger-sales", "events"] as const;
type List = (typeof LISTS)[number];

export async function GET(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const days = Math.min(HISTORY_DAYS, Math.max(1, Math.round(Number(params.get("days"))) || HISTORY_DAYS));
  const store = getStore();
  const asked = params.get("list") ?? "orders";

  if (asked === "book") {
    const [recipes, varieties] = await Promise.all([store.listRecipes(), store.listVarieties()]);
    return NextResponse.json({ recipes, varieties, backend: store.backend });
  }
  if (asked === "earlier") {
    return NextResponse.json({ ...(await store.listEarlierSightings(days)), backend: store.backend });
  }
  if (!(LISTS as readonly string[]).includes(asked)) {
    return NextResponse.json({ error: "That is not a list this route keeps." }, { status: 400 });
  }
  const list = asked as List;

  const cursor = readCursor(params.get("after"));
  if (!cursor) return NextResponse.json({ error: "That page mark is not one this list gave out." }, { status: 400 });

  const room = REPORT_MAX_ROWS - cursor.seen;
  if (room <= 0) return NextResponse.json({ rows: [], next: null, truncated: true, backend: store.backend });
  const limit = Math.min(REPORT_PAGE_ROWS, room);
  const page =
    list === "sales"
      ? await store.listReportSales(days, cursor.mark, limit)
      : list === "ledger-orders"
        ? await store.listLedgerOrders(days, cursor.mark, limit)
        : list === "ledger-sales"
          ? await store.listLedgerSales(days, cursor.mark, limit)
          : list === "events"
            ? await store.listStemEventsPage(days, cursor.mark, limit)
            : await store.listReportOrders(days, cursor.mark, limit);

  const seen = cursor.seen + page.rows.length;
  // More rows are on file and the ceiling is reached: stop here and say so.
  const truncated = page.next !== null && seen >= REPORT_MAX_ROWS;
  const next = page.next && !truncated ? `${seen}-${page.next.at}-${page.next.id}` : null;
  // `mark` is the last row of this page as the store names it: the reader
  // that lays a first page over an older read keeps what is below it.
  return NextResponse.json({ rows: page.rows, next, mark: page.next, truncated, backend: store.backend });
}
