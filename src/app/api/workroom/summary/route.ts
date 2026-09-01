import { NextResponse } from "next/server";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { square } from "@/lib/square/client";
import { resolveSquare } from "@/lib/square/oauth";
import { getStore } from "@/lib/workroom/store";

/**
 * The dashboard's money numbers, for any window: totals, count, cash split,
 * and a bucketed series for the chart.
 *
 * SQUARE'S OWN LEDGER FIRST. The webhook only hears payments rung after the
 * shop connected, and the stored copy is windowed besides. Square's Payments
 * API has her whole register history, so when the register link is live the
 * dashboard asks Square directly and a year view is her real year, including
 * every sale that predates us. The stored webhook rows are the fallback (no
 * link, Square unreachable), and the response SAYS which ledger answered,
 * because a number whose provenance is invisible is a number nobody can
 * argue with.
 *
 * THE CALENDAR IS THE CLIENT'S. Serverless runs in UTC and "today" on the
 * counter means today in Marshall (ui.tsx's todayISO rule), so the client
 * computes its windows and bucket boundaries on its own clock and sends them
 * as epoch milliseconds. This route never invents a boundary; it only counts
 * into the ones it was handed.
 *
 * GROSS, NOT NET. A payment's total_money is what the customer handed over;
 * refunds are not netted out here, same as the stored webhook rows. If she
 * ever asks why this disagrees with Square's "net sales", that is the answer.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One reporting window, reduced. */
type WindowSummary = {
  totalCents: number;
  count: number;
  cashCents: number;
  /** Cents per bucket, aligned to the edges the client sent. Empty when the
      client asked for no series (the comparison window never charts). */
  buckets: number[];
};

type PaymentRow = { ms: number; cents: number; cash: boolean };

type ListPaymentsResponse = {
  payments?: {
    id?: string;
    status?: string;
    source_type?: string;
    created_at?: string;
    total_money?: { amount?: number };
  }[];
  cursor?: string;
};

/**
 * Square lists at most 100 payments a page. 40 pages is 4,000 payments per
 * window, far past a year of this shop's register; if the cursor is somehow
 * still going, we stop and SAY so (truncated), never silently.
 */
const PAGE_CAP = 40;

async function fromSquare(beginMs: number, endMs: number): Promise<{ rows: PaymentRow[]; truncated: boolean } | null> {
  const cfg = await resolveSquare();
  if (!cfg) return null;
  const rows: PaymentRow[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const q = new URLSearchParams({
      begin_time: new Date(beginMs).toISOString(),
      end_time: new Date(endMs).toISOString(),
      location_id: cfg.locationId,
      limit: "100",
    });
    if (cursor) q.set("cursor", cursor);
    const page = await square<ListPaymentsResponse>(cfg, "GET", `/v2/payments?${q}`);
    for (const p of page.payments ?? []) {
      if (p.status !== "COMPLETED") continue;
      const ms = Date.parse(p.created_at ?? "");
      if (!Number.isFinite(ms)) continue;
      rows.push({ ms, cents: p.total_money?.amount ?? 0, cash: p.source_type === "CASH" });
    }
    cursor = page.cursor;
    pages += 1;
  } while (cursor && pages < PAGE_CAP);
  return { rows, truncated: !!cursor };
}

async function fromStored(beginMs: number, endMs: number): Promise<PaymentRow[]> {
  const days = Math.ceil((Date.now() - beginMs) / 86_400_000) + 2;
  const sales = await getStore().listSquareSales(Math.max(1, days));
  const rows: PaymentRow[] = [];
  for (const s of sales) {
    // paidAt is Square's own stamp; a row that somehow lacks one falls back
    // to when the webhook landed, which is seconds later in practice.
    const ms = Number.isFinite(Date.parse(s.paidAt)) ? Date.parse(s.paidAt) : s.createdAt;
    if (ms >= beginMs && ms < endMs) rows.push({ ms, cents: s.totalCents, cash: s.source === "CASH" });
  }
  return rows;
}

function summarize(rows: PaymentRow[], edges: number[]): WindowSummary {
  const buckets = edges.length >= 2 ? new Array<number>(edges.length - 1).fill(0) : [];
  let totalCents = 0;
  let cashCents = 0;
  for (const r of rows) {
    totalCents += r.cents;
    if (r.cash) cashCents += r.cents;
    for (let i = 0; i < buckets.length; i++) {
      if (r.ms >= edges[i] && r.ms < edges[i + 1]) {
        buckets[i] += r.cents;
        break;
      }
    }
  }
  return { totalCents, count: rows.length, cashCents, buckets };
}

const num = (v: string | null): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function GET(req: Request) {
  if (!(await isWorkroomAuthed())) return NextResponse.json({ error: "Locked." }, { status: 401 });

  const url = new URL(req.url);
  const begin = num(url.searchParams.get("begin"));
  const end = num(url.searchParams.get("end"));
  const prevBegin = num(url.searchParams.get("prevBegin"));
  const prevEnd = num(url.searchParams.get("prevEnd"));
  const edges = (url.searchParams.get("edges") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (begin === null || end === null || prevBegin === null || prevEnd === null || end <= begin) {
    return NextResponse.json({ error: "Malformed window." }, { status: 400 });
  }

  let source: "square" | "stored" = "stored";
  let truncated = false;
  let cur: PaymentRow[];
  let prev: PaymentRow[];
  try {
    const [c, p] = await Promise.all([fromSquare(begin, end), fromSquare(prevBegin, prevEnd)]);
    if (c && p) {
      source = "square";
      truncated = c.truncated || p.truncated;
      cur = c.rows;
      prev = p.rows;
    } else {
      [cur, prev] = await Promise.all([fromStored(begin, end), fromStored(prevBegin, prevEnd)]);
    }
  } catch (err) {
    // Square down is a degraded dashboard, not a dead one.
    console.error("summary: Square unreachable, serving stored sales", err);
    [cur, prev] = await Promise.all([fromStored(begin, end), fromStored(prevBegin, prevEnd)]);
  }

  return NextResponse.json({
    source,
    truncated,
    current: summarize(cur, edges),
    previous: summarize(prev, []),
    backend: getStore().backend,
  });
}
