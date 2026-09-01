import manifest from "@/lib/image-manifest.json";

/** True where a real photograph of this product exists in public/img/product/. */
export const hasPhoto = (slug: string): boolean => `product/${slug}` in manifest;

/**
 * PHOTOGRAPHED FIRST, everywhere a grid renders.
 *
 * 20 of 57 products have photographs. Every truncated list on this site was taking
 * the first three by price, which meant the real flowers were mostly buried on page
 * two of a category while the generated prints did all the selling. On the shop page
 * that produced twenty-four cards of which three were photographs, and it read as
 * wallpaper — which is the single biggest thing standing between this build and
 * looking expensive, and it is a content gap rather than a design one.
 *
 * RETRACTED, the sample-only rule. This comment used to exempt full category pages,
 * arguing that a category reader is comparing prices and reordering under them to
 * flatter the photography serves us rather than them. The mobile audit showed what
 * that argument buys: Birthday opened with four generated prints in a row, because
 * price-ascending seats the unphotographed $55 pieces first — a wall of stand-in
 * art as a category's opening image, the exact pattern the weddings and sympathy
 * pages were rebuilt to kill. A flower customer buys the photograph; a placeholder
 * cannot inform any comparison, so leading with real work serves the reader too.
 * Price order is untouched WITHIN each group, and the category page states its
 * range so price comparison loses nothing.
 *
 * The sort is stable — guaranteed by the language since ES2019 — so price order is
 * preserved inside each of the two groups. When the remaining 37 photographs land,
 * this function quietly becomes a no-op.
 */
export function photoFirst<T extends { slug: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(hasPhoto(b.slug)) - Number(hasPhoto(a.slug)));
}
