import type { MetadataRoute } from "next";
import { categories, products } from "@/lib/catalog";
import { NAV, FOOTER_ONLY, href } from "@/lib/nav";
import { CANONICAL_HOST } from "@/lib/seo";

/**
 * The sitemap, generated from the same data the pages are.
 *
 * launch.md asks for one and there was none. Writing it by hand would mean a list
 * of 74 URLs that goes stale the first time a product is added, so it is derived:
 * the nav, the footer-only pages, every category and every product all come from
 * lib/nav.ts and lib/catalog.ts. Add a product and it appears here.
 *
 * WHY THIS EXISTS ON A NOINDEX HOST AT ALL. A sitemap is not an instruction to
 * index, it is a map. The noindex header and the metadata robots block are what
 * keep this build out of results, and they keep working. What this buys today is
 * that the map is correct and derived on the day the noindex comes off, rather
 * than being written in a hurry at launch, which is when a hand-typed list of 74
 * URLs would be at its most wrong.
 *
 * No `lastModified`. It would either be `new Date()`, which glaze.md's failure log
 * names specifically — a date in a statically generated page freezes at build time
 * and then lies — or a hand-maintained date per route, which nobody maintains. An
 * absent field is better than a wrong one.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const url = (path: string) => `${CANONICAL_HOST}${href(path)}`;

  const pages = [
    { url: url(""), priority: 1 },
    ...[...NAV, ...FOOTER_ONLY].map((n) => ({ url: url(n.path), priority: 0.8 })),
    ...categories.map((c) => ({ url: url(`/shop/${c.slug}`), priority: 0.7 })),
    ...products.map((p) => ({ url: url(`/product/${p.slug}`), priority: 0.6 })),
  ];

  // The cart is a UI state, not a page anyone should arrive at from a search.
  return pages.filter((p) => !p.url.endsWith("/cart"));
}
