"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/Cart";
import ProductImage from "@/components/ProductImage";
import { bySlug, money, products } from "@/lib/catalog";
import { deliveryFeeFor, deliveryMinimumFor, site } from "@/lib/site";
import { href } from "@/lib/nav";
import { occasions } from "@/lib/occasions";
import { loadSquareSdk, type BillingContact, type SquareCard } from "@/lib/square/web-sdk";

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
 * its own Convenience fee line before the button quotes the total; the server
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
  /** A card payment was sent and no answer came back: it may have gone
      through. The form stays, the attempt id stays, and a retry is safe. */
  | { state: "unsure"; message: string }
  /** The server says this attempt already charged: the order is in. */
  | { state: "already"; message: string }
  | { state: "unreached"; reason: "unconfigured" | "send-failed" };

/** One id per card attempt, kept until the server gives a definite answer
    (paid, declined, refused), so a retry after a lost answer cannot charge
    twice: the server keys Square's idempotency on it. */
const newAttemptId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

type CardConfig = { cards: boolean; applicationId?: string; locationId?: string; env?: string; feeCents?: number };

/**
 * The cart's add-on strip. Three small things a flower buyer adds at the
 * last moment in a real shop: the chocolates by the register, the tea, the
 * plush. Text-only on purpose (a generated print does not belong at a
 * checkout), full names because the names are hers.
 *
 * THE STRIP NEVER RUNS DRY: it draws from her whole Gifts & Add Ons
 * category, the classic trio first and the rest by price, always showing
 * the next three not already in the cart. Add the chocolates and a tea
 * steps up; add a product to the category later and it surfaces here with
 * zero code changes. The counter always has three little things by the
 * register.
 */
const ADD_ON_PRIORITY = ["petite-box-of-chocolates", "bohemian-breakfast-tea", "lil-lovey"];
const ADD_ON_POOL = (() => {
  const gifts = products.filter((p) => p.cats.includes("gifts-add-ons"));
  return [
    ...ADD_ON_PRIORITY.map((s) => gifts.find((g) => g.slug === s)).filter((p): p is NonNullable<typeof p> => !!p),
    ...gifts.filter((g) => !ADD_ON_PRIORITY.includes(g.slug)).sort((a, b) => a.price - b.price),
  ];
})();

export default function CartView() {
  const { items, subtotal, setQty, remove, count, clear, add, lines } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const attemptRef = useRef<string>("");

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
  const [recipientPhone, setRecipientPhone] = useState("");
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
  /* BILLING, SEPARATE FROM DELIVERY (Katy, 2026-10-06: "put a box where you
     can select same as billing address"). Card payments only. On a
     delivery the box is ticked by default and the delivery address is the
     billing address until someone unticks it; on a pickup there is no
     delivery address, so the fields show on their own. The postal code is
     what Square checks against the card; the rest rides along. */
  const [billingSame, setBillingSame] = useState(true);
  const [billStreet, setBillStreet] = useState("");
  const [billTown, setBillTown] = useState("");
  /* The state too (Kevin, 2026-10-13): a card from Georgia should say so.
     Square checks the zip; the state rides along and prints on the ticket. */
  const [billState, setBillState] = useState<string>(site.address.state);
  const [billZip, setBillZip] = useState("");
  const [payMethod, setPayMethod] = useState<"call" | "card">("call");
  const [cardReady, setCardReady] = useState(false);
  const [cardFailed, setCardFailed] = useState(false);
  const cardRef = useRef<SquareCard | null>(null);
  const holderRef = useRef<HTMLDivElement | null>(null);
  const zipCartRef = useRef<HTMLInputElement | null>(null);
  const zipRef = useRef<HTMLInputElement | null>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement | null>(null);

  /* The confirmation is much shorter than the form it replaces, so the
     browser's kept scroll position landed people in the footer instead of
     on the good news (Kevin's catch). Scroll to the top and move focus to
     the heading, which also makes screen readers announce the change. */
  useEffect(() => {
    if (outcome.state !== "sent") return;
    window.scrollTo({ top: 0 });
    sentHeadingRef.current?.focus();
  }, [outcome.state]);

  /*
    BROWSER AUTOFILL FILLS PIXELS, NOT ALWAYS STATE: Chrome can populate the
    address fields without firing the change events React listens to, so the
    zip looked filled while the fee line never appeared and, worse, the
    state-built payload would have submitted empty fields (Kevin hit the
    visible half: "I have to delete the autofill and retype it"). Two
    defenses: submit reads the DOM through FormData so what the customer
    SEES is what sends, and the zip specifically gets a gentle watcher while
    the checkout is open, because the fee display and the card gate hang off
    it live.
  */
  useEffect(() => {
    const t = setInterval(() => {
      // Whichever zip box is on screen (the cart's before checkout, the
      // address block's after), an autofilled value is read back.
      const dom = (checkingOut ? zipRef.current : zipCartRef.current)?.value;
      if (dom === undefined) return;
      setZip((cur) => (dom !== cur ? dom : cur));
    }, 400);
    return () => clearInterval(t);
  }, [checkingOut]);

  useEffect(() => {
    fetch("/api/checkout/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: CardConfig) => setCfg(j?.cards ? j : { cards: false }))
      .catch(() => setCfg({ cards: false }));
  }, []);

  const delivering0 = fulfillment === "delivery";
  const zipTrim = zip.trim();
  const deliveryFee = delivering0 ? deliveryFeeFor(zipTrim) : undefined;
  const deliveryMin = delivering0 ? deliveryMinimumFor(zipTrim) : 0;
  /** The minimum is a gate (Kevin, 2026-10-13): under it, a delivery
      order cannot be sent at all, paid or not, and the cart says exactly
      how much more qualifies it. Applies whatever the zip; the sheet's
      two numbers are the only two. */
  const belowMin = delivering0 && subtotal < deliveryMin;
  /** THE GAP, NOT THE POLICY (Kevin, 2026-10-13, after reading the
      research): the shops that do this well never state the rule, they
      state the customer's own number, early, with a bar: "$33 more for
      delivery to 49068". The zip is asked in the cart, before checkout,
      because everything hangs on it. The minimums stay Katy's business;
      the gap implies them. One element, shown in the cart and again
      under the zip at checkout. */
  const deliveryNote = !delivering0 ? null : zipTrim.length < 5 ? (
    <p className="muted" style={{ fontSize: 14.5, margin: 0 }}>Enter the zip and we&rsquo;ll price the delivery.</p>
  ) : deliveryFee === undefined ? (
    cfg.cards ? (
      <p style={{ fontSize: 14.5, margin: 0, fontWeight: 600 }} aria-live="polite">
        We don&rsquo;t deliver to {zipTrim} through the website, but give us a call at{" "}
        <a href={site.phoneHref} style={{ whiteSpace: "nowrap" }}>{site.phone}</a> and let&rsquo;s see what we can do. Pickup is always an option.
      </p>
    ) : (
      <p className="muted" style={{ fontSize: 14.5, margin: 0 }} aria-live="polite">
        {zipTrim} isn&rsquo;t on our published delivery list. Send the order anyway and we&rsquo;ll tell you honestly on the confirm call, or ask us first on <a href={site.phoneHref}>{site.phone}</a>.
      </p>
    )
  ) : (
    <div aria-live="polite">
      <div style={{ height: 6, borderRadius: 3, background: "var(--line)", overflow: "hidden", maxWidth: 360 }}>
        <div style={{ height: "100%", width: `${Math.min(100, Math.round((subtotal / deliveryMin) * 100))}%`, background: belowMin ? "var(--rose-ink)" : "var(--green)", transition: "width .3s" }} />
      </div>
      <p style={{ fontSize: 14.5, margin: "6px 0 0", fontWeight: 600, color: belowMin ? "var(--rose-ink)" : "var(--green)" }}>
        {belowMin
          ? <>{money(deliveryMin - subtotal)} more for delivery to {zipTrim}, or choose pickup.</>
          : <>Delivery to {zipTrim}: {money(deliveryFee)}.</>}
      </p>
    </div>
  );
  /** Card payment is offered for pickups always, and for deliveries with a
      priceable zip that clears the minimum (owner's confirmed sheet). */
  const cardAllowed = cfg.cards && (!delivering0 || (deliveryFee !== undefined && !belowMin));

  /* ONLINE ORDERS ARE PAID ONLINE (Kevin, 2026-10-13): with the card
     switch on there is no pay-later choice at all. A delivery the site
     cannot price (a zip off her sheet) is not sent for the shop to sort
     out on a call; it is held, with the phone number. The switch off is
     the kill switch, and then every order is a call, as it was. */
  useEffect(() => {
    setPayMethod(cfg.cards ? "card" : "call");
  }, [cfg.cards]);
  /** A delivery the site cannot price: no zip yet, or one off the sheet. */
  const zipBlocked = cfg.cards && delivering0 && deliveryFee === undefined;

  /* THE CARD FIELD FOLLOWS ITS BOX (review, 2026-10-13). The holder div
     exists only while the checkout is open, the card is the method and
     the order can be charged (a pickup, or a priced delivery over the
     minimum). Square's field is attached when that becomes true and torn
     down when it stops being true, and attached again the next time:
     keyed on exactly the condition that renders the box, so it can never
     be mounted before the box exists (and bail, silently, for good) or
     survive the box unmounting with a dead iframe behind a live button. */
  const cardBoxShown = checkingOut && payMethod === "card" && cardAllowed;
  useEffect(() => {
    if (!cardBoxShown || !cfg.cards || !cfg.applicationId || !cfg.locationId) return;
    let dead = false;
    setCardReady(false);
    setCardFailed(false);
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
          setCardFailed(true);
          setOutcome({ state: "invalid", message: `Card entry did not open. Reload the page and try again, or call the shop at ${site.phone}.` });
        }
      }
    })();
    return () => {
      dead = true;
      cardRef.current?.destroy().catch(() => {});
      cardRef.current = null;
      setCardReady(false);
    };
  }, [cardBoxShown, cfg]);

  /* The single Convenience fee line is the flat 99 cent platform fee
     alone since the 2026-10-06 meeting (the shop's 3% card fee is
     retired; see site.ts). The server charges the same number in the
     order route; Square's own order-total check would catch any drift. */
  const deliveryCents = deliveryFee !== undefined ? Math.round(deliveryFee * 100) : 0;
  // Michigan sales tax on the items, the server's own arithmetic
  // (intake.ts taxFor): never on delivery, never on the fee.
  const taxCents = Math.round(Math.round(subtotal * 100) * site.taxRate);
  const baseCents = Math.round(subtotal * 100) + taxCents + (delivering0 ? deliveryCents : 0);
  const convenienceCents = cfg.feeCents ?? 99;
  const cardTotalCents = baseCents + convenienceCents;

  // Client date, not build date: a statically frozen "today" once sold birds for
  // the wrong year (glaze.md failure log). This runs per visit, in the browser,
  // on the SHOP'S calendar: the board's "today" is Marshall's, and an evening
  // order read in UTC was a day ahead of it.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: site.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const delivering = fulfillment === "delivery";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setOutcome({ state: "sending" });

    // The DOM is the truth for typed fields: autofill can fill inputs
    // without React hearing about it, and what the customer sees in the
    // boxes must be exactly what sends. State is the fallback, and gets
    // synced so the confirmation screen shows the same values.
    const fd = new FormData(e.currentTarget as HTMLFormElement);
    const dom = (k: string, fallback: string) => {
      const v = fd.get(k);
      return typeof v === "string" ? v : fallback;
    };
    const dName = dom("name", name);
    const dPhone = dom("phone", phone);
    const dEmail = dom("email", email);
    const dRecipient = dom("recipient", recipient);
    const dRecipientPhone = dom("recipientPhone", recipientPhone);
    const dStreet = dom("street", street);
    const dTown = dom("town", town);
    const dZip = dom("zip", zip);
    setName(dName); setPhone(dPhone); setEmail(dEmail);
    setRecipient(dRecipient); setRecipientPhone(dRecipientPhone); setStreet(dStreet); setTown(dTown); setZip(dZip);

    // Tokenize first when paying by card: no token, no POST, and the
    // message names what to fix. The card number itself never leaves
    // Square's iframe.
    const useDelivery = delivering && billingSame;
    const billing = payMethod === "card"
      ? useDelivery
        ? { street: dStreet, town: dTown, state: site.address.state, zip: dZip.trim() }
        : { street: dom("billStreet", billStreet), town: dom("billTown", billTown), state: dom("billState", billState).trim().toUpperCase().slice(0, 2), zip: dom("billZip", billZip).trim() }
      : undefined;
    let cardPayload: { sourceId: string; attempt: string } | undefined;
    if (payMethod === "card") {
      try {
        if (!cardRef.current) throw new Error("The card field is not ready yet.");
        if (billing && billing.zip.replace(/\D/g, "").length < 5) throw new Error("The billing zip code is needed for the card.");
        const [givenName, ...rest] = dName.trim().split(/\s+/);
        const billingContact: BillingContact = {
          givenName: givenName || undefined,
          familyName: rest.length ? rest.join(" ") : undefined,
          addressLines: billing?.street ? [billing.street] : undefined,
          locality: billing?.town || undefined,
          administrativeDistrictLevel1: billing?.state || undefined,
          postalCode: billing?.zip || undefined,
          countryCode: "US",
        };
        // The whole verification block, as the SDK requires once any of
        // it is sent: the amount is the card total in dollars as a string.
        const t = await cardRef.current.tokenize({
          intent: "CHARGE",
          amount: (cardTotalCents / 100).toFixed(2),
          currencyCode: "USD",
          billingContact,
          customerInitiated: true,
          sellerKeyedIn: false,
        });
        if (t.status !== "OK" || !t.token) throw new Error(t.errors?.[0]?.message || "The card did not go through. Check the number.");
        if (!attemptRef.current) attemptRef.current = newAttemptId();
        cardPayload = { sourceId: t.token, attempt: attemptRef.current };
      } catch (err) {
        setOutcome({ state: "invalid", message: err instanceof Error ? err.message : "The card did not go through." });
        return;
      }
    }

    const payload = {
      lines: items.map((i) => ({ slug: i.product.slug, qty: i.qty })),
      name: dName, phone: dPhone, email: dEmail, fulfillment,
      recipient: delivering ? dRecipient : "",
      recipientPhone: delivering ? dRecipientPhone : "",
      street: delivering ? dStreet : "",
      town: delivering ? dTown : "",
      zip: delivering ? dZip.trim() : "",
      date, occasion, cardMessage, notes,
      card: cardPayload,
      billing: cardPayload ? billing : undefined,
    };
    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        attemptRef.current = "";
        setOutcome({ state: "sent", number: body.number, paid: body.paid });
        clear();
      } else if (res.status === 400 || res.status === 402 || res.status === 503) {
        // A definite no: nothing was charged, the server says why. The
        // next try is a new attempt.
        attemptRef.current = "";
        setOutcome({ state: "invalid", message: body?.error || "Something in the order needs another look." });
      } else if (res.status === 409 && cardPayload) {
        // This attempt already charged (a doubled send, or the retry after
        // a lost answer). The order is in; nothing to redo.
        setOutcome({ state: "already", message: body?.error || `That payment already went through; your receipt is on its way. If it does not arrive, call the shop at ${site.phone}.` });
      } else if (cardPayload) {
        // Sent, unanswered. The attempt id is kept so a retry cannot be a
        // second charge, and the words say "may have", not "did not".
        setOutcome({
          state: "unsure",
          message: body?.error || `We did not hear back after sending your payment, so your card may or may not have been charged. You can try once more: if the first payment went through, we will say so and not charge again. Or call the shop at ${site.phone}.`,
        });
      } else {
        setOutcome({ state: "unreached", reason: body?.reason === "unconfigured" ? "unconfigured" : "send-failed" });
      }
    } catch {
      // The fetch itself failed: offline, or the site is down. Same honesty,
      // and for a card the same "unsure" (the request may have arrived).
      if (cardPayload) {
        setOutcome({ state: "unsure", message: `The connection dropped after your payment was sent, so your card may or may not have been charged. You can try once more: if the first payment went through, we will say so and not charge again. Or call the shop at ${site.phone}.` });
      } else {
        setOutcome({ state: "unreached", reason: "send-failed" });
      }
    }
  }

  /* Everything the visitor typed, ready to travel by email instead. */
  const orderSummary = items.map((i) => `${i.qty} x ${i.product.name} (${money(i.product.price)})`).join("\n");
  const mailtoBody = [
    "Hello,", "", "I would like to order:", "", orderSummary, "",
    `Subtotal: ${money(subtotal)}`,
    `Sales tax: ${money(taxCents / 100)}`, "",
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
          <h1 ref={sentHeadingRef} tabIndex={-1} style={{ outline: "none" }}>
            It&rsquo;s in.
          </h1>
          <p className="lede" style={{ marginTop: 12 }}>
            Order <strong>{outcome.number}</strong> is with the shop.
          </p>
          {outcome.paid ? (
            <p style={{ maxWidth: "58ch" }}>
              Paid: <strong>{money(outcome.paid.totalCents / 100)}</strong> by card.{" "}
              {date === today ? (
                <>
                  It&rsquo;s wanted <strong>today</strong>, and we&rsquo;ll handle it from here.
                </>
              ) : delivering ? (
                <>
                  We&rsquo;ll deliver on <strong>{date}</strong>. If anything about timing needs
                  a word, we&rsquo;ll call you.
                </>
              ) : (
                <>
                  We&rsquo;ll have it ready for pickup on <strong>{date}</strong>. If anything
                  about timing needs a word, we&rsquo;ll call you.
                </>
              )}
              {/* No link to Square's hosted receipt (Kevin, 2026-10-13): its
                  page carries Square's own rate-your-experience smileys, which
                  record nothing for the shop, and the branded receipt with the
                  card total now goes by email. */}
              {email.trim() ? " Your receipt and a copy of the order are on their way to your email." : ""}
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
              const extras = ADD_ON_POOL
                .filter((p) => !lines.some((l) => l.slug === p.slug))
                .slice(0, 3);
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

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "22px 0 4px", fontSize: 20 }}>
              <span style={{ fontFamily: "var(--serif)" }}>Subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <div className="muted" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "0 0 18px", fontSize: 15 }}>
              <span>Sales tax ({Math.round(site.taxRate * 100)}%)</span>
              <span>{money(taxCents / 100)}</span>
            </div>
            <p className="muted" style={{ fontSize: 14.5, marginTop: -8 }}>
              {cfg.cards
                ? "Paid by card at checkout."
                : "No payment is taken online. We call to confirm every order, arrange delivery, and take payment then."}
            </p>

            {/* Delivery or pickup, and the zip, HERE, before checkout: the
                one fact the price and the gap hang on, asked first. */}
            <fieldset style={{ border: 0, padding: 0, margin: "18px 0 0" }}>
              <legend style={labelText}>Delivery or pickup</legend>
              <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
                {(["delivery", "pickup"] as const).map((f) => (
                  <label key={f} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15.5, padding: "4px 0" }}>
                    <input type="radio" name="fulfillment-cart" checked={fulfillment === f} onChange={() => setFulfillment(f)} style={{ width: 20, height: 20, accentColor: "var(--green)" }} />
                    {f === "delivery" ? "Deliver it" : "Pickup at the shop"}
                  </label>
                ))}
              </div>
            </fieldset>
            {delivering0 ? (
              <div style={{ display: "grid", gap: 10, marginTop: 10, maxWidth: 560 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ ...labelText, display: "inline", margin: 0 }}>Delivery zip</span>
                  <input
                    ref={zipCartRef}
                    name="zip-cart"
                    value={zip}
                    onChange={(e) => setZip(e.target.value)}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                    style={{ ...field, width: 120 }}
                  />
                </label>
                {deliveryNote}
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 14.5, margin: "8px 0 0" }}>Pickup at {site.address.street}. No minimum.</p>
            )}

            <label style={{ display: "block", marginTop: 20 }}>
              <span style={labelText}>
                Card message <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
              </span>
              <textarea
                value={cardMessage}
                onChange={(e) => setCardMessage(e.target.value.slice(0, site.cardMessageMax))}
                rows={3}
                maxLength={site.cardMessageMax}
                placeholder="Printed on the card exactly as you type it."
                style={{ ...field, maxWidth: 560 }}
              />
              {cardMessage.length > 0 && (
                <span className="muted" style={{ display: "block", fontSize: 13, marginTop: 4, textAlign: "right", maxWidth: 560 }}>
                  {cardMessage.length} / {site.cardMessageMax}
                </span>
              )}
            </label>

            {!checkingOut ? (
              <p style={{ marginTop: 24 }}>
                <button className="btn btn--solid" type="button" onClick={() => setCheckingOut(true)}>
                  Continue to checkout
                </button>
              </p>
            ) : (
              <form onSubmit={submit} style={{ marginTop: 28, maxWidth: 560 }}>
                <h2 style={{ fontSize: 24, margin: "0 0 4px" }}>{delivering ? <>Where it&rsquo;s going</> : <>Picking up at the shop</>}</h2>
                <p className="muted" style={{ fontSize: 14.5, margin: "0 0 18px" }}>
                  {cfg.cards
                    ? "Paid by card below; we call only if something about the order needs a word."
                    : "We’ll call to confirm before anything is made or charged."}
                </p>

                <div style={{ display: "grid", gap: 16 }}>
                  {/* Delivery or pickup, and the zip, were asked in the cart
                      just above; the same state drives this form, so the
                      address block opens straight away. Who is ordering
                      comes after where it is going. */}
                  {delivering && (
                    <>
                      <label>
                        <span style={labelText}>
                          Recipient&rsquo;s name{" "}
                          <span className="muted" style={{ fontWeight: 400 }}>(if not you)</span>
                        </span>
                        <input name="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} style={field} />
                      </label>
                      <label>
                        <span style={labelText}>
                          Recipient&rsquo;s phone{" "}
                          <span className="muted" style={{ fontWeight: 400 }}>(optional, for the driver)</span>
                        </span>
                        <input name="recipientPhone" value={recipientPhone} onChange={(e) => setRecipientPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="off" style={field} />
                      </label>
                      <label>
                        <span style={labelText}>Street address</span>
                        <input name="street" value={street} onChange={(e) => setStreet(e.target.value)} required autoComplete="street-address" style={field} />
                      </label>
                      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr minmax(110px, 140px)" }}>
                        <label>
                          <span style={labelText}>Town</span>
                          <input name="town" value={town} onChange={(e) => setTown(e.target.value)} required autoComplete="address-level2" style={field} />
                        </label>
                        <label>
                          <span style={labelText}>Zip</span>
                          <input ref={zipRef} name="zip" value={zip} onChange={(e) => setZip(e.target.value)} required={cfg.cards} inputMode="numeric" autoComplete="postal-code" style={field} />
                        </label>
                      </div>
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

                  <label>
                    <span style={labelText}>Your name</span>
                    <input name="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" style={field} />
                  </label>

                  <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                    <label>
                      <span style={labelText}>Phone</span>
                      <input name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required autoComplete="tel" style={field} />
                    </label>
                    <label>
                      <span style={labelText}>
                        Email <span className="muted" style={{ fontWeight: 400 }}>(for your receipt)</span>
                      </span>
                      <input name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" style={field} />
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

                  {/* One whispered match per occasion, from her own shelves:
                      the plush her catalog already files under new-baby, the
                      tea for a hospital room, the chocolates for celebrations.
                      SYMPATHY DELIBERATELY GETS NOTHING: merchandising grief
                      is how a checkout loses someone forever. The mapping is
                      provisional merchandising, hers to tune. */}
                  {(() => {
                    if (!occasion || occasion === "Sympathy or funeral") return null;
                    const open = ADD_ON_POOL.filter((p) => !lines.some((l) => l.slug === p.slug));
                    const pick =
                      occasion === "New baby"
                        ? open.find((p) => p.cats.includes("new-baby"))
                        : occasion === "Hospital"
                          ? open.find((p) => p.name.toLowerCase().includes("tea"))
                          : open.find((p) => p.slug === "petite-box-of-chocolates");
                    if (!pick) return null;
                    return (
                      <p className="muted" style={{ fontSize: 14.5, margin: "-6px 0 0" }} aria-live="polite">
                        A {pick.name} rides along nicely ({money(pick.price)}).{" "}
                        <button
                          type="button"
                          onClick={() => add(pick.slug)}
                          style={{ background: "none", border: 0, font: "inherit", fontSize: 14.5, fontWeight: 600, color: "var(--green)", cursor: "pointer", textDecoration: "underline", padding: "4px 0" }}
                        >
                          Add it
                        </button>
                      </p>
                    );
                  })()}

                  <label>
                    <span style={labelText}>
                      Anything else we should know <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
                    </span>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={field} />
                  </label>

                  {/* No payment choice: with cards on, every online order
                      is paid by card here (Kevin, 2026-10-13); with cards
                      off, every order is a call. */}

                  {/* Pay-on-call gets its breakdown too (Kevin's ask): the
                      buyer deserves the same arithmetic whichever way the
                      money moves. No Convenience fee row here, honestly:
                      the fee exists only on card payments, and this buyer
                      might pay cash at pickup; the note says which. */}
                  {payMethod === "call" && (!delivering || deliveryFee !== undefined) && (
                    <div style={{ border: "1px solid var(--line)", borderRadius: 3, padding: 14, background: "var(--paper-2)" }}>
                      <ul style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 15 }}>
                        <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Subtotal</span>
                          <span>{money(subtotal)}</span>
                        </li>
                        <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Sales tax ({Math.round(site.taxRate * 100)}%)</span>
                          <span>{money(taxCents / 100)}</span>
                        </li>
                        {delivering && deliveryFee !== undefined && (
                          <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <span>Delivery ({zipTrim})</span>
                            <span>{money(deliveryFee)}</span>
                          </li>
                        )}
                        <li style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--line)", marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
                          <span>Total due</span>
                          <span>{money(baseCents / 100)}</span>
                        </li>
                      </ul>
                      {cfg.cards && (
                        <p className="muted" style={{ fontSize: 13.5, margin: "8px 0 0" }}>
                          Paying by card adds the {money(convenienceCents / 100)} convenience fee; cash does not.
                        </p>
                      )}
                    </div>
                  )}

                  {payMethod === "card" && cardAllowed && (
                    <div style={{ display: "grid", gap: 12 }}>
                      <span style={labelText}>Billing address <span className="muted" style={{ fontWeight: 400 }}>(where the card is registered)</span></span>
                      {delivering && (
                        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, padding: "2px 0" }}>
                          <input
                            type="checkbox"
                            checked={billingSame}
                            onChange={(e) => setBillingSame(e.target.checked)}
                            style={{ width: 20, height: 20, accentColor: "var(--green)" }}
                          />
                          Same as the delivery address
                        </label>
                      )}
                      {(!delivering || !billingSame) && (
                        <>
                          <label>
                            <span style={labelText}>Street address</span>
                            <input name="billStreet" value={billStreet} onChange={(e) => setBillStreet(e.target.value)} required autoComplete="billing street-address" style={field} />
                          </label>
                          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr minmax(64px, 80px) minmax(110px, 140px)" }}>
                            <label>
                              <span style={labelText}>Town</span>
                              <input name="billTown" value={billTown} onChange={(e) => setBillTown(e.target.value)} required autoComplete="billing address-level2" style={field} />
                            </label>
                            <label>
                              <span style={labelText}>State</span>
                              <input name="billState" value={billState} onChange={(e) => setBillState(e.target.value.toUpperCase().slice(0, 2))} required maxLength={2} autoComplete="billing address-level1" style={{ ...field, textTransform: "uppercase" }} />
                            </label>
                            <label>
                              <span style={labelText}>Zip</span>
                              <input name="billZip" value={billZip} onChange={(e) => setBillZip(e.target.value)} required inputMode="numeric" autoComplete="billing postal-code" style={field} />
                            </label>
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {payMethod === "card" && cardAllowed && (
                    <div style={{ border: "1px solid var(--line)", borderRadius: 3, padding: 14, background: "var(--paper-2)" }}>
                      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", fontSize: 15 }}>
                        <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Subtotal</span>
                          <span>{money(subtotal)}</span>
                        </li>
                        <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Sales tax ({Math.round(site.taxRate * 100)}%)</span>
                          <span>{money(taxCents / 100)}</span>
                        </li>
                        {delivering && deliveryFee !== undefined && (
                          <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <span>Delivery ({zipTrim})</span>
                            <span>{money(deliveryFee)}</span>
                          </li>
                        )}
                        <li style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                          <span>Convenience fee</span>
                          <span>{money(convenienceCents / 100)}</span>
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

                {/* A zip off her sheet is a door, not a wall (Kevin,
                    2026-10-13, after the research): the dead button gives
                    way to a call that dials and a switch to pickup that
                    keeps the cart. */}
                {zipBlocked && zipTrim.length >= 5 ? (
                  <p style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                    <a className="btn btn--solid" href={site.phoneHref}>Call {site.phone}</a>
                    <button type="button" onClick={() => setFulfillment("pickup")} style={{ background: "none", border: 0, font: "inherit", fontSize: 15, fontWeight: 600, color: "var(--green)", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
                      Switch to pickup
                    </button>
                  </p>
                ) : (
                <p style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <button
                    className="btn btn--solid"
                    type="submit"
                    disabled={outcome.state === "sending" || belowMin || zipBlocked || cardFailed || (payMethod === "card" && cardAllowed && !cardReady)}
                  >
                    {outcome.state === "sending"
                      ? payMethod === "card" ? "Charging…" : "Sending…"
                      : zipBlocked
                        ? "Enter a delivery zip"
                        : belowMin
                          ? `${money(deliveryMin - subtotal)} more for delivery`
                          : cardFailed
                            ? "Card entry did not open"
                            : payMethod === "card" && cardAllowed
                              ? cardReady ? `Pay ${money(cardTotalCents / 100)} and place the order` : "Opening card field…"
                              : "Send the order"}
                  </button>
                  <span className="muted" style={{ fontSize: 14.5 }}>
                    {zipBlocked
                      ? "The zip prices the delivery."
                      : belowMin
                        ? `${money(deliveryMin - subtotal)} more for delivery, or pickup.`
                        : payMethod === "card" && cardAllowed
                          ? "Charged once, when you tap the button."
                          : "Nothing is charged online."}
                  </span>
                </p>
                )}

                {/* aria-live so the outcome is announced, not just drawn */}
                <div aria-live="polite">
                  {outcome.state === "invalid" && (
                    <p style={{ color: "var(--rose-ink)", fontWeight: 600, marginTop: 10 }}>{outcome.message}</p>
                  )}
                  {outcome.state === "unsure" && (
                    <div className="notice" role="status" style={{ marginTop: 14 }}>
                      <p style={{ margin: 0 }}><strong>{outcome.message}</strong></p>
                    </div>
                  )}
                  {outcome.state === "already" && (
                    <div className="notice" role="status" style={{ marginTop: 14 }}>
                      <p style={{ margin: 0 }}><strong>{outcome.message}</strong></p>
                    </div>
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
