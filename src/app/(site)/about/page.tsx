import type { Metadata } from "next";
import { site, formatHours } from "@/lib/site";
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
 *
 * FLOW. The one page on the site whose subject is the place gets the last unused
 * photograph — the dracaena, close enough to be a texture rather than a picture of a
 * plant — as a full-bleed tier between the story and the practical half.
 */
export default function About() {
  return (
    <>
      {/*
        This head used to carry a generated Bloom print beside the headline,
        and a shop-1 band (an out-of-focus dracaena macro) below it. Both cut:
        generated art is a stand-in for products awaiting photographs, and
        promoting it to decoration on the one page that is ABOUT the real
        shop was the wrong instinct dressed up as a layout. A text head is
        how greening, delivery and weddings already open, and it is better
        company than a blurry leaf.
      */}
      <section className="page-head">
        <div className="wrap">
          <p className="kicker">Our shop &amp; team</p>
          <h1>A calming space filled with the earth&rsquo;s blooms and foliage.</h1>
          <p className="lede">
            Independently owned, women operated, and staffed by people who grow a good
            share of what they arrange. We source the rest locally as the seasons provide.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap split" style={{ alignItems: "start" }}>
          <div>
            <p className="kicker">Where to find us</p>
            <h2>We moved next door.</h2>
            <p style={{ fontSize: 21, lineHeight: 1.45, marginBottom: "calc(var(--u) * 2)" }}>
              <strong>{site.address.street}</strong>
              <br />
              {site.address.city}, {site.address.state} {site.address.zip}
            </p>
            <p className="muted">
              On {site.address.crossStreet}. {site.address.parking} Walk-ins are welcome.
              The building also holds interior plants, locally crafted gifts and culinary
              items, an open workshop area and the floral design studio.
            </p>
            <p className="btnrow">
              <a className="btn btn--solid" href={site.phoneHref}>
                Call {site.phone}
              </a>
            </p>
          </div>

          <div className="notes" style={{ gridTemplateColumns: "1fr" }}>
            <div>
              <h3>Hours</h3>
              <ul className="hours" style={{ marginTop: "calc(var(--u) * 1)" }}>
                {site.hours.map((h) => (
                  <li key={h.day}>
                    <span>{h.day}</span>
                    <span className={h.open ? undefined : "closed"}>{formatHours(h)}</span>
                  </li>
                ))}
              </ul>
              <p style={{ marginTop: "calc(var(--u) * 2)" }}>
                <a href={`mailto:${site.email}`}>{site.email}</a>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="kicker" style={{ margin: 0 }}>
              The team
            </p>
          </div>
          <div className="grid grid--four">
            {/*
              Four generated botanical prints used to stand in for portraits,
              which turned "meet the team" into a wall of clip art. A
              typographic monogram is still a placeholder, and it says so
              below, but it reads as a decision instead of a leftover. The
              real portraits drop straight into these tiles.
            */}
            {site.team.map((m) => (
              <div key={m.name}>
                <div
                  aria-hidden="true"
                  style={{
                    aspectRatio: "4 / 5",
                    background: "var(--paper-2)",
                    border: "1px solid var(--line)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <span style={{ fontFamily: "var(--serif)", fontSize: "clamp(44px, 5vw, 64px)", color: "var(--muted)", lineHeight: 1 }}>
                    {m.name.charAt(0)}
                  </span>
                </div>
                <h3 style={{ fontSize: 20, margin: "14px 0 3px" }}>{m.name}</h3>
                <p className="muted small" style={{ margin: 0 }}>
                  {m.role ?? "Role to confirm"}
                </p>
              </div>
            ))}
          </div>
          <div className="notice" style={{ marginTop: "calc(var(--u) * 5)" }}>
            <strong>PLACEHOLDER.</strong> Their current site publishes these four names with
            no titles, so we have not guessed any. Portraits and roles both come from the
            owner and are one edit to <code>lib/site.ts</code>.
          </div>
        </div>
      </section>

      <section className="quiet">
        <div className="wrap">
          <div className="notes">
            <div>
              <h3>Everyday flowers</h3>
              <p>
                Arrangements designed daily from what came in fresh.{" "}
                <a href={href("/shop")}>Shop</a>.
              </p>
            </div>
            <div>
              <h3>Weddings and events</h3>
              <p>
                Custom work, plus flower bar rental at local venues.{" "}
                <a href={href("/weddings")}>More</a>.
              </p>
            </div>
            <div>
              <h3>Greening</h3>
              <p>
                House plants, and plant maintenance for offices.{" "}
                <a href={href("/greening")}>More</a>.
              </p>
            </div>
          </div>

        </div>
      </section>
    </>
  );
}
