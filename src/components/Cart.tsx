"use client";

/**
 * THE CART.
 *
 * Held for the length of a visit, in sessionStorage. An earlier version of this
 * comment said "in memory, deliberately" and was wrong: in memory it did not survive
 * a single click, because every link here is a full page load. See the note on the
 * provider. When this becomes a real store the same interface backs onto Stripe
 * Checkout; nothing above this file changes.
 *
 * Quantities are per slug, never per name: three products share the name "Designer's
 * Choice" and merging them would charge the wrong price.
 */

import { createContext, useContext, useMemo, useState, useCallback, useEffect } from "react";
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

const STORE_KEY = "devines.cart.v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<Line[]>([]);

  /*
    THE CART HAS TO SURVIVE A CLICK.

    Every internal link on this site is a plain <a>, so every navigation is a full
    document load and this provider remounts. Held in useState alone the cart was
    emptied by the first click after adding to it, which made /demo/cart incapable
    of ever showing a line item. The audit caught it; I had never navigated between
    pages while testing the cart, which is exactly the kind of thing a green build
    does not tell you.

    sessionStorage rather than localStorage on purpose: a florist cart is a visit,
    not a possession, and a bouquet still sitting in the cart a fortnight later is
    a worse experience than an empty one. It clears when the tab closes.

    Wrapped in try/catch because storage throws rather than returns null in private
    mode on some browsers, and a thrown exception here would take the whole header
    down with it. A cart that forgets is a small problem; a site that white-screens
    is not.

    Read in an effect rather than in useState's initialiser: the server renders with
    an empty cart, so seeding from storage during the first client render would make
    the markup disagree with the server's and React would throw a hydration error.
  */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      // Validate rather than trust: a stale or hand-edited value must not be able
      // to put a NaN quantity or an unknown slug into a subtotal.
      const clean = parsed
        .filter((l): l is Line =>
          !!l && typeof l === "object" &&
          typeof (l as Line).slug === "string" &&
          Number.isFinite((l as Line).qty) &&
          bySlug.has((l as Line).slug))
        .map((l) => ({ slug: l.slug, qty: Math.min(99, Math.max(1, Math.round(l.qty))) }));
      if (clean.length) setLines(clean);
    } catch {
      /* storage unavailable: the cart simply starts empty */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(lines));
    } catch {
      /* nothing to do, and nothing worth breaking the page over */
    }
  }, [lines]);

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
    <a className="head-cart" href={href} aria-label={count ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart, empty"}>
      Cart{count > 0 ? ` (${count})` : ""}
    </a>
  );
}

export function AddToCart({ slug, name }: { slug: string; name: string }) {
  const { add, lines } = useCart();
  const inCart = lines.find((l) => l.slug === slug)?.qty ?? 0;
  return (
    <div>
      <button className="btn btn--solid" onClick={() => add(slug)} type="button">
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
