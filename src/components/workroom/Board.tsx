"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { products, type Product } from "@/lib/catalog";
import { occasions } from "@/lib/occasions";
import { site } from "@/lib/site";
import { field, labelText, money, radio, textButton, todayISO, MemoryWarning, PinGate } from "@/components/workroom/ui";

/**
 * The order board. Adapted from the pjs kitchen screen, at florist pace:
 * tickets there are minutes old and gone in twenty; orders here are days out
 * and alive for weeks. So the board buckets on the REQUESTED date, not the
 * order's age, and polls gently.
 *
 * One button moves an order along its whole life: new -> confirmed -> made ->
 * done. "Confirmed" is the phone call that also takes payment, which is why a
 * phone-entered order is born there. Cancel is a small link, not a big button,
 * because it is the rare move.
 */

type Line = { slug: string | null; name: string; qty: number; each: number };
type Order = {
  id: string;
  number: string;
  source: "web" | "phone";
  status: "new" | "confirmed" | "made" | "done" | "canceled";
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
};

const NEXT: Record<string, { to: Order["status"]; label: string }> = {
  new: { to: "confirmed", label: "Confirmed & paid" },
  confirmed: { to: "made", label: "Made" },
  made: { to: "done", label: "Out the door" },
};

export default function Board({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [orders, setOrders] = useState<Order[]>([]);
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
    const byDate = (a: Order, b: Order) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt;
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
          onSaved={() => {
            setAdding(false);
            pull().catch(() => {});
          }}
        />
      )}

      <Bucket title="Should have gone out" tone="late" orders={buckets.overdue} onMove={move} />
      <Bucket title="Today" orders={buckets.today} onMove={move} />
      <Bucket title="Coming up" orders={buckets.upcoming} onMove={move} />

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
      {showDone && <Bucket title="" orders={buckets.closed} onMove={move} />}
    </>
  );
}

function Bucket({
  title,
  tone,
  orders,
  onMove,
}: {
  title: string;
  tone?: "late";
  orders: Order[];
  onMove: (id: string, s: Order["status"]) => void;
}) {
  if (orders.length === 0) return null;
  return (
    <section style={{ marginBottom: 30 }}>
      {title && (
        <h2
          style={{
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
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(310px, 1fr))" }}>
        {orders.map((o) => (
          <OrderCard key={o.id} o={o} onMove={onMove} />
        ))}
      </div>
    </section>
  );
}

function OrderCard({ o, onMove }: { o: Order; onMove: (id: string, s: Order["status"]) => void }) {
  const next = NEXT[o.status];
  const zipFlag = o.fulfillment === "delivery" && o.zip && !(site.deliveryZips as readonly string[]).includes(o.zip);
  const sympathy = o.occasion === "Sympathy or funeral";

  return (
    <article
      className="panel"
      style={{
        padding: 18,
        borderLeft: sympathy ? "3px solid var(--ink)" : o.status === "new" ? "3px solid var(--rose-ink)" : "3px solid transparent",
        opacity: o.status === "canceled" ? 0.55 : 1,
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <strong style={{ fontSize: 17 }}>{o.name}</strong>
        <span className="muted" style={{ fontSize: 13.5, whiteSpace: "nowrap" }}>
          {o.number} · {o.source}
        </span>
      </header>

      <p style={{ margin: "6px 0", fontSize: 14.5 }}>
        <strong>{o.date}</strong> · {o.fulfillment === "delivery" ? "deliver" : "pickup"}
        {o.occasion ? ` · ${o.occasion}` : ""}
        {o.status !== "new" && o.status !== "confirmed" ? ` · ${o.status}` : o.status === "new" ? " · needs the confirm call" : ""}
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

function PhoneOrderForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
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
          <input value={name} onChange={(e) => setName(e.target.value)} required style={field} />
        </label>
        <label>
          <span style={labelText}>Phone</span>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} style={field} />
        </label>
      </div>

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
