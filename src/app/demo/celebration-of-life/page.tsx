import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import { inCategory } from "@/lib/catalog";
import { site, formatHours } from "@/lib/site";
import { href } from "@/lib/nav";
import { photoFirst } from "@/lib/order";

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
 *
 * DESIGN, AND WHY THIS PAGE IS THE QUIETEST ONE. Every other page got a rhythm
 * break — a photograph, a tinted tier, a pull line. This one gets no device at all.
 * A page read by someone making funeral arrangements should not perform. It is a
 * short column, a phone number, two practical answers and the flowers.
 */
export default function CelebrationOfLife() {
  const arrangements = inCategory("celebration-of-life");
  const plants = photoFirst(
    inCategory("plants").filter((p) =>
      /peace lily|dove|angel|memory|wind chime|dish garden/i.test(p.name + p.desc),
    ),
  ).slice(0, 6);

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="kicker">Celebration of Life</p>
          <h1>We can take this part off your hands.</h1>
          <p className="lede">
            Tell us the name of the funeral home and the day of the service, and we will
            handle the timing. If you would rather talk it through with someone, call the
            shop or walk in. There is no wrong way to do this.
          </p>
          <p className="btnrow">
            <a className="btn btn--solid" href={site.phoneHref}>
              Call {site.phone}
            </a>
            <a className="btn" href={`mailto:${site.email}`}>
              Email the shop
            </a>
          </p>
          {/*
            THE KELLER LINE, KEPT, AND DEMOTED ON PURPOSE. The proposal promises
            both halves in one sentence: "The Keller line stays, because it belongs
            on that page. It stops being the heading." Their current site sets it AS
            the h1, which is the finding; a build that dropped it would contradict
            our own letter on the page the letter links to.

            It closes the opening rather than interrupting it: heading, then the
            practical paragraph and the two ways to reach a person, THEN the line —
            because the visitor this page is written for needs the phone number
            before they need the poetry, and the page's own comment says so.
          */}
          <p className="epigraph" style={{ marginTop: "calc(var(--u) * 6)" }}>
            &ldquo;What we have once enjoyed deeply we can never lose. All that we love
            deeply becomes a part of us.&rdquo;
            <span>Helen Keller</span>
          </p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="notes notes--2">
            <div>
              <h3>Delivery to a service</h3>
              <p>
                {site.delivery.funeralNote} You do not need to know the exact time. Give us
                the funeral home and the date and we will call them.
              </p>
            </div>
            <div>
              <h3>Coming in to talk</h3>
              <p>Walk in or make an appointment, during shop hours.</p>
              <ul className="hours" style={{ marginTop: "calc(var(--u) * 2)" }}>
                {site.hours.map((h) => (
                  <li key={h.day}>
                    <span>{h.day}</span>
                    <span className={h.open ? undefined : "closed"}>{formatHours(h)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="kicker" style={{ margin: 0 }}>
              Arrangements
            </p>
            <a className="btn" href={href("/shop/celebration-of-life")}>
              All {arrangements.length}
            </a>
          </div>
          <div className="grid">
            {arrangements.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="kicker" style={{ margin: 0 }}>
              Something that keeps growing
            </p>
            <a className="btn" href={href("/greening")}>
              All plants
            </a>
          </div>
          <p className="lede" style={{ marginBottom: "calc(var(--u) * 5)" }}>
            Cut flowers are for the service. A plant is for the months afterward, when most
            people have stopped asking how the family is doing.
          </p>
          <div className="grid">
            {plants.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
