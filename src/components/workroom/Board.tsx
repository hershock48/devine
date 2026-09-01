"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { products, type Product } from "@/lib/catalog";
import { occasions } from "@/lib/occasions";
import { site } from "@/lib/site";
import { field, labelText, money, radio, textButton, todayISO, MemoryWarning, PinGate } from "@/components/workroom/ui";
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

type Line = { slug: string | null; name: string; qty: number; each: number };
type Order = {
  id: string;
  number: string;
  source: "web" | "phone";
  status: "new" | "confirmed" | "made" | "out" | "done" | "canceled";
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
  payment?: { at: number; method: string; squarePaymentId: string; totalCents: number; feeCents: number } | null;
};

function nextMove(o: Order): { to: Order["status"]; label: string } | null {
  switch (o.status) {
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

/** Last 10 digits, so 269-555-0101 and +1 (269) 555-0101 are one customer. */
const phoneKey = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
};

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
  const [backend, setBackend] = useState("memory");
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  /** The find box: a caller says "order DV-0901-4226" or "it's under
      Wanda" and the counter should not have to scan a busy board by eye.
      Matches number, name, and phone digits; empty means everything. */
  const [find, setFind] = useState("");

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

  async function move(id: string, status: Order["status"]) {
    await fetch("/api/workroom/orders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    pull().catch(() => {});
  }

  const today = todayISO();
  const buckets = useMemo(() => {
    const q = find.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, "");
    const matches = (o: Order) =>
      !q ||
      o.number.toLowerCase().includes(q) ||
      o.name.toLowerCase().includes(q) ||
      (qDigits.length >= 3 && o.phone.replace(/\D/g, "").includes(qDigits));
    const shown = orders.filter(matches);
    const open = shown.filter((o) => o.status !== "done" && o.status !== "canceled");
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
    return {
      overdue: open.filter((o) => o.date < today).sort(byDate),
      today: open.filter((o) => o.date === today).sort(byDate),
      upcoming: open.filter((o) => o.date > today).sort(byDate),
      owed: orders.filter((o) => o.status === "done" && !o.payment).sort(byDate),
      closed: orders
        .filter((o) => o.status === "canceled" || (o.status === "done" && !!o.payment))
        .sort((a, b) => b.createdAt - a.createdAt),
    };
  }, [orders, today]);

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

      <p style={{ margin: "6px 0 26px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <button className="btn" type="button" onClick={() => setAdding((v) => !v)}>
          {adding ? "Close the form" : "Write up a phone order"}
        </button>
        <input
          aria-label="Find an order"
          placeholder="Find: order number, name, or phone"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          style={{ ...field, width: "auto", flex: "0 1 280px", minWidth: 0 }}
        />
      </p>

      {adding && (
        <PhoneOrderForm
          contacts={contacts}
          onSaved={() => {
            setAdding(false);
            pull().catch(() => {});
          }}
        />
      )}

      <Bucket title="Should have gone out" tone="late" orders={buckets.overdue} contacts={contacts} onMove={move} onPaid={pull} />
      <Bucket title="Today" orders={buckets.today} contacts={contacts} onMove={move} onPaid={pull} />
      <Bucket title="Coming up" orders={buckets.upcoming} contacts={contacts} onMove={move} onPaid={pull} />
      <Bucket title="Out the door, not paid" tone="late" orders={buckets.owed} contacts={contacts} onMove={move} onPaid={pull} />

      {buckets.today.length + buckets.overdue.length + buckets.upcoming.length + buckets.owed.length === 0 && (
        <p className="lede" style={{ marginTop: 8 }}>
          {find.trim()
            ? `Nothing matches "${find.trim()}". The finished pile below is searched too.`
            : "Nothing open. Web orders land here on their own; phone orders get written up above."}
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
      {showDone && <Bucket title="" orders={buckets.closed} contacts={contacts} onMove={move} onPaid={pull} />}
    </>
  );
}

function Bucket({
  title,
  tone,
  orders,
  contacts,
  onMove,
  onPaid,
}: {
  title: string;
  tone?: "late";
  orders: Order[];
  contacts: Contact[];
  onMove: (id: string, s: Order["status"]) => void;
  onPaid: () => Promise<void>;
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
          <OrderCard key={o.id} o={o} contacts={contacts} onMove={onMove} onPaid={onPaid} />
        ))}
      </div>
    </section>
  );
}

function OrderCard({
  o,
  contacts,
  onMove,
  onPaid,
}: {
  o: Order;
  contacts: Contact[];
  onMove: (id: string, s: Order["status"]) => void;
  onPaid: () => Promise<void>;
}) {
  const next = nextMove(o);
  const today = todayISO();
  const zipFlag = o.fulfillment === "delivery" && o.zip && !(site.deliveryZips as readonly string[]).includes(o.zip);
  const sympathy = o.occasion === "Sympathy or funeral";
  const prior = priorOrders(contacts, o.phone, o.email, o.createdAt);
  const statusWord =
    o.status === "out" ? "en route" : o.status === "new" ? "needs the confirm call" : o.status;

  return (
    <article
      className="panel"
      style={{
        padding: 18,
        borderLeft: sympathy
          ? "3px solid var(--ink)"
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
        {o.occasion ? ` · ${o.occasion}` : ""}
        {o.status !== "confirmed" ? ` · ${statusWord}` : ""}
      </p>

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
              <span>Order fee</span>
              <span>{money(o.payment.feeCents / 100)}</span>
            </li>
            <li style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
              <span>Total paid</span>
              <span>{money(o.payment.totalCents / 100)}</span>
            </li>
          </>
        )}
      </ul>

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
          New web order: call to confirm{o.payment ? "" : ", then take payment below or on pickup"}.
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
      {o.status !== "canceled" && (
        <PayControls orderId={o.id} subtotal={o.subtotal} payment={o.payment} onPaid={() => onPaid().catch(() => {})} />
      )}

      {next && (
        <p style={{ margin: "12px 0 0", display: "flex", gap: 14, alignItems: "center" }}>
          <button className="btn btn--solid" type="button" onClick={() => onMove(o.id, next.to)}>
            {next.label}
          </button>
          <button
            type="button"
            onClick={() => onMove(o.id, "canceled")}
            style={{ ...textButton, fontSize: 13.5, color: "var(--muted)" }}
          >
            Cancel order
          </button>
        </p>
      )}
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

type DraftLine = { slug: string; custom: string; each: string; qty: number };
const blankLine = (): DraftLine => ({ slug: "", custom: "", each: "", qty: 1 });

function PhoneOrderForm({ contacts, onSaved }: { contacts: Contact[]; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
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
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [recipient, setRecipient] = useState("");
  const [street, setStreet] = useState("");
  const [town, setTown] = useState("");
  const [zip, setZip] = useState("");
  const [date, setDate] = useState(todayISO());
  const [occasion, setOccasion] = useState("");
  const [cardMessage, setCardMessage] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [error, setError] = useState("");

  function setLine(i: number, patch: Partial<DraftLine>) {
    setLines((cur) => cur.map((l, at) => (at === i ? { ...l, ...patch } : l)));
  }

  const productBySlug = (slug: string): Product | undefined => sortedProducts.find((p) => p.slug === slug);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload = {
      name, phone, fulfillment, date, occasion, cardMessage, notes,
      recipient: fulfillment === "delivery" ? recipient : "",
      street: fulfillment === "delivery" ? street : "",
      town: fulfillment === "delivery" ? town : "",
      zip: fulfillment === "delivery" ? zip.trim() : "",
      lines: lines
        .filter((l) => l.slug || l.custom.trim())
        .map((l) =>
          l.slug ? { slug: l.slug, qty: l.qty } : { name: l.custom.trim(), each: Number(l.each) || 0, qty: l.qty },
        ),
    };
    const r = await fetch("/api/workroom/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      setError(d?.error || "That did not save. Look it over and try again.");
      return;
    }
    onSaved();
  }

  const delivering = fulfillment === "delivery";

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
        if (hits.length === 0) return null;
        return (
          <div role="status" style={{ margin: "-6px 0 0", display: "flex", flexWrap: "wrap", gap: 8 }}>
            {hits.map(({ c, count }) => (
              <button
                key={`${c.phone}|${c.name}`}
                type="button"
                onClick={() => {
                  setPicked(c);
                  setTyped({ name: false, phone: false });
                  setName(c.name);
                  setPhone(c.phone);
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
          Filled from {picked.name || "their file"}&rsquo;s last order. What they want today is below.
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
        <>
          <label>
            <span style={labelText}>Recipient (if not the customer)</span>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} style={field} />
          </label>
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
        </>
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
            return (
              /* Flex with wrap, not a fixed grid: four cells at their minimums
                 are ~440px, and a 390px phone needs the row to fold instead of
                 shoving the page sideways. */
              <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
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
                    {p ? money(p.price) : ""} each
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
                {!l.slug && (
                  <input
                    aria-label={`Item ${i + 1} price`}
                    placeholder="$"
                    inputMode="decimal"
                    value={l.each}
                    onChange={(e) => setLine(i, { each: e.target.value })}
                    style={{ ...field, flex: "0 1 90px", minWidth: 0, width: "auto" }}
                  />
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
            );
          })}
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
        <button className="btn btn--solid" type="submit">
          Put it on the board
        </button>
        <span aria-live="polite" style={{ color: "var(--rose-ink)", fontWeight: 600, fontSize: 14.5 }}>{error}</span>
      </p>
    </form>
  );
}
