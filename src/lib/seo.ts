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
 * THE HOST IS A PITCH HOST AND THAT IS A DELIBERATE, TEMPORARY ANSWER.
 * link-cards.md is explicit that metadataBase must be the client's real domain,
 * because pointing it anywhere else "makes every canonical, every sitemap entry
 * and every OG url advertise a duplicate of the site as the original, which is
 * the one SEO fault that actively works against a client." That danger is real
 * and it is neutralised here by the whole host being noindex, header and meta
 * both. But it comes back the moment the noindex is lifted, so:
 *
 *   THE DAY DEVINE'S SIGNS, CANONICAL_HOST becomes their own domain. It is on
 *   the README checklist. Do not lift the noindex without doing this first.
 */
export const CANONICAL_HOST = "https://devine.glazedweb.com";

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
    areaServed: site.deliveryTowns.map((t) => ({ "@type": "City", name: t })),
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
