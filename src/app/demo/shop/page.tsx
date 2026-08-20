import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { categories, inCategory, priceRange, money, products } from "@/lib/catalog";
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
 */
export const metadata: Metadata = {
  title: "Shop flowers, plants and gifts",
  description:
    "Fresh arrangements, house plants and gifts from DeVine's Flowers & Botanicals in Marshall, Michigan. Same-day local delivery whenever possible.",
};

export default function Shop() {
  return (
    <>
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="wrap">
          <p className="kicker">The shop</p>
          <h1>Everything we make, ready to send.</h1>
          <p className="lede">
            {products.length} arrangements, plants and gifts, designed in the shop on Industrial
            Road. {site.delivery.sameDay} Delivered across {site.deliveryTowns.length} towns in{" "}
            {site.region}.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cols-3">
            {categories.map((c) => {
              const items = inCategory(c.slug);
              const [lo, hi] = priceRange(c.slug);
              return (
                <a
                  key={c.slug}
                  className="panel"
                  href={href(`/shop/${c.slug}`)}
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  <h3 style={{ marginBottom: 8 }}>{c.name}</h3>
                  <p className="muted" style={{ fontSize: 15.5, marginBottom: 12 }}>
                    {c.blurb}
                  </p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--green)" }}>
                    {items.length} items · {money(lo)} to {money(hi)}
                  </p>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      {categories.map((c) => (
        <section className="section" key={c.slug} style={{ paddingTop: 0 }}>
          <div className="wrap">
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 24 }}>
              <h2 style={{ margin: 0 }} id={c.slug}>
                {c.name}
              </h2>
              <a href={href(`/shop/${c.slug}`)} style={{ fontSize: 15, fontWeight: 600 }}>
                All {inCategory(c.slug).length} &rarr;
              </a>
            </div>
            <div className="grid">
              {inCategory(c.slug).slice(0, 4).map((p) => (
                <ProductCard key={`${c.slug}-${p.slug}`} p={p} />
              ))}
            </div>
          </div>
        </section>
      ))}
    </>
  );
}
