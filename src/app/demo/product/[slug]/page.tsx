import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProductImage from "@/components/ProductImage";
import ProductCard from "@/components/ProductCard";
import { AddToCart } from "@/components/Cart";
import { products, bySlug, catBySlug, inCategory, money } from "@/lib/catalog";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";
import { photoFirst } from "@/lib/order";

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const p = bySlug.get(slug);
  if (!p) return {};

  /*
    A handful of their products carry no description at all, only the substitution
    clause, so the catalog holds a PLACEHOLDER string for them. That string was being
    served to Google as the meta description of a live page — the word PLACEHOLDER, in
    the search result, on the shop. A missing description is a note for the owner; it
    is not something a customer should ever read. These pages get a factual sentence
    built from what we do know until the real copy is written.
  */
  const cat = catBySlug.get(p.cats[0]);
  const description = p.desc.startsWith("PLACEHOLDER")
    ? `${p.name}, ${money(p.price)}. ${cat ? `${cat.name} ` : ""}designed at DeVine's Flowers & Botanicals in Marshall, Michigan, and delivered across ${site.region}.`
    : p.desc.length > 155
      ? `${p.desc.slice(0, 152).trimEnd()}...`
      : p.desc;

  return { title: `${p.name}, ${money(p.price)}`, description };
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const p = bySlug.get(slug);
  if (!p) notFound();

  const primary = catBySlug.get(p.cats[0]);
  const alsoIn = p.cats.slice(1).map((c) => catBySlug.get(c)).filter(Boolean);
  // three, because the grid is three columns: a fourth sits alone on a second row
  const more = photoFirst(inCategory(p.cats[0]).filter((x) => x.slug !== p.slug)).slice(0, 3);
  const needsCopy = p.desc.startsWith("PLACEHOLDER");

  return (
    <>
      {/* The photograph carries more of the page than the paragraph does, so it gets
          more of the width. An even split makes a product page look like a spec
          sheet. */}
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="wrap split split--wide-left" style={{ alignItems: "start" }}>
          <div>
            <ProductImage p={p} detail />
          </div>

          <div>
            <p className="kicker">
              <a href={href("/shop")} style={{ color: "inherit" }}>
                Shop
              </a>
              {primary && (
                <>
                  {" / "}
                  <a href={href(`/shop/${primary.slug}`)} style={{ color: "inherit" }}>
                    {primary.name}
                  </a>
                </>
              )}
            </p>

            {/* Not the display size. The site's h1 is a masthead face, and a product
                name set at 92px in a half-width column breaks into four lines and
                shouts over the photograph it is labelling. */}
            <h1 style={{ fontSize: "clamp(34px, 4vw, 52px)", marginBottom: 12 }}>{p.name}</h1>

            <p style={{ fontSize: 25, fontFamily: "var(--serif)", margin: "0 0 20px" }}>
              {p.regularPrice && (
                <span className="was" style={{ marginRight: 10 }}>
                  {money(p.regularPrice)}
                </span>
              )}
              {money(p.price)}
              {p.regularPrice && (
                <span className="tag" style={{ marginLeft: 12, verticalAlign: "middle" }}>
                  On sale
                </span>
              )}
            </p>

            {needsCopy ? (
              <div className="notice">
                <strong>PLACEHOLDER.</strong> Their shop carries no description for this
                product, only the substitution clause. This copy needs writing with the owner
                before launch.
              </div>
            ) : (
              <p style={{ fontSize: 18, lineHeight: 1.7 }}>{p.desc}</p>
            )}

            <div style={{ margin: "28px 0" }}>
              <AddToCart slug={p.slug} name={p.name} />
            </div>

            <div className="notes" style={{ gridTemplateColumns: "1fr" }}>
              <div>
                <h3>Delivery</h3>
                <p>
                  {site.delivery.sameDay} We deliver to {site.deliveryTowns.length} towns
                  across {site.region}. <a href={href("/delivery")}>Check your town</a>.
                </p>
                {!p.noSubs && <p>{site.substitutionPolicy}</p>}
              </div>
            </div>

            {alsoIn.length > 0 && (
              <p className="muted" style={{ fontSize: 15, marginTop: 20 }}>
                Also in{" "}
                {alsoIn.map((c, i) => (
                  <span key={c!.slug}>
                    {i > 0 && ", "}
                    <a href={href(`/shop/${c!.slug}`)}>{c!.name}</a>
                  </span>
                ))}
                .
              </p>
            )}
          </div>
        </div>
      </section>

      {more.length > 0 && (
        <section className="section">
          <div className="wrap">
            <div className="sec-head">
              <p className="kicker" style={{ margin: 0 }}>
                More from {primary?.name}
              </p>
              {primary && (
                <a className="btn" href={href(`/shop/${primary.slug}`)}>
                  All {inCategory(primary.slug).length}
                </a>
              )}
            </div>
            <div className="grid">
              {more.map((m) => (
                <ProductCard key={m.slug} p={m} />
              ))}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
