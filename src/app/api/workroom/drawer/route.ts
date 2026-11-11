import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore, type DrawerCount } from "@/lib/workroom/store";

/**
 * THE DRAWER AT CLOSING (Katy, 2026-11-09: "cash we're putting in,
 * balancing drawer at end of day, daily reports"). The day sheet derives
 * the cash the day's business should have left in the drawer; this keeps
 * the three figures only a person knows (the float it opened with, cash
 * put in or taken out that was not a sale, and what was counted at close)
 * so the sheet can say over or short and print it. Staff close the
 * drawer, so the staff PIN opens it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** Whole cents, zero or more, under a million dollars; null when it is not that. */
const cents = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 100_000_000 ? v : null);

export async function GET(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const day = new URL(req.url).searchParams.get("day");
  if (!isDay(day)) return NextResponse.json({ error: "Which day?" }, { status: 400 });
  // `prev` is the newest count before this day: its "left in the drawer"
  // is this day's opening float until someone says otherwise.
  const [count, prev] = await Promise.all([getStore().getDrawerCount(day), getStore().getDrawerCountBefore(day)]);
  return NextResponse.json({ count, prev });
}

export async function PUT(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Empty request." }, { status: 400 });
  }
  const p = (raw ?? {}) as Record<string, unknown>;
  if (!isDay(p.day)) return NextResponse.json({ error: "Which day?" }, { status: 400 });
  // Not a day that has not come (a slipped year would later hand its float
  // to a real day). A day's grace, because the server's clock is UTC.
  if (p.day > new Date(Date.now() + 36 * 3_600_000).toISOString().slice(0, 10)) return NextResponse.json({ error: "That day has not come yet." }, { status: 400 });
  const openingCents = cents(p.openingCents);
  const addedCents = cents(p.addedCents);
  const removedCents = cents(p.removedCents);
  const countedCents = p.countedCents === null || p.countedCents === undefined ? null : cents(p.countedCents);
  if (openingCents === null || addedCents === null || removedCents === null || (p.countedCents !== null && p.countedCents !== undefined && countedCents === null)) {
    return NextResponse.json({ error: "One of the amounts did not read as money." }, { status: 400 });
  }
  // What stays in the drawer for tomorrow; never more than was counted.
  const leftCents = p.leftCents === null || p.leftCents === undefined ? null : cents(p.leftCents);
  if (p.leftCents !== null && p.leftCents !== undefined && leftCents === null) return NextResponse.json({ error: "One of the amounts did not read as money." }, { status: 400 });
  if (leftCents !== null && (countedCents === null || leftCents > countedCents)) {
    return NextResponse.json({ error: countedCents === null ? "Count the drawer before saying what stays in it." : "More is being left in the drawer than was counted. If cash was added to bring it back up to the float, put that under cash put in." }, { status: 400 });
  }
  // Checked whole, not clipped first: "KEVIN" is refused, not stored as KEV
  // (the orders route's rule for initials).
  const by = typeof p.by === "string" ? p.by.trim().toUpperCase() : "";
  if (!/^[A-Z]{2,3}$/.test(by)) return NextResponse.json({ error: "Your initials, two or three letters, so the count has a name on it." }, { status: 400 });
  const count: DrawerCount = {
    day: p.day,
    openingCents,
    addedCents,
    removedCents,
    countedCents,
    leftCents,
    note: typeof p.note === "string" ? p.note.trim().slice(0, 300) : "",
    by,
    at: Date.now(),
  };
  // Two screens closing the same day: the one that saves second is told,
  // instead of quietly replacing the first one's figures. `baseAt` is the
  // saved count the screen was looking at (null: none yet).
  if (p.baseAt === null || typeof p.baseAt === "number") {
    const cur = await getStore().getDrawerCount(p.day);
    if ((cur?.at ?? null) !== p.baseAt) {
      return NextResponse.json({ error: cur ? `This day's count was saved by ${cur.by} on another screen since this one loaded. Reload to see it, then change it.` : "This day's count changed on another screen. Reload and try again.", count: cur }, { status: 409 });
    }
  }
  await getStore().setDrawerCount(count);
  return NextResponse.json({ ok: true, count });
}
