import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { inCategory } from "@/lib/catalog";
import { site, formatHours } from "@/lib/site";
import { href } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Celebration of Life flowers",
  description:
    "Sympathy and funeral flowers from DeVine's Flowers & Botanicals in Marshall, Michigan. We coordinate delivery timing directly with the service location.",
};

/**
 * CELEBRATION OF LIFE.
 *
 * The page whose title tag on their current site reads "Devine's Flower And
 * Botanicals" — singular, and not their name.
 *
 * Written for someone having the worst week of their year. No marketing voice, no
 * upsell, the phone number early and large, and the practical questions answered
 * before the products: can you deliver to the funeral home, do you know when the
 * service is, can I just come in and talk to a person.
 *
 * The plants sit alongside the arrangements here on purpose. A peace lily outlasts a
 * service, and their own copy says so.
 */
export default function CelebrationOfLife() {
  const arrangements = inCategory("celebration-of-life");
  const plants = inCategory("plants").filter((p) =>
    /peace lily|dove|angel|memory|wind chime|dish garden/i.test(p.name + p.desc),
  );

  return (
    <>
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="wrap" style={{ maxWidth: 760 }}>
          <p className="kicker">Celebration of Life</p>
          <h1>We can take this part off your hands.</h1>
          <p className="lede">
            Tell us the name of the funeral home and the day of the service, and we will
            handle the timing. If you would rather talk it through with someone, call the shop
            or walk in. There is no wrong way to do this.
          </p>
          <p style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
            <a className="btn" href={site.phoneHref}>
              Call {site.phone}
            </a>
            <a className="btn ghost" href={`mailto:${site.email}`}>
              Email the shop
            </a>
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap split" style={{ alignItems: "start" }}>
          <div className="panel">
            <h3>Delivery to a service</h3>
            <p className="muted" style={{ fontSize: 15.5, marginBottom: 0 }}>
              {site.delivery.funeralNote} You do not need to know the exact time. Give us the
              funeral home and the date and we will call them.
            </p>
          </div>
          <div className="panel">
            <h3>Consultations</h3>
            <p className="muted" style={{ fontSize: 15.5 }}>
              Walk in or make an appointment, during shop hours.
            </p>
            <ul className="hours" style={{ marginTop: 12 }}>
              {site.hours.map((h) => (
                <li key={h.day}>
                  <span>{h.day}</span>
                  <span className={h.open ? undefined : "closed"}>{formatHours(h)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2>Arrangements</h2>
          <div className="grid" style={{ marginTop: 26 }}>
            {arrangements.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2>Something that keeps growing</h2>
          <p className="lede" style={{ marginBottom: 30 }}>
            Cut flowers are for the service. A plant is for the months afterward, when most
            people have stopped asking how the family is doing.
          </p>
          <div className="grid">
            {plants.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
          <p style={{ marginTop: 30 }}>
            <a className="btn ghost" href={href("/greening")}>
              All plants
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
