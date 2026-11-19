import { HISTORY_DAYS } from "./derive";
import { REPORT_MAX_ROWS } from "./report-rows";

/**
 * HOW A SCREEN READS A WHOLE LEDGER from api/workroom/reports. One copy
 * for the report sheets, the dashboard, the inventory and the weekly order
 * sheet, so every one of them pages, stops and reports a short read by the
 * same rule. Client-safe: it only fetches.
 *
 *   readList    every page until the route says there is no next one. The
 *               first read of a screen, and the catch-up read after it.
 *   readNewest  the first page only, laid over what the screen already
 *               holds. A screen left open all day polls with this, so a
 *               poll costs one page however long the ledger grows. What it
 *               cannot see is a change to a row older than that page (an
 *               order from last spring marked paid today); the screen's
 *               next whole read picks that up, which is why a polling
 *               screen still does a whole read every FULL_READ_EVERY_MS.
 */

export class Locked extends Error {}

export type LedgerList = "orders" | "sales" | "ledger-orders" | "ledger-sales" | "events";
type Mark = { at: number; id: string };
type Page<T> = { rows?: T[]; next?: string | null; mark?: Mark | null; truncated?: boolean; backend?: string };
/** What a screen holds of one list: its rows, newest first, and whether the
    route stopped short of everything on file (its own `truncated`). */
export type Held<T> = { rows: T[]; truncated: boolean; backend: string | null };
type Row = { id: string; createdAt: number };

/** A polling screen reads its lists whole again this often. */
export const FULL_READ_EVERY_MS = 10 * 60_000;

async function page<T>(list: LedgerList, after: string): Promise<Page<T>> {
  const r = await fetch(`/api/workroom/reports?list=${list}&days=${HISTORY_DAYS}${after ? `&after=${encodeURIComponent(after)}` : ""}`, { cache: "no-store" });
  if (r.status === 401) throw new Locked();
  if (!r.ok) throw new Error("The figures did not load.");
  return (await r.json()) as Page<T>;
}

/** One whole list: page after page until the route says there is no next
    one. `truncated` is the route's own word that it stopped with rows
    still on file. Rows come newest first. */
export async function readList<T>(list: LedgerList, onCount?: (n: number) => void): Promise<Held<T>> {
  const rows: T[] = [];
  let after = "";
  for (;;) {
    const d = await page<T>(list, after);
    for (const row of d.rows ?? []) rows.push(row);
    onCount?.(rows.length);
    if (!d.next) return { rows, truncated: !!d.truncated, backend: d.backend ?? null };
    after = d.next;
  }
}

/**
 * The newest page, laid over what is held. The page is the truth for its
 * own span: every held row at or above the page's last row is replaced by
 * the page (so an order removed or a toss deleted inside the span goes),
 * and every held row below it stays as it was last read. A page with
 * nothing after it is the whole list and replaces everything.
 */
export async function readNewest<T extends Row>(list: LedgerList, held: Held<T>): Promise<Held<T>> {
  const d = await page<T>(list, "");
  const rows = d.rows ?? [];
  const mark = d.mark ?? null;
  if (!mark) return { rows, truncated: !!d.truncated, backend: d.backend ?? held.backend };
  const below = held.rows.filter((r) => r.createdAt < mark.at || (r.createdAt === mark.at && r.id < mark.id));
  return { rows: [...rows, ...below], truncated: held.truncated, backend: d.backend ?? held.backend };
}

/** The small reads beside the ledgers (the route's `book` and `earlier`). */
export async function readSmall<T>(list: "book" | "earlier"): Promise<T> {
  const r = await fetch(`/api/workroom/reports?list=${list}&days=${HISTORY_DAYS}`, { cache: "no-store" });
  if (r.status === 401) throw new Locked();
  if (!r.ok) throw new Error("The figures did not load.");
  return (await r.json()) as T;
}

/** The lists a read came back short on, in the words the warning uses;
    empty when everything on file was read. */
export function shortLists(held: { name: string; truncated: boolean }[]): string {
  return held
    .filter((h) => h.truncated)
    .map((h) => h.name)
    .join(` and the newest ${REPORT_MAX_ROWS.toLocaleString("en-US")} `);
}
