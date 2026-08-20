import type { Metadata } from "next";
import Bloom from "@/components/Bloom";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Workshops at the shop",
  description:
    "Floral design workshops, seasonal plant events and DIY arranging mornings at DeVine's Flowers & Botanicals in Marshall, Michigan.",
};

/**
 * WORKSHOPS.
 *
 * Their version of this page is called "On-site Events & Blog" and it advertises two
 * things the site does not have. There is an "Upcoming Events" heading with nothing
 * underneath it, and a "Flower Blog" that does not exist: no index, no posts, no post
 * sitemap. A visitor who follows either one gets nothing.
 *
 * So the blog half is gone from this build entirely rather than being carried forward
 * as an empty promise, and the events half is honest about being empty. An empty
 * state that says "nothing scheduled, here is how to hear about the next one" is
 * useful. A heading with a void underneath is not.
 *
 * WHEN THEY HAVE DATES: this list is driven from lib/site.ts, so adding one is a
 * single edit. That is the seam. Named in the README.
 */
const upcoming: { title: string; when: string; detail: string }[] = [
  // Deliberately empty. Their site lists none, and inventing a workshop date would
  // put a customer in a car on a day nothing is happening.
];

export default function Workshops() {
  return (
    <>
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="wrap split">
          <div>
            <p className="kicker">At the shop</p>
            <h1>Come and make something.</h1>
            <p className="lede">
              Flower workshops, seasonal plant events, and mornings spent building an
              arrangement with a cup of coffee going cold beside you. The open workshop area
              sits right next to the design studio, so you are working where the flowers are.
            </p>
          </div>
          <div style={{ maxWidth: 400, marginInline: "auto", width: "100%" }}>
            <Bloom
              slug="workshops"
              desc="garden roses stock solidago daisies mixed greenery pink yellow green seasonal"
              name="A workshop table at DeVine's"
              detail
            />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap" style={{ maxWidth: 760 }}>
          <h2>What is coming up</h2>

          {upcoming.length === 0 ? (
            <div className="panel" style={{ marginTop: 20 }}>
              <p style={{ margin: "0 0 12px", fontSize: 18 }}>
                Nothing on the calendar this minute.
              </p>
              <p className="muted" style={{ marginBottom: 18 }}>
                Workshops are announced a few weeks out and they fill quickly. The fastest way
                to hear about the next one is to follow along, or to call the shop and ask us
                to put your name down.
              </p>
              <p style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: 0 }}>
                <a className="btn" href={site.social.facebook}>
                  Follow on Facebook
                </a>
                <a className="btn ghost" href={site.phoneHref}>
                  Call {site.phone}
                </a>
              </p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, marginTop: 20 }}>
              {upcoming.map((e) => (
                <li key={e.title} className="panel" style={{ marginBottom: 14 }}>
                  <h3 style={{ margin: "0 0 4px" }}>{e.title}</h3>
                  <p style={{ margin: "0 0 6px", color: "var(--green)", fontWeight: 600 }}>{e.when}</p>
                  <p className="muted" style={{ margin: 0, fontSize: 15.5 }}>{e.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2>What a workshop usually is</h2>
          <div className="cols-3" style={{ marginTop: 24 }}>
            <div className="panel">
              <h3>Floral design</h3>
              <p className="muted" style={{ fontSize: 15.5, marginBottom: 0 }}>
                Build an arrangement start to finish and take it home. Our designers show you
                how they actually do it, which is mostly about where you put the first stem.
              </p>
            </div>
            <div className="panel">
              <h3>Seasonal plants</h3>
              <p className="muted" style={{ fontSize: 15.5, marginBottom: 0 }}>
                Pot something up and leave knowing what light it wants and how often it really
                needs water, which is less often than you think.
              </p>
            </div>
            <div className="panel">
              <h3>Private groups</h3>
              <p className="muted" style={{ fontSize: 15.5, marginBottom: 0 }}>
                Birthdays, showers, a team that needs to do something other than a restaurant.
                Ask us what a group of your size would look like.
              </p>
            </div>
          </div>
          <p style={{ marginTop: 30 }}>
            <a className="btn" href={`mailto:${site.email}?subject=${encodeURIComponent("Workshop inquiry")}`}>
              Ask about a private group
            </a>{" "}
            <a className="btn ghost" href={href("/shop")} style={{ marginLeft: 8 }}>
              Or just send flowers
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
