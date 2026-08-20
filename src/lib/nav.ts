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
  { label: "Weddings & Events", path: "/weddings" },
  { label: "Celebration of Life", path: "/celebration-of-life" },
  { label: "Greening", path: "/greening" },
  { label: "Delivery", path: "/delivery" },
  { label: "Workshops", path: "/workshops" },
  { label: "Our Shop & Team", path: "/about" },
] as const;
