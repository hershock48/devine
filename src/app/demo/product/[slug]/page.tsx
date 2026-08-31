import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProductImage from "@/components/ProductImage";
import ProductCard from "@/components/ProductCard";
import { AddToCart } from "@/components/Cart";
import { products, bySlug, catBySlug, inCategory, money } from "@/lib/catalog";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";
import { photoFirst } from "@/lib/order";
import ogManifest from "@/lib/og-manifest.json";

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

  /*
    SHARED DESCRIPTIONS GET DISAMBIGUATED, because their catalog reuses copy across
    variants and a search engine sees two pages saying the same thing.

    Five routes were affected: the 6" and 8" Peace Lily carry one description
    between them, and all three "Designer's Choice" carry another. Prefixing the
    name and price is enough to make each unique and is honest — it is the one
    thing that actually differs between them.
  */
  const sharesDesc = products.some((o) => o.slug !== p.slug && o.desc === p.desc);

  const stem = `${p.name}, ${money(p.price)}.`;
  const body = p.desc.startsWith("PLACEHOLDER")
    ? `${cat ? `${cat.name} ` : ""}designed at DeVine's Flowers & Botanicals in Marshall, Michigan, and delivered across ${site.region}.`
    : sharesDesc
      ? p.desc
      : "";

  const raw = body ? `${stem} ${body}` : p.desc;
  const description = raw.length > 155 ? `${raw.slice(0, 152).trimEnd()}...` : raw;

  const title = `${p.name}, ${money(p.price)}`;

  /*
    THE PRODUCT'S OWN PHOTOGRAPH AS ITS LINK CARD, where one exists. The page a
    customer actually texts is this one — "look at this one" — and the proposal
    promises a real photograph on every page a customer might share.

    THE BLOCK IS COMPLETE OR ABSENT, NEVER PARTIAL. link-cards.md: Next does not
    deep-merge openGraph; a page defining a partial block replaces the layout's
    wholesale and silently drops the image. So photographed products declare the
    whole card and everything else declares nothing, inheriting the site card.
    The JPEGs and the manifest come from tools/og-products.mjs; regenerate both
    when photographs land.
  */
  if (!(ogManifest as string[]).includes(p.slug)) return { title, description };

  const img = { url: `/og/product/${p.slug}.jpg`, width: 1200, height: 630, alt: `${p.name} by ${site.name}` };
  return {
    title,
    description,
    openGraph: {
      type: "website",
      siteName: site.name,
      title: `${title} · ${site.name}`,
      description,
      url: "./",
      images: [img],
    },
    twitter: { card: "summary_large_image", title: `${title} · ${site.name}`, description, images: [img.url] },
  };
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
              <AddToCart slug={p.slug} name={p.name} cartHref={href("/cart")} />
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
