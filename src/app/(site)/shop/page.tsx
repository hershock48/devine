import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { categories, inCategory, priceRange, money } from "@/lib/catalog";
import { photoFirst, hasPhoto } from "@/lib/order";
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

      {/*
        THE FIGURES BLOCK IS GONE from up here. It spent most of a phone's first
        scroll telling the visitor 57 / $12 / 18 before showing a single flower —
        and every one of those numbers already lives in the contents index below
        (counts, prices) or the header strip (towns). On the mobile audit the
        first product photograph sat 1,660px down; the page that takes money was
        opening with furniture. The index IS the opening now.
      */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
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
            {/*
              TWO TREATMENTS, decided by whether the category owns a single real
              photograph. Only Just Because and Plants do (7/10 and 13/13); the
              other six categories are 0-for-anything, so their "sample" was
              three generated prints — six placeholder walls in a row on the
              page that takes money, the pattern the weddings and sympathy pages
              were rebuilt to kill. Those categories now get the same serif
              name-and-price list those pages use: every design present, one tap
              from its page, no fake art. The card grid returns per category the
              day its first photograph lands, automatically.

              For the grid: three, never four. A four-item slice into a
              three-column grid leaves one card alone on a second row. And
              photographed first — lib/order.ts.
            */}
            {inCategory(c.slug).some((p) => hasPhoto(p.slug)) ? (
              <div className="grid">
                {photoFirst(inCategory(c.slug)).slice(0, 3).map((p) => (
                  <ProductCard key={`${c.slug}-${p.slug}`} p={p} />
                ))}
              </div>
            ) : (
              <ul className="index">
                {inCategory(c.slug).map((p) => (
                  <li key={`${c.slug}-${p.slug}`}>
                    <a href={href(`/product/${p.slug}`)}>
                      <span className="index-name">{p.name}</span>
                      <span className="index-meta">{money(p.price)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ))}
    </>
  );
}
