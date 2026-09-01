"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/Cart";
import ProductImage from "@/components/ProductImage";
import { bySlug, money } from "@/lib/catalog";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";
import { occasions } from "@/lib/occasions";
import { loadSquareSdk, type SquareCard } from "@/lib/square/web-sdk";

/**
 * THE CART, AND A CHECKOUT THAT SENDS SOMEWHERE.
 *
 * Phase 1 of the DeVine build: the order form is real. It POSTs to /api/order,
 * which prices the cart on the server and emails a ticket to the shop over SMTP.
 * No card is taken online; the shop calls to confirm the details and take
 * payment, which is how a florist already handles every phone order it gets.
 *
 * glaze.md's line still governs the failure modes: "What is not acceptable is a
 * stub that waits half a second and says 'Thanks, we got it' while sending
 * nowhere." So the form has exactly three honest outcomes:
 *
 *   sent         "Order DV-0821-4183 is in. We'll call you." The cart clears.
 *   not sent     (mail unconfigured, or the send failed) The visitor is told
 *                plainly that nothing reached the shop, and handed the two
 *                routes that always work: the phone, and a mailto carrying
 *                every field they typed. Nothing to retype, nothing pretended.
 *   bad order    the server's validation message, next to the button.
 *
 * NOTE ON THE TOTAL: still no tax line and no delivery fee. Their site publishes
 * neither a delivery fee nor an order minimum, and inventing either would put a
 * number in front of a customer that the shop never agreed to. The ticket and
 * the confirmation both say the subtotal is settled on the confirm call. Both
 * facts stay on the README checklist as questions for the owner.
 *
 * CARD PAYMENT (2026-09-01), behind the CHECKOUT_CARDS switch and PICKUP
 * ONLY: a pickup subtotal IS the total, so it can be charged honestly; a
 * delivery total still depends on the unanswered delivery-fee question, and
 * charging a number that a fee might later change would be this checkout
 * lying. When the switch is off, or Square is unconnected, none of this
 * renders and the flow above is exactly what it was. The fee is shown as
 * its own Order fee line before the button quotes the total; the server
 * recomputes everything and the browser's numbers decide nothing.
 */

const field: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  font: "inherit",
  fontSize: 15.5,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--paper)",
  color: "var(--ink)",
};

const labelText: React.CSSProperties = {
  display: "block",
  fontSize: 14.5,
  fontWeight: 600,
  marginBottom: 5,
};

type Outcome =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; number: string; paid?: { totalCents: number; feeCents: number; receiptUrl?: string } }
  | { state: "invalid"; message: string }
  | { state: "unreached"; reason: "unconfigured" | "send-failed" };

type CardConfig = { cards: boolean; applicationId?: string; locationId?: string; env?: string; feeCents?: number };

/**
 * The cart's add-on row. Three small things a flower buyer adds at the last
 * moment in a real shop: the chocolates by the register, the tea, the plush.
 * All from her own Gifts & Add Ons category, full names because the names
 * are hers, text-only because none of the three has a photograph yet and a
 * generated print does not belong at a checkout. A row disappears once its
 * item is in the cart; the whole strip disappears when all three are.
 */
const ADD_ON_SLUGS = ["petite-box-of-chocolates", "bohemian-breakfast-tea", "lil-lovey"];

export default function CartView() {
  const { items, subtotal, setQty, remove, count, clear, add, lines } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });

  /*
    THE CARD MESSAGE IS WRITTEN HERE, NOT ON THE PHONE. Someone ordering funeral
    flowers at 11pm should type the hard sentence privately, once, and have it
    travel with the order. Local state only: it flows into the ticket, and a
    half-typed message is not something to persist anywhere without asking.
  */
  const [cardMessage, setCardMessage] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [recipient, setRecipient] = useState("");
  const [street, setStreet] = useState("");
  const [town, setTown] = useState("");
  const [zip, setZip] = useState("");
  const [date, setDate] = useState("");
  const [occasion, setOccasion] = useState("");
  const [notes, setNotes] = useState("");

  /* Card payment plumbing. cfg.cards is false until the CHECKOUT_CARDS
     switch is on AND Square is connected, and everything below renders
     nothing while it is. */
  const [cfg, setCfg] = useState<CardConfig>({ cards: false });
  const [payMethod, setPayMethod] = useState<"call" | "card">("call");
  const [cardReady, setCardReady] = useState(false);
  const cardRef = useRef<SquareCard | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/checkout/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: CardConfig) => setCfg(j?.cards ? j : { cards: false }))
      .catch(() => setCfg({ cards: false }));
  }, []);

  // Card payment is pickup-only; switching to delivery mid-checkout falls
  // back to the call, quietly and correctly.
  useEffect(() => {
    if (fulfillment === "delivery" && payMethod === "card") setPayMethod("call");
  }, [fulfillment, payMethod]);

  // Mount Square's field only while the card option is chosen; tear it
  // down when it is not, same lifecycle as the workroom's pane.
  useEffect(() => {
    if (payMethod !== "card" || !cfg.cards || !cfg.applicationId || !cfg.locationId) return;
    let dead = false;
    setCardReady(false);
    (async () => {
      try {
        await loadSquareSdk(cfg.env ?? "sandbox");
        if (dead || !window.Square) return;
        const payments = await window.Square.payments(cfg.applicationId!, cfg.locationId!);
        const card = await payments.card();
        if (dead || !holderRef.current) {
          await card.destroy().catch(() => {});
          return;
        }
        await card.attach(holderRef.current);
        cardRef.current = card;
        if (!dead) setCardReady(true);
      } catch {
        if (!dead) {
          // The honest fallback is the flow that always works.
          setPayMethod("call");
          setOutcome({ state: "invalid", message: "Card entry did not open; you can place the order and pay on the confirming call." });
        }
      }
    })();
    return () => {
      dead = true;
      cardRef.current?.destroy().catch(() => {});
      cardRef.current = null;
      setCardReady(false);
    };
  }, [payMethod, cfg]);

  const feeCents = cfg.feeCents ?? 99;
  const cardTotalCents = Math.round(subtotal * 100) + feeCents;

  // Client date, not build date: a statically frozen "today" once sold birds for
  // the wrong year (glaze.md failure log). This runs per visit, in the browser.
  const today = new Date().toISOString().slice(0, 10);

  const delivering = fulfillment === "delivery";
  const zipKnown = (site.deliveryZips as readonly string[]).includes(zip.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setOutcome({ state: "sending" });

    // Tokenize first when paying by card: no token, no POST, and the
    // message names what to fix. The card number itself never leaves
    // Square's iframe.
    let cardPayload: { sourceId: string } | undefined;
    if (payMethod === "card") {
      try {
        if (!cardRef.current) throw new Error("The card field is not ready yet.");
        const t = await cardRef.current.tokenize();
        if (t.status !== "OK" || !t.token) throw new Error(t.errors?.[0]?.message || "The card did not go through. Check the number.");
        cardPayload = { sourceId: t.token };
      } catch (err) {
        setOutcome({ state: "invalid", message: err instanceof Error ? err.message : "The card did not go through." });
        return;
      }
    }

    const payload = {
      lines: items.map((i) => ({ slug: i.product.slug, qty: i.qty })),
      name, phone, email, fulfillment,
      recipient: delivering ? recipient : "",
      street: delivering ? street : "",
      town: delivering ? town : "",
      zip: delivering ? zip.trim() : "",
      date, occasion, cardMessage, notes,
      card: cardPayload,
    };
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        setOutcome({ state: "sent", number: body.number, paid: body.paid });
        clear();
      } else if (res.status === 400 || res.status === 402) {
        setOutcome({ state: "invalid", message: body?.error || "Something in the order needs another look." });
      } else {
        setOutcome({ state: "unreached", reason: body?.reason === "unconfigured" ? "unconfigured" : "send-failed" });
      }
    } catch {
      // The fetch itself failed: offline, or the site is down. Same honesty.
      setOutcome({ state: "unreached", reason: "send-failed" });
    }
  }

  /* Everything the visitor typed, ready to travel by email instead. */
  const orderSummary = items.map((i) => `${i.qty} x ${i.product.name} (${money(i.product.price)})`).join("\n");
  const mailtoBody = [
    "Hello,", "", "I would like to order:", "", orderSummary, "",
    `Subtotal: ${money(subtotal)}`, "",
    `My name: ${name}`,
    `My phone: ${phone}`,
    delivering ? `Deliver to: ${recipient || name}` : "Pickup",
    delivering ? `Address: ${street}, ${town} ${zip}` : null,
    `Requested date: ${date}`,
    occasion ? `Occasion: ${occasion}` : null,
    `Card message: ${cardMessage.trim()}`,
    notes ? `Notes: ${notes}` : null,
  ].filter((l): l is string => l !== null).join("\n");
  const mailtoHref = `mailto:${site.email}?subject=${encodeURIComponent("Flower order")}&body=${encodeURIComponent(mailtoBody + "\n")}`;

  if (outcome.state === "sent") {
    return (
      <section className="section">
        <div className="wrap" style={{ maxWidth: 860 }}>
          <p className="kicker">Your order</p>
          <h1>It&rsquo;s in.</h1>
          <p className="lede" style={{ marginTop: 12 }}>
            Order <strong>{outcome.number}</strong> is with the shop.
          </p>
          {outcome.paid ? (
            <p style={{ maxWidth: "58ch" }}>
              Paid: <strong>{money(outcome.paid.totalCents / 100)}</strong> by card.{" "}
              {date === today ? (
                <>
                  It&rsquo;s wanted <strong>today</strong>, so we&rsquo;ll call you to confirm
                  timing.
                </>
              ) : (
                <>
                  We&rsquo;ll have it ready for pickup on <strong>{date}</strong>. If anything
                  about timing needs a word, we&rsquo;ll call you.
                </>
              )}
              {email.trim() ? " Your receipt and a copy of the order are on their way to your email." : ""}
              {outcome.paid.receiptUrl ? (
                <>
                  {" "}
                  <a href={outcome.paid.receiptUrl} target="_blank" rel="noopener noreferrer">
                    Card receipt
                  </a>
                  .
                </>
              ) : null}
            </p>
          ) : (
            <p style={{ maxWidth: "58ch" }}>
              We&rsquo;ll call you at <strong>{phone}</strong> to confirm the details and take
              payment. Nothing has been charged online.
              {email.trim() ? " A copy of the order is on its way to your email." : ""}
            </p>
          )}
          <p style={{ marginTop: 24 }}>
            <a className="btn" href={href("/shop")}>Back to the shop</a>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <div className="wrap" style={{ maxWidth: 860 }}>
        <p className="kicker">Your order</p>
        <h1>Cart</h1>

        {count === 0 ? (
          <>
            <p className="lede">Nothing in it yet.</p>
            <p style={{ marginTop: 24 }}>
              <a className="btn" href={href("/shop")}>
                Browse the shop
              </a>
            </p>
          </>
        ) : (
          <>
            <ul style={{ listStyle: "none", padding: 0, margin: "32px 0 0" }}>
              {items.map(({ product: p, qty }) => (
                <li
                  key={p.slug}
                  style={{
                    display: "flex", gap: 18, alignItems: "center",
                    padding: "18px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap",
                  }}
                >
                  <div style={{ width: 76, flexShrink: 0, borderRadius: 3, overflow: "hidden", border: "1px solid var(--line)" }}>
                    <ProductImage p={p} />
                  </div>

                  <div style={{ flex: "1 1 190px", minWidth: 0 }}>
                    {/* inline-block + padding: a 20px-tall link is a miss-tap
                        on a phone, and this one navigates away from a full cart */}
                    <a
                      href={href(`/product/${p.slug}`)}
                      style={{ fontWeight: 600, textDecoration: "none", color: "var(--ink)", display: "inline-block", padding: "4px 0" }}
                    >
                      {p.name}
                    </a>
                    <p className="muted" style={{ margin: "2px 0 0", fontSize: 15 }}>
                      {money(p.price)} each
                    </p>
                  </div>

                  <label style={{ fontSize: 14.5, display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="muted">Qty</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={qty}
                      /*
                        Ignore anything that does not parse to a real quantity.
                        The old handler passed Number(value) straight through,
                        and clearing the field to retype it produced 0, which
                        setQty treats as removal — so backspacing "2" to type
                        "3" deleted the flowers. Removing is the Remove
                        button's job and only its job.
                      */
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 1) setQty(p.slug, Math.min(99, Math.round(n)));
                      }}
                      style={{ ...field, width: 64, padding: "7px 8px", fontSize: 15 }}
                    />
                  </label>

                  <span style={{ minWidth: 76, textAlign: "right", fontWeight: 600 }}>
                    {money(Math.round(p.price * qty * 100) / 100)}
                  </span>

                  <button
                    type="button"
                    onClick={() => remove(p.slug)}
                    style={{ background: "none", border: 0, font: "inherit", fontSize: 14, color: "var(--rose-ink)", cursor: "pointer", textDecoration: "underline", padding: 4 }}
                  >
                    Remove<span className="sr-only"> {p.name}</span>
                  </button>
                </li>
              ))}
            </ul>

            {(() => {
              const extras = ADD_ON_SLUGS
                .map((s) => bySlug.get(s))
                .filter((p): p is NonNullable<typeof p> => !!p && !lines.some((l) => l.slug === p.slug));
              if (extras.length === 0) return null;
              return (
                <div style={{ padding: "16px 0", borderBottom: "1px solid var(--line)" }}>
                  <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
                    Add a little something
                  </p>
                  {extras.map((p) => (
                    <div key={p.slug} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "5px 0", fontSize: 15 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
                      <span className="muted" style={{ whiteSpace: "nowrap" }}>{money(p.price)}</span>
                      <button
                        type="button"
                        onClick={() => add(p.slug)}
                        style={{ background: "none", border: 0, font: "inherit", fontSize: 14, fontWeight: 600, color: "var(--green)", cursor: "pointer", textDecoration: "underline", padding: "5px 0" }}
                      >
                        Add<span className="sr-only"> {p.name} to your order</span>
                      </button>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "22px 0", fontSize: 20 }}>
              <span style={{ fontFamily: "var(--serif)" }}>Subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <p className="muted" style={{ fontSize: 14.5, marginTop: -8 }}>
              {cfg.cards
                ? "Pickup orders can be paid by card at checkout. Deliveries are confirmed by phone first, payment taken then."
                : "No payment is taken online. We call to confirm every order, arrange delivery, and take payment then."}
            </p>

            <label style={{ display: "block", marginTop: 20 }}>
              <span style={labelText}>
                Card message <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
              </span>
              <textarea
                value={cardMessage}
                onChange={(e) => setCardMessage(e.target.value)}
                rows={3}
                placeholder="Written on the card exactly as you type it, handwriting ours."
                style={{ ...field, maxWidth: 560 }}
              />
            </label>

            {!checkingOut ? (
              <p style={{ marginTop: 24 }}>
                <button className="btn btn--solid" type="button" onClick={() => setCheckingOut(true)}>
                  Continue to checkout
                </button>
              </p>
            ) : (
              <form onSubmit={submit} style={{ marginTop: 28, maxWidth: 560 }}>
                <h2 style={{ fontSize: 24, margin: "0 0 4px" }}>Where it&rsquo;s going</h2>
                <p className="muted" style={{ fontSize: 14.5, margin: "0 0 18px" }}>
                  We&rsquo;ll call to confirm before anything is made or charged.
                </p>

                <div style={{ display: "grid", gap: 16 }}>
                  <label>
                    <span style={labelText}>Your name</span>
                    <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" style={field} />
                  </label>

                  <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                    <label>
                      <span style={labelText}>Phone</span>
                      <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required autoComplete="tel" style={field} />
                    </label>
                    <label>
                      <span style={labelText}>
                        Email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                      </span>
                      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" style={field} />
                    </label>
                  </div>

                  {/* Radios, not a select: two options, both visible, one tap. */}
                  <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend style={labelText}>Delivery or pickup</legend>
                    <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                      {(["delivery", "pickup"] as const).map((f) => (
                        <label key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5, padding: "4px 0" }}>
                          {/* 20px, not the 13px browser default: this gets
                              tapped on a phone at least as often as clicked */}
                          <input
                            type="radio"
                            name="fulfillment"
                            checked={fulfillment === f}
                            onChange={() => setFulfillment(f)}
                            style={{ width: 20, height: 20, accentColor: "var(--green)" }}
                          />
                          {f === "delivery" ? "Deliver it" : `Pickup at the shop`}
                        </label>
                      ))}
                    </div>
                  </fieldset>

                  {delivering && (
                    <>
                      <label>
                        <span style={labelText}>
                          Recipient&rsquo;s name{" "}
                          <span className="muted" style={{ fontWeight: 400 }}>(if not you)</span>
                        </span>
                        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} style={field} />
                      </label>
                      <label>
                        <span style={labelText}>Street address</span>
                        <input value={street} onChange={(e) => setStreet(e.target.value)} required autoComplete="street-address" style={field} />
                      </label>
                      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr minmax(110px, 140px)" }}>
                        <label>
                          <span style={labelText}>Town</span>
                          <input value={town} onChange={(e) => setTown(e.target.value)} required style={field} />
                        </label>
                        <label>
                          <span style={labelText}>Zip</span>
                          <input value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" autoComplete="postal-code" style={field} />
                        </label>
                      </div>
                      {/* ZipCheck's rule: a near miss is a phone call, not a wall.
                          The order still submits; the ticket carries a flag. */}
                      {zip.trim().length === 5 && !zipKnown && (
                        <p className="muted" style={{ fontSize: 14.5, margin: "-6px 0 0" }} aria-live="polite">
                          {zip.trim()} isn&rsquo;t on our published delivery list. Send the order
                          anyway and we&rsquo;ll tell you honestly on the confirm call, or ask us
                          first on <a href={site.phoneHref}>{site.phone}</a>.
                        </p>
                      )}
                    </>
                  )}

                  <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                    <label>
                      <span style={labelText}>{delivering ? "Delivery date" : "Pickup date"}</span>
                      <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required style={field} />
                    </label>
                    <label>
                      <span style={labelText}>
                        Occasion <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                      </span>
                      <select value={occasion} onChange={(e) => setOccasion(e.target.value)} style={field}>
                        <option value="">Choose one</option>
                        {occasions.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {/* The shop's own asks, surfaced exactly when they apply. */}
                  {occasion === "Hospital" && (
                    <p className="muted" style={{ fontSize: 14.5, margin: "-6px 0 0" }}>
                      {site.delivery.hospitalNote} The notes field below is the place.
                    </p>
                  )}
                  {occasion === "Sympathy or funeral" && (
                    <p className="muted" style={{ fontSize: 14.5, margin: "-6px 0 0" }}>
                      {site.delivery.funeralNote}
                    </p>
                  )}

                  <label>
                    <span style={labelText}>
                      Anything else we should know <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                    </span>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={field} />
                  </label>

                  {/* Payment choice: only when the switch is on, and only
                      for pickups (the delivery total still depends on the
                      owner's unanswered delivery-fee question). */}
                  {cfg.cards && !delivering && (
                    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                      <legend style={labelText}>Payment</legend>
                      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                        {(["card", "call"] as const).map((m) => (
                          <label key={m} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5, padding: "4px 0" }}>
                            <input
                              type="radio"
                              name="paymethod"
                              checked={payMethod === m}
                              onChange={() => setPayMethod(m)}
                              style={{ width: 20, height: 20, accentColor: "var(--green)" }}
                            />
                            {m === "card" ? "Pay now by card" : "Pay when we call to confirm"}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {cfg.cards && delivering && (
                    <p className="muted" style={{ fontSize: 14.5, margin: "-6px 0 0" }}>
                      Deliveries are confirmed by phone first and paid then; card at checkout is
                      available for pickup orders.
                    </p>
                  )}

                  {payMethod === "card" && !delivering && (
                    <div style={{ border: "1px solid var(--line)", borderRadius: 3, padding: 14, background: "var(--paper-2)" }}>
                      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", fontSize: 15 }}>
                        <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Subtotal</span>
                          <span>{money(subtotal)}</span>
                        </li>
                        <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Order fee</span>
                          <span>{money(feeCents / 100)}</span>
                        </li>
                        <li style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
                          <span>Total</span>
                          <span>{money(cardTotalCents / 100)}</span>
                        </li>
                      </ul>
                      <div ref={holderRef} />
                    </div>
                  )}
                </div>

                <p style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <button
                    className="btn btn--solid"
                    type="submit"
                    disabled={outcome.state === "sending" || (payMethod === "card" && !delivering && !cardReady)}
                  >
                    {outcome.state === "sending"
                      ? payMethod === "card" ? "Charging…" : "Sending…"
                      : payMethod === "card" && !delivering
                        ? cardReady ? `Pay ${money(cardTotalCents / 100)} and place the order` : "Opening card field…"
                        : "Send the order"}
                  </button>
                  <span className="muted" style={{ fontSize: 14.5 }}>
                    {payMethod === "card" && !delivering
                      ? "Charged once, when you tap the button."
                      : "Nothing is charged online."}
                  </span>
                </p>

                {/* aria-live so the outcome is announced, not just drawn */}
                <div aria-live="polite">
                  {outcome.state === "invalid" && (
                    <p style={{ color: "var(--rose-ink)", fontWeight: 600, marginTop: 10 }}>{outcome.message}</p>
                  )}
                  {outcome.state === "unreached" && (
                    <div className="notice" role="status" style={{ marginTop: 14 }}>
                      <p style={{ margin: "0 0 10px" }}>
                        <strong>
                          {outcome.reason === "unconfigured"
                            ? "Online ordering isn't connected yet, so your order did not reach the shop."
                            : "We couldn't send your order just now, so it did not reach the shop."}
                        </strong>
                      </p>
                      <p style={{ margin: 0 }}>
                        Two routes that do work: call{" "}
                        <a href={site.phoneHref}><strong>{site.phone}</strong></a> or{" "}
                        <a href={mailtoHref}>email the shop</a>. The email opens with everything
                        you just typed already written into it. Nothing to redo.
                      </p>
                    </div>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </section>
  );
}
