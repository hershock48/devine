"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { products, type Product } from "@/lib/catalog";
import { occasions } from "@/lib/occasions";
import { site } from "@/lib/site";
import { field, labelText, money, phoneKey, radio, textButton, todayISO, MemoryWarning, PinGate } from "@/components/workroom/ui";
import { HISTORY_DAYS, isDeliveryLine, normalizeVariety, printPaperFor, waitingToPrint } from "@/lib/workroom/derive";
import PayControls from "@/components/workroom/PayControls";

/**
 * The order board. Adapted from the pjs kitchen screen, at florist pace:
 * tickets there are minutes old and gone in twenty; orders here are days out
 * and alive for weeks. So the board buckets on the REQUESTED date, not the
 * order's age, and polls gently.
 *
 * One button moves an order along its whole life, and the life differs by
 * fulfillment (the owner's ask, 2026-08-31): a delivery goes new ->
 * confirmed -> made -> OUT (on the van) -> done, because "made" and "on the
 * truck" are different answers to a customer calling about their flowers; a
 * pickup goes made -> done when it leaves the counter, no van to track.
 * "Confirmed" is the phone call, and ONLY the phone call: payment has its
 * own controls and badge since 2026-09-01, so the confirm button says
 * nothing about money. A phone-entered order is born confirmed because the
 * shop is already talking to the customer. Cancel is a small link, not a
 * big button, because it is the rare move.
 *
 * "Returning customer" is DERIVED, never typed: same phone (or email) as any
 * earlier non-canceled order across the whole history. A counter tool that
 * asks the shop to remember whether someone is a regular gets lied to by
 * accident; the order history already knows.
 */

type Line = { slug: string | null; name: string; qty: number; each: number; parts?: { variety: string; stems: number }[] };
type Order = {
  id: string;
  number: string;
  source: "web" | "phone";
  status: "hold" | "new" | "confirmed" | "made" | "out" | "done" | "canceled";
  name: string;
  phone: string;
  email: string;
  fulfillment: "delivery" | "pickup";
  recipient: string;
  street: string;
  town: string;
  zip: string;
  date: string;
  occasion: string;
  cardMessage: string;
  notes: string;
  lines: Line[];
  subtotal: number;
  createdAt: number;
  payment?: { at: number; method: string; squarePaymentId: string; totalCents: number; feeCents: number; refundedAt?: number } | null;
  canceledFrom?: string;
  madeBy?: string;
  printedAt?: number;
};

/** Editable while nothing has been made and no money has moved (the PUT
    route enforces the same line). */
const canEdit = (o: Order) => !o.payment && (o.status === "hold" || o.status === "new" || o.status === "confirmed");

function nextMove(o: Order): { to: Order["status"]; label: string } | null {
  switch (o.status) {
    case "hold":
      // Released from limbo onto the make list (Katy, 2026-10-12). The
      // phone call has usually happened by now; confirmed is where a
      // finished phone order starts.
      return { to: "confirmed", label: "Ready to make" };
    case "new":
      // "Confirmed", not "Confirmed & paid": the old label predates tracked
      // payments and lied about money. Kevin, testing as an employee, near
      // verbatim: "it said it was paid, but it doesn't register as paid."
      // This button records the confirm call; the paid badge and the pay
      // buttons are the only voices about money.
      return { to: "confirmed", label: "Confirmed" };
    case "confirmed":
      return { to: "made", label: "Made" };
    case "made":
      return o.fulfillment === "delivery" ? { to: "out", label: "Out the door" } : { to: "done", label: "Picked up" };
    case "out":
      return { to: "done", label: "Delivered" };
    default:
      return null;
  }
}

type Contact = {
  name: string;
  phone: string;
  email: string;
  createdAt: number;
  /** Present since the projection grew (2026-09-01); optional so a stale
      client against a fresh API, or vice versa, degrades to recognition
      without autofill instead of breaking. Who and where only: the lines
      and the occasion are this call's business, not autofill's (Kevin's
      ruling, same day). */
  fulfillment?: "delivery" | "pickup";
  recipient?: string;
  street?: string;
  town?: string;
  zip?: string;
};

/** A contact on file from her old system (IRIS), as the search route
    returns it. Searched server-side as the counter types; never shipped
    whole with the board. */
type FileContact = { id: string; name: string; business: string; street: string; street2: string; town: string; zip: string; phone: string; email: string };

function priorOrders(contacts: Contact[], phone: string, email: string, before: number): Contact[] {
  const pk = phoneKey(phone);
  const ek = email.trim().toLowerCase();
  return contacts.filter(
    (c) =>
      c.createdAt < before &&
      ((pk && phoneKey(c.phone) === pk) || (ek && c.email.trim().toLowerCase() === ek)),
  );
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export default function Board({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [orders, setOrders] = useState<Order[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [backend, setBackend] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  /** The order open in the form for editing (on hold, or not yet made).
      The form remounts per id so a half-typed edit never bleeds across. */
  const [editing, setEditing] = useState<Order | null>(null);
  const [showDone, setShowDone] = useState(false);
  /** The find box: a caller says "order DV-0901-4226" or "it's under
      Wanda" and the counter should not have to scan a busy board by eye.
      Matches number, name, and phone digits; empty means everything.

      TYPING TURNS THE PAGE INTO RESULTS. The first version filtered the
      bucketed board in place, which failed the person it was for: an old
      order's only match sat inside the COLLAPSED finished pile, so the page
      said "nothing matches" while the hit existed one un-clicked toggle
      away, and Kevin could not tell whether search worked at all. Now a
      query shows one flat match list, finished orders open, with the count
      said out loud; clearing the box brings the board back. */
  const [find, setFind] = useState("");
  /** WHAT CAME IN SINCE ANYONE PRINTED (Kevin, 2026-10-12): the website
      orders nobody has printed yet, on every sign-in and every refresh,
      until each is printed or marked. One PDF per paper, so the morning is
      two clicks: the delivery forms, then the pickup tickets. Read off
      the orders the board already polls (same window, same rule as the
      queue route), so there is one clock and no second request. */
  const [printError, setPrintError] = useState("");
  /** Open one PDF with exactly the listed orders for that paper (or the
      one order asked for). The route marks them printed as the document
      goes out: on OPEN, not on the dialog's Print, which a page cannot
      see; the card's own Print link is the reprint if the dialog was
      cancelled. */
  async function printPaper(paper: "forms" | "plain", only?: string) {
    const ids = toPrint.filter((t) => printPaperFor(t) === paper && (!only || t.id === only)).map((t) => t.id);
    if (ids.length === 0) return;
    setPrintError("");
    // No "noopener" in the features string: that makes window.open answer
    // null even when the tab opened, which would read as blocked here.
    // Same-origin PDF; the opener is cut by hand instead.
    const w = window.open(`/api/workroom/print/queue?paper=${paper}&ids=${ids.join(",")}`, "_blank");
    if (!w) {
      setPrintError("The browser blocked the pop-up. Allow pop-ups for this site, then try again; nothing was marked printed.");
      return;
    }
    w.opener = null;
    // The PDF marks on the server; give it a moment, then re-read the board.
    await new Promise((r) => setTimeout(r, 2500));
    await pull();
  }
  async function markPrinted(ids: string[]) {
    setPrintError("");
    const r = await fetch("/api/workroom/print/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null);
    if (!r || !r.ok) setPrintError("Could not mark them; check the connection and try again.");
    await pull();
  }

  /** The Square connect's landing flag (?square=connected and friends),
      read once and then cleared from the address bar so a reload or a
      bookmark never repeats it. The callback route has always sent it;
      nothing displayed it until 2026-10-12. */
  const [squareFlag, setSquareFlag] = useState("");
  useEffect(() => {
    const u = new URL(window.location.href);
    const f = u.searchParams.get("square");
    if (!f) return;
    setSquareFlag(f);
    u.searchParams.delete("square");
    window.history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  }, []);
  /** The full order history, fetched once when a search begins: the board
      loads 60 days, and the order a caller asks about can be older. */
  const [deep, setDeep] = useState<Order[] | null>(null);

  const pull = useCallback(async () => {
    const r = await fetch("/api/workroom/orders", { cache: "no-store" });
    if (r.status === 401) {
      setAuthed(false);
      return;
    }
    const d = await r.json();
    setOrders(d.orders ?? []);
    setContacts(d.contacts ?? []);
    setBackend(d.backend ?? "memory");
    setAuthed(true);
  }, []);

  // Poll only once in (the pjs lesson: polling while locked fires 401s into
  // the console of a page whose normal state is locked). 30s, florist pace.
  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
    const t = setInterval(() => pull().catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [authed, pull]);

  async function move(id: string, status: Order["status"], extra?: { madeBy?: string }) {
    await fetch("/api/workroom/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, ...(extra?.madeBy ? { madeBy: extra.madeBy } : {}) }),
    });
    pull().catch(() => {});
  }

  /** Open an order in the form (on hold, or not yet made). The form sits
      at the top of the page, so the page goes there with it. */
  function openEdit(o: Order) {
    setAdding(false);
    setEditing(o);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Uncancel (Katy, 2026-10-06): back to the status it was canceled from.
      The route refuses a refunded one and says why; the card shows that. */
  async function uncancel(id: string) {
    const r = await fetch("/api/workroom/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, uncancel: true }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      throw new Error(d?.error || "That did not uncancel.");
    }
    await pull();
  }

  /** The human attestation that the Square refund happened; the workroom
      cannot see refunds on its own (no refund webhook subscribed) and
      should not pretend to. */
  async function markRefunded(id: string) {
    await fetch("/api/workroom/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, markRefunded: true }),
    });
    pull().catch(() => {});
  }

  /** The delivery fee adjusted on the card itself, before the card is
      taken (Katy, 2026-10-06). The route refuses once the order is paid. */
  async function setFee(id: string, fee: number) {
    const r = await fetch("/api/workroom/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, deliveryFee: fee }),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => null);
      throw new Error(d?.error || "The fee did not save.");
    }
    await pull();
  }

  // Widen to the full history the moment a search starts, once per visit.
  useEffect(() => {
    if (!find.trim() || deep !== null) return;
    fetch(`/api/workroom/orders?days=${HISTORY_DAYS}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.orders) setDeep(d.orders);
      })
      .catch(() => {});
  }, [find, deep]);

  const searching = find.trim().length > 0;
  const today = todayISO();
  const toPrint = useMemo(() => {
    const now = Date.now();
    return orders.filter((o) => waitingToPrint(o, now)).sort((a, b) => a.createdAt - b.createdAt);
  }, [orders]);
  const buckets = useMemo(() => {
    const q = find.trim().toLowerCase();
    // Search runs over the whole fetched history; the live board stays on
    // its own 60-day pull so a search can never change what the board shows.
    const base = q && deep ? deep : orders;
    // Punctuation never decides a match: dv0901, 0901-4226, and 09014226
    // all find DV-0901-4226 (Kevin's catch: the first version demanded the
    // dashes typed exactly). Numbers compare stripped to letters+digits;
    // phones compare digits; names compare as typed.
    const qNorm = q.replace(/[^a-z0-9]/g, "");
    const qDigits = q.replace(/\D/g, "");
    const matches = (o: Order) =>
      !q ||
      (qNorm.length >= 2 && o.number.toLowerCase().replace(/[^a-z0-9]/g, "").includes(qNorm)) ||
      o.name.toLowerCase().includes(q) ||
      (qDigits.length >= 3 && o.phone.replace(/\D/g, "").includes(qDigits));
    const shown = base.filter(matches);
    // Held orders are limbo (Katy, 2026-10-12): parked with questions open,
    // not on the make list, so they get their own section and never read
    // as late, today, or coming up.
    const open = shown.filter((o) => o.status !== "done" && o.status !== "canceled" && o.status !== "hold");
    const held = shown.filter((o) => o.status === "hold");
    // Within a day, deliveries first: they own a van schedule and a hard
    // deadline; pickups wait patiently in the cooler. Date stays primary,
    // because a florist's whole question is "what has to exist by when".
    const byDate = (a: Order, b: Order) =>
      a.date.localeCompare(b.date) ||
      (a.fulfillment === b.fulfillment ? 0 : a.fulfillment === "delivery" ? -1 : 1) ||
      a.createdAt - b.createdAt;
    // "Done but unpaid" is flowers out the door and money not collected: a
    // receivable, not a finished order (Kevin's catch, 2026-09-01). It gets
    // its own always-visible section instead of the collapsed pile, carries
    // its pay buttons, and clears itself the moment money lands. Canceled
    // orders are never owed; nothing was delivered.
    // Canceled-but-paid is the customer's money still in the till: it holds
    // a visible section until someone refunds it in Square and marks it
    // here (Kevin's edge case, 2026-09-01). One-click refunds are
    // deliberately NOT built: pushing money out of her account from behind
    // a counter PIN crosses the line the auth design drew on day one.
    const isClosed = (o: Order) =>
      (o.status === "canceled" && (!o.payment || !!o.payment.refundedAt)) ||
      (o.status === "done" && !!o.payment);
    return {
      held: held.sort(byDate),
      overdue: open.filter((o) => o.date < today).sort(byDate),
      today: open.filter((o) => o.date === today).sort(byDate),
      upcoming: open.filter((o) => o.date > today).sort(byDate),
      owed: shown.filter((o) => o.status === "done" && !o.payment).sort(byDate),
      toRefund: shown
        .filter((o) => o.status === "canceled" && !!o.payment && !o.payment.refundedAt)
        .sort((a, b) => b.createdAt - a.createdAt),
      /** Search mode's one list of everything still actionable. */
      active: shown.filter((o) => !isClosed(o)).sort(byDate),
      closed: shown.filter(isClosed).sort((a, b) => b.createdAt - a.createdAt),
    };
    // `find` was missing from this list at first, so typing in the box
    // recomputed nothing and the filter looked dead. Kevin reported it as
    // "maybe it has to be done EXACTLY right"; it had to be done never.
  }, [orders, deep, today, find]);

  if (!authed) {
    return (
      <>
        <h1>Orders</h1>
        <PinGate onAuthed={() => pull().catch(() => {})} />
      </>
    );
  }

  return (
    <>
      {/* Page identity only. Getting anywhere else is the shared chrome's job
          (components/workroom/Chrome.tsx). */}
      <h1>Orders</h1>

      <MemoryWarning backend={backend} />

      {toPrint.length > 0 && (
        <PrintBanner items={toPrint} onPrint={printPaper} onPrintOne={(t) => printPaper(printPaperFor(t), t.id)} onMark={markPrinted} error={printError} />
      )}

      {squareFlag && (
        <p
          role="status"
          className="panel"
          style={{
            padding: "10px 14px", margin: "0 0 18px", fontSize: 14.5, maxWidth: 640,
            borderLeft: `3px solid ${squareFlag === "connected" ? "var(--green)" : "var(--rose-ink)"}`,
            display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
          }}
        >
          <span style={{ flex: "1 1 auto" }}>
            {squareFlag === "connected" && <><strong>Square is connected.</strong> Register sales will show up here and on the dashboard from now on.</>}
            {squareFlag === "denied" && <><strong>Square was not connected:</strong> the permission screen was declined. Nothing changed.</>}
            {squareFlag === "failed" && <><strong>Square did not connect.</strong> Square allowed it but the handshake failed; the usual cause is the app secret (see .env.example). Tell Kevin.</>}
            {squareFlag === "badstate" && <><strong>Square did not connect:</strong> the return did not match the request. Start again from the dashboard.</>}
            {squareFlag === "nodatabase" && <><strong>Square did not connect:</strong> there is no database here to keep the connection in. Set it up first.</>}
            {squareFlag === "unconfigured" && <><strong>Square did not connect:</strong> the Square app is not configured on this deployment.</>}
          </span>
          <button type="button" onClick={() => setSquareFlag("")} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
            Dismiss
          </button>
        </p>
      )}

      <p style={{ margin: "6px 0 26px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button
          className="btn"
          type="button"
          onClick={() => {
            if (editing) setEditing(null);
            else setAdding((v) => !v);
          }}
        >
          {adding || editing ? "Close the form" : "Write up a phone order"}
        </button>
        <input
          type="search"
          aria-label="Find an order"
          placeholder="Find: order number, name, or phone"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          style={{ ...field, width: "auto", flex: "0 1 280px", minWidth: 0 }}
        />
        {searching && (
          <button type="button" onClick={() => setFind("")} style={{ ...textButton, fontSize: 14 }}>
            Clear
          </button>
        )}
      </p>

      {(adding || editing) && (
        <PhoneOrderForm
          key={editing?.id ?? "new"}
          contacts={contacts}
          editing={editing}
          onSaved={() => {
            setAdding(false);
            setEditing(null);
            pull().catch(() => {});
          }}
        />
      )}

      {searching ? (
        /* SEARCH RESULTS: one flat view, everything the query hits, finished
           orders open. No toggles between the searcher and the answer. */
        <>
          <p role="status" className="muted" style={{ margin: "0 0 20px", fontSize: 14.5 }}>
            {buckets.active.length + buckets.closed.length === 0
              ? `Nothing matches "${find.trim()}" in ${deep ? `the last ${HISTORY_DAYS} days of orders` : "the loaded orders"}.`
              : `${buckets.active.length + buckets.closed.length} match${
                  buckets.active.length + buckets.closed.length === 1 ? "" : "es"
                }${deep ? "" : "; older orders still loading"}.`}
          </p>
          <Bucket title="Open & owed" orders={buckets.active} contacts={contacts} onMove={move} onPaid={pull} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} onRefunded={markRefunded} />
          {buckets.closed.length > 0 && (
            <section>
              <h2 style={{ fontFamily: "var(--sans)", fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 4px" }}>
                Finished &amp; canceled ({buckets.closed.length})
              </h2>
              <ClosedList orders={buckets.closed} onUncancel={uncancel} />
            </section>
          )}
        </>
      ) : (
        <>
          <Bucket title="On hold" orders={buckets.held} contacts={contacts} onMove={move} onPaid={pull} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} />
          <Bucket title="Should have gone out" tone="late" orders={buckets.overdue} contacts={contacts} onMove={move} onPaid={pull} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} />
          <Bucket title="Today" orders={buckets.today} contacts={contacts} onMove={move} onPaid={pull} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} />
          <Bucket title="Coming up" orders={buckets.upcoming} contacts={contacts} onMove={move} onPaid={pull} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} />
          <Bucket title="Out the door, not paid" tone="late" orders={buckets.owed} contacts={contacts} onMove={move} onPaid={pull} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} />
          <Bucket title="Canceled, money to return" tone="late" orders={buckets.toRefund} contacts={contacts} onMove={move} onPaid={pull} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} onRefunded={markRefunded} />

          {buckets.held.length + buckets.today.length + buckets.overdue.length + buckets.upcoming.length + buckets.owed.length + buckets.toRefund.length === 0 && (
            <p className="lede" style={{ marginTop: 8 }}>
              Nothing open. Web orders land here on their own; phone orders get written up above.
            </p>
          )}

          <p style={{ marginTop: 34 }}>
            <button
              type="button"
              onClick={() => setShowDone((v) => !v)}
              style={{ ...textButton, fontSize: 15, color: "var(--muted)" }}
            >
              {showDone ? "Hide finished orders" : `Finished & canceled (${buckets.closed.length})`}
            </button>
          </p>
          {showDone && <ClosedList orders={buckets.closed} onUncancel={uncancel} />}
        </>
      )}
    </>
  );
}

/**
 * The finished pile as one-line rows, not cards (Kevin's call: "there
 * could be hundreds of orders in that at some point"). A closed order is a
 * record, not work; a record earns a line. The find box upstream filters
 * these too, so a caller asking about last month's order is one search and
 * one glance.
 */
function ClosedList({ orders, onUncancel }: { orders: Order[]; onUncancel?: (id: string) => Promise<void> }) {
  if (orders.length === 0) return null;
  const moneyWord = (o: Order) => {
    if (!o.payment) return o.status === "canceled" ? "" : "not paid";
    if (o.payment.refundedAt) return `refunded ${money(o.payment.totalCents / 100)}`;
    return `paid ${money(o.payment.totalCents / 100)}`;
  };
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", maxWidth: 720 }}>
      {orders.map((o) => (
        <li key={o.id} style={{ borderBottom: "1px solid var(--line)", opacity: o.status === "canceled" ? 0.6 : 1 }}>
          {/* Each row OPENS since 2026-09-04 (the shop's meeting, via Kevin:
              "you can look up the order, but you can't see the details").
              The line stays a line; the record inside is one tap. */}
          <details>
            <summary
              style={{
                display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap",
                padding: "8px 0", fontSize: 14, cursor: "pointer", listStyle: "none",
              }}
            >
              <span aria-hidden="true" style={{ color: "var(--muted)", fontSize: 11 }}>&#9656;</span>
              <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)", whiteSpace: "nowrap" }}>{o.number}</span>
              <span style={{ fontWeight: 600, flex: "1 1 140px", minWidth: 0, overflowWrap: "anywhere" }}>{o.name}</span>
              <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{o.date}</span>
              <span style={{ whiteSpace: "nowrap" }}>{o.status === "canceled" ? "canceled" : "done"}</span>
              <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{moneyWord(o)}</span>
            </summary>
            <div style={{ padding: "2px 0 14px 23px", fontSize: 14, display: "grid", gap: 6, maxWidth: 480 }}>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {o.lines.map((l, i) => (
                  <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>{l.qty} &times; {l.name}</span>
                    <span style={{ whiteSpace: "nowrap" }}>{money(l.each * l.qty)}</span>
                  </li>
                ))}
                <li style={{ display: "flex", justifyContent: "space-between", gap: 10, fontWeight: 600, borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4 }}>
                  <span>Subtotal</span>
                  <span>{money(o.subtotal)}</span>
                </li>
              </ul>
              <p className="muted" style={{ margin: 0 }}>
                {o.source} order &middot; {o.fulfillment}
                {o.fulfillment === "delivery" && (o.street || o.recipient)
                  ? ` to ${[o.recipient, o.street, o.town].filter(Boolean).join(", ")}`
                  : ""}
                {o.phone ? ` · ${o.phone}` : ""}
                {o.email ? ` · ${o.email}` : ""}
                {o.madeBy ? ` · made by ${o.madeBy}` : ""}
              </p>
              {o.status === "canceled" && onUncancel && <Uncancel o={o} onUncancel={onUncancel} />}
              {o.payment && (
                <p className="muted" style={{ margin: 0 }}>
                  Paid by {o.payment.method === "other" ? "another way" : o.payment.method}, {money(o.payment.totalCents / 100)}
                  {o.payment.feeCents > 0 ? ` (includes the ${money(o.payment.feeCents / 100)} ${o.source === "web" ? "convenience" : "card"} fee)` : ""}
                  {o.payment.refundedAt ? " · refunded" : ""}
                </p>
              )}
              {o.cardMessage && <p style={{ margin: 0, fontStyle: "italic", overflowWrap: "anywhere" }}>&ldquo;{o.cardMessage}&rdquo;</p>}
              {o.notes && <p className="muted" style={{ margin: 0, overflowWrap: "anywhere" }}>{o.notes}</p>}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Bucket({
  title,
  tone,
  orders,
  contacts,
  onMove,
  onPaid,
  onRefunded,
  onFee,
  onUncancel,
  onEdit,
}: {
  title: string;
  tone?: "late";
  orders: Order[];
  contacts: Contact[];
  onMove: (id: string, s: Order["status"], extra?: { madeBy?: string }) => void;
  onPaid: () => Promise<void>;
  onRefunded?: (id: string) => void;
  onFee?: (id: string, fee: number) => Promise<void>;
  onUncancel?: (id: string) => Promise<void>;
  onEdit?: (o: Order) => void;
}) {
  if (orders.length === 0) return null;
  return (
    <section style={{ marginBottom: 30 }}>
      {title && (
        <h2
          style={{
            /* Explicit sans: the global h2 is serif, and an uppercase serif
               label with Cormorant's oldstyle figures — "TODAY (ɪ)" — read as
               a glitch next to the sans labels everywhere else on the page. */
            fontFamily: "var(--sans)",
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: tone === "late" ? "var(--rose-ink)" : "var(--muted)",
            margin: "0 0 10px",
          }}
        >
          {title} ({orders.length})
        </h2>
      )}
      {/* min(310px, 100%): a bare 310px floor shoves the page sideways at a
          320 viewport, and only when cards exist, which is why the empty-board
          audit never saw it. */}
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(min(310px, 100%), 1fr))" }}>
        {orders.map((o) => (
          <OrderCard key={o.id} o={o} contacts={contacts} onMove={onMove} onPaid={onPaid} onRefunded={onRefunded} onFee={onFee} onUncancel={onUncancel} onEdit={onEdit} />
        ))}
      </div>
    </section>
  );
}

/**
 * The two buttons under a card, with the pauses Katy asked for (2026-10-06).
 *
 * CANCEL ASKS TWICE. Her words: "are you sure you want to cancel?" then
 * "No. Seriously... are you sure?!" A cancel is the rare move and the one
 * that un-makes a day's work, so it is two deliberate taps with a way out
 * at each, and the whole thing resets if the card re-renders with a new
 * status underneath it.
 *
 * MADE ASKS WHO. The Made tap opens a two-letter field for initials so the
 * ticket says who made it (same meeting). Required at that moment, because
 * "fill it in later" is never; it can still be corrected afterwards.
 */
function Moves({
  o,
  next,
  onMove,
  onEdit,
}: {
  o: Order;
  next: { to: Order["status"]; label: string };
  onMove: (id: string, s: Order["status"], extra?: { madeBy?: string }) => void;
  /** Present while the order may still be edited (on hold, or not yet made). */
  onEdit?: () => void;
}) {
  const [cancelStep, setCancelStep] = useState<0 | 1 | 2>(0);
  const [asking, setAsking] = useState(false);
  const [initials, setInitials] = useState("");
  const [err, setErr] = useState("");

  if (cancelStep > 0) {
    return (
      <p style={{ margin: "12px 0 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <strong style={{ color: "var(--rose-ink)", fontSize: 14.5 }}>
          {cancelStep === 1 ? "Cancel this order?" : "No. Seriously… are you sure?!"}
        </strong>
        <button
          type="button"
          className="btn"
          onClick={() => (cancelStep === 1 ? setCancelStep(2) : onMove(o.id, "canceled"))}
          style={{ color: "var(--rose-ink)" }}
        >
          {cancelStep === 1 ? "Yes, cancel it" : "Yes, really cancel it"}
        </button>
        <button type="button" onClick={() => setCancelStep(0)} style={{ ...textButton, fontSize: 13.5 }}>
          Keep it
        </button>
      </p>
    );
  }

  if (asking) {
    const ok = /^[A-Za-z]{1,4}$/.test(initials.trim());
    return (
      <p style={{ margin: "12px 0 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14.5 }}>
          Made by
          <input
            value={initials}
            onChange={(e) => {
              setInitials(e.target.value.toUpperCase());
              setErr("");
            }}
            placeholder="initials"
            maxLength={4}
            autoFocus
            aria-label="Your initials"
            style={{ ...field, width: 84, textTransform: "uppercase" }}
          />
        </label>
        <button
          type="button"
          className="btn btn--solid"
          onClick={() => {
            if (!ok) {
              setErr("Your initials, one to four letters.");
              return;
            }
            onMove(o.id, "made", { madeBy: initials.trim().toUpperCase() });
          }}
        >
          Made
        </button>
        <button type="button" onClick={() => setAsking(false)} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
          Not yet
        </button>
        {err && <span style={{ color: "var(--rose-ink)", fontSize: 13.5 }}>{err}</span>}
      </p>
    );
  }

  return (
    <p style={{ margin: "12px 0 0", display: "flex", gap: 14, alignItems: "center" }}>
      <button
        className="btn btn--solid"
        type="button"
        onClick={() => (next.to === "made" ? setAsking(true) : onMove(o.id, next.to))}
      >
        {next.label}
      </button>
      {onEdit && (
        <button type="button" onClick={onEdit} style={{ ...textButton, fontSize: 13.5 }}>
          {o.status === "hold" ? "Finish it" : "Edit"}
        </button>
      )}
      <button type="button" onClick={() => setCancelStep(1)} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
        Cancel order
      </button>
    </p>
  );
}

/**
 * THE MORNING BANNER. What IRIS did by printing overnight, this does by
 * refusing to be ignored: every website order nobody has printed, listed
 * by name and paper, with one button per paper. It stays through every
 * sign-in and refresh until each order is printed or marked, so a busy
 * afternoon cannot lose one. The helper on the counter PC, if it is ever
 * installed, empties this list by itself.
 */
function PrintBanner({
  items,
  onPrint,
  onPrintOne,
  onMark,
  error,
}: {
  items: Order[];
  onPrint: (paper: "forms" | "plain") => Promise<void>;
  onPrintOne: (o: Order) => Promise<void>;
  onMark: (ids: string[]) => Promise<void>;
  error?: string;
}) {
  const [busy, setBusy] = useState<"" | "forms" | "plain" | "mark" | "one">("");
  const forms = items.filter((t) => printPaperFor(t) === "forms");
  const plain = items.filter((t) => printPaperFor(t) === "plain");
  const run = async (what: "forms" | "plain" | "mark" | "one", fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
    } finally {
      setBusy("");
    }
  };
  return (
    <section
      className="panel"
      aria-label="Website orders to print"
      style={{ padding: "14px 16px", margin: "0 0 20px", borderLeft: "3px solid var(--rose-ink)", maxWidth: 760 }}
    >
      <p style={{ margin: "0 0 8px", fontSize: 15.5, fontWeight: 700 }}>
        {items.length === 1 ? "1 website order came in" : `${items.length} website orders came in`} and {items.length === 1 ? "has" : "have"} not been printed.
      </p>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", fontSize: 14.5, display: "grid", gap: 3 }}>
        {items.map((t) => (
          <li key={t.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
            <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--muted)" }}>{t.number}</span>
            <span style={{ fontWeight: 600 }}>{t.fulfillment === "delivery" && t.recipient ? `${t.recipient} (from ${t.name})` : t.name}</span>
            <span className="muted">
              {t.fulfillment} · {t.date} · {printPaperFor(t) === "forms" ? "order form, bottom tray" : "plain paper, top tray"}
            </span>
            <button type="button" disabled={busy !== ""} onClick={() => run("one", () => onPrintOne(t))} style={{ ...textButton, fontSize: 13.5 }}>
              just this one
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        {forms.length > 0 && (
          <button type="button" className="btn btn--solid" disabled={busy !== ""} onClick={() => run("forms", () => onPrint("forms"))}>
            {busy === "forms" ? "Opening…" : `Print ${forms.length === 1 ? "the delivery form" : `the ${forms.length} delivery forms`}`}
          </button>
        )}
        {plain.length > 0 && (
          <button type="button" className={forms.length > 0 ? "btn" : "btn btn--solid"} disabled={busy !== ""} onClick={() => run("plain", () => onPrint("plain"))}>
            {busy === "plain" ? "Opening…" : `Print ${plain.length === 1 ? "the pickup ticket" : `the ${plain.length} pickup tickets`}`}
          </button>
        )}
        <button type="button" disabled={busy !== ""} onClick={() => run("mark", () => onMark(items.map((t) => t.id)))} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
          Already printed these
        </button>
      </div>
      {error && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--rose-ink)" }}>
          {error}
        </p>
      )}
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
        Each button opens one document with a page per order; in the print dialog pick the tray by name. The list clears once opened; a card&rsquo;s own Print link reprints any one.
      </p>
    </section>
  );
}

/** "made by KD", with a fix: initials mistyped at the Made tap are
    corrected here, through the same route, status unchanged. */
function MadeBy({ o, onMove }: { o: Order; onMove: (id: string, s: Order["status"], extra?: { madeBy?: string }) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(o.madeBy ?? "");
  if (!editing) {
    return (
      <p style={{ margin: "0 0 6px", fontSize: 13.5 }} className="muted">
        made by {o.madeBy}
        {" · "}
        <button type="button" onClick={() => { setV(o.madeBy ?? ""); setEditing(true); }} style={{ ...textButton, fontSize: 13 }}>
          fix
        </button>
      </p>
    );
  }
  const ok = /^[A-Za-z]{1,4}$/.test(v.trim());
  return (
    <p style={{ margin: "0 0 6px", display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
      <span className="muted">made by</span>
      <input value={v} onChange={(e) => setV(e.target.value.toUpperCase())} maxLength={4} aria-label="Initials" autoFocus style={{ ...field, width: 72, textTransform: "uppercase" }} />
      <button
        type="button"
        className="btn"
        disabled={!ok}
        onClick={() => {
          onMove(o.id, o.status, { madeBy: v.trim().toUpperCase() });
          setEditing(false);
        }}
      >
        Save
      </button>
      <button type="button" onClick={() => setEditing(false)} style={{ ...textButton, fontSize: 13, color: "var(--muted)" }}>
        Never mind
      </button>
    </p>
  );
}

/** The way back from a cancel (Katy, 2026-10-06). The route decides what
    it goes back to and refuses a refunded one; this just asks and shows. */
function Uncancel({ o, onUncancel }: { o: Order; onUncancel: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (o.payment?.refundedAt) return null;
  return (
    <p style={{ margin: "10px 0 0", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 13.5 }}>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr("");
          try {
            await onUncancel(o.id);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "That did not uncancel.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Putting it back…" : "Uncancel"}
      </button>
      <span className="muted">
        back to {o.canceledFrom && o.canceledFrom !== "canceled" ? o.canceledFrom : "confirmed"}
      </span>
      {err && <span style={{ color: "var(--rose-ink)" }}>{err}</span>}
    </p>
  );
}

/**
 * The delivery fee on an unpaid ticket, adjustable in place (Katy,
 * 2026-10-06: the zip sheet is the default, and whoever is ringing the
 * order up can change it before the card is taken). A web order arrives
 * with no delivery line and shows the sheet's fee as "added when charged",
 * which is exactly what the pay route does; a phone order carries the line
 * the form wrote. Saving writes (or replaces) the line and the subtotal,
 * so the ticket, the Take-card total and the receipt all agree. Once paid
 * this renders nothing: the ticket and the payment must stay in step.
 */
function FeeAdjust({ o, onFee }: { o: Order; onFee: (id: string, fee: number) => Promise<void> }) {
  const line = o.lines.find(isDeliveryLine);
  const sheet = site.deliveryFees[o.zip];
  const current = line ? line.each : sheet;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const note = line
    ? sheet === undefined
      ? "set by hand"
      : line.each === sheet
        ? "from the zip list"
        : `adjusted; the list says ${money(sheet)}`
    : sheet !== undefined
      ? "from the zip list, added when charged"
      : "not set; the zip is off the list";

  async function save() {
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n) || n < 0) {
      setError("A number, zero or more.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onFee(o.id, n);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <p style={{ margin: "0 0 8px", fontSize: 13.5, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <span className="muted">
        Delivery fee {current !== undefined ? money(current) : "not set"} · {note}
      </span>
      {!editing ? (
        <button
          type="button"
          onClick={() => {
            setValue(current !== undefined ? String(current) : "");
            setEditing(true);
          }}
          style={{ ...textButton, fontSize: 13.5 }}
        >
          Adjust
        </button>
      ) : (
        <>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            aria-label="Delivery fee"
            style={{ ...field, width: 90 }}
          />
          <button type="button" className="btn" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" disabled={busy} onClick={() => setEditing(false)} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
            Never mind
          </button>
          {error && <span style={{ color: "var(--rose-ink)" }}>{error}</span>}
        </>
      )}
    </p>
  );
}

function OrderCard({
  o,
  contacts,
  onMove,
  onPaid,
  onRefunded,
  onFee,
  onUncancel,
  onEdit,
}: {
  o: Order;
  contacts: Contact[];
  onMove: (id: string, s: Order["status"], extra?: { madeBy?: string }) => void;
  onPaid: () => Promise<void>;
  onRefunded?: (id: string) => void;
  onFee?: (id: string, fee: number) => Promise<void>;
  onUncancel?: (id: string) => Promise<void>;
  onEdit?: (o: Order) => void;
}) {
  const next = nextMove(o);
  const today = todayISO();
  const zipFlag = o.fulfillment === "delivery" && o.zip && !(site.deliveryZips as readonly string[]).includes(o.zip);
  const sympathy = o.occasion === "Sympathy or funeral";
  const prior = priorOrders(contacts, o.phone, o.email, o.createdAt);
  const statusWord =
    o.status === "out" ? "en route" : o.status === "new" ? "needs the confirm call" : o.status === "hold" ? "on hold, not ready to make" : o.status;

  return (
    <article
      className="panel"
      style={{
        padding: 18,
        borderLeft: sympathy
          ? "3px solid var(--ink)"
          : o.status === "hold"
            ? "3px dashed var(--muted)"
          : o.status === "new"
            ? "3px solid var(--rose-ink)"
            : o.status === "out"
              ? "3px solid var(--green)"
              : "3px solid transparent",
        opacity: o.status === "canceled" ? 0.55 : 1,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <strong style={{ fontSize: 17 }}>{o.name}</strong>
        <span className="muted" style={{ fontSize: 13.5, whiteSpace: "nowrap" }}>
          {o.number} · {o.source}
          {" · "}
          {/* The order as a PDF on its paper (2026-10-12): the six-panel
              form for a delivery, plain paper for a pickup. Opens in a tab;
              the viewer's print button picks the tray by printer name. The
              counter's print helper prints web orders by itself; this is
              for everything else and for a second copy. */}
          <a href={`/api/workroom/print/${o.id}`} target="_blank" rel="noopener" style={{ padding: "4px 0" }}>
            Print
          </a>
          {o.printedAt ? <span> · printed {new Date(o.printedAt).toLocaleString("en-US", { timeZone: site.timeZone, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> : ""}
        </span>
      </header>

      {prior.length > 0 && (
        <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--green)" }}>
          Returning · their {ordinal(prior.length + 1)} order
        </p>
      )}

      {/* The customer's tap-to-call, up here with their name where it reads
          as "call them", not dangling under the money where it read as part
          of the payment controls (Kevin, mid-test: "why is this number
          here?"). */}
      {o.phone && (
        <p style={{ margin: "2px 0", fontSize: 14.5 }}>
          <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} style={{ display: "inline-block", padding: "5px 0" }}>
            {o.phone}
          </a>
        </p>
      )}

      <p style={{ margin: "6px 0", fontSize: 14.5 }}>
        <strong>{o.date}</strong>
        {" · "}
        {/* The one fact that changes the whole afternoon gets weight, not a
            lowercase word lost mid-line: DELIVER means a van and a deadline. */}
        <strong style={{ letterSpacing: "0.04em", color: o.fulfillment === "delivery" ? "var(--rose-ink)" : "var(--ink)" }}>
          {o.fulfillment === "delivery" ? "DELIVER" : "PICKUP"}
        </strong>
        {/* "Everyday" is her word for no-particular-occasion, so on the
            board it is the absence of information and floats like a typo
            (Kevin's read). Real occasions still show; Everyday stays on
            the ticket email, where its Occasion: label explains it. */}
        {o.occasion && o.occasion !== "Everyday" ? ` · ${o.occasion}` : ""}
        {o.status !== "confirmed" ? ` · ${statusWord}` : ""}
      </p>
      {o.madeBy && <MadeBy o={o} onMove={onMove} />}

      {/* Built from the parts that exist: a phone order can be taken before
          the address is known, and "Smoke Test · ," is not an address. A named
          recipient with no street is a real case too, not a missing one — a
          funeral quote sends flowers to "Kempf Funeral Home" and the driver
          knows where that is. */}
      {o.fulfillment === "delivery" && (
        <p style={{ margin: "0 0 6px", fontSize: 14.5 }}>
          {(() => {
            const where = [o.street, [o.town, o.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
            if (where) return `${o.recipient || o.name} · ${where}`;
            return o.recipient || "No delivery address yet";
          })()}
          {zipFlag && (
            <strong style={{ color: "var(--rose-ink)" }}> · off the delivery list</strong>
          )}
        </p>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: "8px 0", fontSize: 14.5 }}>
        {o.lines.map((l, i) => (
          <li key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <span>
              {l.qty} × {l.name}
              {/* A piece priced by stems says what it was priced from, so the
                  workroom builds what the counter promised. */}
              {l.parts && l.parts.length > 0 && (
                <span className="muted" style={{ display: "block", fontSize: 13 }}>
                  {l.parts.map((pt) => `${pt.stems} ${pt.variety}`).join(", ")}
                </span>
              )}
            </span>
            <span style={{ whiteSpace: "nowrap" }}>{money(l.each * l.qty)}</span>
          </li>
        ))}
        <li style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4, fontWeight: 600 }}>
          <span>Subtotal</span>
          <span>{money(o.subtotal)}</span>
        </li>
        {/* Once paid by card, the fee and the true total join the ticket
            itself, receipt style, so the record reads whole without hunting
            through the badge. */}
        {o.payment && o.payment.feeCents > 0 && (
          <>
            <li style={{ display: "flex", justifyContent: "space-between" }}>
              {/* The web checkout's line is the combined Convenience fee;
                  a card keyed at the board pays the shop's Card fee. */}
              <span>{o.source === "web" ? "Convenience fee" : "Card fee"}</span>
              <span>{money(o.payment.feeCents / 100)}</span>
            </li>
            <li style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
              <span>Total paid</span>
              <span>{money(o.payment.totalCents / 100)}</span>
            </li>
          </>
        )}
      </ul>

      {o.fulfillment === "delivery" && !o.payment && o.status !== "canceled" && o.status !== "hold" && onFee && <FeeAdjust o={o} onFee={onFee} />}

      {/* Labeled, because unlabeled they read as mystery text: an employee
          has to KNOW the italic line goes on the card and the other one is
          a customer note (Kevin's catch, first live paid order). overflowWrap
          still, because both are customer-typed and one long unbroken run
          (a URL, a keysmash) must not widen the card. */}
      {o.cardMessage && (
        <p style={{ margin: "6px 0", fontSize: 14.5, overflowWrap: "anywhere" }}>
          <strong style={{ fontSize: 13, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>
            Card message
          </strong>
          <br />
          <span style={{ fontStyle: "italic" }}>&ldquo;{o.cardMessage}&rdquo;</span>
        </p>
      )}
      {o.notes && (
        <p style={{ margin: "6px 0", fontSize: 14.5, overflowWrap: "anywhere" }}>
          <strong style={{ fontSize: 13, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)" }}>
            Notes
          </strong>
          <br />
          {o.notes}
        </p>
      )}

      {/* A new web order says its ask out loud. Kevin walked the customer
          side, chose pay-on-call, and found the board answering with one
          muted mid-line phrase and a button that just says Confirmed:
          nothing told an employee to pick up the phone, or that money still
          needs arranging. Web orders are the only ones born unspoken-to
          (phone orders ARE the call), so the instruction belongs on exactly
          these cards, in the attention color, next to the buttons. */}
      {o.status === "new" && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5, fontWeight: 700, color: "var(--rose-ink)" }}>
          New web order:{" "}
          {o.phone ? (
            <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} style={{ color: "inherit" }}>
              call {o.phone}
            </a>
          ) : (
            "call them"
          )}{" "}
          to confirm{o.payment ? "" : ", then take payment below or at pickup"}.
        </p>
      )}

      {/* A paid web order wanted TODAY skipped the confirm call by design
          (its money is settled), but its timing is a promise nobody made
          yet. The customer was told we will call about timing; this line
          is that promise, employee side. Same-day is the flag because it
          is a fact; a big-order dollar threshold is the owner's policy to
          set and is on her question list. */}
      {o.source === "web" && o.status === "confirmed" && !!o.payment && o.date === today && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5, fontWeight: 700, color: "var(--rose-ink)" }}>
          Paid web order for today: call about timing.
        </p>
      )}

      {/* The money corner. Canceled orders take no payment; finished unpaid
          ones still can, because "paid at pickup" happens after "picked up"
          more often than a process diagram admits. */}
      {/* The refund reminder: money in, order canceled, nothing given. The
          workroom cannot move money out (deliberate; see the bucket note),
          so it says exactly what to do and takes the shop's word when it is
          done. */}
      {o.status === "canceled" && o.payment && !o.payment.refundedAt && (
        <div style={{ margin: "10px 0 0" }}>
          <p style={{ margin: "0 0 8px", fontSize: 14.5, fontWeight: 700, color: "var(--rose-ink)" }}>
            Paid {money(o.payment.totalCents / 100)}, then canceled. Refund it from the Square
            dashboard (Transactions), then mark it here.
          </p>
          {onRefunded && (
            <button type="button" className="btn" onClick={() => onRefunded(o.id)}>
              Refunded in Square
            </button>
          )}
        </div>
      )}

      {o.status !== "canceled" && o.status !== "hold" && (
        <PayControls
          orderId={o.id}
          subtotal={o.subtotal}
          /* Mirrors the pay route's own computation: a delivery ticket with
             no delivery line yet gets the zip's fee appended at charge time,
             and the buttons must quote what will actually be charged. */
          deliveryCents={
            o.fulfillment === "delivery" &&
            !o.lines.some(isDeliveryLine) &&
            site.deliveryFees[o.zip] !== undefined
              ? Math.round(site.deliveryFees[o.zip] * 100)
              : 0
          }
          payment={o.payment}
          onPaid={() => onPaid().catch(() => {})}
        />
      )}

      {/* Keyed by status so a half-finished cancel confirm or initials
          prompt resets when the 30s poll brings a new status underneath. */}
      {next && <Moves key={o.status} o={o} next={next} onMove={onMove} onEdit={onEdit && canEdit(o) ? () => onEdit(o) : undefined} />}
      {o.status === "canceled" && onUncancel && <Uncancel o={o} onUncancel={onUncancel} />}
    </article>
  );
}

/**
 * The counter's order pad. Catalog lines price themselves from the catalog
 * (same rule as the web checkout); custom lines take a typed price, because
 * half of what a florist sells — a casket spray, a one-off vase — has no
 * catalog entry.
 */
const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name));

type DraftPart = { variety: string; stems: string };
type DraftLine = { slug: string; custom: string; each: string; qty: number; byStems: boolean; parts: DraftPart[] };
const blankLine = (): DraftLine => ({ slug: "", custom: "", each: "", qty: 1, byStems: false, parts: [{ variety: "", stems: "" }] });
/** The lines that can be built by stems: her Designer's Choice three and
    anything custom. A Peace Lily is a Peace Lily. */
const canBuild = (l: DraftLine) => !l.slug || l.slug.startsWith("designers-choice");
type StemPrice = { name: string; sellStem: number | null };

/** A stored line back into the form's shape, for editing. The Delivery
    line is not an item; it becomes the fee field. */
const fromLines = (o: Order): DraftLine[] => {
  const items = o.lines.filter((l) => !isDeliveryLine(l));
  if (items.length === 0) return [blankLine()];
  return items.map((l) => ({
    slug: l.slug ?? "",
    custom: l.slug ? "" : l.name,
    each: l.slug ? "" : String(l.each),
    qty: l.qty,
    byStems: !!(l.parts && l.parts.length),
    parts: l.parts && l.parts.length ? l.parts.map((pt) => ({ variety: pt.variety, stems: String(pt.stems) })) : [{ variety: "", stems: "" }],
  }));
};

function PhoneOrderForm({ contacts, onSaved, editing = null }: { contacts: Contact[]; onSaved: () => void; editing?: Order | null }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [picked, setPicked] = useState<Contact | null>(null);
  /**
   * Which of the two lookup fields the HUMAN has typed in since the last
   * pick. Suggestions match only against typed fields, never autofilled
   * ones: without this, picking Wanda fills her phone number, retyping the
   * name to someone else leaves that number in the phone field, and Wanda
   * keeps being suggested off a value nobody typed (found by Kevin in the
   * first minute of testing). A pick resets both flags because the values
   * it writes are the machine's, not the caller's.
   */
  const [typed, setTyped] = useState({ name: false, phone: false });
  /** Same rule for the recipient field: only what the human typed drives
      the recipient suggestions, and a pick closes them. */
  const [typedRecipient, setTypedRecipient] = useState(false);
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">(editing?.fulfillment ?? "delivery");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [recipient, setRecipient] = useState(editing?.recipient ?? "");
  const [street, setStreet] = useState(editing?.street ?? "");
  const [town, setTown] = useState(editing?.town ?? "");
  const [zip, setZip] = useState(editing?.zip ?? "");
  /** Hits from the contacts on file (IRIS), fetched as the human types,
      a short pause after the last keystroke; merged under the order-history
      chips, which always come first because they are more recent truth. */
  const [fileHits, setFileHits] = useState<FileContact[]>([]);
  const [fileRecipHits, setFileRecipHits] = useState<FileContact[]>([]);
  const [pickedFromFile, setPickedFromFile] = useState(false);
  const custQ = typed.name ? name.trim() : typed.phone ? phone.trim() : "";
  useEffect(() => {
    let dead = false;
    if (picked || custQ.length < 2) {
      setFileHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/workroom/contacts?kind=customer&q=${encodeURIComponent(custQ)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!dead) setFileHits((d?.hits as FileContact[]) ?? []);
        })
        .catch(() => {});
    }, 180);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [custQ, picked]);
  const recipQ = typedRecipient ? recipient.trim() : "";
  useEffect(() => {
    let dead = false;
    if (recipQ.length < 2) {
      setFileRecipHits([]);
      return;
    }
    const t = setTimeout(() => {
      fetch(`/api/workroom/contacts?kind=recipient&q=${encodeURIComponent(recipQ)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!dead) setFileRecipHits((d?.hits as FileContact[]) ?? []);
        })
        .catch(() => {});
    }, 180);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [recipQ]);
  /** What was typed into the fee field, or null while it still follows the
      zip sheet. Derived, not an effect: a typed fee survives retyping a zip
      to fix a digit, and a never-touched field tracks the zip as it changes. */
  const [feeOverride, setFeeOverride] = useState<string | null>(() => {
    const dl = editing?.lines.find(isDeliveryLine);
    return dl ? String(dl.each) : null;
  });
  const [date, setDate] = useState(editing?.date ?? todayISO());
  const [occasion, setOccasion] = useState(editing?.occasion ?? "");
  const [cardMessage, setCardMessage] = useState(editing?.cardMessage ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() => (editing ? fromLines(editing) : [blankLine()]));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"" | "board" | "hold">("");
  /** The stem library's names and per-stem prices, for building a piece
      by stems (Katy, 2026-10-06). Loaded once per form open; the route
      re-prices from the same library at write time, so these numbers only
      show what the counter is about to promise. */
  const [library, setLibrary] = useState<StemPrice[]>([]);
  useEffect(() => {
    fetch("/api/workroom/varieties", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.varieties) setLibrary((d.varieties as StemPrice[]).map((v) => ({ name: v.name, sellStem: v.sellStem })));
      })
      .catch(() => {});
  }, []);
  const stemPrice = (variety: string): number | undefined => {
    const v = library.find((x) => x.name === normalizeVariety(variety));
    return v && v.sellStem != null && v.sellStem > 0 ? v.sellStem : undefined;
  };
  /** The built price of a line, in dollars, plus the varieties the library
      cannot price (the route will refuse those by name). */
  const builtPrice = (l: DraftLine): { each: number; unpriced: string[] } => {
    let cents = 0;
    const unpriced: string[] = [];
    for (const pt of l.parts) {
      const stems = Math.round(Number(pt.stems) || 0);
      const name = pt.variety.trim();
      if (!name || stems <= 0) continue;
      const price = stemPrice(name);
      if (price === undefined) unpriced.push(name);
      else cents += Math.round(price * 100) * stems;
    }
    return { each: cents / 100, unpriced };
  };

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((cur) => cur.map((l, at) => (at === i ? { ...l, ...patch } : l)));
  }
  function setPart(i: number, j: number, patch: Partial<DraftPart>) {
    setLines((cur) =>
      cur.map((l, at) => (at === i ? { ...l, parts: l.parts.map((pt, k) => (k === j ? { ...pt, ...patch } : pt)) } : l)),
    );
  }

  const productBySlug = (slug: string): Product | undefined => sortedProducts.find((p) => p.slug === slug);

  /** Save it. `hold` parks it (Katy, 2026-10-12: typed up with questions
      still open, not ready to make); otherwise it goes onto the board as
      confirmed, or an existing one keeps its place. */
  async function save(hold: boolean) {
    setError("");
    // A piece marked "by stems" with no flower and count typed would save
    // at $0 with its price field hidden; refuse here, in words.
    const halfBuilt = lines.find(
      (l) => l.byStems && canBuild(l) && (l.slug || l.custom.trim()) && !l.parts.some((pt) => pt.variety.trim() && Number(pt.stems) > 0),
    );
    if (halfBuilt) {
      setError(`"${halfBuilt.custom.trim() || productBySlug(halfBuilt.slug)?.name || "An item"}" is marked by stems but has no flowers yet. Add a flower and a count, or untick Price it by stems.`);
      return;
    }
    setSaving(hold ? "hold" : "board");
    const payload = {
      id: editing?.id,
      hold,
      name, phone, email, fulfillment, date, occasion, cardMessage, notes,
      recipient: fulfillment === "delivery" ? recipient : "",
      // The address rides on PICKUP orders too since 2026-09-04 (Kevin,
      // from the shop's meeting): it is the customer's own address, kept
      // for their file, house accounts and mileage later.
      street: street,
      town: town,
      zip: zip.trim(),
      // The fee as shown, sheet or typed (Katy, 2026-10-06). Blank means
      // "none typed and the zip is off the list": the route adds no line.
      deliveryFee: delivering && deliveryFee.trim() !== "" && Number.isFinite(Number(deliveryFee)) ? Number(deliveryFee) : undefined,
      lines: lines
        .filter((l) => l.slug || l.custom.trim() || (l.byStems && l.parts.some((pt) => pt.variety.trim() && Number(pt.stems) > 0)))
        .map((l) => {
          // Built by stems: the route prices from the library, so only the
          // parts travel, never a browser-computed price.
          const parts =
            l.byStems && canBuild(l)
              ? l.parts.filter((pt) => pt.variety.trim() && Number(pt.stems) > 0).map((pt) => ({ variety: pt.variety.trim(), stems: Number(pt.stems) }))
              : undefined;
          return l.slug
            ? { slug: l.slug, qty: l.qty, parts }
            : { name: l.custom.trim(), each: parts ? 0 : Number(l.each) || 0, qty: l.qty, parts };
        }),
    };
    const r = await fetch("/api/workroom/orders", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => null);
    setSaving("");
    if (!r.ok) {
      setError(d?.error || "That did not save. Look it over and try again.");
      return;
    }
    onSaved();
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    save(false).catch(() => setSaving(""));
  }

  const delivering = fulfillment === "delivery";
  const sheetFee = site.deliveryFees[zip.trim()];
  const deliveryFee = feeOverride ?? (sheetFee !== undefined ? String(sheetFee) : "");

  return (
    <form onSubmit={submit} className="panel" style={{ maxWidth: 640, marginBottom: 30, display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          <span style={labelText}>Customer</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              // Typing again reopens the suggestions: a wrong pick must not
              // be sticky.
              setPicked(null);
              setTyped((t) => ({ ...t, name: true }));
            }}
            onKeyDown={(e) => {
              // Escape dismisses the suggestions (the canonical combobox
              // behavior); the next keystroke brings them back.
              if (e.key === "Escape") setTyped({ name: false, phone: false });
            }}
            required
            style={field}
          />
        </label>
        <label>
          <span style={labelText}>Phone</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setPicked(null);
              setTyped((t) => ({ ...t, phone: true }));
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTyped({ name: false, phone: false });
            }}
            style={field}
          />
        </label>
        <label>
          <span style={labelText}>
            Email <span className="muted" style={{ fontWeight: 400 }}>(for their receipt)</span>
          </span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
        </label>
      </div>

      {/* THE CUSTOMER BASE IS THE ORDER HISTORY, surfaced while typing: a
          few characters of name or phone offer the matching customers, and
          one tap fills WHO and WHERE from their latest order. Deliberately
          not the lines or the occasion: an earlier same-day version filled
          those too and Kevin cut it, because what they are ordering and why
          is this call's business, and a prefilled Sympathy on a birthday
          order is the kind of wrong that ships. No separate customer table
          to maintain or drift: the orders already know everyone.

          The interaction follows the canonical autocomplete rules (checked
          against the ARIA APG combobox pattern 2026-09-01): match only the
          characters the human typed, selection closes the list, editing
          reopens it filtered by the new value, Escape dismisses. What it
          deliberately is NOT is a full ARIA combobox with arrow-key
          activedescendant plumbing: the suggestions are real buttons,
          natively tabbable and announced, and the APG's own guidance warns
          that half-applied combobox attributes are worse than none. */}
      {(() => {
        // Only what the human typed counts as a query; autofilled values
        // must never drive matching (see the `typed` note above).
        const q = typed.name ? name.trim().toLowerCase() : "";
        const pq = typed.phone ? phone.replace(/\D/g, "") : "";
        if (picked || (q.length < 2 && pq.length < 3)) return null;
        const latestByKey = new Map<string, { c: Contact; count: number }>();
        for (const c of contacts) {
          const key = phoneKey(c.phone) || c.email.trim().toLowerCase() || c.name.trim().toLowerCase();
          if (!key) continue;
          const cur = latestByKey.get(key);
          if (!cur) latestByKey.set(key, { c, count: 1 });
          else {
            cur.count += 1;
            if (c.createdAt > cur.c.createdAt) cur.c = c;
          }
        }
        const hits = [...latestByKey.values()]
          .filter(
            ({ c }) =>
              (q.length >= 2 && c.name.toLowerCase().includes(q)) ||
              (pq.length >= 3 && phoneKey(c.phone).includes(pq)),
          )
          .sort((a, b) => b.c.createdAt - a.c.createdAt)
          .slice(0, 4);
        // Then her old system's file, minus anyone the orders already
        // offered (same phone, or same name when there is no phone).
        const onFile = fileHits.filter(
          (f) => !hits.some(({ c }) => (phoneKey(c.phone) && phoneKey(c.phone) === phoneKey(f.phone)) || c.name.trim().toLowerCase() === f.name.trim().toLowerCase()),
        );
        if (hits.length === 0 && onFile.length === 0) return null;
        return (
          <div role="status" style={{ margin: "-6px 0 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {onFile.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setPicked({ name: f.name, phone: f.phone, email: f.email, createdAt: 0, street: f.street, town: f.town, zip: f.zip });
                  setPickedFromFile(true);
                  setTyped({ name: false, phone: false });
                  setName(f.name);
                  setPhone(f.phone);
                  setEmail(f.email);
                  setStreet(f.street);
                  setTown(f.town);
                  setZip(f.zip);
                }}
                style={{
                  font: "inherit",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--ink)",
                  background: "var(--paper-2)",
                  border: "1px dashed var(--line)",
                  borderRadius: 2,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                {f.name}{f.business ? ` (${f.business})` : ""} · {f.phone || f.email || f.town || "no phone on file"} · on file
              </button>
            ))}
            {hits.map(({ c, count }) => (
              <button
                key={`${c.phone}|${c.name}`}
                type="button"
                onClick={() => {
                  setPicked(c);
                  setPickedFromFile(false);
                  setTyped({ name: false, phone: false });
                  setName(c.name);
                  setPhone(c.phone);
                  // Email is part of WHO: without this line a regular's
                  // receipt silently stopped, because nobody redictates an
                  // email the shop already has (fine-tooth pass, 2026-09-09).
                  setEmail(c.email ?? "");
                  if (c.fulfillment) setFulfillment(c.fulfillment);
                  setRecipient(c.recipient ?? "");
                  setStreet(c.street ?? "");
                  setTown(c.town ?? "");
                  setZip(c.zip ?? "");
                }}
                style={{
                  font: "inherit",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--green)",
                  background: "var(--paper-2)",
                  border: "1px solid var(--line)",
                  borderRadius: 2,
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                {c.name || "On file"} · {c.phone || c.email} · {count} order{count === 1 ? "" : "s"}
              </button>
            ))}
          </div>
        );
      })()}

      {/* After a pick, a quiet confirmation: the filled fields do the
          talking, and the lines below start blank because this call's
          order is its own. */}
      {picked && (
        <p role="status" style={{ margin: "-6px 0 0", fontSize: 14, fontWeight: 600, color: "var(--green)" }}>
          {pickedFromFile
            ? <>Filled from {picked.name || "their"} file in the old system; check the address is current. What they want today is below.</>
            : <>Filled from {picked.name || "their file"}&rsquo;s last order. What they want today is below.</>}
        </p>
      )}

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={labelText}>Delivery or pickup</legend>
        <div style={{ display: "flex", gap: 22 }}>
          {(["delivery", "pickup"] as const).map((f) => (
            <label key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, padding: "4px 0" }}>
              <input type="radio" name="wr-fulfillment" checked={fulfillment === f} onChange={() => setFulfillment(f)} style={radio} />
              {f === "delivery" ? "Deliver it" : "Pickup"}
            </label>
          ))}
        </div>
      </fieldset>

      {delivering && (
        <label>
          <span style={labelText}>Recipient (if not the customer)</span>
          <input
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value);
              setTypedRecipient(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTypedRecipient(false);
            }}
            style={field}
          />
        </label>
      )}

      {/* RECIPIENTS COME FROM THE SAME HISTORY (Katy's question, 2026-10-06:
          "will the same happen with recipients?"). Yes: every delivery
          order already carries who it went to and where, so typing a few
          letters of a recipient offers the matching ones and a tap fills
          the name and the address. Same autocomplete rules as the customer
          chips above, same no-separate-list design: a funeral home or a
          grandmother who gets flowers every month is in the orders. */}
      {delivering &&
        (() => {
          const q = typedRecipient ? recipient.trim().toLowerCase() : "";
          if (q.length < 2) return null;
          const latest = new Map<string, { c: Contact; count: number }>();
          for (const c of contacts) {
            if (c.fulfillment !== "delivery" || !c.recipient) continue;
            const key = `${c.recipient.trim().toLowerCase()}|${(c.street ?? "").trim().toLowerCase()}`;
            const cur = latest.get(key);
            if (!cur) latest.set(key, { c, count: 1 });
            else {
              cur.count += 1;
              if (c.createdAt > cur.c.createdAt) cur.c = c;
            }
          }
          const hits = [...latest.values()]
            .filter(({ c }) => (c.recipient ?? "").toLowerCase().includes(q))
            .sort((a, b) => b.c.createdAt - a.c.createdAt)
            .slice(0, 4);
          const onFile = fileRecipHits.filter(
            (f) => !hits.some(({ c }) => (c.recipient ?? "").trim().toLowerCase() === f.name.trim().toLowerCase() && (c.street ?? "").trim().toLowerCase() === f.street.trim().toLowerCase()),
          );
          if (hits.length === 0 && onFile.length === 0) return null;
          return (
            <div role="status" style={{ margin: "-6px 0 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {onFile.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setTypedRecipient(false);
                    // A person at a place keeps both: the driver needs the
                    // funeral home's name and the family's.
                    setRecipient(f.business && f.business !== f.name ? `${f.name}, ${f.business}` : f.name);
                    setStreet([f.street, f.street2].filter(Boolean).join(", "));
                    setTown(f.town);
                    setZip(f.zip);
                  }}
                  style={{
                    font: "inherit",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--ink)",
                    background: "var(--paper-2)",
                    border: "1px dashed var(--line)",
                    borderRadius: 2,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                >
                  {f.name}{f.business && f.business !== f.name ? ` at ${f.business}` : ""} · {[f.street, f.town].filter(Boolean).join(", ") || "no address on file"} · on file
                </button>
              ))}
              {hits.map(({ c, count }) => (
                <button
                  key={`${c.recipient}|${c.street}`}
                  type="button"
                  onClick={() => {
                    setTypedRecipient(false);
                    setRecipient(c.recipient ?? "");
                    setStreet(c.street ?? "");
                    setTown(c.town ?? "");
                    setZip(c.zip ?? "");
                  }}
                  style={{
                    font: "inherit",
                    fontSize: 14,
                    fontWeight: 600,
                    color: "var(--green)",
                    background: "var(--paper-2)",
                    border: "1px solid var(--line)",
                    borderRadius: 2,
                    padding: "6px 10px",
                    cursor: "pointer",
                  }}
                >
                  {c.recipient} · {[c.street, c.town].filter(Boolean).join(", ") || "no address on file"} · {count} deliver{count === 1 ? "y" : "ies"}
                </button>
              ))}
            </div>
          );
        })()}
      {/* The address block renders for BOTH fulfillments since 2026-09-04
          (Kevin, from the shop's meeting): on a delivery it is where the
          flowers go; on a pickup it is the customer's own address, kept
          for their file. The heading says which so nobody wonders. */}
      <div>
        <span style={labelText}>
          {delivering ? "Delivery address" : "Customer address"}
          {!delivering && <span className="muted" style={{ fontWeight: 400 }}> (optional, for their file)</span>}
        </span>
        {/* minWidth: 0 on every grid label, or the inputs' intrinsic ~170px
            minimum wins over the fr columns and the whole form pushes the
            page sideways at 390px. Caught by the authed-state audit. */}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr minmax(70px, 110px)" }}>
          <label style={{ minWidth: 0 }}>
            <span style={labelText}>Street</span>
            <input value={street} onChange={(e) => setStreet(e.target.value)} style={field} />
          </label>
          <label style={{ minWidth: 0 }}>
            <span style={labelText}>Town</span>
            <input value={town} onChange={(e) => setTown(e.target.value)} style={field} />
          </label>
          <label style={{ minWidth: 0 }}>
            <span style={labelText}>Zip</span>
            <input value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" style={field} />
          </label>
        </div>
      </div>

      {/* THE FEE, WHILE THE PRICE IS BEING QUOTED (Katy, 2026-10-06): the
          zip sheet fills it in, and the person on the phone can change it
          on the spot. It goes on the ticket as the Delivery line, so what
          the customer was told is what the card is charged. */}
      {delivering && (
        <label style={{ maxWidth: 260 }}>
          <span style={labelText}>Delivery fee</span>
          <input
            value={deliveryFee}
            onChange={(e) => setFeeOverride(e.target.value)}
            inputMode="decimal"
            placeholder={zip.trim() ? "" : "type the zip first"}
            style={field}
          />
          <span className="muted" style={{ fontSize: 13, display: "block", marginTop: 4 }}>
            {sheetFee !== undefined
              ? Number(deliveryFee) === sheetFee
                ? `From the zip list for ${zip.trim()}. Change it if this one is different.`
                : `The list says ${money(sheetFee)} for ${zip.trim()}; this order charges what you typed.`
              : zip.trim()
                ? "That zip is not on the list. Type a fee, or leave it blank to settle on the call."
                : "The zip fills this in from the list; you can also just type a fee."}
          </span>
        </label>
      )}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          <span style={labelText}>{delivering ? "Delivery date" : "Pickup date"}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required style={field} />
        </label>
        <label>
          <span style={labelText}>Occasion</span>
          <select value={occasion} onChange={(e) => setOccasion(e.target.value)} style={field}>
            <option value="">None given</option>
            {occasions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
      </div>

      {/* minWidth: 0 down this whole chain. The product select's intrinsic
          width is its longest option, ~350px, and without these the form's
          grid track inherits it and every row stretches past a 390px phone.
          With them, the select shrinks and clips its text instead. */}
      <div style={{ minWidth: 0 }}>
        {/* "Items", not "Lines": a session shipped order-ticket jargon and
            Kevin could not parse the validation error, which means her staff
            cannot either. The code keeps calling them lines; the shop never
            sees the code. */}
        <span style={labelText}>Items</span>
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          {lines.map((l, i) => {
            const p = productBySlug(l.slug);
            const building = l.byStems && canBuild(l);
            const built = building ? builtPrice(l) : null;
            return (
              /* Flex with wrap, not a fixed grid: four cells at their minimums
                 are ~440px, and a 390px phone needs the row to fold instead of
                 shoving the page sideways. */
              <div key={i} style={{ display: "grid", gap: 8, minWidth: 0 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
                <select
                  aria-label={`Item ${i + 1} product`}
                  value={l.slug}
                  onChange={(e) => setLine(i, { slug: e.target.value })}
                  style={{ ...field, flex: "2 1 180px", minWidth: 0, width: "auto" }}
                >
                  <option value="">Custom item…</option>
                  {sortedProducts.map((sp) => (
                    <option key={sp.slug} value={sp.slug}>
                      {sp.name} ({money(sp.price)})
                    </option>
                  ))}
                </select>
                {l.slug ? (
                  <span style={{ alignSelf: "center", fontSize: 14.5, flex: "1 1 auto" }} className="muted">
                    {built ? `${money(built.each)} each, by stems` : `${p ? money(p.price) : ""} each`}
                  </span>
                ) : (
                  <input
                    aria-label={`Item ${i + 1} custom item`}
                    placeholder="What it is"
                    value={l.custom}
                    onChange={(e) => setLine(i, { custom: e.target.value })}
                    style={{ ...field, flex: "1 1 140px", minWidth: 0, width: "auto" }}
                  />
                )}
                {!l.slug && !building && (
                  <input
                    aria-label={`Item ${i + 1} price`}
                    placeholder="$"
                    inputMode="decimal"
                    value={l.each}
                    onChange={(e) => setLine(i, { each: e.target.value })}
                    style={{ ...field, flex: "0 1 90px", minWidth: 0, width: "auto" }}
                  />
                )}
                {!l.slug && building && built && (
                  <span style={{ alignSelf: "center", fontSize: 14.5, flex: "0 1 auto" }} className="muted">
                    {money(built.each)} each, by stems
                  </span>
                )}
                <input
                  aria-label={`Item ${i + 1} quantity`}
                  type="number"
                  min={1}
                  max={99}
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: Number(e.target.value) || 1 })}
                  style={{ ...field, flex: "0 0 72px", minWidth: 0, width: "auto" }}
                />
              </div>

              {/* BUILT BY STEMS (Katy, 2026-10-06: "select rose x 3 and that
                  = the price... this exists in wedding! just needs to be
                  under designers choice"). The wedding builder's arithmetic
                  at the counter: pick a flower from her stem library, say
                  how many, and the piece prices itself at her per-stem
                  retail. Wendalyn is $75 and they want to spend $100: build
                  the $100 here instead of guessing what fits. */}
              {canBuild(l) && (
                <div style={{ paddingLeft: 4, display: "grid", gap: 6 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "var(--muted)" }}>
                    <input
                      type="checkbox"
                      checked={l.byStems}
                      onChange={(e) => setLine(i, { byStems: e.target.checked })}
                      style={{ width: 18, height: 18, accentColor: "var(--green)" }}
                    />
                    Price it by stems
                  </label>
                  {building && (
                    <>
                      {l.parts.map((pt, j) => {
                        const price = pt.variety.trim() ? stemPrice(pt.variety) : undefined;
                        const stems = Math.round(Number(pt.stems) || 0);
                        return (
                          <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", minWidth: 0 }}>
                            <input
                              aria-label={`Item ${i + 1} flower ${j + 1}`}
                              list="wr-stem-library"
                              placeholder="Flower, from the stem library"
                              value={pt.variety}
                              onChange={(e) => setPart(i, j, { variety: e.target.value })}
                              style={{ ...field, flex: "2 1 180px", minWidth: 0, width: "auto" }}
                            />
                            <span className="muted" style={{ fontSize: 14 }}>×</span>
                            <input
                              aria-label={`Item ${i + 1} flower ${j + 1} stems`}
                              type="number"
                              min={0}
                              max={999}
                              placeholder="stems"
                              value={pt.stems}
                              onChange={(e) => setPart(i, j, { stems: e.target.value })}
                              style={{ ...field, flex: "0 0 84px", minWidth: 0, width: "auto" }}
                            />
                            <span style={{ fontSize: 14, minWidth: 110 }} className={price === undefined && pt.variety.trim() ? "" : "muted"}>
                              {!pt.variety.trim()
                                ? ""
                                : price === undefined
                                  ? <strong style={{ color: "var(--rose-ink)" }}>no stem price in the library</strong>
                                  : `${money(price)} a stem${stems > 0 ? ` = ${money(price * stems)}` : ""}`}
                            </span>
                          </div>
                        );
                      })}
                      <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
                        <button type="button" onClick={() => setLine(i, { parts: [...l.parts, { variety: "", stems: "" }] })} style={{ ...textButton, fontSize: 13.5 }}>
                          Another flower
                        </button>
                        {built && built.each > 0 && (
                          <strong style={{ fontSize: 14.5 }}>
                            {money(built.each)} each{l.qty > 1 ? ` · ${money(built.each * l.qty)} for ${l.qty}` : ""}
                          </strong>
                        )}
                        {built && built.unpriced.length > 0 && (
                          <span style={{ fontSize: 13.5, color: "var(--rose-ink)" }}>
                            Add a per-stem price for {built.unpriced.join(", ")} on the Inventory tab, or it will not save.
                          </span>
                        )}
                      </p>
                    </>
                  )}
                </div>
              )}
              </div>
            );
          })}
          {/* One datalist for every flower field: the library's names, so a
              typed name is a resident's name and not a near miss. */}
          <datalist id="wr-stem-library">
            {library.map((v) => (
              <option key={v.name} value={v.name} />
            ))}
          </datalist>
        </div>
        <p style={{ margin: "8px 0 0" }}>
          <button type="button" onClick={() => setLines((cur) => [...cur, blankLine()])} style={textButton}>
            Another item
          </button>
        </p>
      </div>

      <label>
        <span style={labelText}>Card message</span>
        <textarea value={cardMessage} onChange={(e) => setCardMessage(e.target.value)} rows={2} style={field} />
      </label>
      <label>
        <span style={labelText}>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={field} />
      </label>

      <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center" }}>
        <button className="btn btn--solid" type="submit" disabled={saving !== ""}>
          {saving === "board"
            ? "Saving…"
            : editing?.status === "hold"
              ? "Finish it: put it on the board"
              : editing
                ? "Save the changes"
                : "Put it on the board"}
        </button>
        {/* ON HOLD (Katy, 2026-10-12): the email came in, the order is typed,
            and two questions are open. Park it with everything typed; it
            waits in its own section, off the make list, until someone
            finishes it. */}
        <button className="btn" type="button" disabled={saving !== ""} onClick={() => save(true).catch(() => setSaving(""))}>
          {saving === "hold" ? "Saving…" : editing && editing.status !== "hold" ? "Put it on hold" : "Save on hold"}
        </button>
        <span aria-live="polite" style={{ color: "var(--rose-ink)", fontWeight: 600, fontSize: 14.5 }}>{error}</span>
      </p>
    </form>
  );
}
