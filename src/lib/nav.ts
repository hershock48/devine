/**
 * ROUTING PREFIX.
 *
 * The concept build lives under /demo because the root of this host serves the
 * proposal. Every internal link goes through href() so that the day DeVine's signs,
 * moving the site to the root is one edit here plus moving the folder, rather than a
 * hunt through every component for a hardcoded "/demo".
 */
export const BASE = "/demo";

export const href = (path = "") => `${BASE}${path}`;

/**
 * Their own nav, kept in their own order and mostly in their own words. Two changes,
 * both deliberate:
 *   - their "Shop Now" points at /flower-and-plant-delivery/ rather than the shop,
 *     which is why the shop is unreachable from their main nav. Ours points at /shop.
 *   - "On-site Events & Blog" loses the blog half, because the blog it promises does
 *     not exist. A nav item that leads nowhere is worse than no nav item.
 */
export const NAV = [
  { label: "Shop", path: "/shop" },
  { label: "Weddings", path: "/weddings" },
  { label: "Sympathy", path: "/celebration-of-life" },
  { label: "Greening", path: "/greening" },
  { label: "Visit", path: "/about" },
] as const;

/**
 * Not in the top strip, and deliberately.
 *
 * Seven items at 17px made a 687px-wide nav and a 151px-tall header, which is
 * what a directory looks like rather than a shop. The florists whose sites read
 * as expensive carry two to five: Saipua's whole header is "The Farm" and "Shop",
 * with Story, Contact, Newsletter and the Journal all pushed to the footer.
 *
 * These two pages are not less important, they are reached where they are
 * actually wanted: delivery from the header's own delivery line, from every
 * product page and from the homepage; workshops from the footer and from Visit.
 * A nav item is not the only way to reach a page, and treating it as one is how
 * headers end up with eleven things in them.
 */
export const FOOTER_ONLY = [
  { label: "Delivery", path: "/delivery" },
  { label: "Workshops", path: "/workshops" },
] as const;
