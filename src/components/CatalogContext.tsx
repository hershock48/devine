"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { Category, Product } from "@/lib/catalog";

/**
 * THE LIVE CATALOG, HANDED TO CLIENT COMPONENTS (2026-11-05). The server
 * reads it (lib/catalog-live.ts) and a page wrapper puts it here; the cart,
 * the board's item picker, the recipe editor and the reports read it from
 * here instead of importing the static file, so an edit on the Products tab
 * reaches every screen without a deploy.
 *
 * `refreshUrl` is for a screen that stays open all day (the board on the
 * counter): it asks again every minute and whenever the tab comes back to
 * the front, so a price the owner changed at ten is the price quoted at
 * five past, not at the next reload.
 */
type Catalog = { products: Product[]; categories: Category[] };
const Ctx = createContext<Catalog>({ products: [], categories: [] });

const EMPTY: Category[] = [];

export function CatalogProvider({
  products,
  categories = EMPTY,
  refreshUrl,
  children,
}: {
  products: Product[];
  categories?: Category[];
  refreshUrl?: string;
  children: React.ReactNode;
}) {
  const [fetched, setFetched] = useState<Catalog | null>(null);

  useEffect(() => {
    if (!refreshUrl) return;
    let dead = false;
    const pull = async () => {
      try {
        const r = await fetch(refreshUrl, { cache: "no-store" });
        if (!r.ok) return;
        const d = (await r.json()) as Partial<Catalog>;
        if (!dead && Array.isArray(d.products)) setFetched({ products: d.products, categories: Array.isArray(d.categories) ? d.categories : [] });
      } catch {
        /* offline or signed out: keep what the page was handed */
      }
    };
    const timer = setInterval(pull, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", pull);
    return () => {
      dead = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", pull);
    };
  }, [refreshUrl]);

  const value = useMemo(() => fetched ?? { products, categories }, [fetched, products, categories]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Every product, off the menu included (the counter can still sell one by name). */
export function useProducts(): Product[] {
  return useContext(Ctx).products;
}

export function useCategories(): Category[] {
  return useContext(Ctx).categories;
}

/** A slug lookup over the live products, memoized. */
export function useBySlug(): Map<string, Product> {
  const products = useProducts();
  return useMemo(() => new Map(products.map((p) => [p.slug, p])), [products]);
}
