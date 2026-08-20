import type { Metadata } from "next";
import { CartProvider } from "@/components/Cart";
import { Header, Footer } from "@/components/Chrome";
import { BreezeOnLoad } from "@/components/Logo";
import { site } from "@/lib/site";

/**
 * The concept site's chrome.
 *
 * title.template gives every route its own title without repeating the shop name in
 * each file. Their current site has four different spellings of their own name across
 * eight page titles, which is the first finding in the proposal. One template makes
 * that impossible here.
 */
export const metadata: Metadata = {
  title: {
    default: `${site.name} · Florist in ${site.town}`,
    template: `%s · ${site.name}`,
  },
  description:
    "A full-service, independently owned flower and plant shop in Marshall, Michigan. Fresh arrangements, weddings, sympathy flowers and same-day local delivery.",
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
      <main id="main">{children}</main>
      <Footer />
      {/* Arms the logo animation. Renders nothing; see components/Logo.tsx for why
          the animation is opt-in rather than the default state. */}
      <BreezeOnLoad />
    </CartProvider>
  );
}
