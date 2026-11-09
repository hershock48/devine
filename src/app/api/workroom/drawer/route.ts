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
  return NextResponse.json({ count: await getStore().getDrawerCount(day) });
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
  const openingCents = cents(p.openingCents);
  const addedCents = cents(p.addedCents);
  const removedCents = cents(p.removedCents);
  const countedCents = p.countedCents === null || p.countedCents === undefined ? null : cents(p.countedCents);
  if (openingCents === null || addedCents === null || removedCents === null || (p.countedCents !== null && p.countedCents !== undefined && countedCents === null)) {
    return NextResponse.json({ error: "One of the amounts did not read as money." }, { status: 400 });
  }
  const by = typeof p.by === "string" ? p.by.trim().toUpperCase().slice(0, 3) : "";
  if (!/^[A-Z]{2,3}$/.test(by)) return NextResponse.json({ error: "Your initials, two or three letters, so the count has a name on it." }, { status: 400 });
  const count: DrawerCount = {
    day: p.day,
    openingCents,
    addedCents,
    removedCents,
    countedCents,
    note: typeof p.note === "string" ? p.note.trim().slice(0, 300) : "",
    by,
    at: Date.now(),
  };
  await getStore().setDrawerCount(count);
  return NextResponse.json({ ok: true, count });
}
