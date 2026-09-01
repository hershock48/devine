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
 * "Confirmed" is the phone call that also takes payment, which is why a
 * phone-entered order is born there. Cancel is a small link, not a big
 * button, because it is the rare move.
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
      return { to: "confirmed", label: "Confirmed & paid" };
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
    const open = orders.filter((o) => o.status !== "done" && o.status !== "canceled");
    // Within a day, deliveries first: they own a van schedule and a hard
    // deadline; pickups wait patiently in the cooler. Date stays primary,
    // because a florist's whole question is "what has to exist by when".
    const byDate = (a: Order, b: Order) =>
      a.date.localeCompare(b.date) ||
      (a.fulfillment === b.fulfillment ? 0 : a.fulfillment === "delivery" ? -1 : 1) ||
      a.createdAt - b.createdAt;
    return {
      overdue: open.filter((o) => o.date < today).sort(byDate),
      today: open.filter((o) => o.date === today).sort(byDate),
      upcoming: open.filter((o) => o.date > today).sort(byDate),
      closed: orders.filter((o) => o.status === "done" || o.status === "canceled").sort((a, b) => b.createdAt - a.createdAt),
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

      <p style={{ margin: "6px 0 26px" }}>
        <button className="btn" type="button" onClick={() => setAdding((v) => !v)}>
          {adding ? "Close the form" : "Write up a phone order"}
        </button>
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

      {buckets.today.length + buckets.overdue.length + buckets.upcoming.length === 0 && (
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
      </ul>

      {/* overflowWrap, because a card message is customer-typed text and one
          long unbroken run (a URL, a keysmash) must not widen the card. */}
      {o.cardMessage && (
        <p style={{ margin: "6px 0", fontSize: 14.5, fontStyle: "italic", overflowWrap: "anywhere" }}>&ldquo;{o.cardMessage}&rdquo;</p>
      )}
      {o.notes && <p style={{ margin: "6px 0", fontSize: 14.5, overflowWrap: "anywhere" }}>{o.notes}</p>}
      {o.phone && (
        <p style={{ margin: "2px 0", fontSize: 14.5 }}>
          {/* inline-block + padding so the tap target clears 24px on a phone */}
          <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`} style={{ display: "inline-block", padding: "5px 0" }}>
            {o.phone}
          </a>
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
          to maintain or drift: the orders already know everyone. */}
      {(() => {
        const q = name.trim().toLowerCase();
        const pq = phone.replace(/\D/g, "");
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
        <span style={labelText}>Lines</span>
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          {lines.map((l, i) => {
            const p = productBySlug(l.slug);
            return (
              /* Flex with wrap, not a fixed grid: four cells at their minimums
                 are ~440px, and a 390px phone needs the row to fold instead of
                 shoving the page sideways. */
              <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: 8, minWidth: 0 }}>
                <select
                  aria-label={`Line ${i + 1} product`}
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
                    aria-label={`Line ${i + 1} custom item`}
                    placeholder="What it is"
                    value={l.custom}
                    onChange={(e) => setLine(i, { custom: e.target.value })}
                    style={{ ...field, flex: "1 1 140px", minWidth: 0, width: "auto" }}
                  />
                )}
                {!l.slug && (
                  <input
                    aria-label={`Line ${i + 1} price`}
                    placeholder="$"
                    inputMode="decimal"
                    value={l.each}
                    onChange={(e) => setLine(i, { each: e.target.value })}
                    style={{ ...field, flex: "0 1 90px", minWidth: 0, width: "auto" }}
                  />
                )}
                <input
                  aria-label={`Line ${i + 1} quantity`}
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
            Another line
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
