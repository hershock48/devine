import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { inCategory, priceRange, money } from "@/lib/catalog";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Plants and greening",
  description:
    "House plants, dish gardens and corporate plant maintenance from DeVine's Flowers & Botanicals in Marshall, Michigan.",
};

/**
 * GREENING.
 *
 * "Greening" is their word and it stays. It is the nav label on their own site and it
 * covers something a florist page usually does not: they maintain plants in other
 * people's offices, on contract.
 *
 * That service is buried in a sentence on their about page. It is the highest value
 * thing on this page, because it is recurring revenue rather than a one-off sale, so
 * it gets a section and a way to ask about it.
 */
export default function Greening() {
  const plants = inCategory("plants");
  const [lo, hi] = priceRange("plants");

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="kicker">Greening</p>
          <h1>Living things, for rooms that need them.</h1>
          <p className="lede">
            House plants, dish gardens and wind chimes, {money(lo)} to {money(hi)}. Chosen and
            potted here, with care notes written in plain language.
          </p>
        </div>
      </section>

      <figure className="band bleed" style={{ margin: 0 }}>
        <img
          src="/img/shop/shop-2.webp"
          width={1000}
          height={500}
          alt="House plants on the shelves at the shop, philodendron and mixed foliage"
          loading="lazy"
          decoding="async"
        />
        <figcaption>The greening shelves on Industrial Road</figcaption>
      </figure>

      <section className="section">
        <div className="wrap">
          <div className="sec-head">
            <p className="kicker" style={{ margin: 0 }}>
              {plants.length} plants and planters
            </p>
          </div>
          <div className="grid">
            {plants.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>

      <section className="quiet">
        <div className="wrap split split--wide-left" style={{ alignItems: "start" }}>
          <div>
            <p className="kicker">For businesses</p>
            <h2>Corporate plant maintenance</h2>
            <p className="lede">
              We place plants in offices, lobbies and waiting rooms around {site.region}, and
              then we keep them alive. Watering, feeding, rotating, and replacing anything that
              gives up. Your staff do not have to remember, and nobody has to explain the dead
              ficus to a client.
            </p>
            <p className="btnrow">
              <a
                className="btn btn--solid"
                href={`mailto:${site.email}?subject=${encodeURIComponent("Corporate plant maintenance")}`}
              >
                Ask about a contract
              </a>
            </p>
          </div>
          <div className="notes" style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <h3>Also in the building</h3>
              <p>
                The shop shares its building with a few other businesses. On the same corner,
                by appointment:
              </p>
              <ul style={{ marginTop: "calc(var(--u) * 1.5)" }}>
                {site.neighbors.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
