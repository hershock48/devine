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
/*
  THE SHAPE THE PROPOSAL PROMISES: "a workshop is a date, a price, a number of
  seats and a button," and "when a date passes it takes itself off the page." The
  fields are all here so filling one in is the whole job.

  THE SELF-EXPIRY IS DELIBERATELY NOT WIRED YET, and the reason is in glaze.md's
  failure log: `new Date()` in a statically generated page freezes at build time —
  it printed "taking orders for 2027" on a page selling birds for October 2026. A
  date filter on this page only tells the truth if the route renders per request
  (`export const dynamic = "force-dynamic"`). Add that line in the same commit as
  the first real date, never separately, or the page will hold expired workshops
  with a green build and no error anywhere.
*/
const upcoming: {
  title: string;
  date: string; // ISO, e.g. "2026-10-14" — drives the self-expiry when wired
  when: string; // as a person says it: "Tuesday October 14, 6pm"
  price: string;
  seats: number;
  detail: string;
}[] = [
  // Deliberately empty. Their site lists none, and inventing a workshop date would
  // put a customer in a car on a day nothing is happening.
];

export default function Workshops() {
  return (
    <>
      <section className="page-head">
        <div className="wrap split split--wide-left">
          <div>
            <p className="kicker">At the shop</p>
            <h1>Come and make something.</h1>
            <p className="lede">
              Flower workshops, seasonal plant events, and mornings spent building an
              arrangement with a cup of coffee going cold beside you. The open workshop area
              sits right next to the design studio, so you are working where the flowers are.
            </p>
          </div>
          <div style={{ maxWidth: 380, marginInline: "auto", width: "100%" }}>
            <Bloom
              slug="workshops"
              desc="garden roses stock solidago daisies mixed greenery pink yellow green seasonal"
              name="A workshop table at DeVine's"
              detail
            />
          </div>
        </div>
      </section>

      {/* The empty state gets the tinted tier to itself. An empty calendar handled
          honestly is the most interesting thing on this page, so it is not buried in
          a box halfway down a column. */}
      <section className="quiet">
        <div className="wrap">
          <div className="text">
          {upcoming.length === 0 ? (
            <>
              <p className="kicker">What is coming up</p>
              <p className="pull">Nothing on the calendar this minute.</p>
              <p className="pull-note">
                Workshops are announced a few weeks out and they fill quickly. The fastest
                way to hear about the next one is to follow along, or to call the shop and
                ask us to put your name down.
              </p>
              <p className="btnrow">
                <a className="btn btn--solid" href={site.phoneHref}>
                  Call {site.phone}
                </a>
                <a className="btn" href={site.social.facebook}>
                  Follow on Facebook
                </a>
              </p>
            </>
          ) : (
            <>
              <p className="kicker">What is coming up</p>
              <ul className="index" style={{ marginTop: "calc(var(--u) * 3)" }}>
                {upcoming.map((e) => (
                  <li key={e.title}>
                    <div style={{ padding: "calc(var(--u) * 2.6) 0" }}>
                      <span className="index-name" style={{ display: "block" }}>{e.title}</span>
                      <span className="index-meta" style={{ display: "block", marginTop: 8 }}>
                        {e.when} &middot; {e.price} &middot; {e.seats} seats
                      </span>
                      <p className="muted small" style={{ margin: "10px 0 0" }}>{e.detail}</p>
                      <p style={{ margin: "14px 0 0" }}>
                        <a
                          className="btn"
                          href={`mailto:${site.email}?subject=${encodeURIComponent(`Workshop: ${e.title}, ${e.when}`)}`}
                        >
                          Save me a seat
                        </a>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          {/* A kicker on its own, not a .sec-head: the rule a section head draws would
              land directly on top of the rules .notes draws over each column. */}
          <p className="kicker">What a workshop usually is</p>
          <div className="notes" style={{ marginTop: "calc(var(--u) * 4)" }}>
            <div>
              <h3>Floral design</h3>
              <p>
                Build an arrangement start to finish and take it home. Our designers show you
                how they actually do it, which is mostly about where you put the first stem.
              </p>
            </div>
            <div>
              <h3>Seasonal plants</h3>
              <p>
                Pot something up and leave knowing what light it wants and how often it really
                needs water, which is less often than you think.
              </p>
            </div>
            <div>
              <h3>Private groups</h3>
              <p>
                Birthdays, showers, or a team that would like an evening with its hands busy.
                Ask us what a group of your size would look like.
              </p>
            </div>
          </div>
          <p className="btnrow" style={{ marginTop: "calc(var(--u) * 8)" }}>
            <a className="btn" href={`mailto:${site.email}?subject=${encodeURIComponent("Workshop inquiry")}`}>
              Ask about a private group
            </a>
            <a className="btn" href={href("/shop")}>
              Or just send flowers
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
