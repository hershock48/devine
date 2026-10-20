"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { products, type Product } from "@/lib/catalog";
import { occasions } from "@/lib/occasions";
import { deliveryFeeFor, deliveryMinimumFor, site } from "@/lib/site";
import { INITIALS_ERROR, InitialsInput, field, isInitials, labelText, money, phoneKey, radio, textButton, todayISO, MemoryWarning, PinGate } from "@/components/workroom/ui";
import { balanceCents, clock12, collectedCents, grossPaidCents, HISTORY_DAYS, isDeliveryLine, isTaxLine, normalizeVariety, paidByHandOnly, paidInParts, printPaperFor, refundableCents, refundedCents, squareMoney, taxFor, waitingToPrint, zipFeeToAppend } from "@/lib/workroom/derive";
import PayControls, { CashTendered, changeFor } from "@/components/workroom/PayControls";

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
  recipientPhone?: string;
  company?: string;
  /** The business ordering, when one is (a funeral home for a family). */
  business?: string;
  street: string;
  town: string;
  zip: string;
  date: string;
  neededBy?: string;
  occasion: string;
  cardMessage: string;
  notes: string;
  lines: Line[];
  subtotal: number;
  createdAt: number;
  payment?: { at: number; method: string; squarePaymentId: string; totalCents: number; feeCents: number; refundedAt?: number } | null;
  topUps?: { at: number; method: string; squarePaymentId: string; totalCents: number; feeCents: number }[];
  refunds?: { at: number; cents: number; note: string }[];
  batchId?: string;
  canceledFrom?: string;
  madeBy?: string;
  takenBy?: string;
  account?: boolean;
  taxExempt?: boolean;
  taxId?: string;
  thirdParty?: boolean;
  printedAt?: number;
  /** Rung up from the Quick sale panel: a done pickup for "Walk-in". */
  quick?: boolean;
};

/** Editable while nothing has been made and no money has moved (the PUT
    route enforces the same line). */
/** What a Made tap or a fix on the card may send beside the status. */
type InitialsExtra = { madeBy?: string; takenBy?: string };

/** Editable until canceled (Kevin, 2026-10-14): paid, made or delivered,
    a ticket can still take a tax ID, an address, another item. */
const canEdit = (o: Order) => o.status !== "canceled";

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
  recipientPhone?: string;
  company?: string;
  business?: string;
  account?: boolean;
  taxExempt?: boolean;
  taxId?: string;
  thirdParty?: boolean;
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

/** One sanitizer for every tap-to-call link on the board. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
/** The customer as the board names them: their business first when they
    have one, their own name after it in a lighter weight. The pickup
    header and the delivery card's Ordered by line read this one. */
function CustomerName({ o }: { o: { business?: string; name: string } }) {
  return (
    <>
      {o.business || o.name}
      {o.business && o.name ? <span style={{ fontWeight: 400 }}> · {o.name}</span> : null}
    </>
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
  /** Another order for a customer already on the board, on the same card
      (the card's link): the form opens with them filled in. */
  const [addTo, setAddTo] = useState<Order | null>(null);
  /** One line after a write-up lands: what went on, by number. */
  const [notice, setNotice] = useState("");
  /** The Quick sale panel (Kevin, 2026-10-14), beside the write-up. */
  const [quick, setQuick] = useState(false);
  /** The stem library, for the write-up and the quick sale alike, read
      again each time either opens. */
  const library = useStemLibrary(adding || !!editing || quick, `${adding}|${editing?.id ?? ""}|${quick}`);
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
      two clicks: the six-panel forms (deliveries, and pickups with a card
      message), then the plain pickup tickets. Read off
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

  /** A payment landed on a card: refresh, and when cash was given, say
      the change at the top of the board too (Kevin, 2026-10-16). The
      card's own line can vanish with the refresh when the order changes
      bucket (an out-the-door order paid at pickup goes to Finished), so
      the figure is said where it survives. */
  const paid = (changeCents?: number | null) => {
    if (changeCents) setNotice(`Change ${money(changeCents / 100)} back to the customer.`);
    return pull();
  };
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

  async function move(id: string, status: Order["status"], extra?: InitialsExtra) {
    await fetch("/api/workroom/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, ...(extra?.madeBy ? { madeBy: extra.madeBy } : {}), ...(extra?.takenBy ? { takenBy: extra.takenBy } : {}) }),
    });
    pull().catch(() => {});
  }

  /** Open an order in the form (on hold, or not yet made). The form sits
      at the top of the page, so the page goes there with it. */
  function openEdit(o: Order) {
    setAdding(false);
    setAddTo(null);
    setNotice("");
    setEditing(o);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  /** Open the form for another order on this customer's card (Kevin,
      2026-10-14: the hospital calls back with a sixth). */
  function openAddTo(o: Order) {
    // A write-up already open at the top would be replaced, and what is
    // typed in it lost; say so first.
    if ((adding || editing) && !window.confirm(`A write-up is open at the top of the page. Replace it with another order for ${o.name}? What is typed in it goes away.`)) return;
    setEditing(null);
    setNotice("");
    setAddTo(o);
    setAdding(true);
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

  /** One PATCH to the orders route, then a refresh; the route's own
      message is what the alert shows when it refuses. */
  async function patchOrder(body: Record<string, unknown>) {
    const r = await fetch("/api/workroom/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) window.alert(d?.error || "That did not save.");
    await pull().catch(() => {});
  }
  /** Take back a by-hand paid mark (Katy, 2026-10-15); the route refuses
      anything Square recorded. */
  const unmarkPaid = (id: string) => patchOrder({ id, unmarkPaid: true });
  /** A part of a payment given back (a fee off a ticket the customer
      picked up instead), recorded for the amount owed back. */
  const markPartRefund = (id: string, cents: number) => patchOrder({ id, refunded: cents });
  /** The human attestation that the Square refund happened; the workroom
      cannot see refunds on its own (no refund webhook subscribed) and
      should not pretend to. */
  const markRefunded = (id: string) => patchOrder({ id, markRefunded: true });

  /** The delivery fee adjusted on the card itself, before the card is
      taken (Katy, 2026-10-06). On a paid order the card then shows what is owed back. */
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
      (o.business ?? "").toLowerCase().includes(q) ||
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
      // Within a day, the one needed earliest first; no time sorts last.
      (a.neededBy || "99:99").localeCompare(b.neededBy || "99:99") ||
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
    /* THE GROUPS (Kevin, 2026-10-14): orders placed together for one
       customer that still need paying, by batch id, so a card can offer
       "all N orders, one card". Settled, canceled and held ones drop out
       of the group on their own. */
    // Keyed on the first order's id. A write-up of several stamps every
    // order, the first included, with the first's id; a group grown from
    // the old post-save button left its first order with no batchId. So
    // the key is "batchId, else my own id", and both shapes group right.
    const batches = new Map<string, Order[]>();
    for (const o of shown) {
      if (o.status === "canceled" || o.status === "hold" || balanceCents(o) <= 0) continue;
      const key = o.batchId || o.id;
      batches.set(key, [...(batches.get(key) ?? []), o]);
    }
    // ON ACCOUNT, OUT THE DOOR (Katy, 2026-10-20): a billed order that has
    // gone out is finished as far as the board is concerned; the money is
    // the Accounts tab's business, not the red section's. It files under
    // Finished with its "on account · not paid" words.
    const isClosed = (o: Order) =>
      (o.status === "canceled" && (!o.payment || !!o.payment.refundedAt)) ||
      (o.status === "done" && !!o.payment && balanceCents(o) === 0) ||
      (o.status === "done" && !!o.account && balanceCents(o) > 0);
    return {
      held: held.sort(byDate),
      overdue: open.filter((o) => o.date < today).sort(byDate),
      today: open.filter((o) => o.date === today).sort(byDate),
      upcoming: open.filter((o) => o.date > today).sort(byDate),
      owed: shown.filter((o) => o.status === "done" && !o.account && balanceCents(o) > 0).sort(byDate),
      // Canceled after paying, or trimmed below what was paid: both are
      // money to give back, and both get the red bucket.
      toRefund: shown
        .filter((o) => (o.status === "canceled" && !!o.payment && !o.payment.refundedAt) || (o.status !== "canceled" && !!o.payment && balanceCents(o) < 0))
        .sort((a, b) => b.createdAt - a.createdAt),
      /** Search mode's one list of everything still actionable. */
      active: shown.filter((o) => !isClosed(o)).sort(byDate),
      batches,
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
            setNotice("");
            if (editing) setEditing(null);
            else {
              setAdding((v) => !v);
              setAddTo(null);
            }
          }}
        >
          {adding || editing ? "Close the form" : "Write up an order"}
        </button>
        {/* QUICK SALE (Kevin, 2026-10-14): a walk-in buying something small
            is rung up and paid in one panel, items and initials only. */}
        <button className="btn" type="button" onClick={() => setQuick((v) => !v)}>
          {quick ? "Close quick sale" : "Quick sale"}
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

      {notice && (
        <p role="status" style={{ margin: "-14px 0 22px", fontSize: 15, fontWeight: 600, color: "var(--green)" }}>
          {notice}
        </p>
      )}

      {/* One datalist for every flower field on the page, the write-up's
          and the quick sale's: the library's names, so a typed name is a
          resident's name and not a near miss. */}
      <datalist id="wr-stem-library">
        {library.map((v) => (
          <option key={v.name} value={v.name} />
        ))}
      </datalist>

      {quick && <QuickSale library={library} onChanged={() => pull().catch(() => {})} />}

      {(adding || editing) && (
        <PhoneOrderForm
          key={editing?.id ?? (addTo ? `add:${addTo.id}` : "new")}
          contacts={contacts}
          library={library}
          editing={editing}
          addTo={addTo}
          onSaved={(placed) => {
            setAdding(false);
            setEditing(null);
            setAddTo(null);
            if (placed && placed.length > 1) {
              setNotice(`${placed.length} orders on the board for ${placed[0].name}: ${placed.map((o) => o.number).join(", ")}. One card pays for all of them.`);
            } else if (placed && placed.length === 1 && !editing) {
              setNotice(`${placed[0].number} is on the board for ${placed[0].name}.`);
            }
            pull().catch(() => {});
          }}
          onRefresh={() => pull().catch(() => {})}
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
          <Bucket title="Open & owed" orders={buckets.active} contacts={contacts} batches={buckets.batches} onMove={move} onPaid={paid} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} onAddTo={openAddTo} onPartRefund={markPartRefund} onRefunded={markRefunded} />
          {buckets.closed.length > 0 && (
            <section>
              <h2 style={{ fontFamily: "var(--sans)", fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 4px" }}>
                Finished &amp; canceled ({buckets.closed.length})
              </h2>
              <ClosedList orders={buckets.closed} onUncancel={uncancel} onUnmark={unmarkPaid} />
            </section>
          )}
        </>
      ) : (
        <>
          <Bucket title="On hold" orders={buckets.held} contacts={contacts} batches={buckets.batches} onMove={move} onPaid={paid} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} onAddTo={openAddTo} onPartRefund={markPartRefund} />
          <Bucket title="Should have gone out" tone="late" orders={buckets.overdue} contacts={contacts} batches={buckets.batches} onMove={move} onPaid={paid} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} onAddTo={openAddTo} onPartRefund={markPartRefund} />
          <Bucket title="Today" orders={buckets.today} contacts={contacts} batches={buckets.batches} onMove={move} onPaid={paid} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} onAddTo={openAddTo} onPartRefund={markPartRefund} />
          <Bucket title="Coming up" orders={buckets.upcoming} contacts={contacts} batches={buckets.batches} onMove={move} onPaid={paid} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} onAddTo={openAddTo} onPartRefund={markPartRefund} />
          <Bucket title="Out the door, not paid" tone="late" orders={buckets.owed} contacts={contacts} batches={buckets.batches} onMove={move} onPaid={paid} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} onAddTo={openAddTo} onPartRefund={markPartRefund} />
          <Bucket title="Money to return" tone="late" orders={buckets.toRefund} contacts={contacts} batches={buckets.batches} onMove={move} onPaid={paid} onFee={setFee} onUncancel={uncancel} onEdit={openEdit} onAddTo={openAddTo} onPartRefund={markPartRefund} onRefunded={markRefunded} />

          {buckets.held.length + buckets.today.length + buckets.overdue.length + buckets.upcoming.length + buckets.owed.length + buckets.toRefund.length === 0 && (
            <p className="lede" style={{ marginTop: 8 }}>
              Nothing open. Web orders land here on their own; counter and phone orders get written up above.
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
          {showDone && <ClosedList orders={buckets.closed} onUncancel={uncancel} onUnmark={unmarkPaid} />}
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
function ClosedList({ orders, onUncancel, onUnmark }: { orders: Order[]; onUncancel?: (id: string) => Promise<void>; onUnmark?: (id: string) => Promise<void> }) {
  if (orders.length === 0) return null;
  const moneyWord = (o: Order) => {
    if (!o.payment) return o.status === "canceled" ? "" : o.account ? "on account · not paid" : "not paid";
    // Everything paid, fees included, the one refund figure (derive.ts
    // refundableCents): a ticket paid in parts (cash then card) is one
    // paid order, not a $40 one, and the line agrees with the card's.
    if (o.payment.refundedAt) return `refunded ${money(grossPaidCents(o) / 100)}`;
    return `paid ${money(grossPaidCents(o) / 100)}${refundedCents(o) > 0 ? ` · ${money(refundedCents(o) / 100)} refunded` : ""}`;
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
              {/* A quick sale says so in the name's place: "Walk-in" alone
                  would read as a customer nobody asked the name of. */}
              <span style={{ fontWeight: 600, flex: "1 1 140px", minWidth: 0, overflowWrap: "anywhere" }}>{o.quick ? "Quick sale" : o.business ? `${o.business} · ${o.name}` : o.name}</span>
              <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{o.date}{o.neededBy ? ` · by ${clock12(o.neededBy)}` : ""}</span>
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
                {o.quick ? "quick sale, walk-in" : `${o.source} order`} &middot; {o.fulfillment}
                {o.fulfillment === "delivery" && (o.street || o.recipient)
                  ? ` to ${[o.recipient, o.company, o.street, o.town].filter(Boolean).join(", ")}`
                  : o.company ? ` · ${o.company}` : ""}
                {o.phone ? ` · ${o.phone}` : ""}
                {o.email ? ` · ${o.email}` : ""}
                {o.account ? " · on account" : ""}
                {o.taxExempt ? " · tax exempt" : ""}
                {o.thirdParty ? " · third party, no tax" : ""}
                {o.takenBy ? ` · taken by ${o.takenBy}` : ""}
                {o.madeBy ? ` · made by ${o.madeBy}` : ""}
              </p>
              {o.status === "canceled" && onUncancel && <Uncancel o={o} onUncancel={onUncancel} />}
              {o.payment && (
                <p className="muted" style={{ margin: 0 }}>
                  Paid {o.payment.method === "other" ? "by hand (marked paid another way)" : `by ${o.payment.method}`}, {money(o.payment.totalCents / 100)}
                  {/* When, on the shop's clock, so "did I mark that yesterday?"
                      (Katy, 2026-10-15) is answered by the row itself. */}
                  {o.payment.at > 0 ? ` · ${new Date(o.payment.at).toLocaleString("en-US", { timeZone: site.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
                  {o.payment.feeCents > 0 ? ` (includes the ${money(o.payment.feeCents / 100)} ${o.source === "web" ? "convenience" : "card"} fee)` : ""}
                  {o.payment.refundedAt ? " · refunded" : ""}
                </p>
              )}
              {/* A delivered account order marked paid by hand lands here, so
                  the undo lives here too (Katy, 2026-10-15); never for Square
                  money, never once refunded. */}
              {o.status !== "canceled" && !o.payment?.refundedAt && paidByHandOnly(o) && onUnmark && (
                <p style={{ margin: 0 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm("Take back the paid mark? The order goes back to owed; nothing in Square changes.")) onUnmark(o.id).catch(() => {});
                    }}
                    style={{ ...textButton, fontSize: 13, color: "var(--muted)" }}
                  >
                    Marked paid by mistake? Undo
                  </button>
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
  batches,
  onMove,
  onPaid,
  onRefunded,
  onFee,
  onUncancel,
  onEdit,
  onAddTo,
  onPartRefund,
}: {
  title: string;
  tone?: "late";
  orders: Order[];
  contacts: Contact[];
  batches?: Map<string, Order[]>;
  onMove: (id: string, s: Order["status"], extra?: InitialsExtra) => void;
  /** After a payment: refresh, and the change to hand back when cash
      was given (PayControls), so the board can say it even when the card
      moves bucket and remounts. */
  onPaid: (changeCents?: number | null) => Promise<void>;
  onRefunded?: (id: string) => void;
  onFee?: (id: string, fee: number) => Promise<void>;
  onUncancel?: (id: string) => Promise<void>;
  onEdit?: (o: Order) => void;
  onAddTo?: (o: Order) => void;
  onPartRefund?: (id: string, cents: number) => Promise<void>;
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
          <OrderCard key={o.id} o={o} contacts={contacts} batches={batches} onMove={onMove} onPaid={onPaid} onRefunded={onRefunded} onFee={onFee} onUncancel={onUncancel} onEdit={onEdit} onAddTo={onAddTo} onPartRefund={onPartRefund} />
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
  onAddTo,
}: {
  o: Order;
  next: { to: Order["status"]; label: string };
  onMove: (id: string, s: Order["status"], extra?: InitialsExtra) => void;
  /** Present while the order may still be edited (on hold, or not yet made). */
  onEdit?: () => void;
  /** One more order for this customer, on this card. */
  onAddTo?: () => void;
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
    <p style={{ margin: "12px 0 0", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
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
      {onAddTo && (
        <button type="button" onClick={onAddTo} style={{ ...textButton, fontSize: 13.5 }}>
          Another order, same card
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
              {t.fulfillment} · {t.date} · {printPaperFor(t) === "forms" ? "six-panel form, bottom tray" : "plain paper, top tray"}
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
            {busy === "forms" ? "Opening…" : `Print ${forms.length === 1 ? "the six-panel form" : `the ${forms.length} six-panel forms`}`}
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

/** "taken by KH" and "made by KD", each with a fix: initials mistyped at
    write-up or at the Made tap are corrected here, through the same route,
    status unchanged. The taker's are two or three letters (the write-up
    rule); the maker's keep their one-to-four. */
function InitialsLine({ o, which, onMove }: { o: Order; which: "madeBy" | "takenBy"; onMove: (id: string, s: Order["status"], extra?: InitialsExtra) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(o[which] ?? "");
  const word = which === "madeBy" ? "made by" : "taken by";
  if (!editing) {
    return (
      <p style={{ margin: "0 0 6px", fontSize: 13.5 }} className="muted">
        {word} {o[which]}
        {" · "}
        <button type="button" onClick={() => { setV(o[which] ?? ""); setEditing(true); }} style={{ ...textButton, fontSize: 13 }}>
          fix
        </button>
      </p>
    );
  }
  const ok = which === "madeBy" ? /^[A-Za-z]{1,4}$/.test(v.trim()) : isInitials(v);
  return (
    <p style={{ margin: "0 0 6px", display: "flex", gap: 8, alignItems: "center", fontSize: 13.5 }}>
      <span className="muted">{word}</span>
      <input value={v} onChange={(e) => setV(e.target.value.toUpperCase())} maxLength={4} aria-label="Initials" autoFocus style={{ ...field, width: 72, textTransform: "uppercase" }} />
      <button
        type="button"
        className="btn"
        disabled={!ok}
        onClick={() => {
          onMove(o.id, o.status, { [which]: v.trim().toUpperCase() });
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

/** ON ACCOUNT, after the fact (Katy, 2026-10-14): the box was missed at
    write-up, or the customer asked to be billed after the order was made,
    when Edit is no longer offered. One tap either way, unpaid orders only;
    the Accounts tab picks it up on its next load. */
function AccountToggle({ o, onDone }: { o: Order; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function flip() {
    setBusy(true);
    setErr("");
    const r = await fetch("/api/workroom/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: o.id, account: !o.account }),
    });
    const d = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) {
      setErr(d?.error || "That did not save.");
      return;
    }
    onDone();
  }
  return (
    <p style={{ margin: "0 0 6px", fontSize: 13.5 }} className="muted">
      <button type="button" disabled={busy} onClick={() => flip().catch(() => setBusy(false))} style={{ ...textButton, fontSize: 13 }}>
        {o.account ? "Take off account" : "Put on account"}
      </button>
      {err && <span style={{ color: "var(--rose-ink)", marginLeft: 8 }}>{err}</span>}
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
 * so the ticket, the Take-card total and the receipt all agree. On a paid
 * order (Katy, 2026-10-15) it stays: dropping the fee leaves money owed
 * back, and the card then says what to refund and records that it was.
 */
function FeeAdjust({ o, onFee }: { o: Order; onFee: (id: string, fee: number) => Promise<void> }) {
  const line = o.lines.find(isDeliveryLine);
  const sheet = deliveryFeeFor(o.zip);
  // Once paid, the ticket is the record: no line means no fee was charged
  // (the pay route appends the sheet's fee only when there is one).
  const current = line ? line.each : o.payment ? 0 : sheet;
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
    : o.payment
      ? "none charged"
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
  batches,
  onMove,
  onPaid,
  onRefunded,
  onFee,
  onUncancel,
  onEdit,
  onAddTo,
  onPartRefund,
}: {
  o: Order;
  contacts: Contact[];
  batches?: Map<string, Order[]>;
  onMove: (id: string, s: Order["status"], extra?: InitialsExtra) => void;
  /** After a payment: refresh, and the change to hand back when cash
      was given (PayControls), so the board can say it even when the card
      moves bucket and remounts. */
  onPaid: (changeCents?: number | null) => Promise<void>;
  onRefunded?: (id: string) => void;
  onFee?: (id: string, fee: number) => Promise<void>;
  onUncancel?: (id: string) => Promise<void>;
  onEdit?: (o: Order) => void;
  onAddTo?: (o: Order) => void;
  onPartRefund?: (id: string, cents: number) => Promise<void>;
}) {
  const next = nextMove(o);
  const today = todayISO();
  const [refunding, setRefunding] = useState(false);
  const delivery = o.fulfillment === "delivery";
  const callNumber = delivery ? o.recipientPhone ?? "" : o.phone;
  /* This order's group, when two or more of them still need paying: what
     the pay pane offers to settle at once, each for its own share. */
  const group = batches?.get(o.batchId || o.id);
  const owedFor = (x: Order) => Math.max(0, balanceCents(x)) + (x.payment ? 0 : Math.round((zipFeeToAppend(x) ?? 0) * 100));
  const batch =
    group && group.length > 1 && group.some((x) => x.id === o.id)
      ? { ids: group.map((x) => x.id), count: group.length, index: group.findIndex((x) => x.id === o.id) + 1, totalCents: group.reduce((s, x) => s + owedFor(x), 0), name: o.business || o.name, owed: group.map((x) => ({ number: x.number, cents: owedFor(x) })) }
      : undefined;
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
        // Delivery on a warm wash, pickup on a green one (globals.css), with
        // the word beside the number so the colour is never the only cue.
        background: o.fulfillment === "delivery" ? "var(--wash-delivery)" : "var(--wash-pickup)",
      }}
    >
      {/* WHO IS ON THE CARD FIRST (Kevin, 2026-10-17): a delivery card leads
          with the recipient and where it goes, because that is what the
          workroom and the driver act on; who ordered it sits below the
          items (the "Ordered by" line), with their phone. A pickup card
          keeps the customer first: they are the one walking in. */}
      <header style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 17 }}>
          {delivery ? (
            <>
              {o.recipient || o.name}
              {o.company ? <span style={{ fontWeight: 400 }}> · {o.company}</span> : null}
            </>
          ) : (
            <CustomerName o={o} />
          )}
        </strong>
        <span className="muted" style={{ fontSize: 13.5, whiteSpace: "nowrap" }}>
          <span
            style={{
              display: "inline-block",
              marginRight: 8,
              padding: "1px 7px",
              borderRadius: 2,
              border: `1px solid ${o.fulfillment === "delivery" ? "var(--tag-delivery)" : "var(--tag-pickup)"}`,
              color: o.fulfillment === "delivery" ? "var(--tag-delivery)" : "var(--tag-pickup)",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {o.fulfillment === "delivery" ? "Delivery" : "Pickup"}
          </span>
          {o.number} · {o.quick ? "quick sale" : o.source}
          {/* The order as a PDF on its paper (2026-10-12): the six-panel
              form for a delivery, plain paper for a pickup. Opens in a tab;
              the viewer's print button picks the tray by printer name. The
              counter's print helper prints web orders by itself; this is
              for everything else and for a second copy. Not for a quick
              sale: it walked out the door already, there is nothing to
              make from a ticket. */}
          {!o.quick && (
            <>
              {" · "}
              <a href={`/api/workroom/print/${o.id}`} target="_blank" rel="noopener" style={{ padding: "4px 0" }}>
                Print
              </a>
            </>
          )}
        </span>
      </header>
      {/* The printed stamp on its own line (Kevin, 2026-10-13): in the
          header it ran past the card's edge and under the next one. */}
      {o.printedAt ? (
        <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
          Printed {new Date(o.printedAt).toLocaleString("en-US", { timeZone: site.timeZone, month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </p>
      ) : null}

      {!delivery && prior.length > 0 && (
        <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--green)" }}>
          Returning · their {ordinal(prior.length + 1)} order
        </p>
      )}

      {/* The tap-to-call, up here with the name where it reads as "call
          them", not dangling under the money where it read as part of the
          payment controls (Kevin, mid-test: "why is this number here?").
          On a delivery this is the recipient's number when there is one;
          the customer's is on the Ordered by line below. */}
      {callNumber && (
        <p style={{ margin: "2px 0", fontSize: 14.5 }}>
          <a href={telHref(callNumber)} style={{ display: "inline-block", padding: "5px 0" }}>
            {callNumber}
          </a>
        </p>
      )}

      {/* Built from the parts that exist: a phone order can be taken before
          the address is known, and "Smoke Test · ," is not an address. The
          place (company) is in the header beside the name, so a place with
          no street is a real address, not a missing one: a funeral quote
          sends flowers to "Kempf Funeral Home" and the driver knows where
          that is. Only a card with neither says so. */}
      {delivery &&
        (() => {
          const where = [o.street, [o.town, o.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
          if (!where && o.company) return null;
          return (
            <p style={{ margin: "0 0 2px", fontSize: 14.5 }}>
              {where || "No delivery address yet"}
              {zipFlag && <strong style={{ color: "var(--rose-ink)" }}> · off the delivery list</strong>}
            </p>
          );
        })()}

      <p style={{ margin: "6px 0", fontSize: 14.5 }}>
        <strong>{o.date}{o.neededBy ? ` · by ${clock12(o.neededBy)}` : ""}</strong>
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
        {o.account ? <strong> · ON ACCOUNT</strong> : ""}
        {batch ? <strong> · order {batch.index} of {batch.count}, one card for all</strong> : ""}
        {o.taxExempt ? ` · tax exempt${o.taxId ? ` (ID ${o.taxId})` : ""}` : ""}
        {o.thirdParty ? " · third-party order, no tax" : ""}
      </p>
      {o.takenBy && <InitialsLine o={o} which="takenBy" onMove={onMove} />}
      {o.madeBy && <InitialsLine o={o} which="madeBy" onMove={onMove} />}

      {/* A pickup for a place: the company line under the customer. */}
      {o.fulfillment === "pickup" && o.company && (
        <p style={{ margin: "0 0 6px", fontSize: 14.5 }}>{o.company}</p>
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
          {/* The ticket's total: items, the delivery line and the tax line
              are all rows above, so "Subtotal" was the wrong word. */}
          <span>Total</span>
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
              {/* Everything paid once there are top-ups, so this row is
                  the sum of the payment rows below it. */}
              <span>Total paid</span>
              <span>{money((paidInParts(o) ? grossPaidCents(o) : o.payment.totalCents) / 100)}</span>
            </li>
          </>
        )}
        {/* Money given back after the payment (a fee off a ticket picked up
            instead): on the ticket itself, so Total, the payment and the
            refund read as one record. */}
        {o.payment && refundedCents(o) > 0 && (
          <li style={{ display: "flex", justifyContent: "space-between", color: "var(--rose-ink)" }}>
            <span>Refunded</span>
            <span>−{money(refundedCents(o) / 100)}</span>
          </li>
        )}
        {/* After an edit to a paid ticket, or a part payment (Kevin,
            2026-10-14): the payments taken since the first, and what is
            still due or owed back (derive.ts balanceCents). */}
        {o.payment && paidInParts(o) && (
          <li style={{ display: "flex", justifyContent: "space-between" }}>
            {/* The first payment gets its own row once there are more,
                so the list adds up on its own ($40 cash + $28.90 card). */}
            <span>Paid, {o.payment.method === "other" ? "another way" : o.payment.method}</span>
            <span>{money((o.payment.totalCents - o.payment.feeCents) / 100)}</span>
          </li>
        )}
        {o.payment && paidInParts(o) && o.topUps!.map((p, i) => (
          <li key={i} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Also paid, {p.method === "other" ? "another way" : p.method}</span>
            <span>{money(p.totalCents / 100)}</span>
          </li>
        ))}
        {o.payment && balanceCents(o) !== 0 && (
          <li style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "var(--rose-ink)" }}>
            <span>{balanceCents(o) > 0 ? "Still due" : "To refund after changes"}</span>
            <span>{money(Math.abs(balanceCents(o)) / 100)}</span>
          </li>
        )}
      </ul>

      {/* WHO ORDERED IT, under the ticket on a delivery card (Kevin,
          2026-10-17): the customer (their business first when there is
          one), their phone to call, and whether they are a regular. */}
      {delivery && (
        <p style={{ margin: "0 0 8px", fontSize: 14.5, borderTop: "1px solid var(--line)", paddingTop: 6 }}>
          <span className="muted" style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>Ordered by</span>{" "}
          <strong><CustomerName o={o} /></strong>
          {o.recipient && o.recipient.trim().toLowerCase() === o.name.trim().toLowerCase() ? <span className="muted"> (the recipient)</span> : null}
          {o.phone && (
            <>
              {" · "}
              <a href={telHref(o.phone)} style={{ display: "inline-block", padding: "4px 0" }}>
                {o.phone}
              </a>
            </>
          )}
          {prior.length > 0 && <span style={{ color: "var(--green)", fontWeight: 700 }}> · returning, their {ordinal(prior.length + 1)} order</span>}
        </p>
      )}
      {o.fulfillment === "delivery" && o.status !== "canceled" && o.status !== "hold" && onFee && <FeeAdjust o={o} onFee={onFee} />}
      {/* Not on a quick sale: a walk-in has no account to bill. */}
      {!o.payment && o.status !== "canceled" && !o.quick && <AccountToggle o={o} onDone={() => onPaid().catch(() => {})} />}

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
            <a href={telHref(o.phone)} style={{ color: "inherit" }}>
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
            Paid {money(grossPaidCents(o) / 100)}
            {refundedCents(o) > 0 ? `, ${money(refundedCents(o) / 100)} refunded` : ""}, then canceled. Refund{" "}
            {refundedCents(o) > 0 ? `the remaining ${money(refundableCents(o) / 100)}` : "it"} from the Square dashboard (Transactions), then mark it here.
          </p>
          {onRefunded && (
            <button type="button" className="btn" onClick={() => onRefunded(o.id)}>
              Refunded in Square
            </button>
          )}
        </div>
      )}

      {/* MONEY OWED BACK ON A LIVE ORDER (Katy, 2026-10-15): the ticket shrank
          after it was paid (a delivery fee off, the customer picks up). The
          workroom never moves money out; it says what to refund in Square
          and records that it was done, so the two match. */}
      {o.status !== "canceled" && o.payment && balanceCents(o) < 0 && (
        <div style={{ margin: "10px 0 0" }}>
          <p style={{ margin: "0 0 8px", fontSize: 14.5, fontWeight: 700, color: "var(--rose-ink)" }}>
            Paid {money((collectedCents(o) - refundedCents(o)) / 100)}; the ticket is now {money(o.subtotal)}.{" "}
            {squareMoney(o)
              ? `Refund ${money(-balanceCents(o) / 100)} from the Square dashboard (Transactions), then mark it here.`
              : `Give ${money(-balanceCents(o) / 100)} back (cash or a check), then mark it here.`}
          </p>
          {onPartRefund && (
            <button
              type="button"
              className="btn"
              disabled={refunding}
              onClick={() => {
                setRefunding(true);
                onPartRefund(o.id, -balanceCents(o)).finally(() => setRefunding(false));
              }}
            >
              {refunding ? "Marking…" : squareMoney(o) ? `Refunded ${money(-balanceCents(o) / 100)} in Square` : `Gave ${money(-balanceCents(o) / 100)} back`}
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
          deliveryCents={o.payment ? 0 : Math.round((zipFeeToAppend(o) ?? 0) * 100)}
          payment={o.payment}
          balanceCents={balanceCents(o)}
          collectedCents={collectedCents(o)}
          paidInParts={paidInParts(o)}
          handPaid={paidByHandOnly(o)}
          squareMoney={squareMoney(o)}
          refundedCents={refundedCents(o)}
          batch={batch}
          onPaid={(_m, _c, out) => onPaid(out?.changeCents ?? null).catch(() => {})}
        />
      )}

      {/* Keyed by status so a half-finished cancel confirm or initials
          prompt resets when the 30s poll brings a new status underneath. */}
      {/* "Another order, same card" (Kevin, 2026-10-14): the customer calls
          back with one more for the same card. Not on a canceled order;
          a held one is fine (the new one joins the group when it is
          finished). Not on a quick sale either: "Walk-in" is nobody to
          write another order up for. */}
      {next && (
        <Moves
          key={o.status}
          o={o}
          next={next}
          onMove={onMove}
          onEdit={onEdit && canEdit(o) ? () => onEdit(o) : undefined}
          onAddTo={onAddTo && canEdit(o) && !o.quick ? () => onAddTo(o) : undefined}
        />
      )}
      {/* A finished order has no next move, but it can still be edited
          (a tax ID after the fact, a corrected address for the file). */}
      {!next && canEdit(o) && (onEdit || onAddTo) && (
        <p style={{ margin: "10px 0 0", display: "flex", gap: 14, flexWrap: "wrap" }}>
          {onEdit && (
            <button type="button" onClick={() => onEdit(o)} style={{ ...textButton, fontSize: 13.5 }}>
              Edit
            </button>
          )}
          {onAddTo && !o.quick && (
            <button type="button" onClick={() => onAddTo(o)} style={{ ...textButton, fontSize: 13.5 }}>
              Another order, same card
            </button>
          )}
        </p>
      )}
      {o.status === "canceled" && onUncancel && <Uncancel o={o} onUncancel={onUncancel} />}
    </article>
  );
}

const sortedProducts = [...products].sort((a, b) => a.name.localeCompare(b.name));

type DraftPart = { variety: string; stems: string };
/** `uid` is the row's identity for React (a Remove in the middle of the
    list must not hand row 3's input to row 2's data); it is never sent. */
type DraftLine = { uid: number; slug: string; custom: string; each: string; qty: number; byStems: boolean; parts: DraftPart[] };
let lineUid = 0;
const newUid = () => ++lineUid;
const blankLine = (): DraftLine => ({ uid: newUid(), slug: "", custom: "", each: "", qty: 1, byStems: false, parts: [{ variety: "", stems: "" }] });
/** The lines that can be built by stems: her Designer's Choice three and
    anything custom. A Peace Lily is a Peace Lily. */
const canBuild = (l: DraftLine) => !l.slug || l.slug.startsWith("designers-choice");
type StemPrice = { name: string; sellStem: number | null };

/** A stored line back into the form's shape, for editing. The Delivery
    line is not an item; it becomes the fee field. */
const fromLines = (o: Order): DraftLine[] => {
  const items = o.lines.filter((l) => !isDeliveryLine(l) && !isTaxLine(l));
  if (items.length === 0) return [blankLine()];
  return items.map((l) => ({
    slug: l.slug ?? "",
    custom: l.slug ? "" : l.name,
    each: l.slug ? "" : String(l.each),
    qty: l.qty,
    byStems: !!(l.parts && l.parts.length),
    uid: newUid(),
    parts: l.parts && l.parts.length ? l.parts.map((pt) => ({ variety: pt.variety, stems: String(pt.stems) })) : [{ variety: "", stems: "" }],
  }));
};

/* ====================== THE WRITE-UP, ONE OR MANY ====================== */

/**
 * One order within a write-up: who it is for, where, when, what. A write-up
 * is one customer and one or more of these (Kevin, 2026-10-14: "oaklawn
 * hospital calls and they want to place multiple orders, but use one
 * card"). Each becomes its own order on the board, because the workroom
 * makes and drives them one at a time and each wants its own ticket, card
 * and driver stub; all of them share one card at the end. The shape is the
 * "add another" pattern the UK government design systems settled on for
 * repeated entries on one page: everything stays visible, each entry can be
 * removed, and the add button sits right under the last one.
 */
type Stop = {
  key: number;
  fulfillment: "delivery" | "pickup";
  recipient: string;
  recipientPhone: string;
  company: string;
  street: string;
  town: string;
  zip: string;
  /** What was typed into the fee field, or null while it still follows the
      zip sheet. Derived, not an effect: a typed fee survives retyping a zip
      to fix a digit, and a never-touched field tracks the zip as it changes. */
  feeOverride: string | null;
  date: string;
  neededBy: string;
  occasion: string;
  cardMessage: string;
  notes: string;
  lines: DraftLine[];
};
let stopSeq = 0;
const blankStop = (from: Partial<Stop> = {}): Stop => ({
  key: ++stopSeq,
  fulfillment: "delivery",
  recipient: "",
  recipientPhone: "",
  company: "",
  street: "",
  town: "",
  zip: "",
  feeOverride: null,
  date: todayISO(),
  neededBy: "",
  occasion: "",
  cardMessage: "",
  notes: "",
  lines: [blankLine()],
  ...from,
});
/** A stored order back into the form's shape, for editing. */
const stopFromOrder = (o: Order): Stop => {
  const dl = o.lines.find(isDeliveryLine);
  return blankStop({
    fulfillment: o.fulfillment,
    recipient: o.recipient ?? "",
    recipientPhone: o.recipientPhone ?? "",
    company: o.company ?? "",
    street: o.street ?? "",
    town: o.town ?? "",
    zip: o.zip ?? "",
    feeOverride: dl ? String(dl.each) : null,
    date: o.date,
    neededBy: o.neededBy ?? "",
    occasion: o.occasion ?? "",
    cardMessage: o.cardMessage ?? "",
    notes: o.notes ?? "",
    lines: fromLines(o),
  });
};
/** What the next order on the same call starts with: the same day and
    occasion (a hospital's five go out together) and the same fulfillment.
    A pickup also keeps the address and place, because on a pickup those
    are the customer's own; a delivery starts with a blank recipient and
    address, because a copied address is the kind of wrong that ships. */
const carryOver = (last: Stop): Partial<Stop> => ({
  fulfillment: last.fulfillment,
  date: last.date,
  occasion: last.occasion,
  ...(last.fulfillment === "pickup" ? { company: last.company, street: last.street, town: last.town, zip: last.zip } : {}),
});
/** A line with anything typed in it: a product picked, a custom name, or
    a by-stems build with a flower and a count. The payload sends these
    and only these; the quick sale counts and prices the same set. */
const lineStarted = (l: DraftLine) => !!(l.slug || l.custom.trim() || (l.byStems && l.parts.some((pt) => pt.variety.trim() && Number(pt.stems) > 0)));
/** Anything at all typed or ticked on the row (a price with no name, a
    flower with no count): what the Remove button is for. */
const lineTouched = (l: DraftLine) => lineStarted(l) || l.each.trim() !== "" || l.qty !== 1 || l.byStems || l.parts.some((pt) => pt.variety.trim() || pt.stems.trim());
/** Anything typed into it that deserves an "are you sure" before Remove. */
const stopHasWork = (s: Stop) =>
  !!(
    [s.recipient, s.recipientPhone, s.company, s.street, s.town, s.zip, s.cardMessage, s.notes, s.feeOverride ?? ""].some((v) => v.trim()) ||
    s.lines.some((l) => l.slug || l.custom.trim() || l.parts.some((pt) => pt.variety.trim()))
  );

const productBySlug = (slug: string): Product | undefined => sortedProducts.find((p) => p.slug === slug);
const stemPriceIn = (library: StemPrice[], variety: string): number | undefined => {
  const v = library.find((x) => x.name === normalizeVariety(variety));
  return v && v.sellStem != null && v.sellStem > 0 ? v.sellStem : undefined;
};
/** The built price of a line, in dollars, plus the varieties the library
    cannot price (the route will refuse those by name). */
const builtPriceIn = (library: StemPrice[], l: DraftLine): { each: number; unpriced: string[] } => {
  let cents = 0;
  const unpriced: string[] = [];
  for (const pt of l.parts) {
    const stems = Math.round(Number(pt.stems) || 0);
    const name = pt.variety.trim();
    if (!name || stems <= 0) continue;
    const price = stemPriceIn(library, name);
    if (price === undefined) unpriced.push(name);
    else cents += Math.round(price * 100) * stems;
  }
  return { each: cents / 100, unpriced };
};
/** What one draft line costs each, by the rule the route will apply:
    built by stems from the library, else the catalog price, else what
    was typed. The warning and the items list read the same number. */
const lineEachIn = (library: StemPrice[], l: DraftLine): number =>
  l.byStems && canBuild(l) ? builtPriceIn(library, l).each : l.slug ? productBySlug(l.slug)?.price ?? 0 : Number(l.each) || 0;

/** One order's arithmetic, in the route's terms: items, the fee as shown,
    tax on the items (none when exempt), and the delivery-minimum reading.
    Display only; the route writes the ticket. */
function stopMath(s: Stop, library: StemPrice[], taxExempt: boolean) {
  const delivering = s.fulfillment === "delivery";
  const items = s.lines.reduce((sum, l) => sum + lineEachIn(library, l) * l.qty, 0);
  // A by-stems piece with a flower the library does not price would be
  // summed short and could cry "under" at an order that is not; no warning
  // until every piece can be priced.
  const anyUnpriced = s.lines.some((l) => l.byStems && canBuild(l) && builtPriceIn(library, l).unpriced.length > 0);
  const sheetFee = deliveryFeeFor(s.zip.trim());
  const deliveryFee = s.feeOverride ?? (sheetFee !== undefined ? String(sheetFee) : "");
  const feeTyped = delivering && deliveryFee.trim() !== "" && Number.isFinite(Number(deliveryFee));
  const fee = feeTyped ? Number(deliveryFee) : 0;
  // Any delivery zip, on the sheet or off it (a typed fee for an off-list
  // zip is still a delivery, and the website would have refused it too).
  const minimum = delivering && s.zip.trim().length >= 5 ? deliveryMinimumFor(s.zip.trim()) : 0;
  const underMinimum = minimum > 0 && !anyUnpriced && items > 0 && items < minimum;
  const tax = taxFor(s.lines.map((l) => ({ name: l.custom.trim() || "item", qty: l.qty, each: lineEachIn(library, l) })), taxExempt);
  const total = Math.round((items + fee + tax) * 100) / 100;
  return { delivering, items, anyUnpriced, sheetFee, deliveryFee, feeTyped, fee, minimum, underMinimum, tax, total };
}

/** What the route reads for one order: the form's stop in the body's words. */
function stopPayload(s: Stop, library: StemPrice[]) {
  const m = stopMath(s, library, false);
  return {
    fulfillment: s.fulfillment,
    date: s.date,
    neededBy: s.neededBy,
    occasion: s.occasion,
    cardMessage: s.cardMessage,
    notes: s.notes,
    recipient: m.delivering ? s.recipient : "",
    recipientPhone: m.delivering ? s.recipientPhone.trim() : "",
    company: s.company.trim(),
    // The address rides on PICKUP orders too since 2026-09-04 (Kevin,
    // from the shop's meeting): it is the customer's own address, kept
    // for their file, house accounts and mileage later.
    street: s.street,
    town: s.town,
    zip: s.zip.trim(),
    // The fee as shown, sheet or typed (Katy, 2026-10-06). Blank means
    // "none typed and the zip is off the list": the route adds no line.
    deliveryFee: m.feeTyped ? m.fee : undefined,
    lines: s.lines
      .filter(lineStarted)
      .map((l) => {
        // Built by stems: the route prices from the library, so only the
        // parts travel, never a browser-computed price.
        const parts =
          l.byStems && canBuild(l)
            ? l.parts.filter((pt) => pt.variety.trim() && Number(pt.stems) > 0).map((pt) => ({ variety: pt.variety.trim(), stems: Number(pt.stems) }))
            : undefined;
        return l.slug ? { slug: l.slug, qty: l.qty, parts } : { name: l.custom.trim(), each: parts ? 0 : Number(l.each) || 0, qty: l.qty, parts };
      }),
  };
}

const chipDashed: React.CSSProperties = {
  font: "inherit",
  fontSize: 14,
  fontWeight: 600,
  color: "var(--ink)",
  background: "var(--paper-2)",
  border: "1px dashed var(--line)",
  borderRadius: 2,
  padding: "6px 10px",
  cursor: "pointer",
};
const chipSolid: React.CSSProperties = { ...chipDashed, color: "var(--green)", border: "1px solid var(--line)" };

/**
 * The fields of one order within the write-up. With one order on the form
 * this is the whole lower half, unframed, exactly as it has always looked;
 * with several, each sits in its own numbered frame with a Remove link.
 */
function StopFields({
  s,
  patch,
  contacts,
  library,
  index,
  count,
  taxWord,
  m,
  focus,
  onFocused,
  onRemove,
}: {
  s: Stop;
  patch: (p: Partial<Stop>) => void;
  contacts: Contact[];
  library: StemPrice[];
  index: number;
  count: number;
  /** Why there is no tax line ("tax exempt", "no tax, third-party order"),
      or "" when the tax is charged. */
  taxWord: string;
  /** This order's arithmetic, computed once by the form (it sums them). */
  m: ReturnType<typeof stopMath>;
  /** Land the cursor in this one when it appears (the one just added). */
  focus: boolean;
  onFocused: () => void;
  onRemove?: () => void;
}) {
  /** The frame, so the cursor can land on its first typing field once
      (recipient on a delivery, the place on a pickup) and never again. */
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    frame.current?.querySelector<HTMLInputElement>('input:not([type="radio"]):not([type="checkbox"])')?.focus();
    onFocused();
  }, [focus, onFocused]);
  /** Only what the human typed drives the recipient suggestions, and a
      pick closes them (the same rule as the customer chips). */
  const [typedRecipient, setTypedRecipient] = useState(false);
  /** Hits from the contacts on file (IRIS), fetched as the human types. */
  const [fileRecipHits, setFileRecipHits] = useState<FileContact[]>([]);
  const recipQ = typedRecipient ? s.recipient.trim() : "";
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

  const many = count > 1;
  const delivering = m.delivering;
  const setLines = (f: (cur: DraftLine[]) => DraftLine[]) => patch({ lines: f(s.lines) });
  // Field labels for a screen reader stay unique across several orders.
  const aria = (t: string) => (many ? `Order ${index} ${t.charAt(0).toLowerCase()}${t.slice(1)}` : t);

  return (
    <div
      ref={frame}
      style={{
        display: "grid",
        gap: 14,
        minWidth: 0,
        ...(many
          ? {
              padding: 14,
              border: "1px solid var(--line)",
              borderRadius: 2,
              background: delivering ? "var(--wash-delivery)" : "var(--wash-pickup)",
            }
          : {}),
      }}
    >
      {many && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>
            Order {index} of {count}
            {s.recipient.trim() ? <span className="muted" style={{ fontWeight: 400 }}> · for {s.recipient.trim()}</span> : ""}
          </h3>
          {onRemove && (
            <button type="button" onClick={onRemove} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
              Remove this order
            </button>
          )}
        </div>
      )}

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={labelText}>Delivery or pickup</legend>
        <div style={{ display: "flex", gap: 22 }}>
          {(["delivery", "pickup"] as const).map((f) => (
            <label key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, padding: "4px 0" }}>
              <input type="radio" name={`wr-fulfillment-${s.key}`} checked={s.fulfillment === f} onChange={() => patch({ fulfillment: f })} style={radio} />
              {f === "delivery" ? "Deliver it" : "Pickup"}
            </label>
          ))}
        </div>
      </fieldset>

      {delivering && (
        <label>
          <span style={labelText}>Recipient (if not the customer)</span>
          <input
            value={s.recipient}
            onChange={(e) => {
              patch({ recipient: e.target.value });
              setTypedRecipient(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setTypedRecipient(false);
            }}
            style={field}
          />
        </label>
      )}
      {delivering && (
        <label>
          <span style={labelText}>Recipient&rsquo;s phone (optional, for the driver)</span>
          <input value={s.recipientPhone} onChange={(e) => patch({ recipientPhone: e.target.value })} type="tel" inputMode="tel" autoComplete="off" style={field} />
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
          const q = typedRecipient ? s.recipient.trim().toLowerCase() : "";
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
                    // funeral home's name and the family's. The place goes
                    // on its own line now (the company field).
                    patch({
                      recipient: f.name,
                      company: f.business && f.business !== f.name ? f.business : "",
                      street: [f.street, f.street2].filter(Boolean).join(", "),
                      town: f.town,
                      zip: f.zip,
                    });
                  }}
                  style={chipDashed}
                >
                  {f.name}{f.business && f.business !== f.name ? ` at ${f.business}` : ""} · {[f.street, f.town].filter(Boolean).join(", ") || "no address on file"} · on file
                </button>
              ))}
              {hits.map(({ c, count: n }) => (
                <button
                  key={`${c.recipient}|${c.street}`}
                  type="button"
                  onClick={() => {
                    setTypedRecipient(false);
                    patch({ recipient: c.recipient ?? "", recipientPhone: c.recipientPhone ?? "", street: c.street ?? "", town: c.town ?? "", zip: c.zip ?? "" });
                  }}
                  style={chipSolid}
                >
                  {c.recipient} · {[c.street, c.town].filter(Boolean).join(", ") || "no address on file"} · {n} deliver{n === 1 ? "y" : "ies"}
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
        {/* The place above the street (Kevin, 2026-10-14): a funeral home,
            a school, a church, an office. Its own line on every order: the
            driver reads it before the number on a delivery, and a business
            picking up has a name worth keeping ("worst comes to worst they
            don't use it"). */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={labelText}>Company or place (optional)</span>
          <input value={s.company} onChange={(e) => patch({ company: e.target.value })} placeholder="Funeral home, school, church, office" style={field} />
        </label>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "2fr 1fr minmax(70px, 110px)" }}>
          <label style={{ minWidth: 0 }}>
            <span style={labelText}>Street</span>
            <input value={s.street} onChange={(e) => patch({ street: e.target.value })} style={field} />
          </label>
          <label style={{ minWidth: 0 }}>
            <span style={labelText}>Town</span>
            <input value={s.town} onChange={(e) => patch({ town: e.target.value })} style={field} />
          </label>
          <label style={{ minWidth: 0 }}>
            <span style={labelText}>Zip</span>
            <input value={s.zip} onChange={(e) => patch({ zip: e.target.value })} inputMode="numeric" style={field} />
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
            value={m.deliveryFee}
            onChange={(e) => patch({ feeOverride: e.target.value })}
            inputMode="decimal"
            placeholder={s.zip.trim() ? "" : "type the zip first"}
            style={field}
          />
          <span className="muted" style={{ fontSize: 13, display: "block", marginTop: 4 }}>
            {m.sheetFee !== undefined
              ? Number(m.deliveryFee) === m.sheetFee
                ? `From the zip list for ${s.zip.trim()}. Change it if this one is different.`
                : `The list says ${money(m.sheetFee)} for ${s.zip.trim()}; this order charges what you typed.`
              : s.zip.trim()
                ? "That zip is not on the list. Type a fee, or leave it blank to settle on the call."
                : "The zip fills this in from the list; you can also just type a fee."}
          </span>
        </label>
      )}

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
        <label>
          <span style={labelText}>{delivering ? "Delivery date" : "Pickup date"}</span>
          <input type="date" value={s.date} onChange={(e) => patch({ date: e.target.value })} required style={field} />
        </label>
        {/* "Needed by" (Kevin, 2026-10-14): a service at two, a party at
            six. Optional; the board sorts the day by it and the ticket
            prints it. */}
        <label>
          <span style={labelText}>Needed by (optional)</span>
          <input type="time" value={s.neededBy} onChange={(e) => patch({ neededBy: e.target.value })} step={300} style={field} />
        </label>
        <label>
          <span style={labelText}>Occasion</span>
          <select value={s.occasion} onChange={(e) => patch({ occasion: e.target.value })} style={field}>
            <option value="">None given</option>
            {occasions.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </label>
      </div>

      {/* The items editor is shared with the Quick sale panel (2026-10-14);
          its minWidth: 0 chain keeps the product select from widening a
          390px phone. */}
      <ItemsEditor lines={s.lines} setLines={setLines} library={library} aria={aria} />

      <label>
        <span style={labelText}>Card message</span>
        <textarea value={s.cardMessage} onChange={(e) => patch({ cardMessage: e.target.value })} rows={2} style={field} />
      </label>
      <label>
        <span style={labelText}>Notes</span>
        <textarea value={s.notes} onChange={(e) => patch({ notes: e.target.value })} rows={2} style={field} />
      </label>

      {m.items > 0 && (
        <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
          {many ? `Order ${index}: items` : "Items"} {money(m.items)}
          {m.fee > 0 ? ` + delivery ${money(m.fee)}` : ""}
          {taxWord ? ` · ${taxWord}` : ` + sales tax ${money(m.tax)}`}
          {" = "}
          <strong>{money(m.total)}</strong>
        </p>
      )}
      {/* THE DELIVERY MINIMUM IS A WARNING HERE, NEVER A LOCK (Katy,
          2026-10-14). The website refuses a delivery under her minimum
          because nobody is there to say yes; the counter is exactly the
          person who can. So the form says it, in the words the site would
          have used, and saves anyway. Items only, the fee excluded, the
          same reading the website enforces. */}
      {m.underMinimum && (
        <p role="status" style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: "var(--rose-ink)" }}>
          Under the ${m.minimum} delivery minimum for {s.zip.trim()}: the items come to {money(m.items)}. The website would not
          take this one. It saves here all the same, if you have agreed it with the customer.
        </p>
      )}
    </div>
  );
}

/**
 * THE STEM LIBRARY, names and per-stem retail, for pricing a piece by
 * stems (Katy, 2026-10-06). Read when `active` turns true (the write-up
 * or the quick sale opening), so a price added on the Inventory tab is
 * seen the next time either opens; the route re-prices from the same
 * library at write time, so these numbers only show what the counter is
 * about to promise.
 */
function useStemLibrary(active: boolean, opening: string): StemPrice[] {
  const [library, setLibrary] = useState<StemPrice[]>([]);
  // Re-read whenever something opens (the form, another order in it, the
  // quick sale), not only when the first thing opened: a per-stem price
  // added on the Inventory tab mid-morning is seen by the next opening.
  useEffect(() => {
    if (!active) return;
    fetch("/api/workroom/varieties", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.varieties) setLibrary((d.varieties as StemPrice[]).map((v) => ({ name: v.name, sellStem: v.sellStem })));
      })
      .catch(() => {});
  }, [active, opening]);
  return library;
}

/**
 * THE ITEMS OF AN ORDER, as the counter types them: a product from the
 * catalog or a custom item with a price, a quantity, and the by-stems
 * builder under the lines that can take it. One editor for the write-up
 * (each order on it) and the Quick sale panel (2026-10-14), so a product
 * rings up by exactly the same rules whichever way it is sold.
 */
function ItemsEditor({
  lines,
  setLines,
  library,
  aria = (t) => t,
}: {
  lines: DraftLine[];
  setLines: (f: (cur: DraftLine[]) => DraftLine[]) => void;
  library: StemPrice[];
  /** Field labels for a screen reader, made unique by the caller when
      several orders sit on one form. */
  aria?: (t: string) => string;
}) {
  function setLine(i: number, p: Partial<DraftLine>) {
    setLines((cur) => cur.map((l, at) => (at === i ? { ...l, ...p } : l)));
  }
  function setPart(i: number, j: number, p: Partial<DraftPart>) {
    setLines((cur) => cur.map((l, at) => (at === i ? { ...l, parts: l.parts.map((pt, k) => (k === j ? { ...pt, ...p } : pt)) } : l)));
  }
  /* minWidth: 0 down this whole chain. The product select's intrinsic
     width is its longest option, ~350px, and without these the form's
     grid track inherits it and every row stretches past a 390px phone.
     With them, the select shrinks and clips its text instead. */
  return (
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
          const built = building ? builtPriceIn(library, l) : null;
          return (
            /* Flex with wrap, not a fixed grid: four cells at their minimums
               are ~440px, and a 390px phone needs the row to fold instead of
               shoving the page sideways. */
            <div key={l.uid} style={{ display: "grid", gap: 8, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
              <select
                aria-label={aria(`Item ${i + 1} product`)}
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
                  aria-label={aria(`Item ${i + 1} custom item`)}
                  placeholder="What it is"
                  value={l.custom}
                  onChange={(e) => setLine(i, { custom: e.target.value })}
                  style={{ ...field, flex: "1 1 140px", minWidth: 0, width: "auto" }}
                />
              )}
              {!l.slug && !building && (
                <input
                  aria-label={aria(`Item ${i + 1} price`)}
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
                aria-label={aria(`Item ${i + 1} quantity`)}
                type="number"
                min={1}
                max={99}
                value={l.qty}
                onChange={(e) => setLine(i, { qty: Number(e.target.value) || 1 })}
                style={{ ...field, flex: "0 0 72px", minWidth: 0, width: "auto" }}
              />
              {/* TAKE IT OFF (Kevin, 2026-10-17: "they wanted to add an add
                  on but decided against it while we're still putting the
                  order together"). The last line clears instead of going,
                  so the form always has a row to type into. Hidden on a
                  single blank row, where it would do nothing. */}
              {(lines.length > 1 || lineTouched(l)) && (
                <button
                  type="button"
                  aria-label={aria(`Remove item ${i + 1}`)}
                  onClick={() => setLines((cur) => (cur.length > 1 ? cur.filter((_, at) => at !== i) : [blankLine()]))}
                  style={{ ...textButton, fontSize: 13.5, color: "var(--muted)", alignSelf: "center" }}
                >
                  Remove
                </button>
              )}
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
                      const price = pt.variety.trim() ? stemPriceIn(library, pt.variety) : undefined;
                      const stems = Math.round(Number(pt.stems) || 0);
                      return (
                        <div key={j} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", minWidth: 0 }}>
                          <input
                            aria-label={aria(`Item ${i + 1} flower ${j + 1}`)}
                            list="wr-stem-library"
                            placeholder="Flower, from the stem library"
                            value={pt.variety}
                            onChange={(e) => setPart(i, j, { variety: e.target.value })}
                            style={{ ...field, flex: "2 1 180px", minWidth: 0, width: "auto" }}
                          />
                          <span className="muted" style={{ fontSize: 14 }}>×</span>
                          <input
                            aria-label={aria(`Item ${i + 1} flower ${j + 1} stems`)}
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
      </div>
      <p style={{ margin: "8px 0 0" }}>
        <button type="button" onClick={() => setLines((cur) => [...cur, blankLine()])} style={textButton}>
          Another item
        </button>
      </p>
    </div>
  );
}

/**
 * QUICK SALE (Kevin, 2026-10-14: "when someone walks in and just
 * purchases something small it just goes through and we don't have to
 * ask them a million questions"). Items, the total with tax, initials,
 * and three ways to settle: that is the whole panel. No name, phone,
 * email, date, recipient, address or card message. The route writes it
 * as a done pickup for "Walk-in" dated today; this panel then pays it by
 * the same pay route and the same card entry an order card uses, and
 * says "Done: $12.72 cash" and clears for the next customer.
 *
 * IF THE PAYMENT STEP FAILS the sale is still on the board, unpaid,
 * under Walk-in, with its pay buttons right here (and on its card), so
 * nothing is lost and nothing is charged twice. It never sends a receipt
 * (no email) and never prints or waits to print (not a web order).
 */
/** The sale on the board but not yet settled: what the panel keeps
    between placing a quick sale and its payment landing whole. */
type PlacedSale = {
  id: string;
  number: string;
  subtotal: number;
  /** "card" opens card entry straight off; "idle" shows the pay buttons
      again after a payment that did not take. */
  start: "idle" | "card";
  /** Why it is not paid yet, in words, or "" while the card is being keyed. */
  why: string;
  /** A payment that went through but did not finish the sale: a part
      payment (the rest is still due), or a charge the board missed. */
  paid?: { method: "card" | "cash" | "manual"; cents: number; boardMissed: boolean };
};

function QuickSale({ library, onChanged }: { library: StemPrice[]; onChanged: () => void }) {
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [taxExempt, setTaxExempt] = useState(false);
  /** Who rang it up: kept between sales, because the same person is at
      the counter all morning and retyping it is a question too. */
  const [takenBy, setTakenBy] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "cash" | "card" | "manual">("");
  const [placed, setPlaced] = useState<PlacedSale | null>(null);
  /** The last sale's one line, over the cleared panel. */
  const [done, setDone] = useState("");
  /** Cash given (CashTendered): the change is said in the Done line. */
  const [tendered, setTendered] = useState("");

  // The write-up's own arithmetic (stopMath), on a pickup stop with no
  // fee: items at the rule the route applies, tax on them unless exempt.
  // The same stop is what ring() sends, so the figure shown is the figure
  // charged.
  const stop = useMemo(() => blankStop({ fulfillment: "pickup", lines }), [lines]);
  const m = stopMath(stop, library, taxExempt);
  /** The lines with anything typed in them. Each must price above zero
      (a catalog product, a typed price, or a build the library prices):
      a $0 quick sale would be born done and never paid, and so vanish
      from the board. The route refuses the same thing in the same words. */
  const started = lines.filter(lineStarted);
  const unpriced = started.some((l) => !(lineEachIn(library, l) > 0));

  function clear() {
    setLines([blankLine()]);
    setTaxExempt(false);
    setPlaced(null);
    setTendered("");
    setError("");
  }
  /** PayControls answered: paid whole, paid in part, or charged while the
      board missed it. Only the first is "Done"; the other two keep the
      sale in the panel, with its pay buttons and the warning, so the
      rest is taken or the mark is made before the next customer. */
  const finish = (method?: "card" | "cash" | "manual", cents?: number, outcome?: { settled: boolean; boardMissed: boolean; changeCents: number | null }) => {
    onChanged();
    const paidCents = cents ?? Math.round(m.total * 100);
    if (method && outcome && (!outcome.settled || outcome.boardMissed)) {
      setPlaced((cur) => cur && { ...cur, start: "idle", why: "", paid: { method, cents: paidCents, boardMissed: outcome.boardMissed } });
      return;
    }
    const word = method === "manual" ? "paid another way" : method ?? "paid";
    // The change comes with the outcome, from whichever pane took the
    // cash (this panel's own button, or PayControls once the sale is on
    // the board), so one figure is computed for one payment.
    const back = outcome?.changeCents ?? null;
    setDone(`Done: ${money(paidCents / 100)} ${word}.${back !== null && back > 0 ? ` Change ${money(back / 100)}.` : ""}`);
    clear();
  };

  /** After a charge the board missed: record it by hand for the charged
      amount. "Already paid" back means Square's notice got there first,
      which is the same good news. */
  async function markCharged(id: string, cents: number) {
    setBusy("manual");
    try {
      const pr = await fetch("/api/workroom/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, method: "manual", amountCents: cents }),
      });
      const pd = (await pr.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (pr.ok && pd?.ok) finish("card", cents, { settled: true, boardMissed: false, changeCents: null });
      else if (/already paid/i.test(pd?.error ?? "")) finish("card", cents, { settled: true, boardMissed: false, changeCents: null });
      else setError(pd?.error || "That did not save. Reload the board and mark it from its card.");
    } catch {
      setError("The connection dropped. Reload the board and mark it from its card.");
    } finally {
      setBusy("");
    }
  }

  /** Ring it up: the order goes on the board (done, unpaid), then is paid
      the chosen way. Cash and the by-hand mark go straight to the pay
      route; a card opens card entry on the sale just placed. */
  async function ring(method: "cash" | "card" | "manual") {
    setError("");
    setDone("");
    const halfBuilt = lines.find((l) => l.byStems && canBuild(l) && (l.slug || l.custom.trim()) && !l.parts.some((pt) => pt.variety.trim() && Number(pt.stems) > 0));
    if (halfBuilt) {
      setError(`"${halfBuilt.custom.trim() || productBySlug(halfBuilt.slug)?.name || "An item"}" is marked by stems but has no flowers yet. Add a flower and a count, or untick Price it by stems.`);
      return;
    }
    if (started.length === 0) {
      setError("Add at least one item first.");
      return;
    }
    if (unpriced) {
      setError("A quick sale needs a price on every item.");
      return;
    }
    if (!isInitials(takenBy)) {
      setError(INITIALS_ERROR);
      return;
    }
    setBusy(method);
    /** The order once it is on the board, so a dropped connection after
        that point keeps paying THIS one instead of writing a second. */
    let o: { id: string; number: string; subtotal: number } | null = null;
    try {
      // The write-up's own payload reading for the lines, on the stop the
      // figures were shown for; the route reads only the items, the
      // tax-exempt box and the initials on a quick sale.
      const { lines: payload } = stopPayload(stop, library);
      const r = await fetch("/api/workroom/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quick: true, lines: payload, taxExempt, takenBy: takenBy.trim().toUpperCase() }),
      });
      const d = (await r.json().catch(() => null)) as { error?: string; order?: { id: string; number: string; subtotal: number } } | null;
      if (r.ok && !d) {
        // Saved, answer lost: the sale is on the board; never ring it twice.
        setLines([blankLine()]);
        onChanged();
        setError("The sale saved but the answer did not arrive. It is on the board under Walk-in: take the payment from its card. Do not ring it up again.");
        return;
      }
      if (!r.ok || !d?.order) {
        setError(d?.error || "That did not save. Look it over and try again.");
        return;
      }
      o = d.order;
      onChanged();
      if (method === "card") {
        setPlaced({ id: o.id, number: o.number, subtotal: o.subtotal, start: "card", why: "" });
        return;
      }
      const pr = await fetch("/api/workroom/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: o.id, method }),
      });
      const pd = (await pr.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!pr.ok || !pd?.ok) {
        setPlaced({ id: o.id, number: o.number, subtotal: o.subtotal, start: "idle", why: `${pd?.error || "The payment did not go through."} Take the payment here or from its card; nothing was charged.` });
        return;
      }
      const due = Math.round(o.subtotal * 100);
      const back = method === "cash" ? changeFor(tendered, due) : null;
      finish(method, due, { settled: true, boardMissed: false, changeCents: back !== null && back > 0 ? back : null });
    } catch {
      if (o) {
        // On the board already; the retry pays this one, never a second.
        setPlaced({ id: o.id, number: o.number, subtotal: o.subtotal, start: "idle", why: "the connection dropped as it was being paid. Reload the board in a moment: if it still shows as not paid, take the payment here or from its card." });
      } else {
        setError("The connection dropped. Check the board before trying again: the sale may already be on it.");
      }
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 640, marginBottom: 30, display: "grid", gap: 14 }}>
      {done && (
        <p role="status" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--green)" }}>
          {done}
        </p>
      )}
      {placed ? (
        /* ON THE BOARD, NOT PAID: the sale is safe under Walk-in; this is
           its money corner, the same one its card has, so the card can be
           keyed or the cash recorded without leaving the panel. */
        <div style={{ display: "grid", gap: 8 }}>
          <p role="status" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: placed.why || placed.paid ? "var(--rose-ink)" : "var(--ink)" }}>
            {placed.paid?.boardMissed
              ? `The card WAS CHARGED ${money(placed.paid.cents / 100)} for ${placed.number}, but the board did not save it. Do NOT charge again. Square's own notice usually marks it within a minute; if ${placed.number} still shows as not paid under Walk-in after that, tap the button below.`
              : placed.paid
                ? `${money(placed.paid.cents / 100)} taken by ${placed.paid.method === "manual" ? "another way" : placed.paid.method}; ${money((Math.round(placed.subtotal * 100) - placed.paid.cents) / 100)} still due on ${placed.number} under Walk-in. Take the rest here.`
                : placed.why
                  ? `${placed.number} is on the board under Walk-in, but it is not marked paid: ${placed.why}`
                  : `${placed.number} is on the board under Walk-in. Take the card for ${money(placed.subtotal)}.`}
          </p>
          {/* The card's own money corner, for this one order: a walk-in
              pays in full, so no part-payment link. After a part payment
              all the same (the flag is read defensively), the balance is
              what the buttons charge, as on the card. */}
          {placed.paid?.boardMissed ? (
            /* No card entry here: the money is already taken. The only
               move is to record it, and the webhook turns that mark into
               the real record if it lands later (or has already marked
               it, which the route reports as "already paid": done). */
            <p style={{ margin: 0 }}>
              <button type="button" className="btn" disabled={busy !== ""} onClick={() => markCharged(placed.id, placed.paid!.cents)}>
                {busy ? "Marking…" : `Mark "Paid another way" for ${money(placed.paid.cents / 100)}`}
              </button>
            </p>
          ) : (
            <PayControls
              key={placed.paid?.cents ?? 0}
              orderId={placed.id}
              subtotal={placed.subtotal}
              start={placed.start}
              partPay={false}
              payment={placed.paid ? { at: 0, method: placed.paid.method, totalCents: placed.paid.cents, feeCents: 0 } : undefined}
              balanceCents={placed.paid ? Math.round(placed.subtotal * 100) - placed.paid.cents : undefined}
              collectedCents={placed.paid ? placed.paid.cents : undefined}
              onPaid={finish}
            />
          )}
          <p style={{ margin: 0 }}>
            <button type="button" onClick={clear} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
              Leave it on the board, next customer
            </button>
          </p>
        </div>
      ) : (
        <>
          <ItemsEditor lines={lines} setLines={setLines} library={library} />
          <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, padding: "4px 0" }}>
              <input type="checkbox" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} style={radio} />
              Tax exempt (no sales tax)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}>
              Your initials
              <InitialsInput value={takenBy} onChange={setTakenBy} label="Rung up by, your initials" />
            </label>
          </div>
          <p style={{ margin: 0, fontSize: 15 }}>
            Items {money(m.items)}
            {taxExempt ? " · tax exempt" : ` + sales tax ${money(m.tax)}`}
            {" = "}
            <strong>{money(m.total)}</strong>
          </p>
          {m.total > 0 && <CashTendered dueCents={Math.round(m.total * 100)} value={tendered} onChange={setTendered} disabled={busy !== ""} />}
          <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn--solid" disabled={busy !== ""} onClick={() => ring("cash")}>
              {busy === "cash" ? "Recording…" : `Record ${money(m.total)} cash`}
            </button>
            <button type="button" className="btn" disabled={busy !== ""} onClick={() => ring("card")}>
              {busy === "card" ? "Saving…" : "Take card"}
            </button>
            <button type="button" disabled={busy !== ""} onClick={() => ring("manual")} style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}>
              {busy === "manual" ? "Marking…" : "Paid another way"}
            </button>
          </p>
        </>
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 14.5, fontWeight: 600, color: "var(--rose-ink)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The counter's order pad. Catalog lines price themselves from the catalog
 * (same rule as the web checkout); custom lines take a typed price, because
 * half of what a florist sells — a casket spray, a one-off vase — has no
 * catalog entry. One customer at the top; below, one order, or several on
 * the same call, each for its own recipient, all on one card at the end.
 */
function PhoneOrderForm({
  contacts,
  library,
  onSaved,
  onRefresh,
  editing = null,
  addTo = null,
}: {
  contacts: Contact[];
  /** The stem library's names and per-stem prices (the board's
      useStemLibrary), for building a piece by stems (Katy, 2026-10-06).
      The route re-prices from the same library at write time, so these
      numbers only show what the counter is about to promise. */
  library: StemPrice[];
  /** The write-up is on the board (or the edit is saved); `placed` is what
      went on, for the board's one-line confirmation. */
  onSaved: (placed?: { number: string; name: string }[]) => void;
  /** Something changed on the board under the form (a partial save). */
  onRefresh?: () => void;
  editing?: Order | null;
  /** Another order for a customer already on the board, on the same card
      (the card's "Another order, same card"): who they are and how they pay
      come from this order; what this one is for starts blank. */
  addTo?: Order | null;
}) {
  /** The group this write-up belongs to: an existing group's id when adding
      to it; otherwise the route makes one when there are several. */
  const [batchId, setBatchId] = useState(editing?.batchId ?? (addTo ? addTo.batchId || addTo.id : ""));
  const seed = editing ?? addTo;
  const [name, setName] = useState(seed?.name ?? "");
  /** THE BUSINESS ORDERING (Kevin, 2026-10-14): Kempf's funeral home calls
      for a family, a school's office orders for a teacher. The name stays
      the person on the phone (or the family); the business is who the
      order is really for, on the card, the ticket and the Accounts tab. */
  const [business, setBusiness] = useState(seed?.business ?? "");
  const [phone, setPhone] = useState(seed?.phone ?? "");
  const [email, setEmail] = useState(seed?.email ?? "");
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
  /** Hits from the contacts on file (IRIS), fetched as the human types,
      a short pause after the last keystroke; merged under the order-history
      chips, which always come first because they are more recent truth. */
  const [fileHits, setFileHits] = useState<FileContact[]>([]);
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
  /** Who is writing this up. Required (Katy, 2026-10-14); an edit keeps
      the original initials unless they are changed on purpose. */
  const [takenBy, setTakenBy] = useState(editing?.takenBy ?? "");
  /** HOUSE ACCOUNT and TAX EXEMPT (Katy, 2026-10-14), two boxes, either or
      both. Account: billed, not paid now; it lives on the Accounts tab until
      settled. Tax exempt: the route writes no tax line. Both are the
      customer's, so they apply to every order on the write-up. */
  const [account, setAccount] = useState(seed?.account ?? false);
  const [taxExempt, setTaxExempt] = useState(seed?.taxExempt ?? false);
  const [taxId, setTaxId] = useState(seed?.taxId ?? "");
  /** THROUGH A THIRD PARTY (Katy, 2026-10-20): Tribute and the like
      collect the tax from their own customer, so the ticket here carries
      none, but the order is not tax exempt and must not read as one. */
  const [thirdParty, setThirdParty] = useState(seed?.thirdParty ?? false);
  const noTax = taxExempt || thirdParty;
  const taxWord = taxExempt ? "tax exempt" : thirdParty ? "no tax, third-party order" : "";
  /** The orders on this write-up, one or more. */
  const [stops, setStops] = useState<Stop[]>(() => [
    editing ? stopFromOrder(editing) : addTo ? blankStop(carryOver(stopFromOrder(addTo))) : blankStop(),
  ]);
  /** The order just added, so its first field takes the cursor. */
  const [focusKey, setFocusKey] = useState<number | null>(null);
  const clearFocus = useCallback(() => setFocusKey(null), []);
  const patchStop = (key: number, p: Partial<Stop>) => setStops((cur) => cur.map((s) => (s.key === key ? { ...s, ...p } : s)));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<"" | "board" | "hold">("");
  /** Another order on the same call: what carries over from the last one
      typed (see carryOver), everything else blank, the cursor in it. */
  function addStop() {
    const last = stops[stops.length - 1];
    const s = blankStop(carryOver(last));
    setStops((cur) => [...cur, s]);
    setFocusKey(s.key);
  }
  function removeStop(s: Stop, index: number) {
    if (stopHasWork(s) && !window.confirm(`Remove order ${index}? What is typed in it goes away.`)) return;
    setStops((cur) => cur.filter((x) => x.key !== s.key));
  }

  /** Save it. `hold` parks it (Katy, 2026-10-12: typed up with questions
      still open, not ready to make); otherwise it goes onto the board as
      confirmed, or an existing one keeps its place. Several orders go on
      together or not at all; the route says which one it stopped on. */
  async function save(hold: boolean) {
    setError("");
    const many = stops.length > 1;
    for (let i = 0; i < stops.length; i++) {
      // A piece marked "by stems" with no flower and count typed would save
      // at $0 with its price field hidden; refuse here, in words.
      const halfBuilt = stops[i].lines.find(
        (l) => l.byStems && canBuild(l) && (l.slug || l.custom.trim()) && !l.parts.some((pt) => pt.variety.trim() && Number(pt.stems) > 0),
      );
      if (halfBuilt) {
        setError(
          `${many ? `Order ${i + 1}: ` : ""}"${halfBuilt.custom.trim() || productBySlug(halfBuilt.slug)?.name || "An item"}" is marked by stems but has no flowers yet. Add a flower and a count, or untick Price it by stems.`,
        );
        return;
      }
    }
    if (!isInitials(takenBy)) {
      setError(INITIALS_ERROR);
      return;
    }
    setSaving(hold ? "hold" : "board");
    const shared = {
      id: editing?.id,
      hold,
      takenBy: takenBy.trim().toUpperCase(),
      batchId: batchId || undefined,
      account,
      taxExempt,
      taxId: taxExempt ? taxId.trim() : "",
      thirdParty,
      name,
      business: business.trim(),
      phone,
      email,
    };
    // An edit is one order, flat, as the PUT route has always read it; a
    // new write-up is the customer once and a list, one entry per order.
    const payload = editing ? { ...shared, ...stopPayload(stops[0], library) } : { ...shared, deliveries: stops.map((s) => stopPayload(s, library)) };
    const r = await fetch("/api/workroom/orders", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => null);
    setSaving("");
    if (!r.ok) {
      setError(d?.error || "That did not save. Look it over and try again.");
      // Some of a group went on before the failure: the board behind the
      // form shows them, their frames leave the form, and the rest retry
      // into the same group, so nothing is written up twice.
      const landed = Array.isArray(d?.orders) ? (d.orders as { id: string; batchId?: string }[]) : [];
      if (landed.length) {
        setStops((cur) => (cur.length > landed.length ? cur.slice(landed.length) : cur));
        setBatchId(landed[0].batchId || landed[0].id);
        onRefresh?.();
      }
      return;
    }
    const placed = (Array.isArray(d?.orders) ? d.orders : d?.order ? [d.order] : []) as { number: string; name: string }[];
    onSaved(placed);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    save(false).catch(() => setSaving(""));
  }

  const many = stops.length > 1;
  const maths = stops.map((s) => stopMath(s, library, noTax));
  const sum = (pick: (m: ReturnType<typeof stopMath>) => number) => Math.round(maths.reduce((t, m) => t + pick(m), 0) * 100) / 100;
  const grand = { items: sum((m) => m.items), fee: sum((m) => m.fee), tax: sum((m) => m.tax), total: sum((m) => m.total) };

  return (
    <form onSubmit={submit} className="panel" style={{ maxWidth: 640, marginBottom: 30, display: "grid", gap: 14 }}>
      {addTo && (
        <p role="status" style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--green)" }}>
          Another order for {addTo.name}, on the same card as {addTo.number}. Who they are is filled in; what this one is for goes below.
        </p>
      )}
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
          <span style={labelText}>
            Business <span className="muted" style={{ fontWeight: 400 }}>(if a company is ordering)</span>
          </span>
          <input value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="Funeral home, school, office" style={field} />
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
          one tap fills WHO from their latest order (WHERE as well until
          2026-10-16, when Kevin cut it: see the WHO ONLY note below).
          Deliberately not the lines or the occasion: an earlier same-day
          version filled those too and Kevin cut it, because what they are
          ordering and why is this call's business, and a prefilled
          Sympathy on a birthday order is the kind of wrong that ships. No separate customer table
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
              (q.length >= 2 && (c.name.toLowerCase().includes(q) || (c.business ?? "").toLowerCase().includes(q))) ||
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
        // WHO ONLY (Kevin, 2026-10-16: the pick "will also autofill all the
        // most recent previous recipient's information"; "for now it's just
        // not working for us"). A pick fills the customer's own fields and
        // their account settings; where the flowers go is typed fresh, with
        // the recipient chips (StopFields) for a name that has been used.
        return (
          <div role="status" style={{ margin: "-6px 0 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {onFile.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setPicked({ name: f.name, phone: f.phone, email: f.email, createdAt: 0 });
                  setPickedFromFile(true);
                  setTyped({ name: false, phone: false });
                  setName(f.name);
                  // The customer file's Business column is the customer's
                  // own company (the recipient file's is the place flowers
                  // go, and that one fills the address's company line).
                  setBusiness(f.business && f.business !== f.name ? f.business : "");
                  setPhone(f.phone);
                  setEmail(f.email);
                }}
                style={chipDashed}
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
                  setBusiness(c.business ?? "");
                  setPhone(c.phone);
                  // Email is part of WHO: without this line a regular's
                  // receipt silently stopped, because nobody redictates an
                  // email the shop already has (fine-tooth pass, 2026-09-09).
                  setEmail(c.email ?? "");
                  // An account customer stays one: their last order's
                  // account and tax-exempt settings come along, ID too.
                  setAccount(c.account === true);
                  setTaxExempt(c.taxExempt === true);
                  setTaxId(c.taxExempt ? c.taxId ?? "" : "");
                }}
                style={chipSolid}
              >
                {c.business ? `${c.business} · ` : ""}{c.name} · {c.phone || c.email || "no phone"} · {count} order{count === 1 ? "" : "s"}
              </button>
            ))}
          </div>
        );
      })()}
      {/* Said once, so a prefilled form is never mistaken for a blank one
          and the chips' silence after a pick is understood: the rest of the
          order, where it goes included, is typed fresh. */}
      {picked && (
        <p role="status" style={{ margin: "-6px 0 0", fontSize: 14, fontWeight: 600, color: "var(--green)" }}>
          {pickedFromFile
            ? <>Who is ordering, filled from {picked.name || "their"} file in the old system. Where it goes and what they want today are below.</>
            : <>Who is ordering, filled from {picked.name || "their file"}&rsquo;s last order. Where it goes and what they want today are below.</>}
        </p>
      )}

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={labelText}>Account and tax</legend>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, padding: "4px 0" }}>
            <input type="checkbox" checked={account} onChange={(e) => setAccount(e.target.checked)} style={radio} />
            On account (billed, not paid now)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, padding: "4px 0" }}>
            <input type="checkbox" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} style={radio} />
            Tax exempt (no sales tax)
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, padding: "4px 0" }}>
            <input type="checkbox" checked={thirdParty} onChange={(e) => setThirdParty(e.target.checked)} style={radio} />
            Third-party order (Tribute): they bill the tax, none here
          </label>
        </div>
        {/* The exemption number, asked for once the box is ticked (Kevin,
            2026-10-14). Kept with the order and printed on the ticket. */}
        {taxExempt && (
          <label style={{ display: "block", marginTop: 10, maxWidth: 320 }}>
            <span style={labelText}>Tax exempt ID number</span>
            <input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="From their exemption certificate"
              autoComplete="off"
              style={field}
            />
          </label>
        )}
      </fieldset>

      {stops.map((s, i) => (
        <StopFields
          key={s.key}
          s={s}
          patch={(p) => patchStop(s.key, p)}
          contacts={contacts}
          library={library}
          index={i + 1}
          count={stops.length}
          taxWord={taxWord}
          m={maths[i]}
          focus={s.key === focusKey}
          onFocused={clearFocus}
          onRemove={many ? () => removeStop(s, i + 1) : undefined}
        />
      ))}
      {/* ANOTHER ORDER ON THE SAME CALL (Kevin, 2026-10-14). In the form,
          under the last order, where the eye lands when the caller says
          "and one more": not a button that appears only after saving,
          which nobody found. Each order gets its own ticket; the board
          takes one card for the lot. An edit is one order and has no
          button; the card's "Another order, same card" covers the later
          call. Twenty is the route's ceiling. */}
      {!editing && stops.length < 20 && (
        <button
          type="button"
          onClick={addStop}
          style={{
            font: "inherit",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--green)",
            background: "var(--paper-2)",
            border: "1.5px dashed var(--green)",
            borderRadius: 2,
            padding: "12px 14px",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          + Another order for {name.trim() || "this customer"}
          <span className="muted" style={{ display: "block", fontWeight: 400, fontSize: 13.5, marginTop: 2 }}>
            A second recipient or stop on the same call. Each gets its own ticket; one card pays for all of them at the end.
          </span>
        </button>
      )}

      {many && grand.items > 0 && (
        <p style={{ margin: 0, fontSize: 15 }}>
          <strong>{stops.length} orders:</strong> items {money(grand.items)}
          {grand.fee > 0 ? ` + delivery ${money(grand.fee)}` : ""}
          {taxWord ? ` · ${taxWord}` : ` + sales tax ${money(grand.tax)}`}
          {" = "}
          <strong>{money(grand.total)}</strong>
          <span className="muted"> · one card for all of them</span>
        </p>
      )}
      {editing?.payment && (
        <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
          Paid {money(collectedCents(editing) / 100)} already. If the total changes, the card will say what is still due or to refund.
        </p>
      )}
      {editing && !editing.payment && !["hold", "new", "confirmed"].includes(editing.status) && (
        <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
          Already {editing.status === "out" ? "out the door" : editing.status}. The changes save to the ticket; nothing is made again by itself.
        </p>
      )}

      <label style={{ maxWidth: 260 }}>
        <span style={labelText}>Taken by (your initials)</span>
        <InitialsInput value={takenBy} onChange={setTakenBy} label="Taken by, your initials" describedBy="wr-takenby-help" />
        <span id="wr-takenby-help" style={{ display: "block", marginTop: 4, fontSize: 13, color: "var(--muted)" }}>
          Whoever took the order, so a question later knows who to ask. Two or three letters.
        </span>
      </label>

      <p style={{ margin: 0, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn--solid" type="submit" disabled={saving !== ""}>
          {saving === "board"
            ? "Saving…"
            : editing?.status === "hold"
              ? "Finish it: put it on the board"
              : editing
                ? "Save the changes"
                : many
                  ? `Put all ${stops.length} orders on the board`
                  : "Put it on the board"}
        </button>
        {/* ON HOLD (Katy, 2026-10-12): the email came in, the order is typed,
            and two questions are open. Park it with everything typed; it
            waits in its own section, off the make list, until someone
            finishes it. A group holds together. */}
        {!(editing && (editing.payment || !["hold", "new", "confirmed"].includes(editing.status))) && (
          <button className="btn" type="button" disabled={saving !== ""} onClick={() => save(true).catch(() => setSaving(""))}>
            {saving === "hold" ? "Saving…" : editing && editing.status !== "hold" ? "Put it on hold" : many ? "Save them on hold" : "Save on hold"}
          </button>
        )}
        <span aria-live="polite" style={{ color: "var(--rose-ink)", fontWeight: 600, fontSize: 14.5 }}>{error}</span>
      </p>
    </form>
  );
}
