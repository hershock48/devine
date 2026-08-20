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
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="wrap" style={{ maxWidth: 780 }}>
          <p className="kicker">Greening</p>
          <h1>Living things, for rooms that need them.</h1>
          <p className="lede">
            House plants, dish gardens and wind chimes, {money(lo)} to {money(hi)}. Chosen and
            potted here, with care notes that assume you are a normal person and not a
            botanist.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="grid">
            {plants.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ background: "var(--paper-2)", borderTop: "1px solid var(--line)" }}>
        <div className="wrap split">
          <div>
            <p className="kicker">For businesses</p>
            <h2>Corporate plant maintenance</h2>
            <p className="lede">
              We place plants in offices, lobbies and waiting rooms around {site.region}, and
              then we keep them alive. Watering, feeding, rotating, and replacing anything that
              gives up. Your staff do not have to remember, and nobody has to explain the dead
              ficus to a client.
            </p>
            <p>
              <a className="btn" href={`mailto:${site.email}?subject=${encodeURIComponent("Corporate plant maintenance")}`}>
                Ask about a contract
              </a>
            </p>
          </div>
          <div className="panel" style={{ background: "var(--paper)" }}>
            <h3>Also in the building</h3>
            <p className="muted" style={{ fontSize: 15.5 }}>
              The shop on Industrial Road is a multi-business building with interior plants,
              locally crafted gifts and culinary items, plus an open workshop area and the
              floral design studio. On the same corner, by appointment:
            </p>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 15.5 }}>
              {site.neighbors.map((n) => (
                <li key={n} style={{ padding: "3px 0" }}>
                  {n}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </>
  );
}
