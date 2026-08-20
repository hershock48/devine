import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProductImage from "@/components/ProductImage";
import ProductCard from "@/components/ProductCard";
import { AddToCart } from "@/components/Cart";
import { products, bySlug, catBySlug, inCategory, money } from "@/lib/catalog";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";

type Params = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return products.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const p = bySlug.get(slug);
  if (!p) return {};
  return {
    title: `${p.name}, ${money(p.price)}`,
    // Their own description, trimmed to a length Google will actually print.
    description: p.desc.length > 155 ? `${p.desc.slice(0, 152).trimEnd()}...` : p.desc,
  };
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const p = bySlug.get(slug);
  if (!p) notFound();

  const primary = catBySlug.get(p.cats[0]);
  const alsoIn = p.cats.slice(1).map((c) => catBySlug.get(c)).filter(Boolean);
  const more = inCategory(p.cats[0]).filter((x) => x.slug !== p.slug).slice(0, 4);
  const needsCopy = p.desc.startsWith("PLACEHOLDER");

  return (
    <>
      <section className="section" style={{ paddingBottom: 0 }}>
        <div className="wrap split" style={{ alignItems: "start" }}>
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

            <h1 style={{ marginBottom: 12 }}>{p.name}</h1>

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

            <div className="panel" style={{ padding: 20 }}>
              <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 15 }}>Delivery</p>
              <p className="muted" style={{ margin: "0 0 12px", fontSize: 15 }}>
                {site.delivery.sameDay} We deliver to {site.deliveryTowns.length} towns across{" "}
                {site.region}.{" "}
                <a href={href("/delivery")}>Check your town</a>.
              </p>
              {!p.noSubs && (
                <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
                  {site.substitutionPolicy}
                </p>
              )}
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
            <h2>More from {primary?.name}</h2>
            <div className="grid" style={{ marginTop: 26 }}>
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
