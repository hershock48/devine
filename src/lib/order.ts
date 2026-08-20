import manifest from "@/lib/image-manifest.json";

/** True where a real photograph of this product exists in public/img/product/. */
export const hasPhoto = (slug: string): boolean => `product/${slug}` in manifest;

/**
 * PHOTOGRAPHED FIRST — but only where the list is a SAMPLE, never where it is the
 * whole category.
 *
 * 20 of 57 products have photographs. Every truncated list on this site was taking
 * the first three by price, which meant the real flowers were mostly buried on page
 * two of a category while the generated prints did all the selling. On the shop page
 * that produced twenty-four cards of which three were photographs, and it read as
 * wallpaper — which is the single biggest thing standing between this build and
 * looking expensive, and it is a content gap rather than a design one.
 *
 * So: any list that shows only some of a category shows the photographed ones. A full
 * category page stays in price order, because someone reading a whole category is
 * comparing prices and reordering it under them to flatter the photography would be
 * serving us rather than them.
 *
 * The sort is stable — guaranteed by the language since ES2019 — so price order is
 * preserved inside each of the two groups. When the remaining 37 photographs land,
 * this function quietly becomes a no-op.
 */
export function photoFirst<T extends { slug: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(hasPhoto(b.slug)) - Number(hasPhoto(a.slug)));
}
