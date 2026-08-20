"use client";

/**
 * THE CART.
 *
 * In memory for the length of a visit, deliberately. glaze.md forbids browser storage
 * assumptions we cannot verify, and a demo that persists a cart across sessions
 * invites the question "where is that stored" during a pitch meeting. When this
 * becomes a real store the same interface backs onto Stripe Checkout; nothing above
 * this file changes.
 *
 * Quantities are per slug, never per name: three products share the name "Designer's
 * Choice" and merging them would charge the wrong price.
 */

import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { bySlug, money, type Product } from "@/lib/catalog";

type Line = { slug: string; qty: number };
type Ctx = {
  lines: Line[];
  count: number;
  subtotal: number;
  add: (slug: string, qty?: number) => void;
  setQty: (slug: string, qty: number) => void;
  remove: (slug: string) => void;
  clear: () => void;
  items: { product: Product; qty: number }[];
};

const CartCtx = createContext<Ctx | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<Line[]>([]);

  const add = useCallback((slug: string, qty = 1) => {
    setLines((cur) => {
      const at = cur.findIndex((l) => l.slug === slug);
      if (at === -1) return [...cur, { slug, qty }];
      const next = [...cur];
      next[at] = { ...next[at], qty: next[at].qty + qty };
      return next;
    });
  }, []);

  const setQty = useCallback((slug: string, qty: number) => {
    setLines((cur) =>
      qty <= 0 ? cur.filter((l) => l.slug !== slug) : cur.map((l) => (l.slug === slug ? { ...l, qty } : l)),
    );
  }, []);

  const remove = useCallback((slug: string) => setLines((c) => c.filter((l) => l.slug !== slug)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<Ctx>(() => {
    const items = lines
      .map((l) => ({ product: bySlug.get(l.slug), qty: l.qty }))
      .filter((i): i is { product: Product; qty: number } => Boolean(i.product));
    return {
      lines,
      items,
      count: lines.reduce((n, l) => n + l.qty, 0),
      // Rounded to the cent on every read. Floating point on 28.95 * 3 otherwise
      // prints 86.84999999999999 in a total a customer is about to pay.
      subtotal: Math.round(items.reduce((s, i) => s + i.product.price * i.qty, 0) * 100) / 100,
      add, setQty, remove, clear,
    };
  }, [lines, add, setQty, remove, clear]);

  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}

export function useCart(): Ctx {
  const c = useContext(CartCtx);
  if (!c) throw new Error("useCart must be used inside CartProvider");
  return c;
}

/** The header's cart link. Announces its own count to screen readers. */
export function CartLink({ href }: { href: string }) {
  const { count } = useCart();
  return (
    <a className="btn ghost" href={href} aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart, empty"}>
      Cart{count > 0 ? ` (${count})` : ""}
    </a>
  );
}

export function AddToCart({ slug, name }: { slug: string; name: string }) {
  const { add, lines } = useCart();
  const inCart = lines.find((l) => l.slug === slug)?.qty ?? 0;
  return (
    <div>
      <button className="btn" onClick={() => add(slug)} type="button">
        Order now
      </button>
      {/* aria-live so the confirmation is announced, not just drawn */}
      <p aria-live="polite" className="muted" style={{ margin: "10px 0 0", fontSize: 14.5, minHeight: "1.4em" }}>
        {inCart > 0 ? `${inCart} × ${name} in your cart.` : " "}
      </p>
    </div>
  );
}

export { money };
