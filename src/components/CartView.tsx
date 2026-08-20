"use client";

import { useState } from "react";
import { useCart } from "@/components/Cart";
import ProductImage from "@/components/ProductImage";
import { money } from "@/lib/catalog";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";

/**
 * THE CART, AND AN HONEST CHECKOUT.
 *
 * glaze.md is explicit about the failure mode here: "What is not acceptable is a stub
 * that waits half a second and says 'Thanks, we got it' while sending nowhere." So
 * this checkout does not pretend. It states plainly that it is a demonstration, that
 * no card is taken and no order reaches the shop, and it hands over two routes that
 * do work today: the phone and email.
 *
 * The real thing is a small change from here: Stripe hosted Checkout, which takes the
 * card on Stripe's own page so no card number ever touches this site. The cart shape
 * above already matches what that call wants.
 *
 * NOTE ON THE TOTAL: no tax line and no delivery fee. Their site publishes neither a
 * delivery fee nor an order minimum anywhere, and inventing either would put a number
 * in front of a customer that the shop never agreed to. Both are on the README
 * checklist as questions for the owner.
 */
export default function CartView() {
  const { items, subtotal, setQty, remove, count } = useCart();
  const [showDemoNote, setShowDemoNote] = useState(false);

  const orderSummary = items.map((i) => `${i.qty} x ${i.product.name} (${money(i.product.price)})`).join("\n");

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
                    <a href={href(`/product/${p.slug}`)} style={{ fontWeight: 600, textDecoration: "none", color: "var(--ink)" }}>
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
                      onChange={(e) => setQty(p.slug, Number(e.target.value))}
                      style={{ width: 64, padding: "7px 8px", font: "inherit", fontSize: 15, border: "1px solid var(--line)", borderRadius: 3, background: "var(--paper)", color: "var(--ink)" }}
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

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "22px 0", fontSize: 20 }}>
              <span style={{ fontFamily: "var(--serif)" }}>Subtotal</span>
              <strong>{money(subtotal)}</strong>
            </div>
            <p className="muted" style={{ fontSize: 14.5, marginTop: -8 }}>
              Delivery is arranged when we call to confirm. Their current site publishes no
              delivery fee, so this build does not invent one.
            </p>

            <p style={{ marginTop: 24 }}>
              <button className="btn" type="button" onClick={() => setShowDemoNote(true)}>
                Continue to checkout
              </button>
            </p>

            {showDemoNote && (
              <div className="notice" role="status" style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>This is a demonstration, so checkout is switched off.</strong>
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  No card is taken and nothing reaches the shop. On the live site this button
                  opens Stripe&rsquo;s own hosted checkout, where the card is entered on
                  Stripe&rsquo;s page rather than this one. DeVine&rsquo;s would pay Stripe
                  2.9% plus 30&cent; per order and nothing to anybody else.
                </p>
                <p style={{ margin: 0 }}>
                  To order today:{" "}
                  <a href={site.phoneHref}>
                    <strong>{site.phone}</strong>
                  </a>{" "}
                  or{" "}
                  <a
                    href={`mailto:${site.email}?subject=${encodeURIComponent("Flower order")}&body=${encodeURIComponent(`Hello,\n\nI would like to order:\n\n${orderSummary}\n\nSubtotal: ${money(subtotal)}\n\nMy name:\nDelivery address:\nDelivery date:\nCard message:\n`)}`}
                  >
                    email the shop
                  </a>
                  . The email arrives with this order already written into it.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
