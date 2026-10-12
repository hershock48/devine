import type { Metadata } from "next";
import Ticket from "@/components/workroom/Ticket";
import { isWorkroomAuthed } from "@/lib/workroom/auth";
import { getStore } from "@/lib/workroom/store";

export const metadata: Metadata = { title: "Ticket" };
export const dynamic = "force-dynamic";

/**
 * THE TICKET, for the Star TSP100 on the counter (2026-10-12). IRIS printed
 * a slip for every order the moment it landed; this page is that slip, at
 * receipt width, for one order. The board's Print link opens it; the
 * board's auto-print opens it in a hidden frame for every new web order
 * and prints it, which Chrome does silently on the counter PC when it is
 * launched with kiosk printing (research/printing.md). Gated like every
 * workroom page.
 */
export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ card?: string }>;
}) {
  const { id } = await params;
  const { card } = await searchParams;
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
  return <Ticket order={order} card={card === "1"} />;
}
