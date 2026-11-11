import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { HISTORY_DAYS } from "@/lib/workroom/derive";
import { REPORT_MAX_ROWS, REPORT_PAGE_ROWS } from "@/lib/workroom/report-rows";
import { getStore, type PageMark } from "@/lib/workroom/store";

/**
 * WHAT THE REPORT SHEETS READ. Two lists, `?list=orders` (the default) and
 * `?list=sales` (register rings that belong to no order), each a page at a
 * time, newest first, cut down to what a sheet adds up.
 *
 * WHY ITS OWN ROUTE. The sheets used to read the board's list through the
 * stems route. That list stops at a fixed count and drops the oldest past
 * it, which suits a board and silently shorts a month's books: a shop
 * writing a handful of orders and quick sales a day passes the count well
 * inside the 400 days, and the older months, "the last 12 months" and
 * "about this time last year" read low with no sign of it. Here nothing is
 * dropped: the sheet follows `next` until it is null and has every order
 * on file. The board, the dashboard and the stem screens keep their own
 * polling lists as they were.
 *
 * `truncated` IS THE ONLY WAY A SHEET LEARNS IT IS SHORT. It is true on
 * the page where REPORT_MAX_ROWS was reached with rows still left, and
 * that page's `next` is null. The sheet's warning is driven by this flag
 * and by nothing else.
 *
 * The staff PIN opens it, like the lists it replaces: the day sheet is the
 * staff's, and the month and customer sheets are gated on the screen
 * (Reports.tsx says why).
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

export async function GET(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const params = new URL(req.url).searchParams;
  const days = Math.min(HISTORY_DAYS, Math.max(1, Math.round(Number(params.get("days"))) || HISTORY_DAYS));
  const cursor = readCursor(params.get("after"));
  if (!cursor) return NextResponse.json({ error: "That page mark is not one this list gave out." }, { status: 400 });

  const store = getStore();
  const room = REPORT_MAX_ROWS - cursor.seen;
  if (room <= 0) return NextResponse.json({ rows: [], next: null, truncated: true, backend: store.backend });
  const limit = Math.min(REPORT_PAGE_ROWS, room);
  const page = params.get("list") === "sales" ? await store.listReportSales(days, cursor.mark, limit) : await store.listReportOrders(days, cursor.mark, limit);

  const seen = cursor.seen + page.rows.length;
  // More rows are on file and the ceiling is reached: stop here and say so.
  const truncated = page.next !== null && seen >= REPORT_MAX_ROWS;
  const next = page.next && !truncated ? `${seen}-${page.next.at}-${page.next.id}` : null;
  return NextResponse.json({ rows: page.rows, next, truncated, backend: store.backend });
}
