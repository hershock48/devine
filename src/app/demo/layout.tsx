import type { Metadata } from "next";
import { CartProvider } from "@/components/Cart";
import { Header, Footer } from "@/components/Chrome";
import { BreezeOnLoad } from "@/components/Logo";
import { site } from "@/lib/site";
import { CANONICAL_HOST, OG_IMAGE, localBusinessJsonLd } from "@/lib/seo";

/**
 * The concept site's chrome.
 *
 * title.template gives every route its own title without repeating the shop name in
 * each file. Their current site has four different spellings of their own name across
 * eight page titles, which is the first finding in the proposal. One template makes
 * that impossible here.
 */
export const metadata: Metadata = {
  metadataBase: new URL(CANONICAL_HOST),
  title: {
    default: `${site.name} · Florist in ${site.town}`,
    template: `%s · ${site.name}`,
  },
  description:
    "A full-service, independently owned flower and plant shop in Marshall, Michigan. Fresh arrangements, weddings, sympathy flowers and same-day local delivery.",

  /*
    CANONICAL, ONE LINE, EVERY ROUTE. "./" resolves against metadataBase and the
    CURRENT path, so each of the 74 routes ends up canonical to itself without a
    single per-page declaration. Writing it per page would mean 74 chances to
    point one at the wrong URL.
  */
  alternates: { canonical: "./" },

  /*
    THE CARD IS DECLARED EXACTLY ONCE, HERE, AND NO PAGE MAY OVERRIDE IT.

    link-cards.md names the trap: "Next.js does not deep-merge openGraph. A page
    that defines its own openGraph block replaces the parent's wholesale,
    including the image." One sub-page adding an openGraph.title silently drops
    the card for that route. So pages set `title` and `description` only — both
    of which merge independently — and the image lives here for all of them.

    The image is THEIRS, not ours. link-cards.md's two-card table: the proposal
    card at /pitch/devine/og.jpg wears Glazed Web's argument in Glazed Web's
    colours, and the demo card wears the client's brand entirely, because the
    demo is a full copy of their site and should look like it in every surface
    including this one.
  */
  openGraph: {
    type: "website",
    siteName: site.name,
    title: `${site.name} · Florist in ${site.town}`,
    description: `Flowers, plants and gifts arranged by hand in ${site.town}. Delivered across ${site.region}.`,
    url: "./",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: `${site.name}, a flower and plant shop in ${site.town}.`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} · Florist in ${site.town}`,
    description: `Flowers, plants and gifts arranged by hand in ${site.town}.`,
    images: [OG_IMAGE],
  },

  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      {/* First tab stop on every page. The header carries a logo, five nav items, a
          delivery line, a phone number and a cart, so a keyboard user reaching the
          actual page otherwise tabs through nine controls on every single route. */}
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Header />
      {/*
        LocalBusiness, from lib/site.ts rather than typed out, so it cannot drift
        from what the pages print. launch.md asks for it on the homepage; it costs
        nothing to carry on every route and means a crawler that lands anywhere
        finds the shop's hours and address.
      */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd()) }}
      />
      <main id="main">{children}</main>
      <Footer />
      {/* Arms the logo animation. Renders nothing; see components/Logo.tsx for why
          the animation is opt-in rather than the default state. */}
      <BreezeOnLoad />
    </CartProvider>
  );
}
