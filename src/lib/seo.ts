import { site } from "@/lib/site";
import { BASE } from "@/lib/nav";

/**
 * SEARCH AND SHARING, in one place, fed from lib/site.ts.
 *
 * Four items on glaze/launch.md's checklist were failing — no Open Graph, no
 * canonical, no LocalBusiness, no sitemap — and they were all the same failure:
 * this project had no site-level metadata block at all. Every fact any of them
 * needs was already modelled in lib/site.ts. It was simply never emitted.
 *
 * THE HOST IS THE SHOP'S OWN DOMAIN. link-cards.md is explicit that
 * metadataBase must be the client's real domain, because pointing it anywhere
 * else "makes every canonical, every sitemap entry and every OG url advertise
 * a duplicate of the site as the original, which is the one SEO fault that
 * actively works against a client." While this was a pitch the host was
 * devine.glazedweb.com and the whole site was noindex; the cutover moved the
 * host here and lifted the noindex in the same change, never one without the
 * other.
 *
 * SITE_URL overrides it (no trailing slash) if the www address is chosen as
 * the main one. Whichever it is must be the address that does NOT redirect,
 * or every canonical points at a hop.
 */
export const CANONICAL_HOST = process.env.SITE_URL?.trim().replace(/\/+$/, "") || "https://devinesflowersandbotanicals.com";

/** The demo's own link card. Theirs, not ours — see link-cards.md's two-card table. */
export const OG_IMAGE = "/og.jpg";

/**
 * LocalBusiness, as a Florist, with the hours and the address launch.md asks for.
 *
 * Written from the constant file rather than typed out, so it cannot drift from
 * what the pages say. If the shop changes its Thursday close, this changes with it.
 *
 * openingHoursSpecification wants 24-hour times and two-letter-plus day URLs;
 * lib/site.ts stores "9:00 am" because that is what the pages print. The
 * conversion lives here rather than in site.ts, because site.ts holds what is
 * true and this file holds what a crawler needs.
 */
function to24(t: string): string {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(t.trim());
  if (!m) return t;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

export function localBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Florist",
    name: site.name,
    description: site.tagline,
    url: `${CANONICAL_HOST}${BASE}`,
    telephone: site.phone,
    email: site.email,
    image: `${CANONICAL_HOST}${OG_IMAGE}`,
    address: {
      "@type": "PostalAddress",
      streetAddress: site.address.street,
      addressLocality: site.address.city,
      addressRegion: site.address.state,
      postalCode: site.address.zip,
      addressCountry: "US",
    },
    // With the state: a bare "Marshall" names towns in several states.
    areaServed: site.deliveryTowns.map((t) => ({ "@type": "City", name: `${t}, Michigan` })),
    sameAs: [site.social.facebook, site.social.instagram, site.social.pinterest],
    openingHoursSpecification: site.hours
      .filter((h) => h.open && h.close)
      .map((h) => ({
        "@type": "OpeningHoursSpecification",
        dayOfWeek: `https://schema.org/${h.day}`,
        opens: to24(h.open as string),
        closes: to24(h.close as string),
      })),
  };
}
