import Link from "next/link";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";

/**
 * The demo's own 404, reached when a product or category slug does not exist —
 * the notFound() calls in product/[slug] and shop/[category] land here. Unlike
 * the root one, this renders inside the demo layout, so the visitor keeps the
 * header, the footer and the cart: they are lost on a page, not lost on the site.
 *
 * The most likely reason to be here is a product link from a text message after
 * the arrangement was renamed or retired, so the way out is the shop, and the
 * phone for the person who was sent here to buy one specific thing.
 */
export const metadata = { title: "Page not found" };

export default function DemoNotFound() {
  return (
    <section className="page-head" style={{ paddingBottom: "calc(var(--u) * 14)" }}>
      <div className="wrap">
        <p className="kicker">404</p>
        <h1>We do not have a page there.</h1>
        <p className="lede">
          If someone sent you a link to a particular arrangement, it may have been
          renamed with the seasons. The shop has everything current, and the people at
          the counter know it by heart.
        </p>
        <p className="btnrow">
          <Link className="btn btn--solid" href={href("/shop")}>
            Browse the shop
          </Link>
          <a className="btn" href={site.phoneHref}>
            Call {site.phone}
          </a>
        </p>
      </div>
    </section>
  );
}
