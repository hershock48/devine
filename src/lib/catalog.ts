/**
 * THE CATALOG. 57 products, harvested from their WooCommerce shop on 2026-08-20 and
 * cross-checked against their own Store API, so every name, price and description
 * here is theirs rather than ours.
 *
 * KEYED ON SLUG, NEVER ON NAME. Three separate products are all called "Designer's
 * Choice" and differ only by price. Keying on name silently collapses them.
 *
 * Their category badges sum to 66 because nine products sit in two categories at
 * once. 57 unique + 9 second placements = 66. Nothing is missing.
 *
 * The substitution clauses are theirs, quoted once in site.ts rather than repeated
 * on 40 products the way their current site does.
 */

export type Product = {
  slug: string;
  name: string;
  price: number;
  /** Set only where their shop shows a strikethrough. One product has one. */
  regularPrice?: number;
  cats: string[];
  /** Their own product copy, verbatim. */
  desc: string;
  /** Their image path under wp-content/uploads. Used once real photos land. */
  img: string;
  /** True where their own shop uses a line-art placeholder rather than a photo. */
  placeholderImage?: boolean;
  /** No substitution clause appears on their wedding items or the plush toys. */
  noSubs?: boolean;
};

export type Category = {
  slug: string;
  name: string;
  /** Ours, not theirs: their category pages carry no copy at all. */
  blurb: string;
};

/*
  THE ORDER IS THE SALES ORDER, as well as it can be known today. This array
  drives the shop page's sections, its contents index and the homepage occasion
  list, so its sequence is merchandising, not alphabet.

  What it is built from, since the shop has no online sales history yet: the
  Society of American Florists' consumer buying data (safnow.org) puts "just
  because" at 23% of cut-flower purchases and birthday and anniversary at 12%
  each — the three biggest reasons anyone buys flowers, so they open the shop.
  Sympathy is a small share of CONSUMER purchases but a core revenue line for a
  local full-service florist (hers carries the shop's highest tickets, $95-215,
  and its buyers are urgent), so it sits directly after the everyday three.
  Plants follow (roughly a fifth of purchases are for the buyer's own home or
  office, and it is the deepest, best-photographed shelf). Gifts are
  attachments rather than destinations — the cart already offers them beside
  the register. Wedding closes: four ready-to-order classics, while the real
  wedding trade runs through its own consultation page.

  PROVISIONAL, and self-correcting: the Square register link lands her actual
  counter sales in square_sales. Once a season of real numbers exists, this
  order gets re-cut from what Marshall actually buys, not from industry data.
*/
export const categories: Category[] = [
  { slug: "just-because", name: "Just Because", blurb: "No occasion required. The arrangements our designers reach for when someone simply deserves flowers." },
  { slug: "birthday", name: "Birthday", blurb: "Bright, generous and built to be carried into a room." },
  { slug: "anniversary", name: "Anniversary", blurb: "Roses, and the arrangements for people who would rather not send roses." },
  { slug: "celebration-of-life", name: "Celebration of Life", blurb: "Arrangements for a service, a graveside, or a kitchen table that needs softening." },
  { slug: "plants", name: "Plants", blurb: "Living things that stay long after cut flowers are done." },
  { slug: "new-baby", name: "New Baby", blurb: "Something for the parents, and something the child keeps." },
  { slug: "gifts-add-ons", name: "Gifts & Add Ons", blurb: "Tea, chocolate from Albion, and something soft to hold. Add one to any arrangement." },
  { slug: "wedding", name: "Wedding", blurb: "Our four classics, ready to order. Everything else is designed with you." },
];

/*
  ONE EDIT TO THEIR OWN WORDS, and it is on the README checklist for the owner to
  veto. Three descriptions (Bridget, Helene, Clementine) shipped "grey ceramic".
  glaze.md requires American spelling without exception, and this is a Michigan
  florist, so they read "gray" here. Everything else in this file is verbatim.
*/
const SUB_NOTE = ""; // substitution language lives in site.ts, shown once per product page

/*
  SIX PLANT PRICES DIVERGE FROM THE WOO HARVEST, deliberately. The owner's own
  plant par sheet (research/weekly-order-and-price-lists.md, photographed
  2026-08-31) prices several plants a few dollars below her website, and
  Kevin's ruling that day was that the paper is the most recent pricing.
  Repriced to the sheet: the three ceramic dish gardens (the sheet's 8"/10"/12"
  are the site's Small/Medium/Large, confirmed by the dish sizes in their own
  descriptions), both peace lilies, and the rustic box planter. The sheet also
  carries a 10" Peace Lily at $85 that the website never sold; not added here
  without her copy and a photo.
*/

export const products: Product[] = [
  // ---- Celebration of Life ----
  { slug: "natures-home", name: "Nature's Home", price: 95, cats: ["celebration-of-life"], img: "2026/08/IMG_0661-1-scaled.jpeg",
    desc: "A bright garden designed in a locally made bird house planter. Blue delphinium, yellow cushion mums, red miniature carnations, orange alstroemeria and aster carry an uplifting sentiment to someone in a time of grief." },
  { slug: "eden", name: "Eden", price: 125, cats: ["celebration-of-life"], img: "2026/07/IMG_0211-scaled.jpeg",
    desc: "Serenity in a soft, feminine garden of snapdragons, lisianthus, stock, alstroemeria, button mums, and both full size and petite roses, gathered in a rustic wooden box." },
  { slug: "gayles-garden", name: "Gayle's Garden", price: 215, cats: ["celebration-of-life"], img: "2024/07/Gayles-Garden.jpg",
    desc: "Full and vibrant, a true garden variety, designed with a cottage garden in mind. Mixed greens, sunflowers, leucadendron, purple statice, burgundy carnations, solidago, blue delphinium, burnt orange cremones, spray roses, bells of Ireland, iris, yellow and red alstroemeria, orange mini carnations and purple daisies, finished with a bow." },
  { slug: "mary", name: "Mary", price: 95, cats: ["celebration-of-life"], img: "2024/07/Mary.jpg",
    desc: "A tender, bright arrangement of greens, mini carnations, thistle, daisies, viking and button mums surrounding a ceramic keepsake angel." },
  { slug: "crystal-cross", name: "Crystal Cross Garden", price: 130, cats: ["celebration-of-life"], img: "2024/07/Crystal-Cross.jpg",
    desc: "A low arrangement in a rectangular centerpiece container, adorned with a crystal cross. Roses, statice, larkspur, button mums, daisies, green hypericum, pink carnations and white buttons in soft and bold hues." },

  // ---- Gifts & Add Ons ----
  { slug: "magic-hour-vitality-tea", name: "Magic Hour Vitality Tea", price: 12, cats: ["gifts-add-ons"], img: "2026/07/Vitality-2-scaled.jpeg", noSubs: true,
    desc: "A caffeine free blend for when fatigue has become a constant companion. Organic shatavari root, green tea, cinnamon, peppermint, holy basil, ginger root, gymnema sylvestre, rosemary leaf, raspberry leaf and orange peel." },
  { slug: "magic-hour-balance-tea", name: "Magic Hour Balance Tea", price: 12, cats: ["gifts-add-ons"], img: "2026/07/IMG_0167-scaled.jpeg", noSubs: true,
    desc: "Cooling herbs that have supported women for centuries, for when your internal thermostat has a mind of its own. Caffeine free. Organic shatavari, sage leaf, red clover, dong quai root, chrysanthemum flowers, lemon verbena, rose petals and spearmint." },
  { slug: "magic-hour-rest-tea", name: "Magic Hour Rest Tea", price: 12, cats: ["gifts-add-ons"], img: "2026/07/IMG_0173-scaled.jpeg", noSubs: true,
    desc: "For the quiet hours when sleep should come but thoughts still wander. Caffeine free. Organic shatavari, chamomile, ashwagandha, passionflower, oat straw, lemon balm, rose petals, lavender, lemon myrtle and magnolia bark." },
  { slug: "bohemian-breakfast-tea", name: "Bohemian Breakfast Tea", price: 15, cats: ["gifts-add-ons"], img: "2026/07/IMG_0178-scaled.jpeg", noSubs: true,
    desc: "Round, bold and rich with hints of chocolate and vanilla, in an amber glass bottle. Probiotic-rich puerh black tea blended with biodynamic Sri Lankan tea and Rwandan black teas." },
  { slug: "petite-box-of-chocolates", name: "Signature Collection of Chocolates", price: 15, cats: ["gifts-add-ons"], img: "2026/07/IMG_0656-scaled.jpeg", noSubs: true,
    desc: "Four handcrafted dark chocolate truffles, sourced locally from YellowBird Chocolate Shop in Albion, Michigan. Each box varies slightly, the way handmade things do." },
  { slug: "lil-lovey", name: "Lil' Lovey", price: 21, cats: ["gifts-add-ons", "new-baby"], img: "2026/07/IMG_0294-scaled.jpeg", noSubs: true,
    desc: "Send a little bit of love. Choose Winnie the white bear, Briar the brown bear, or Blossom the white bunny, and tell us which in your order notes." },
  { slug: "claire-the-cat", name: "Claire the Cat", price: 28.95, cats: ["gifts-add-ons", "new-baby"], img: "2026/07/IMG_0305-scaled.jpeg", noSubs: true,
    desc: "Whether you are cheering up a friend or welcoming a new arrival, Claire is eager to be a loving companion." },
  { slug: "piper-the-puppy", name: "Piper the Puppy", price: 28.95, cats: ["gifts-add-ons", "new-baby"], img: "2026/07/IMG_0309.jpeg", noSubs: true,
    desc: "Whether you are cheering up a friend or welcoming a new arrival, Piper is eager to be a loving companion." },
  { slug: "grand-collection-of-chocolates", name: "Grand Collection of Chocolates", price: 30, cats: ["gifts-add-ons"], img: "2026/07/IMG_0661-scaled.jpeg", noSubs: true,
    desc: "Nine handcrafted dark chocolate truffles from YellowBird Chocolate Shop in Albion, Michigan. Each box varies slightly, the way handmade things do." },
  { slug: "duke-the-dog", name: "Duke the Dog", price: 31.95, cats: ["gifts-add-ons", "new-baby"], img: "2026/07/IMG_0300-scaled.jpeg", noSubs: true,
    desc: "Whether you are cheering up a friend or welcoming a new arrival, Duke is eager to be a loving companion." },
  { slug: "mindful-moments-basket", name: "Mindful Moments Basket", price: 80, cats: ["gifts-add-ons"], img: "2025/09/IMG_0280-1-scaled.jpeg",
    desc: "A rustic box holding a small houseplant, coconut body oil, a eucalyptus soap bar with an exfoliating bag, a lavender vanilla candle, a roll on calming oil, and a sachet of locally grown dried lavender. The best gift is one that asks someone to slow down." },

  // ---- New Baby ----
  { slug: "honey-bee", name: "Honey Bee", price: 75, cats: ["new-baby"], img: "2026/06/IMG_0560-scaled.jpeg",
    desc: "PLACEHOLDER: their shop carries no description for this product, only the substitution clause. Ask the owner for copy." },
  { slug: "butterfly-kisses", name: "Butterfly Kisses", price: 75, cats: ["new-baby"], img: "2026/06/IMG_9575-scaled.jpeg",
    desc: "Delicate pastels of lavender stock, pink larkspur, pink rose, green hydrangea, white cremone, pink alstroemeria and limonium in seasonal greenery, with a pink butterfly as a finishing touch." },
  { slug: "bears-baby-box", name: "Bear's Baby Box", price: 110, cats: ["new-baby"], img: "2026/08/IMG_0419-scaled.jpeg",
    desc: "Briar the brown bear alongside fresh flowers for mom and dad. Blue hydrangeas, white daisies and two toned blue delphinium in a dark wood rustic box. A keepsake and a bouquet in one." },
  { slug: "blossom-and-blooms", name: "Blossom and Blooms", price: 110, cats: ["new-baby"], img: "2026/07/IMG_0326-scaled.jpeg",
    desc: "Blossom, the softest bunny in all the land, surrounded by pink snapdragons, pink carnations, white daisies and soft fillers in a creamy white ceramic pedestal pot. A grand gesture, generously sized." },

  // ---- Wedding ----
  { slug: "classic-boutonniere", name: "Classic Boutonniere", price: 21.95, cats: ["wedding"], img: "2025/09/IMG_6890.jpg", noSubs: true,
    desc: "A simple, elegant white rose boutonniere with Italian ruscus and baby's breath, to complement any suit jacket." },
  { slug: "classic-wrist-corsage", name: "Classic Wrist Corsage", price: 35.95, cats: ["wedding"], img: "2025/09/IMG_6894-scaled.jpg", noSubs: true,
    desc: "A timeless corsage on a white satin and sheer ribbon base, accented with white spray roses, Italian ruscus and baby's breath." },
  { slug: "classic-bridesmaid-bouquet", name: "Classic Bridesmaid Bouquet", price: 75, cats: ["wedding"], img: "2025/09/IMG_6856-scaled.jpg", noSubs: true,
    desc: "White roses, white spray roses and baby's breath, intricately placed and wrapped in ivory satin ribbon." },
  { slug: "classic-bridal-bouquet", name: "Classic Bridal Bouquet", price: 260, cats: ["wedding"], img: "2025/09/Classic-Bridal-Bouquet.png", noSubs: true,
    desc: "All white roses surrounded by baby's breath and wrapped with ivory ribbon. A touch of classic." },

  // ---- Just Because ----
  { slug: "designers-choice", name: "Designer's Choice", price: 55, cats: ["just-because", "birthday"], img: "2025/05/Black-And-White-Flower-A4-Page-Border-1-e1753476113498.png", placeholderImage: true,
    desc: "Put the creative agency in the hands of the designer. Container and flowers are chosen for seasonality, availability and inspiration on the day. Tell us any colors or flowers you have in mind in your order notes." },
  { slug: "maeve", name: "Maeve", price: 65, cats: ["just-because"], img: "2026/08/IMG_0759-scaled.jpeg",
    desc: "In a green ceramic keepsake pumpkin, full of mixed greenery with peach spray roses, burgundy cushion mums, red leucadendron, red strawflower, peach hypericum, bunny tails and solidago. A collection of complementing autumn tones." },
  { slug: "gwendolyn", name: "Gwendolyn", price: 65, cats: ["just-because"], img: "2026/08/IMG_0690-scaled.jpeg",
    desc: "A play on traditional autumn color in a keepsake orange ceramic pumpkin. A deep toned dahlia, orange spray roses, red alstroemeria, champagne cushion mums, burgundy hypericum berries and bright yellow solidago." },
  { slug: "harper-2", name: "Harper", price: 65, cats: ["just-because"], img: "2026/08/IMG_0714-scaled.jpeg",
    desc: "A feminine take on autumn. Mauves, pinks and apricot tones in spray roses, stock, thistle, cushion mums and solidago. The stock fills a room with scent as well as color." },
  { slug: "designers-choice-3", name: "Designer's Choice", price: 75, cats: ["just-because", "anniversary", "birthday"], img: "2025/05/Black-And-White-Flower-A4-Page-Border-1-e1753476113498.png", placeholderImage: true,
    desc: "Put the creative agency in the hands of the designer. Container and flowers are chosen for seasonality, availability and inspiration on the day. Tell us any colors or flowers you have in mind in your order notes." },
  { slug: "della", name: "Della", price: 79, cats: ["just-because"], img: "2026/08/IMG_0688-scaled.jpeg",
    desc: "Vibrant fall color in a concrete container. Red hypericum berries, orange alstroemeria, craspedia balls, solidago, a large sunflower and a live succulent that can be planted and keep growing, nestled in mixed seasonal greenery." },
  { slug: "ginger", name: "Ginger", price: 85, cats: ["just-because"], img: "2026/08/IMG_0741-scaled.jpeg",
    desc: "A stunning collection of purples and oranges. Deep toned hydrangeas, orange daisies, butterscotch cremones, dark purple button mums, Free Spirit roses, orange carnations, solidago and garden fresh calendula in a clear bowl vase." },
  { slug: "bridget", name: "Bridget", price: 85, cats: ["just-because"], img: "2026/08/IMG_0676-scaled.jpeg",
    desc: "The more neutral, natural side of autumn, in a gray ceramic container. White Japanese anemones, peachy orange hypericum berries, pale yellow lisianthus, chocolate Queen Anne's lace, burgundy carnations, autumn leaves, and slices of tree trunk and twig." },
  { slug: "designers-choice-2", name: "Designer's Choice", price: 100, cats: ["just-because", "anniversary", "birthday"], img: "2025/05/Black-And-White-Flower-A4-Page-Border-1-e1753476113498.png", placeholderImage: true,
    desc: "Put the creative agency in the hands of the designer. Container and flowers are chosen for seasonality, availability and inspiration on the day. Tell us any colors or flowers you have in mind in your order notes." },
  { slug: "helene", name: "Helene", price: 115, cats: ["just-because"], img: "2026/08/IMG_0805-scaled.jpeg",
    desc: "A show stopping vased arrangement in gray ceramic, abundant with seeded eucalyptus, willow eucalyptus, plumosa fern, grasses and ninebark. Woven through the greenery: solidago, cremone mums, burgundy micro daisies, golden fennel and a mixture of hypericum berries. For someone who appreciates a natural, neutral palette." },

  // ---- Anniversary ----
  { slug: "hanna", name: "Hanna", price: 60, cats: ["anniversary"], img: "2026/08/IMG_0557-scaled.jpeg",
    desc: "Delicately sweet. A clear regency vase with mixed greenery, petite peach spray roses and baby's breath. The right size for a kitchen counter or a work desk, as an everyday reminder." },
  { slug: "dozen-roses", name: "Classic Red Dozen", price: 75, regularPrice: 126.95, cats: ["anniversary"], img: "2026/01/IMG_0513-scaled.jpeg",
    desc: "The classic way to say I love you. Twelve long stemmed red roses in a large clear vase, filled abundantly with greens and filler accents, finished with a satin bow." },
  { slug: "serena", name: "Serena", price: 100, cats: ["anniversary"], img: "2026/08/IMG_0754-scaled.jpeg",
    desc: "A romantic display of neutral tones. White lilies, hydrangeas, mums, alstroemeria, snapdragons and classic white roses in mixed seasonal greenery, intertwined with white waxflower in a clear tapered vase." },
  { slug: "roxanne", name: "Roxanne", price: 100, cats: ["anniversary"], img: "2026/07/IMG_0349-scaled.jpeg",
    desc: "Love and desire, in classic red roses, vibrant red alstroemeria, delicate pink scabiosa, white veronica, white stock and pink limonium." },
  { slug: "mixed-dozen-of-roses", name: "Mixed Dozen Roses", price: 126.95, cats: ["anniversary"], img: "2026/08/IMG_0416-scaled.jpeg",
    desc: "A twist on the classic dozen. Twelve long stemmed roses in pink and red, abundantly designed in a large clear urn with mixed greenery and filler." },
  { slug: "eliza", name: "Eliza", price: 135, cats: ["anniversary"], img: "2026/08/IMG_0478-scaled.jpeg",
    desc: "An elaborate display of feminine tones. Pink lilies, deep purple roses, purple stock and snapdragons, alstroemeria, butterfly ranunculus, button mums and carnations in a bed of mixed greenery." },

  // ---- Birthday ----
  { slug: "looking-lovely", name: "Looking Lovely", price: 55, cats: ["birthday"], img: "2026/03/IMG_9491-scaled.jpeg",
    desc: "A garden of bold color. Orange daisies, purple alstroemeria, magenta mini carnations, lavender button mums, solidago and a sunflower in mixed seasonal greenery." },
  { slug: "blooming-candle", name: "Blooming Candle", price: 70, cats: ["birthday"], img: "2024/07/IMG_8580-scaled.jpeg",
    desc: "Two gifts in one. Fresh flowers arranged into the top of a scented tinned candle, full of mixed greens, purple stock and larkspur, light blue delphinium, purple button mums, white cushion mums and filler." },
  { slug: "clementine", name: "Clementine", price: 85, cats: ["birthday"], img: "2026/06/Screenshot-2026-06-01-105732.png",
    desc: "The warmth of summer, in double petaled gerbera daisies, snapdragons, sunset orange daisies, whimsical yellow butterfly ranunculus, purple statice and solidago, in a gray ceramic container with seasonal summer greenery." },
  { slug: "nicole", name: "Nicole", price: 110, cats: ["birthday"], img: "2025/04/Nicole-2-1.jpg",
    desc: "The energy of a garden in full bloom, in a bubble glass vase. Blue delphinium, Free Spirit roses, orange and yellow alstroemeria, blue hydrangea, orange lily, chamomile, pink rice flower and solidago." },

  // ---- Plants ----
  { slug: "6-peace-lily", name: "6″ Peace Lily", price: 45.95, cats: ["plants"], img: "2024/08/6-inch-Peace-Lily.jpg",
    desc: "The peace lily, Spathiphyllum, blooms with stunning white flowers and is a symbol of calm and balance. Delivered in a woven basket or a tin container with a white satin bow. Prefers moist soil and low light." },
  { slug: "small-ceramic-dish-garden", name: "Small Ceramic Dish Garden", price: 48.95, cats: ["plants"], img: "2026/02/IMG_0028-scaled.jpeg",
    desc: "A collection of plants grown together in an 8″ ceramic dish. Plants and dish may vary. Keep the soil moist, in bright diffused light." },
  { slug: "small-chime-stand", name: "30″ Wind Chime", price: 50.95, cats: ["plants"], img: "2024/07/Untitled-design-2.png",
    desc: "A full, classically beautiful sound, in three colors. If no color preference is noted on the order, black will be sent." },
  { slug: "terra-bowel", name: "Terra Bowl", price: 52.95, cats: ["plants"], img: "2024/06/Terra-Bowel.jpg",
    desc: "An earthy, vibrant collection of mixed green house plants grown in a 10″ terra dish. Plants may vary." },
  { slug: "beautiful-memory", name: "Beautiful Memory", price: 59.95, cats: ["plants"], img: "2024/09/IMG_0031-scaled.jpeg",
    desc: "An 8″ ceramic dish garden of mixed green house plants with three bright butterflies. Keep the soil moist, in bright diffused light." },
  { slug: "peaceful-garden-2", name: "Peaceful Garden", price: 59.95, cats: ["plants"], img: "2024/07/IMG_0077-scaled.jpeg",
    desc: "Mixed house plants grown together in a ceramic dish, with a white ceramic dove among the greenery. Plants and dish may vary." },
  { slug: "succulent-garden", name: "Succulent Garden", price: 59.95, cats: ["plants"], img: "2024/06/Succulent-Garden.jpg",
    desc: "A ceramic bowl abundantly filled with mixed succulents. The soil prefers to stay relatively dry, with occasional watering, in bright diffused light." },
  { slug: "cylinder-wind-chime", name: "Cylinder Wind Chime", price: 61, cats: ["plants"], img: "2024/07/Untitled-design-1.png",
    desc: "A single cylinder chime with a deep tone. For a garden, or the corner of a house, calling in the memory of someone or simply bringing awareness to the breeze. Five colors. If no preference is noted, black will be sent." },
  { slug: "8-peace-lily", name: "8″ Peace Lily", price: 62.95, cats: ["plants"], img: "2024/07/8-inch-Peace-Lily.jpg",
    desc: "The peace lily, Spathiphyllum, blooms with stunning white flowers and is a symbol of calm and balance. Delivered in a woven basket or a tin container with a white satin bow. Prefers moist soil and low light." },
  { slug: "rustic-box-planter", name: "Rustic Box Planter", price: 65.95, cats: ["plants"], img: "2024/07/Rustic-Box-.jpg",
    desc: "Mixed house plants grown together in a rustic box planter. Plants and planter may vary." },
  { slug: "medium-ceramic-dish-garden", name: "Medium Ceramic Dish Garden", price: 68.95, cats: ["plants"], img: "2024/07/Medium-Ceramic-Dish-Garden-.jpg",
    desc: "A collection of plants grown together in a 10″ ceramic dish. Plants and dish may vary. Keep the soil moist, in bright diffused light." },
  { slug: "wing-and-a-prayer", name: "A Wing and A Prayer Dish Garden", price: 79.95, cats: ["plants"], img: "2024/07/IMG_0072-scaled.jpeg",
    desc: "An assortment of house plants in a basket, accented with a ceramic angel keepsake and a white satin bow. Keep the soil moist, in bright diffused light." },
  { slug: "large-ceramic-dish-garden", name: "Large Ceramic Dish Garden", price: 90.95, cats: ["plants"], img: "2024/07/Large-Dish-Garden.jpg",
    desc: "A collection of plants grown together in a 12″ ceramic dish. Plants and dish may vary. Keep the soil moist, in bright diffused light." },
];

// ---- lookups -------------------------------------------------------------

export const bySlug = new Map(products.map((p) => [p.slug, p]));
export const catBySlug = new Map(categories.map((c) => [c.slug, c]));

export function inCategory(catSlug: string): Product[] {
  return products.filter((p) => p.cats.includes(catSlug)).sort((a, b) => a.price - b.price);
}

export function priceRange(catSlug: string): [number, number] {
  const ps = inCategory(catSlug).map((p) => p.price);
  return [Math.min(...ps), Math.max(...ps)];
}

/** "$64.95" and "$75". Their shop prints trailing .00, which reads like a receipt. */
export function money(n: number): string {
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`;
}

/*
  The homepage's featured six used to be a single list here (their own homepage
  set: helene, maeve, ginger, gwendolyn, harper-2, della). It moved to
  lib/seasons.ts on 2026-08-31, one curated list per season, because the front
  page now turns with the calendar. That original set survives verbatim as the
  fall list, which is what it always was: every description in it says autumn.
*/

void SUB_NOTE;
