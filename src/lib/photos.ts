import type { Product } from "@/lib/catalog";
import { getCatalog } from "@/lib/catalog-live";
import { hasAnyPhoto } from "@/lib/order";

/**
 * THE PHOTO LIST: every catalog product without a real photograph, in the
 * order that helps the shop most, for the owner's upload page at /photos.
 *
 * DERIVED, NEVER TYPED. The list is products minus the image manifest, so the
 * moment a photograph lands in public/img/product/ and the manifest, its row
 * leaves this list on the next deploy without anyone editing anything. When
 * the last one lands, the page says so and the proposal link can retire.
 *
 * The Designer's Choice three are excluded on purpose: they are whatever she
 * designs that day, so a photo is optional by definition. The page carries
 * that note in prose instead of three rows that would read as homework.
 *
 * Tier order mirrors the shop's merchandising order (catalog.ts): the
 * occasions people buy most first, the register add-ons pulled forward
 * because the checkout offers them with every order.
 */

export type NeededPhoto = {
  slug: string;
  name: string;
  price: number;
  tier: string;
};

const DESIGNERS_CHOICE = new Set(["designers-choice", "designers-choice-2", "designers-choice-3"]);

/** The checkout's add-on strip (CartView.tsx) sells these three with every
    order, which promotes their photos past their category's turn (one off
    the menu is simply not in `menu`, so it never asks for a photo). */
const REGISTER_ADD_ONS = new Set(["petite-box-of-chocolates", "bohemian-breakfast-tea", "lil-lovey"]);

type Tier = { key: string; label: string; cats: string[] };

export const TIERS: Tier[] = [
  { key: "first", label: "First: Birthday & Anniversary", cats: ["birthday", "anniversary"] },
  { key: "col", label: "Next: Celebration of Life", cats: ["celebration-of-life"] },
  { key: "baby", label: "Then: New Baby, and the three by the register", cats: ["new-baby"] },
  { key: "gifts", label: "When you can: the rest of the gifts", cats: ["gifts-add-ons"] },
  { key: "wedding", label: "And the wedding classics", cats: ["wedding"] },
  // Seasonal (2026-11-02) rides with the everyday designs: a category a
  // tier does not name would silently never be asked for.
  { key: "rest", label: "Everything else", cats: ["seasonal", "just-because", "plants"] },
];

export async function neededPhotos(): Promise<{ tier: Tier; items: NeededPhoto[] }[]> {
  const { menu } = await getCatalog();
  const missing = menu.filter((p) => !hasAnyPhoto(p) && !DESIGNERS_CHOICE.has(p.slug));
  const taken = new Set<string>();

  const pick = (test: (p: Product) => boolean) =>
    missing
      .filter((p) => !taken.has(p.slug) && test(p))
      .map((p) => {
        taken.add(p.slug);
        return { slug: p.slug, name: p.name, price: p.price, tier: "" };
      });

  return TIERS.map((tier) => {
    const items =
      tier.key === "baby"
        ? [...pick((p) => p.cats[0] === "new-baby"), ...pick((p) => REGISTER_ADD_ONS.has(p.slug))]
        : // The tier's own category order, then price, so "Birthday &
          // Anniversary" reads as birthday designs then anniversary designs
          // instead of the catalog file's section order.
          [
            ...tier.cats.flatMap((cat) => pick((p) => p.cats[0] === cat).sort((a, b) => a.price - b.price)),
            // The last tier also takes what no tier names: a design on a
            // shelf the owner added (Products tab), or on no shelf at all.
            ...(tier.key === "rest" ? pick(() => true).sort((a, b) => a.price - b.price) : []),
          ];
    return { tier, items };
  }).filter((t) => t.items.length > 0);
}

export async function neededSlugs(): Promise<Set<string>> {
  return new Set((await neededPhotos()).flatMap((t) => t.items.map((i) => i.slug)));
}
