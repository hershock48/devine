import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ProductCard from "@/components/ProductCard";
import { categories, catBySlug, inCategory, priceRange, money } from "@/lib/catalog";
import { site } from "@/lib/site";
import { href } from "@/lib/nav";

type Params = { params: Promise<{ category: string }> };

export function generateStaticParams() {
  return categories.map((c) => ({ category: c.slug }));
}

/**
 * Every category gets its own title and description. glaze.md's launch bar requires
 * it per route, and their current category pages have neither: the shop page carries
 * no meta description at all, so Google writes its own summary of the page that takes
 * money.
 *
 * TITLES ARE NOT TEMPLATED FROM THE NAME. `${name} flowers` produced "Plants flowers"
 * and "Gifts & Add Ons flowers", and it produced two pairs of duplicate titles — the
 * wedding and celebration-of-life categories collided with the standalone pages of the
 * same name, which is exactly what a search engine treats as one page done twice.
 * Four categories are named by hand; the rest read correctly from the template.
 */
const TITLE: Record<string, string> = {
  plants: "Plants and dish gardens",
  "gifts-add-ons": "Gifts and add ons",
  wedding: "Wedding classics, ready to order",
  "celebration-of-life": "Sympathy arrangements, ready to order",
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { category } = await params;
  const c = catBySlug.get(category);
  if (!c) return {};
  const [lo, hi] = priceRange(c.slug);
  return {
    title: TITLE[c.slug] ?? `${c.name} flowers`,
    description: `${c.blurb} ${inCategory(c.slug).length} designs from ${money(lo)} to ${money(hi)}, delivered across ${site.region}.`,
  };
}

export default async function CategoryPage({ params }: Params) {
  const { category } = await params;
  const c = catBySlug.get(category);
  if (!c) notFound();

  const items = inCategory(c.slug);
  const [lo, hi] = priceRange(c.slug);

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="kicker">
            <a href={href("/shop")} style={{ color: "inherit" }}>
              Shop
            </a>{" "}
            / {c.name}
          </p>
          <h1>{c.name}</h1>
          <p className="lede">{c.blurb}</p>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="kicker" style={{ margin: 0 }}>
              {items.length} designs &middot; {money(lo)}&ndash;{money(hi)} &middot; sorted by price
            </p>
            <a className="btn" href={href("/delivery")}>
              Delivery area
            </a>
          </div>

          <div className="grid">
            {items.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>

          <div className="notice" style={{ marginTop: "calc(var(--u) * 7)" }}>
            <strong>A note on substitutions.</strong> {site.substitutionPolicy}
          </div>
        </div>
      </section>
    </>
  );
}
