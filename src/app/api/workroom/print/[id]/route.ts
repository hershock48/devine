import { NextResponse } from "next/server";
import { isWorkroomAuthedOrHeader } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";
import { printLayoutFor, type PrintLayout } from "@/lib/workroom/derive";
import { renderOrderPdf } from "@/lib/workroom/print-pdf";

/**
 * One order as a PDF, on its paper (2026-10-12). The board's Print link
 * opens it in a tab; the print helper on the counter PC downloads it and
 * hands it to the Brother. ?layout=sheet|plain overrides the order's own
 * choice. Workroom cookie, or the staff PIN as a header for the helper,
 * throttled like login.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isWorkroomAuthedOrHeader(req))) return NextResponse.json({ error: "Locked." }, { status: 401 });
  const { id } = await params;
  const order = await getStore().getOrder(id);
  if (!order) return NextResponse.json({ error: "No such order." }, { status: 404 });
  const asked = new URL(req.url).searchParams.get("layout");
  const layout: PrintLayout = asked === "sheet" || asked === "plain" ? asked : printLayoutFor(order);
  const pdf = await renderOrderPdf(order, layout);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${order.number}-${layout}.pdf"`,
      "Cache-Control": "no-store",
      "X-Print-Layout": layout,
    },
  });
}
