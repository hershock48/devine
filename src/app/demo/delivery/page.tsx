import type { Metadata } from "next";
import ZipCheck from "@/components/ZipCheck";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Flower delivery across Southwest Michigan",
  description:
    "DeVine's delivers fresh flowers and plants to 18 towns and 24 zip codes around Marshall, Michigan, including Battle Creek, Albion, Jackson and Coldwater.",
};

/**
 * DELIVERY.
 *
 * Their page prints 18 towns and 24 zip codes as two flat lists and asks the visitor
 * to scan them. The lists stay, because someone browsing wants to see the range, but
 * the question underneath is "do you come to me" and ZipCheck answers it directly.
 *
 * WHAT THIS PAGE DOES NOT CLAIM: no delivery fee, no order minimum, no same-day
 * cutoff. Their site publishes none of the three, and putting a number in front of a
 * customer that the shop never agreed to is worse than leaving it out. All three are
 * on the README checklist as questions for the owner.
 *
 * Note the hedge in their own same-day language, "whenever possible", is kept. It is
 * a florist's honest caveat and upgrading it to a guarantee would be our invention.
 *
 * FLOW. This was one long .section: a heading, a checker, two lists and three tinted
 * boxes, all at one width with one rhythm. The check is the whole point of the page,
 * so it now sits alone in the tinted tier where nothing competes with it, and the
 * lists — which are reference material, not reading — come after.
 */
export default function Delivery() {
  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="kicker">Delivery</p>
          <h1>Do we come to you?</h1>
          <p className="lede">
            {site.delivery.sameDay} We deliver to {site.deliveryTowns.length} towns across{" "}
            {site.deliveryZips.length} zip codes in {site.region}.
          </p>
        </div>
      </section>

      {/* The one thing this page is for, in its own tier. */}
      <section className="quiet" style={{ paddingBlock: "calc(var(--u) * 9)" }}>
        <div className="wrap">
          <div className="text">
            <ZipCheck />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="figures">
            <div>
              <b>{site.deliveryTowns.length}</b>
              <span>Towns</span>
            </div>
            <div>
              <b>{site.deliveryZips.length}</b>
              <span>Zip codes</span>
            </div>
            <div>
              <b>Same day</b>
              <span>Whenever possible</span>
            </div>
          </div>

          <div className="split" style={{ marginTop: "calc(var(--u) * 9)", alignItems: "start" }}>
            <div>
              <p className="kicker">Towns we deliver to</p>
              <ul className="townlist" style={{ marginTop: "calc(var(--u) * 2)" }}>
                {site.deliveryTowns.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="kicker">Zip codes</p>
              <ul className="townlist" style={{ marginTop: "calc(var(--u) * 2)" }}>
                {site.deliveryZips.map((z) => (
                  <li key={z}>{z}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="notes">
            <div>
              <h3>Hospitals</h3>
              <p>{site.delivery.hospitalNote}</p>
            </div>
            <div>
              <h3>Funeral homes</h3>
              <p>{site.delivery.funeralNote}</p>
            </div>
            <div>
              <h3>Pick up</h3>
              <p>
                Collect from the shop at {site.address.street} during opening hours.{" "}
                {site.address.parking}
              </p>
            </div>
          </div>

          <p className="btnrow" style={{ marginTop: "calc(var(--u) * 8)" }}>
            <a className="btn btn--solid" href={href("/shop")}>
              Shop arrangements
            </a>
            <a className="btn" href={site.phoneHref}>
              Call the shop
            </a>
          </p>
        </div>
      </section>
    </>
  );
}
