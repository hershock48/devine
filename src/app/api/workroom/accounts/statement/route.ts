import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { sendStatement, type StatementRow } from "@/lib/workroom/statement-mail";

export const runtime = "nodejs";

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** POST: the Accounts tab's statement for one account, emailed from the shop. */
export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const p = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!p) return NextResponse.json({ error: "Malformed." }, { status: 400 });
  const to = str(p.to, 160);
  if (!to.includes("@")) return NextResponse.json({ error: "That account has no email address on file." }, { status: 400 });
  const rows: StatementRow[] = Array.isArray(p.rows)
    ? p.rows.slice(0, 200).map((r) => {
        const x = (r ?? {}) as Record<string, unknown>;
        return { date: str(x.date, 20), number: str(x.number, 24), items: str(x.items, 400), owed: str(x.owed, 20) };
      })
    : [];
  if (rows.length === 0) return NextResponse.json({ error: "Nothing is owed on that account." }, { status: 400 });
  const kind = p.kind === "invoice" ? "invoice" : "statement";
  const sent = await sendStatement({ to, name: str(p.name, 120), business: str(p.business, 120), company: str(p.company, 120), rows, balance: str(p.balance, 20), kind });
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });
  return NextResponse.json({ ok: true });
}
