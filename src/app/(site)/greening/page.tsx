import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { inCategory, priceRange, money } from "@/lib/catalog";
import { site } from "@/lib/site";
import GreeningInquiry from "@/components/GreeningInquiry";

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

      {/*
        A band used to sit here: shop-2, a leaf macro cropped to 2:1. At that
        crop it read as a blurry green wall, and on a phone it was a full
        screen of it (Kevin: "so ugly", and he was right). The thirteen real
        plant photographs directly below are the page's imagery; a rhythm
        break between a heading and the grid it introduces was never earning
        its space. If a genuine wide shot of the greening shelves ever
        arrives, this is where it goes.
      */}
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
            {/*
              THE FRONT DOOR THE PROPOSAL PROMISED. Section four's argument is that
              Greening is recurring revenue with no way to ask for it, and it names
              the exact fields a business brief needs. A mailto button was the same
              missing door with new paint: it asks the office manager to compose the
              brief themselves, which is the person the proposal says "was going to
              think about calling you and then did not."
            */}
            <GreeningInquiry />
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
