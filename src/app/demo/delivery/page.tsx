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
 */
export default function Delivery() {
  return (
    <section className="section">
      <div className="wrap">
        <p className="kicker">Delivery</p>
        <h1>Do we come to you?</h1>
        <p className="lede">
          {site.delivery.sameDay} We deliver to {site.deliveryTowns.length} towns across{" "}
          {site.deliveryZips.length} zip codes in {site.region}.
        </p>

        <ZipCheck />

        <div className="split" style={{ marginTop: 52, alignItems: "start" }}>
          <div>
            <h2>Towns we deliver to</h2>
            <ul className="townlist" style={{ marginTop: 16 }}>
              {site.deliveryTowns.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2>Zip codes</h2>
            <ul className="townlist" style={{ marginTop: 16 }}>
              {site.deliveryZips.map((z) => (
                <li key={z}>{z}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="cols-3" style={{ marginTop: 52 }}>
          <div className="panel">
            <h3>Hospitals</h3>
            <p className="muted" style={{ fontSize: 15.5, marginBottom: 0 }}>
              {site.delivery.hospitalNote}
            </p>
          </div>
          <div className="panel">
            <h3>Funeral homes</h3>
            <p className="muted" style={{ fontSize: 15.5, marginBottom: 0 }}>
              {site.delivery.funeralNote}
            </p>
          </div>
          <div className="panel">
            <h3>Pick up</h3>
            <p className="muted" style={{ fontSize: 15.5, marginBottom: 0 }}>
              Collect from the shop at {site.address.street} during opening hours.{" "}
              {site.address.parking}
            </p>
          </div>
        </div>

        <p style={{ marginTop: 44 }}>
          <a className="btn" href={href("/shop")}>
            Shop arrangements
          </a>
        </p>
      </div>
    </section>
  );
}
