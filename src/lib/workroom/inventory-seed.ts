import "server-only";

/**
 * THE SEED IS HER PAPER. Every number here was transcribed from the shop's
 * own documents photographed 2026-08-31 (research/weekly-order-and-price-
 * lists.md): the two laminated selling-price lists behind the counter, and
 * the plant par sheet. Kevin confirmed the laminated lists are what she
 * charges. Values that were occluded or uncertain in the photos are null,
 * NOT guessed (glaze.md's placeholder rule) — a blank she fills once beats
 * a wrong price she never notices.
 *
 * stemsPerBunch is null throughout ON PURPOSE: her documents never state it
 * and it differs by variety. The weekly-order screen asks the first time a
 * bunch of that variety is received, then remembers.
 *
 * Seeding is additive and idempotent: only names not already in the store
 * are inserted, so her edits are never overwritten by re-seeding.
 */

type VarietySeed = {
  name: string;
  kind: "flower" | "green";
  sellStem: number | null;
  sellBunch: number | null;
};

export const varietySeed: VarietySeed[] = [
  // ---- flowers (laminated list, per stem; BUNCH column where hers has one) ----
  { name: "agapanthus", kind: "flower", sellStem: 3.5, sellBunch: null },
  { name: "alstroemeria", kind: "flower", sellStem: 3.5, sellBunch: null },
  { name: "amaranthus", kind: "flower", sellStem: 10, sellBunch: null },
  { name: "anemone", kind: "flower", sellStem: 7, sellBunch: null },
  { name: "astrantia", kind: "flower", sellStem: 4.5, sellBunch: null },
  { name: "aster serenade", kind: "flower", sellStem: 3.5, sellBunch: null },
  { name: "aster matsumoto", kind: "flower", sellStem: 6.75, sellBunch: null },
  { name: "aster monte casino", kind: "flower", sellStem: null, sellBunch: 33 },
  { name: "astilbe", kind: "flower", sellStem: 6, sellBunch: null },
  { name: "baby's breath", kind: "flower", sellStem: 4, sellBunch: 45 },
  { name: "bells of ireland", kind: "flower", sellStem: 6, sellBunch: null },
  { name: "billy balls", kind: "flower", sellStem: 3.25, sellBunch: null },
  { name: "birds of paradise", kind: "flower", sellStem: 8.75, sellBunch: null },
  { name: "bupleurum", kind: "flower", sellStem: 3, sellBunch: null },
  { name: "boronia", kind: "flower", sellStem: 4.5, sellBunch: null },
  { name: "calla lily", kind: "flower", sellStem: 6.75, sellBunch: null },
  { name: "carnation", kind: "flower", sellStem: 2, sellBunch: null },
  { name: "carnation mini", kind: "flower", sellStem: 2, sellBunch: null },
  { name: "carnation moon", kind: "flower", sellStem: 2.5, sellBunch: null },
  { name: "cattail", kind: "flower", sellStem: 1, sellBunch: null },
  { name: "chamomile/feverfew", kind: "flower", sellStem: 7, sellBunch: 36 },
  { name: "cosmos", kind: "flower", sellStem: 3.25, sellBunch: null },
  { name: "dahlia", kind: "flower", sellStem: 5, sellBunch: null },
  { name: "daisy pomps", kind: "flower", sellStem: 3.25, sellBunch: null },
  { name: "hybrid daisy pomps", kind: "flower", sellStem: 3.75, sellBunch: null },
  { name: "novelty pomp", kind: "flower", sellStem: 2.6, sellBunch: null },
  { name: "delphinium", kind: "flower", sellStem: 6, sellBunch: null },
  { name: "dianthus green", kind: "flower", sellStem: 4.75, sellBunch: null },
  { name: "eriostemon", kind: "flower", sellStem: 3.75, sellBunch: null },
  { name: "eryngium", kind: "flower", sellStem: 3.75, sellBunch: null },
  { name: "freesia", kind: "flower", sellStem: 4, sellBunch: null },
  { name: "gardenia", kind: "flower", sellStem: 75, sellBunch: null },
  { name: "genista", kind: "flower", sellStem: 4.5, sellBunch: null },
  { name: "gerbera large", kind: "flower", sellStem: 5, sellBunch: null },
  { name: "gerbera mini", kind: "flower", sellStem: 5.5, sellBunch: null },
  { name: "gerbera pom", kind: "flower", sellStem: 5.25, sellBunch: null },
  { name: "gladiolus", kind: "flower", sellStem: 7.5, sellBunch: null },
  { name: "godetia", kind: "flower", sellStem: 3, sellBunch: null },
  { name: "heather", kind: "flower", sellStem: 5.65, sellBunch: null },
  { name: "hellebore", kind: "flower", sellStem: 4.5, sellBunch: null },
  { name: "hydrangea", kind: "flower", sellStem: 6.5, sellBunch: null },
  { name: "hydrangea minigreen", kind: "flower", sellStem: 6, sellBunch: null },
  { name: "hydrangea big green", kind: "flower", sellStem: 12, sellBunch: null },
  { name: "hydrangea blue", kind: "flower", sellStem: 7.5, sellBunch: null },
  { name: "hydrangea pink or dark burgundy", kind: "flower", sellStem: 15, sellBunch: null },
  { name: "hypericum", kind: "flower", sellStem: 4, sellBunch: null },
  { name: "iris", kind: "flower", sellStem: 4.5, sellBunch: null },
  { name: "kangaroo paw", kind: "flower", sellStem: 4, sellBunch: null },
  { name: "larkspur", kind: "flower", sellStem: 4.5, sellBunch: null },
  { name: "lavender", kind: "flower", sellStem: 1.75, sellBunch: null },
  { name: "leucadendron", kind: "flower", sellStem: 4.5, sellBunch: null },
  { name: "liatris", kind: "flower", sellStem: 3.5, sellBunch: null },
  { name: "lily asiatic", kind: "flower", sellStem: 5, sellBunch: null },
  { name: "lily oriental", kind: "flower", sellStem: 10, sellBunch: null },
  { name: "limonium", kind: "flower", sellStem: 4, sellBunch: 36 },
  { name: "lisianthus", kind: "flower", sellStem: 5, sellBunch: null },
  { name: "magnolia", kind: "flower", sellStem: 8, sellBunch: null },
  { name: "monstera medium", kind: "flower", sellStem: 3, sellBunch: null },
  { name: "mum", kind: "flower", sellStem: 3.5, sellBunch: null },
  { name: "orchid dendrobium", kind: "flower", sellStem: 7.25, sellBunch: null },
  { name: "peony", kind: "flower", sellStem: 13, sellBunch: null },
  { name: "pincushion protea", kind: "flower", sellStem: 12, sellBunch: null },
  { name: "protea pink", kind: "flower", sellStem: 12, sellBunch: null },
  { name: "pussy willow", kind: "flower", sellStem: 3, sellBunch: null },
  { name: "queen anne's lace", kind: "flower", sellStem: 3, sellBunch: null },
  { name: "ranunculus", kind: "flower", sellStem: 6, sellBunch: null },
  { name: "ranunculus butterfly", kind: "flower", sellStem: 7, sellBunch: null },
  { name: "rose", kind: "flower", sellStem: 5, sellBunch: null },
  { name: "rose garden", kind: "flower", sellStem: 12.75, sellBunch: null },
  { name: "rose spray", kind: "flower", sellStem: 5, sellBunch: null },
  { name: "rumex unicorn", kind: "flower", sellStem: 3.25, sellBunch: null },
  { name: "scabiosa", kind: "flower", sellStem: 4.75, sellBunch: null },
  { name: "scabiosa pods", kind: "flower", sellStem: null, sellBunch: null },
  { name: "snapdragon", kind: "flower", sellStem: 5, sellBunch: null },
  { name: "snowberry pink", kind: "flower", sellStem: 5.25, sellBunch: null },
  { name: "solidago", kind: "flower", sellStem: 3, sellBunch: 32 },
  { name: "statice", kind: "flower", sellStem: 3.5, sellBunch: 32 },
  { name: "sterling range", kind: "flower", sellStem: 3.75, sellBunch: null },
  { name: "stock", kind: "flower", sellStem: 3.5, sellBunch: null },
  { name: "strawflower", kind: "flower", sellStem: 4.25, sellBunch: null },
  { name: "sunflower", kind: "flower", sellStem: 4.5, sellBunch: null },
  { name: "tarchelium", kind: "flower", sellStem: 3.75, sellBunch: null },
  { name: "tulip", kind: "flower", sellStem: 4, sellBunch: null },
  { name: "tulip double", kind: "flower", sellStem: 4, sellBunch: null },
  { name: "tulip french", kind: "flower", sellStem: null, sellBunch: null },
  { name: "veronica", kind: "flower", sellStem: null, sellBunch: null },
  { name: "waxflower", kind: "flower", sellStem: null, sellBunch: null },
  { name: "yarrow", kind: "flower", sellStem: 7.25, sellBunch: null },

  // ---- greens (laminated list, bunch and stem columns) ----
  { name: "aspidistra leaves", kind: "green", sellStem: 2.5, sellBunch: 18 },
  { name: "bear grass", kind: "green", sellStem: 0.25, sellBunch: 18 },
  { name: "cocculus", kind: "green", sellStem: 3.5, sellBunch: null },
  { name: "coffee", kind: "green", sellStem: 3, sellBunch: 27 },
  { name: "eucalyptus gunni", kind: "green", sellStem: 4, sellBunch: 30 },
  { name: "eucalyptus parvifolia", kind: "green", sellStem: 4.1, sellBunch: 33 },
  { name: "eucalyptus seeded", kind: "green", sellStem: 4.5, sellBunch: 31.5 },
  { name: "eucalyptus silver dollar", kind: "green", sellStem: 4.5, sellBunch: 31.5 },
  { name: "eucalyptus spiral", kind: "green", sellStem: 3.25, sellBunch: 30 },
  { name: "eucalyptus willow", kind: "green", sellStem: null, sellBunch: null },
  { name: "ivanhoe", kind: "green", sellStem: 4.75, sellBunch: null },
  { name: "leather leaf", kind: "green", sellStem: 0.7, sellBunch: 15 },
  { name: "lily grass", kind: "green", sellStem: 1, sellBunch: null },
  { name: "myrtle", kind: "green", sellStem: 3.5, sellBunch: null },
  { name: "nagi", kind: "green", sellStem: 3.5, sellBunch: null },
  { name: "pennycress", kind: "green", sellStem: 3.75, sellBunch: 36 },
  { name: "pittosporum green", kind: "green", sellStem: null, sellBunch: null },
  { name: "pittosporum variegated", kind: "green", sellStem: 3, sellBunch: 18 },
  { name: "pittosporum mini variegated", kind: "green", sellStem: 4.5, sellBunch: 45 },
  { name: "plumosa", kind: "green", sellStem: 2.5, sellBunch: 18 },
  { name: "ruscus israeli", kind: "green", sellStem: 2.5, sellBunch: 18 },
  { name: "ruscus italian", kind: "green", sellStem: 7.25, sellBunch: 42 },
  { name: "robellini", kind: "green", sellStem: null, sellBunch: 18 },
  { name: "salal", kind: "green", sellStem: 0.3, sellBunch: 6 },
  { name: "sword fern", kind: "green", sellStem: 1, sellBunch: null },
  { name: "tree fern", kind: "green", sellStem: 1, sellBunch: 18 },
  { name: "viburnum", kind: "green", sellStem: null, sellBunch: null },
];

type PlantSeed = {
  slug: string;
  name: string;
  retail: number | null;
  cost: number | null;
  par: number;
};

/** The par sheet, line for line. Null cost = the sheet's column was blank
    or unreadable in the photo; she fills it once on the Plants screen. */
export const plantSeed: PlantSeed[] = [
  { slug: "dish-garden-8", name: 'Dish Garden 8"', retail: 48.95, cost: 24, par: 5 },
  { slug: "dish-garden-10", name: 'Dish Garden 10"', retail: 68.95, cost: 34, par: 2 },
  { slug: "dish-garden-12", name: 'Dish Garden 12"', retail: 90.95, cost: 47, par: 1 },
  { slug: "succulent-garden", name: "Succulent Garden", retail: 59.95, cost: null, par: 1 },
  { slug: "rustic-box", name: "Rustic Box", retail: 65.95, cost: 30, par: 1 },
  { slug: "basket-garden-9", name: 'Basket Garden 9"', retail: 50.95, cost: 25, par: 2 },
  { slug: "basket-garden-12", name: 'Basket Garden 12"', retail: 86, cost: 43, par: 1 },
  { slug: "terra-bowl", name: "Terra Bowl", retail: 52.95, cost: null, par: 1 },
  { slug: "peace-lily-6", name: 'Peace Lily 6"', retail: 45.95, cost: null, par: 5 },
  { slug: "peace-lily-8", name: 'Peace Lily 8"', retail: 62.95, cost: null, par: 3 },
  { slug: "peace-lily-10", name: 'Peace Lily 10"', retail: 85, cost: null, par: 1 },
  { slug: "anthurium-6", name: 'Anthurium 6" (red or pink)', retail: null, cost: null, par: 1 },
  { slug: "palm-8", name: 'Palm 8"', retail: null, cost: null, par: 1 },
  { slug: "african-violet-4", name: 'African Violet 4"', retail: null, cost: null, par: 2 },
  { slug: "big-bird-house", name: "Big Bird House", retail: 110, cost: null, par: 1 },
];
