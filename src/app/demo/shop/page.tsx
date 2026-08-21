import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { categories, inCategory, priceRange, money, products } from "@/lib/catalog";
import { photoFirst } from "@/lib/order";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";

/**
 * THE SHOP.
 *
 * Their /shop is reachable but is not linked from their main navigation: the nav item
 * labelled "Shop Now" points at the delivery page instead. So the page that takes
 * money is the one page a visitor cannot navigate to. Here it is the first nav item.
 *
 * Their category index is eight thumbnails and nothing else, so a visitor cannot tell
 * what anything costs until they are two clicks deep. Each category here carries its
 * count and its real price range.
 *
 * WHY THE TOP OF THIS PAGE IS A CONTENTS LIST AND NOT EIGHT TILES.
 * It was eight tinted boxes, each with a heading, a blurb and a price line: sixty-odd
 * lines of furniture before a single flower. What a visitor does with that block is
 * scan it for one word and click. That is a contents page, so it is set as one, and
 * the links go to anchors on this page rather than away from it — the sections are
 * right there underneath. The way OUT of each section, to its full category, is the
 * button in its own section head.
 */
export const metadata: Metadata = {
  title: "Shop flowers, plants and gifts",
  description:
    "Fresh arrangements, house plants and gifts from DeVine's Flowers & Botanicals in Marshall, Michigan. Same-day local delivery whenever possible.",
};

export default function Shop() {
  const floor = Math.min(...products.map((p) => p.price));

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="kicker">The shop</p>
          <h1>Everything we make, ready to send.</h1>
          <p className="lede">
            Designed in the studio on Industrial Road, from whatever came in fresh that
            morning.
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="figures" style={{ marginBottom: "calc(var(--u) * 9)" }}>
            <div>
              <b>{products.length}</b>
              <span>Designs in the shop</span>
            </div>
            <div>
              <b>{money(floor)}</b>
              <span>Where it starts</span>
            </div>
            <div>
              <b>{site.deliveryTowns.length}</b>
              <span>Towns we drive to</span>
            </div>
          </div>

          <ul className="index">
            {categories.map((c) => {
              const items = inCategory(c.slug);
              const [lo, hi] = priceRange(c.slug);
              return (
                <li key={c.slug}>
                  <a href={`#${c.slug}`}>
                    <span className="index-name">{c.name}</span>
                    <span className="index-meta">
                      {items.length} designs &middot; {money(lo)}&ndash;{money(hi)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {categories.map((c, i) => (
        <section className="section" key={c.slug} style={{ paddingTop: i === 0 ? 0 : undefined }}>
          <div className="wrap">
            <div className="sec-head">
              <h2 style={{ margin: 0, fontSize: "clamp(28px, 3.2vw, 42px)" }} id={c.slug}>
                {c.name}
              </h2>
              <a className="btn" href={href(`/shop/${c.slug}`)}>
                All {inCategory(c.slug).length}
              </a>
            </div>
            {/* Three, never four. A four-item slice into a three-column grid leaves one
                card alone on a second row, which is the single most common way a
                good grid is spoiled. And photographed first — see lib/order.ts for
                why a sample is allowed to lead with its photographs and a full
                category is not. */}
            <div className="grid">
              {photoFirst(inCategory(c.slug)).slice(0, 3).map((p) => (
                <ProductCard key={`${c.slug}-${p.slug}`} p={p} />
              ))}
            </div>
          </div>
        </section>
      ))}
    </>
  );
}
