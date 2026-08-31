import "server-only";

import { randomUUID } from "node:crypto";
import { products, type Product } from "@/lib/catalog";
import { square, type SquareConfig } from "./client";

/**
 * Catalog push: our 57 products onto her Square register.
 *
 * THE SKU IS THE KEY. Square assigns its own object ids and our catalog is
 * keyed on slug (three products share the name "Designer's Choice", so name
 * matching is the same trap it was in catalog.ts). The slug is written into
 * each variation's SKU, and every later sync finds its own items by reading
 * SKUs back. No mapping table to maintain, nothing stored that Square does
 * not already hold.
 *
 * WHAT SYNC NEVER TOUCHES: anything in her Square catalog whose SKU is not
 * one of our slugs. She may have items rung at the counter that predate us.
 * Those are hers; deleting or "cleaning up" somebody's live register from a
 * script is how a shop loses a Saturday. Strays are counted and named in the
 * report instead, per glaze.md: no silent caps.
 *
 * Square updates are versioned: an upsert of an existing object must carry
 * the version the server holds or it is refused (409). Versions are read in
 * the same list call that finds the SKUs.
 */

type SquareCatalogVariation = {
  type: "ITEM_VARIATION";
  id: string;
  version?: number;
  item_variation_data?: {
    item_id?: string;
    name?: string;
    sku?: string;
    pricing_type?: string;
    price_money?: { amount?: number; currency?: string };
  };
};

type SquareCatalogItem = {
  type: "ITEM";
  id: string;
  version?: number;
  item_data?: {
    name?: string;
    description_plaintext?: string;
    description?: string;
    variations?: SquareCatalogVariation[];
  };
};

type ListResponse = { objects?: SquareCatalogItem[]; cursor?: string };

export type SyncReport = {
  checked: number;
  created: number;
  updated: number;
  unchanged: number;
  /** Item names in her Square catalog that sync does not manage. Hers. */
  strays: string[];
};

const cents = (dollars: number) => Math.round(dollars * 100);

/** What we want a product to look like on the register. */
function desired(p: Product) {
  return {
    name: p.name,
    // Their own copy, same as the site. Square caps descriptions well above
    // the longest one here (Gayle's Garden, ~500 chars).
    description: p.desc,
    priceCents: cents(p.price),
  };
}

async function listItems(cfg: SquareConfig): Promise<SquareCatalogItem[]> {
  const all: SquareCatalogItem[] = [];
  let cursor: string | undefined;
  do {
    const q = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    const page = await square<ListResponse>(cfg, "GET", `/v2/catalog/list?types=ITEM${q}`);
    all.push(...(page.objects ?? []));
    cursor = page.cursor;
  } while (cursor);
  return all;
}

export async function syncCatalogToSquare(cfg: SquareConfig): Promise<SyncReport> {
  const existing = await listItems(cfg);

  // slug -> the Square item that carries it, found by variation SKU.
  const ours = new Map<string, { item: SquareCatalogItem; variation: SquareCatalogVariation }>();
  const strays: string[] = [];
  for (const item of existing) {
    const variation = (item.item_data?.variations ?? []).find((v) =>
      products.some((p) => p.slug === v.item_variation_data?.sku),
    );
    if (variation) ours.set(variation.item_variation_data!.sku!, { item, variation });
    else strays.push(item.item_data?.name ?? item.id);
  }

  const upserts: unknown[] = [];
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const p of products) {
    const want = desired(p);
    const found = ours.get(p.slug);

    if (found) {
      const { item, variation } = found;
      const same =
        item.item_data?.name === want.name &&
        (item.item_data?.description_plaintext ?? item.item_data?.description ?? "") === want.description &&
        variation.item_variation_data?.price_money?.amount === want.priceCents;
      if (same) {
        unchanged++;
        continue;
      }
      updated++;
      upserts.push({
        type: "ITEM",
        id: item.id,
        version: item.version,
        present_at_all_locations: true,
        item_data: {
          name: want.name,
          description: want.description,
          variations: [
            {
              type: "ITEM_VARIATION",
              id: variation.id,
              version: variation.version,
              item_variation_data: {
                item_id: item.id,
                // Keep whatever variation name the register shows; ours is
                // only set on creation.
                name: variation.item_variation_data?.name ?? "Regular",
                sku: p.slug,
                pricing_type: "FIXED_PRICING",
                price_money: { amount: want.priceCents, currency: "USD" },
              },
            },
          ],
        },
      });
    } else {
      created++;
      // "#" ids are temporary: Square mints real ones and the SKU finds them
      // again next sync.
      upserts.push({
        type: "ITEM",
        id: `#${p.slug}`,
        present_at_all_locations: true,
        item_data: {
          name: want.name,
          description: want.description,
          variations: [
            {
              type: "ITEM_VARIATION",
              id: `#${p.slug}-var`,
              item_variation_data: {
                item_id: `#${p.slug}`,
                name: "Regular",
                sku: p.slug,
                pricing_type: "FIXED_PRICING",
                price_money: { amount: want.priceCents, currency: "USD" },
              },
            },
          ],
        },
      });
    }
  }

  if (upserts.length > 0) {
    // One batch: 57 items is nowhere near Square's 1000-object batch cap.
    await square(cfg, "POST", "/v2/catalog/batch-upsert", {
      idempotency_key: randomUUID(),
      batches: [{ objects: upserts }],
    });
  }

  return { checked: products.length, created, updated, unchanged, strays };
}
