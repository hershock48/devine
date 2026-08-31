import ProductCard from "@/components/ProductCard";
import HeroTrace from "@/components/HeroTrace";
import { bySlug, categories, inCategory, priceRange, money, products } from "@/lib/catalog";
import { site, formatHours } from "@/lib/site";
import { currentSeasonal } from "@/lib/seasons";
import { photoFirst } from "@/lib/order";
import { href } from "@/lib/nav";

/**
 * HOME.
 *
 * THE FLOW, and why it is in this order.
 *
 * Their current homepage opens with a 14-word heading and then prints the same
 * three paragraphs twice, with small wording differences between the copies. The
 * first pass of this rebuild said it once, which was better, but it was still six
 * boxed sections stacked at the same width in the same rhythm: a document, not a
 * shop.
 *
 * The page alternates now. A bleeding photograph, a narrow column of type, a wide
 * grid, a full-width band, a quiet index, a practical close. That alternation is
 * what gives scrolling a cadence, and it is the thing every one of the reference
 * sites does and no template does.
 *
 * Someone visiting a florist is usually buying today, so the shop sits above the
 * story and the delivery question is answered before either.
 *
 * THE PAGE TURNS WITH THE YEAR (lib/seasons.ts): the kicker, the headline's
 * second line, the lede's closing clause and the six featured pieces all come
 * from the current season. The first lede sentence never changes, because it
 * carries the business facts, and the hero photograph stays until there are
 * seasonal photographs to swap in (the standing photo item on the checklist).
 */
export default async function Home() {
  const { season } = await currentSeasonal();
  // photoFirst: this grid is a sample, so her real photographs lead it. The
  // seasonal lists are built half-photographed (see lib/seasons.ts); this puts
  // that half in the front row.
  const featured = photoFirst(season.featuredSlugs.map((s) => bySlug.get(s)!).filter(Boolean));
  return (
    <>
      {/* 1. THE PHOTOGRAPH FIRST, running off the right edge of the viewport. */}
      <section className="hero bleed">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="kicker">{season.kicker}</p>
            <h1>
              Grown, gathered,
              <br />
              {season.headlineTail}
            </h1>
            <p className="lede">
              An independently owned, women operated flower and plant shop. We grow a good
              share of what we arrange and source the rest close by, {season.ledeTail}
            </p>
            <p className="btnrow">
              <a className="btn btn--solid" href={href("/shop")}>
                Shop arrangements
              </a>
              <a className="btn" href={href("/weddings")}>
                Weddings
              </a>
            </p>
          </div>
          <div className="hero-art draws">
            <img
              src="/img/shop/shop-4.webp"
              width={1000}
              height={1100}
              alt="A hand-tied arrangement of purple lisianthus, delphinium and pink alstroemeria, made at DeVine's"
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
            {/* Four blooms out of this exact photograph, drawn on and then let go.
                Renders nothing visible unless the page arms it, and never arms
                under reduced motion. See components/HeroTrace.tsx. */}
            <HeroTrace />
          </div>
        </div>
      </section>

      {/* 2. ONE LINE, WITH AIR AROUND IT. Used once on the whole site. */}
      <section className="section--loose">
        <div className="wrap">
          <p className="statement">
            Arranged this morning, forty feet from the counter you collect them at.
          </p>
          <p className="statement-note">
            No wire service. No call center. The person who made it is the person who
            hands it to you.
          </p>
        </div>
      </section>

      {/* 3. THE SHOP, three columns rather than four. */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="kicker" style={{ margin: 0 }}>
              {season.featureKicker}
            </p>
            <a className="btn" href={href("/shop")}>
              All {products.length} designs
            </a>
          </div>
          <div className="grid">
            {featured.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>

      {/* 4. A FULL-WIDTH BAND, breaking the rhythm before the index. */}
      <figure className="band bleed" style={{ margin: 0 }}>
        <img
          src="/img/shop/shop-3.webp"
          width={1000}
          height={500}
          alt="Peach roses, coral carnations, orange ranunculus and Queen Anne's lace, hand-tied at the shop"
          loading="lazy"
          decoding="async"
        />
        <figcaption>Designed daily, from whatever came in fresh that morning</figcaption>
      </figure>

      {/* 5. OCCASIONS, as an index rather than eight boxes. */}
      <section className="section">
        <div className="wrap">
          <p className="kicker">What are the flowers for?</p>
          <ul className="index">
            {categories.map((c) => {
              const items = inCategory(c.slug);
              const [min] = priceRange(c.slug);
              return (
                <li key={c.slug}>
                  <a href={href(`/shop/${c.slug}`)}>
                    <span className="index-name">{c.name}</span>
                    <span className="index-meta">
                      {items.length} designs &middot; from {money(min)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* 6. THE PRACTICAL CLOSE. */}
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap split split--wide-left" style={{ alignItems: "start" }}>
          <div>
            <p className="kicker">Delivery</p>
            <h2>We come to {site.deliveryTowns.length} towns.</h2>
            <p className="lede">
              {site.delivery.sameDay} From Marshall out to Jackson, Coldwater, Charlotte and
              Battle Creek, across {site.deliveryZips.length} zip codes.
            </p>
            <p className="btnrow">
              <a className="btn" href={href("/delivery")}>
                Check your town
              </a>
            </p>
          </div>
          <div>
            <p className="kicker">The shop</p>
            <ul className="hours">
              {site.hours.map((h) => (
                <li key={h.day}>
                  <span>{h.day}</span>
                  <span className={h.open ? undefined : "closed"}>{formatHours(h)}</span>
                </li>
              ))}
            </ul>
            <p className="muted small" style={{ margin: "18px 0 0" }}>
              {site.address.street}, {site.address.city}. Walk-in orders welcome.{" "}
              {site.address.parking}
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
