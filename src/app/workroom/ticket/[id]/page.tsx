import type { Metadata } from "next";
import Ticket, { type TicketLayout } from "@/components/workroom/Ticket";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";

export const metadata: Metadata = { title: "Ticket" };
export const dynamic = "force-dynamic";

/**
 * THE ORDER SHEET (2026-10-12): the shop's own six-panel form, printed on
 * the Brother on the counter the way IRIS printed it for every order the
 * moment it landed. The board's Print link opens it; the board's auto-print
 * opens it in a hidden frame for every new web order and prints it, which
 * Chrome does silently on the counter PC when it is launched with kiosk
 * printing (research/printing.md). Three layouts: the six-panel form for
 * deliveries, plain paper for pickups, and a receipt-width slip; the order
 * picks its own and ?layout= overrides. Gated like every workroom page.
 */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ layout?: string }>;
}) {
  const { id } = await params;
  const { layout } = await searchParams;
  if (!(await isWorkroomAuthed())) {
    return (
      <>
        <h1>Ticket</h1>
        <p className="lede">
          Sign into the workroom first. <a href="/workroom">Open the board</a>.
        </p>
      </>
    );
  }
  const order = await getStore().getOrder(id);
  if (!order) {
    return (
      <>
        <h1>No such order</h1>
        <p className="lede">
          <a href="/workroom">Back to the board</a>.
        </p>
      </>
    );
  }
  // The layout follows the order unless asked otherwise (Kevin, 2026-10-12:
  // deliveries print on the six-panel form, pickups on plain paper, and the
  // employee can choose). ?layout=sheet|plain|slip overrides.
  const chosen: TicketLayout =
    layout === "sheet" || layout === "plain" || layout === "slip" ? layout : order.fulfillment === "pickup" ? "plain" : "sheet";
  return <Ticket order={order} layout={chosen} />;
}
