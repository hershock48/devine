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
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { category } = await params;
  const c = catBySlug.get(category);
  if (!c) return {};
  const [lo, hi] = priceRange(c.slug);
  return {
    title: `${c.name} flowers`,
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
    <section className="section">
      <div className="wrap">
        <p className="kicker">
          <a href={href("/shop")} style={{ color: "inherit" }}>
            Shop
          </a>{" "}
          / {c.name}
        </p>
        <h1>{c.name}</h1>
        <p className="lede">{c.blurb}</p>
        <p className="muted" style={{ fontSize: 15, marginBottom: 38 }}>
          {items.length} designs, {money(lo)} to {money(hi)}. Sorted by price.
        </p>

        <div className="grid">
          {items.map((p) => (
            <ProductCard key={p.slug} p={p} />
          ))}
        </div>

        <div className="notice" style={{ marginTop: 44 }}>
          <strong>A note on substitutions.</strong> {site.substitutionPolicy}
        </div>
      </div>
    </section>
  );
}
