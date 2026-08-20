import ProductCard from "@/components/ProductCard";
import { featured, categories, inCategory } from "@/lib/catalog";
import { site, formatHours } from "@/lib/site";
import { href } from "@/lib/nav";

/**
 * HOME.
 *
 * Their current homepage opens with a 14-word heading and then prints the same three
 * paragraphs twice, with small wording differences between the two copies. This says
 * it once.
 *
 * Order is deliberate: what they are, what you can buy, whether they deliver to you,
 * then who they are. Someone visiting a florist is usually buying today, so the shop
 * comes before the story.
 */
export default function Home() {
  return (
    <>
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="wrap split">
          <div>
            <p className="kicker">Marshall, Michigan</p>
            <h1>Flowers grown, gathered and arranged by hand.</h1>
            <p className="lede">
              A full-service, independently owned and women operated flower and plant shop.
              We grow many of our own cuttings and source the rest locally, so what we put in
              your hands is whatever the season is actually doing.
            </p>
            <p style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 28 }}>
              <a className="btn" href={href("/shop")}>
                Shop arrangements
              </a>
              <a className="btn ghost" href={href("/weddings")}>
                Weddings &amp; events
              </a>
            </p>
          </div>
          {/* Their own photograph, not an illustration. The hero is the one image a
              visitor judges a florist on, so it is eager rather than lazy. */}
          <div style={{ maxWidth: 460, marginInline: "auto", width: "100%" }}>
            <img
              src="/img/shop/shop-4.webp"
              width={1000}
              height={1100}
              alt="A hand-tied arrangement of purple lisianthus, delphinium and pink alstroemeria, made at DeVine's"
              style={{ width: "100%", height: "auto", borderRadius: "var(--r)" }}
              loading="eager"
              decoding="async"
            />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <p className="kicker">Ready to send</p>
          <h2>This week from the studio</h2>
          <p className="lede" style={{ marginBottom: 34 }}>
            Designed here, in the shop, from what came in fresh.
          </p>
          <div className="grid">
            {featured.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
          <p style={{ marginTop: 34 }}>
            <a className="btn ghost" href={href("/shop")}>
              See everything
            </a>
          </p>
        </div>
      </section>

      <section
        className="section"
        style={{ background: "var(--paper-2)", borderTop: "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}
      >
        <div className="wrap">
          <p className="kicker">Shop by occasion</p>
          <h2>What are the flowers for?</h2>
          <div className="cols-3" style={{ marginTop: 34 }}>
            {categories.map((c) => {
              const n = inCategory(c.slug).length;
              return (
                <a
                  key={c.slug}
                  className="panel"
                  href={href(`/shop/${c.slug}`)}
                  style={{ textDecoration: "none", color: "inherit", display: "block", background: "var(--paper)" }}
                >
                  <h3 style={{ marginBottom: 8 }}>{c.name}</h3>
                  <p className="muted" style={{ fontSize: 15.5, marginBottom: 10 }}>
                    {c.blurb}
                  </p>
                  <p style={{ margin: 0, fontSize: 14, color: "var(--green)", fontWeight: 600 }}>
                    {n} {n === 1 ? "arrangement" : "arrangements"}
                  </p>
                </a>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap split">
          <div>
            <p className="kicker">Delivery</p>
            <h2>We deliver to {site.deliveryTowns.length} towns.</h2>
            <p className="lede">
              {site.delivery.sameDay} From Marshall out to Jackson, Coldwater, Charlotte and
              Battle Creek, across {site.deliveryZips.length} zip codes.
            </p>
            <p>
              <a className="btn ghost" href={href("/delivery")}>
                Check your town
              </a>
            </p>
          </div>
          <div className="panel">
            <h3 style={{ marginBottom: 14 }}>Shop hours</h3>
            <ul className="hours">
              {site.hours.map((h) => (
                <li key={h.day}>
                  <span>{h.day}</span>
                  <span className={h.open ? undefined : "closed"}>{formatHours(h)}</span>
                </li>
              ))}
            </ul>
            <p className="muted" style={{ fontSize: 15, margin: "16px 0 0" }}>
              Walk-in flower and plant orders are welcome. {site.address.parking}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
