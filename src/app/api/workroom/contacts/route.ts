import { NextResponse } from "next/server";
import { isWorkroomAuthed, isWorkroomOwner } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";
import { parseIris } from "@/lib/workroom/iris";

/**
 * Contacts on file, from her old system (2026-10-12).
 *
 * GET ?kind=customer|recipient&q=  searches them for the phone form's
 * autofill, a few at a time as the counter types; GET alone reports how
 * many are on file. Staff PIN.
 *
 * POST multipart { file }  loads an IRIS export, customer or recipient
 * list, detected from its columns. Owner PIN: it writes thousands of
 * rows of her customers' details, which is the owner's call, once.
 * Additive and idempotent, so loading the same file twice is harmless.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const kind = url.searchParams.get("kind") === "recipient" ? "recipient" : "customer";
  const store = getStore();
  if (!q) return NextResponse.json({ counts: await store.countContacts(), backend: store.backend });
  if (q.length < 2) return NextResponse.json({ hits: [] });
  return NextResponse.json({ hits: await store.searchContacts(kind, q, 6) });
}

export async function POST(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });
  if (!(await isWorkroomOwner())) return NextResponse.json({ error: "Owner PIN only: this loads customer details." }, { status: 403 });
  let text = "";
  try {
    const fd = await req.formData();
    const f = fd.get("file");
    if (!(f instanceof File)) return NextResponse.json({ error: "No file arrived." }, { status: 400 });
    if (f.size > 8_000_000) return NextResponse.json({ error: "That file is over 8MB; IRIS exports are around 1MB." }, { status: 413 });
    text = await f.text();
  } catch {
    return NextResponse.json({ error: "Could not read the upload." }, { status: 400 });
  }
  const report = parseIris(text);
  if ("error" in report) return NextResponse.json({ error: report.error }, { status: 400 });
  const store = getStore();
  const written = await store.upsertContacts(report.contacts);
  return NextResponse.json({
    ok: true,
    kind: report.kind,
    rows: report.rows,
    written,
    merged: report.merged,
    skipped: report.skipped,
    badPhones: report.badPhones,
    counts: await store.countContacts(),
    backend: store.backend,
  });
}
