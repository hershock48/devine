"use client";

import { createContext, useContext, useMemo } from "react";
import type { Category, Product } from "@/lib/catalog";

/**
 * THE LIVE CATALOG, HANDED TO CLIENT COMPONENTS (2026-11-05). The server
 * reads it (lib/catalog-live.ts) and a page wrapper puts it here; the cart,
 * the shop header, the board's item picker, the recipe editor and the
 * reports read it from here instead of importing the static file, so an
 * edit on the Products tab reaches every screen without a deploy.
 */
type Catalog = { products: Product[]; categories: Category[] };
const Ctx = createContext<Catalog>({ products: [], categories: [] });

export function CatalogProvider({ products, categories = [], children }: { products: Product[]; categories?: Category[]; children: React.ReactNode }) {
  const value = useMemo(() => ({ products, categories }), [products, categories]);
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
