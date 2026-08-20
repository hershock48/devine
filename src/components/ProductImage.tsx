import Bloom from "./Bloom";
import manifest from "@/lib/image-manifest.json";
import type { Product } from "@/lib/catalog";

/**
 * ONE PLACE THAT DECIDES WHAT GOES IN THE FRAME.
 *
 * A real photograph where we have one, the generated botanical print where we do
 * not. 20 of 57 products have photographs today, so both paths are live at once and
 * the shop has to look deliberate either way rather than half-finished.
 *
 * Nothing above this component knows which is which, so the day the remaining 37
 * photographs land, they are dropped into public/img/product/, the manifest is
 * regenerated, and every page picks them up with no code change.
 *
 * WIDTH AND HEIGHT ARE ALWAYS STATED, taken from the manifest rather than assumed.
 * An <img> with no dimensions reflows the page when it loads, and the launch bar is
 * CLS under 0.1. This is also why the manifest records real pixel sizes instead of
 * the component guessing an aspect ratio.
 *
 * srcSet gives the browser the 400px card image or the 1000px detail image. A phone
 * loading a twelve-item grid otherwise downloads twelve full-size photographs.
 */

const has = (key: string): key is keyof typeof manifest => key in manifest;

export default function ProductImage({
  p,
  detail = false,
}: {
  p: Product;
  detail?: boolean;
}) {
  const key = `product/${p.slug}`;

  if (!has(key)) {
    return <Bloom slug={p.slug} desc={p.desc} name={p.name} detail={detail} />;
  }

  const { w, h } = manifest[key];
  return (
    <img
      src={`/img/${key}.webp`}
      srcSet={`/img/${key}-sm.webp 400w, /img/${key}.webp ${w}w`}
      sizes={detail ? "(max-width: 780px) 100vw, 560px" : "(max-width: 400px) 50vw, 280px"}
      width={w}
      height={h}
      alt={`${p.name} by DeVine's Flowers & Botanicals`}
      loading={detail ? "eager" : "lazy"}
      decoding="async"
    />
  );
}

/** True where a real photograph exists. Used to put photographed items first. */
export function hasPhoto(slug: string): boolean {
  return `product/${slug}` in manifest;
}

/** The shop's own atmosphere photographs, for pages that are not a product. */
export function shopPhoto(n: number) {
  const key = `shop/shop-${n}`;
  return has(key) ? { src: `/img/${key}.webp`, ...manifest[key] } : null;
}

export function logo() {
  const key = "brand/logo";
  return has(key) ? { src: `/img/${key}.webp`, ...manifest[key] } : null;
}
