import type { Metadata } from "next";
import Bloom from "@/components/Bloom";
import { site, formatHours, addressOneLine } from "@/lib/site";
import { href } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Our shop and team",
  description:
    "DeVine's Flowers & Botanicals is an independently owned, women operated flower and plant shop at 800 Industrial Rd in Marshall, Michigan.",
};

/**
 * OUR SHOP & TEAM.
 *
 * Their version publishes four portraits with four names and no roles at all, so a
 * visitor cannot tell who to ask for. Roles are NOT invented here: each one is a
 * PLACEHOLDER on the README checklist, to be filled in by the owner in one edit to
 * lib/site.ts.
 *
 * The address block is deliberately emphatic. They moved from 810 to 800 Industrial
 * Road and most of the internet still has them next door, so the page states the
 * address, the cross street and the parking rather than assuming a map pin will do
 * the work.
 */
export default function About() {
  return (
    <>
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="wrap split">
          <div>
            <p className="kicker">Our shop &amp; team</p>
            <h1>A calming space filled with the earth&rsquo;s blooms and foliage.</h1>
            <p className="lede">
              Independently owned, women operated, and staffed by people who grow a good
              share of what they arrange. We source the rest locally as the seasons provide.
            </p>
          </div>
          <div style={{ maxWidth: 400, marginInline: "auto", width: "100%" }}>
            <Bloom
              slug="about-shop"
              desc="mixed greenery eucalyptus fern seasonal garden roses stock solidago cream green"
              name="The DeVine's studio"
              detail
            />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap split" style={{ alignItems: "start" }}>
          <div>
            <h2>Where to find us</h2>
            <p style={{ fontSize: 19 }}>
              <strong>{site.address.street}</strong>
              <br />
              {site.address.city}, {site.address.state} {site.address.zip}
            </p>
            <p className="muted">
              We moved next door. We are now at {site.address.street}, on{" "}
              {site.address.crossStreet}. {site.address.parking}
            </p>
            <p>
              <a className="btn ghost" href={site.phoneHref}>
                Call {site.phone}
              </a>
            </p>
            <p className="muted" style={{ fontSize: 15.5 }}>
              Walk-in flower and plant orders are welcome. The building also holds interior
              plants, locally crafted gifts and culinary items, an open workshop area and the
              floral design studio.
            </p>
          </div>

          <div className="panel">
            <h3 style={{ marginBottom: 14 }}>Hours</h3>
            <ul className="hours">
              {site.hours.map((h) => (
                <li key={h.day}>
                  <span>{h.day}</span>
                  <span className={h.open ? undefined : "closed"}>{formatHours(h)}</span>
                </li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: 15, margin: "16px 0 0" }}>
              <a href={`mailto:${site.email}`}>{site.email}</a>
            </p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2>The team</h2>
          <div className="cols-3" style={{ marginTop: 26 }}>
            {site.team.map((m) => (
              <div key={m.name}>
                <div style={{ border: "1px solid var(--line)", borderRadius: 3, overflow: "hidden", aspectRatio: "4 / 5", background: "var(--paper-2)" }}>
                  <Bloom
                    slug={`team-${m.name}`}
                    desc="soft green foliage eucalyptus fern cream white"
                    name={m.name}
                  />
                </div>
                <h3 style={{ fontSize: 20, margin: "12px 0 2px" }}>{m.name}</h3>
                <p className="muted" style={{ fontSize: 15, margin: 0 }}>
                  {m.role ?? "Role to confirm"}
                </p>
              </div>
            ))}
          </div>
          <div className="notice" style={{ marginTop: 28 }}>
            <strong>PLACEHOLDER.</strong> Their current site publishes these four names with
            no titles, so we have not guessed any. Portraits and roles both come from the
            owner and are one edit to <code>lib/site.ts</code>.
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="panel">
            <h2 style={{ marginTop: 0 }}>What we do</h2>
            <div className="cols-3" style={{ marginTop: 18 }}>
              <div>
                <h3>Everyday flowers</h3>
                <p className="muted" style={{ fontSize: 15.5 }}>
                  Arrangements designed daily from what came in fresh.{" "}
                  <a href={href("/shop")}>Shop</a>.
                </p>
              </div>
              <div>
                <h3>Weddings and events</h3>
                <p className="muted" style={{ fontSize: 15.5 }}>
                  Custom work, plus flower bar rental at local venues.{" "}
                  <a href={href("/weddings")}>More</a>.
                </p>
              </div>
              <div>
                <h3>Greening</h3>
                <p className="muted" style={{ fontSize: 15.5 }}>
                  House plants, and plant maintenance for offices.{" "}
                  <a href={href("/greening")}>More</a>.
                </p>
              </div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 14.5, marginTop: 20 }}>
            {site.name}, {addressOneLine}.
          </p>
        </div>
      </section>
    </>
  );
}
