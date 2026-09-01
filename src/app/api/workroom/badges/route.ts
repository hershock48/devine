import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";

/**
 * The workroom's attention counts, for the tab badges in the chrome. Born
 * from Kevin's question: a wedding inquiry seeds a draft quote on the
 * Quotes tab, and how would anyone know without clicking over to check?
 * The email to the shop is the record; the badge is the nudge on the
 * screen the counter actually watches.
 *
 * GET answers UNAUTHED REQUESTS WITH ZEROS, not a 401, on purpose: the
 * chrome renders on the PIN gate too, and a 401 per page load would spray
 * the console with errors (the pjs polling-while-locked lesson). A zero
 * tells a stranger nothing.
 *
 * POST marks the web-seeded quotes seen (the Quotes list calls it when it
 * shows them), and that one does require the PIN.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ quotes: 0 });
  const quotes = (await getStore().listQuotes()).filter((q) => q.source === "web" && !q.seenAt).length;
  return NextResponse.json({ quotes });
}

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => ({}))) as { seen?: unknown };
  if (p.seen !== "quotes") return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const store = getStore();
  const now = Date.now();
  for (const q of await store.listQuotes()) {
    if (q.source === "web" && !q.seenAt) await store.upsertQuote({ ...q, seenAt: now });
  }
  return NextResponse.json({ ok: true });
}
