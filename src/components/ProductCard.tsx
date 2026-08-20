import ProductImage from "./ProductImage";
import { money, type Product } from "@/lib/catalog";
import { href } from "@/lib/nav";

/**
 * One product in a grid.
 *
 * The whole card is a single link. A card with the image, the title and a separate
 * "view" link is three tab stops for one destination, and it reads as three items to
 * a screen reader.
 */
export default function ProductCard({ p }: { p: Product }) {
  return (
    <a className="card" href={href(`/product/${p.slug}`)}>
      <div className="frame">
        <ProductImage p={p} />
      </div>
      <h3>{p.name}</h3>
      <p className="price">
        {p.regularPrice ? (
          <>
            <span className="was">{money(p.regularPrice)}</span>
            {money(p.price)}
          </>
        ) : (
          money(p.price)
        )}
      </p>
    </a>
  );
}
