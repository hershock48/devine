import type { QuotePiece } from "@/lib/workroom/store";

/**
 * Starter pieces, one set per model. "Funerals are a different model from
 * weddings" — the owner's words, and the two templates differ in shape, not
 * just contents.
 *
 * PROVISIONAL, in two different ways:
 *
 *   wedding   REWRITTEN 2026-09-02 from her 2026WeddingQuotes sheet (the
 *             Grace tab, via Kevin's screenshots). The piece list below is
 *             her sheet's own column vocabulary; quantities are gentle
 *             starters, not hers - each tab's counts are that wedding's.
 *             Pieces start with no stems, so no quantity here is ever
 *             mistaken for one of hers.
 *
 *   funeral   She quotes funerals on the spot, in person, no spreadsheet, so
 *             the menu is one tap per piece per price. THE RANGES ARE NOW
 *             HERS, from Katy's own texts, 2026-09-02: funeral vases
 *             $75-$250ish; easels and casket sprays $150-$550; urn surrounds
 *             $125-$350. The price points below are spread inside those
 *             ranges; rows she did not name (insert, basket, table piece,
 *             boutonniere, corsage) keep the published 2026 industry
 *             stand-ins they launched with. Every price is editable at the
 *             counter either way, and watching her quote one live funeral
 *             remains the calibration that matters.
 */

const piece = (name: string, qty: number): Omit<QuotePiece, "id"> => ({
  name,
  qty,
  hardgoods: 0,
  parts: [],
});

export const QUOTE_TEMPLATES: Record<"wedding" | "funeral", Omit<QuotePiece, "id">[]> = {
  wedding: [
    piece("Bridal bouquet", 1),
    piece("Bridesmaid bouquet", 4),
    piece("Groom boutonniere", 1),
    piece("Boutonniere", 6),
    piece("Corsage", 2),
    piece("Centerpiece", 10),
    piece("Aisle basket", 2),
    piece("Seating table flowers", 1),
    piece("Cocktail table flowers", 1),
    piece("Cake flowers", 1),
    piece("Toss bouquet", 1),
  ],
  /* A funeral pad starts EMPTY. The family names what they want and the
     counter taps it in from the menu below; a prefilled list of caskets and
     crosses is the wrong thing to hand someone who just lost their mother. */
  funeral: [],
};

/**
 * Per kind since 2026-09-02, because the two rooms price differently:
 *
 *   wedding  HER MODEL, from the sheet: per-stem prices are her retail list
 *            so markup is ×1; labor is 66.67 (her exact 2/3 of materials);
 *            tax 6 (Michigan, on piece money only). The old ×3-over-wholesale
 *            defaults produced the right ballpark for the wrong reason and
 *            are retired for weddings.
 *   funeral  price-first at the counter; ×3 and 25% remain the reverse
 *            dials for the workroom's flower budget until her funeral cost
 *            structure is observed. Tax 0 until Friday answers whether her
 *            counter prices are out-the-door.
 */
export const QUOTE_DEFAULTS: Record<"wedding" | "funeral", { markup: number; laborPct: number; taxPct: number; delivery: number; setup: number }> = {
  wedding: { markup: 1, laborPct: 66.67, taxPct: 6, delivery: 0, setup: 0 },
  funeral: { markup: 3, laborPct: 25, taxPct: 0, delivery: 0, setup: 0 },
};

/**
 * The counter menu. Each row is one tap: a piece at a price the shop sells it
 * at, with the hardgoods (easel, frame, container) that piece always carries.
 *
 * `casket` marks the two rows that depend on the open/closed answer, so the
 * pad can put the right one forward and grey the other. Everything stays
 * available regardless — a rule that hides a piece a family asked for is
 * worse than one that suggests.
 */
export type FuneralPreset = {
  name: string;
  prices: number[];
  hardgoods: number;
  note?: string;
  casket?: "open" | "closed";
};

export const FUNERAL_MENU: FuneralPreset[] = [
  // Casket sprays and easel pieces sit inside her $150-$550; the half couch
  // takes the lower half of the range, the full couch the upper.
  { name: "Casket spray, half couch", prices: [150, 250, 350], hardgoods: 0, note: "Open casket", casket: "open" },
  { name: "Casket spray, full couch", prices: [350, 450, 550], hardgoods: 0, note: "Closed casket", casket: "closed" },
  { name: "Casket insert / pillow", prices: [95, 150], hardgoods: 0 },
  { name: "Standing spray on easel", prices: [150, 250, 350], hardgoods: 25, note: "Easel included" },
  { name: "Wreath on easel", prices: [150, 250, 350], hardgoods: 25, note: "Easel included" },
  { name: "Cross on easel", prices: [175, 275, 375], hardgoods: 25, note: "Easel included" },
  // Her words: urn surrounds "range $125-$350 usually".
  { name: "Urn surround", prices: [125, 225, 350], hardgoods: 0, note: "Cremation" },
  // "Funeral vases range from $75-$250ish" - her own name for the piece, so
  // the row wears it (this was "Pedestal arrangement", an industry label no
  // one at her counter uses).
  { name: "Funeral vase", prices: [75, 125, 175, 250], hardgoods: 0 },
  { name: "Sympathy basket", prices: [60, 90, 125], hardgoods: 0 },
  { name: "Table arrangement", prices: [55, 85, 120], hardgoods: 0 },
  { name: "Pallbearer boutonniere", prices: [12], hardgoods: 0 },
  { name: "Corsage", prices: [25, 35], hardgoods: 0 },
];

/** What the ribbon usually says. Tapped, not typed, at a counter. */
export const RIBBON_WORDS = [
  "Beloved Mother",
  "Beloved Father",
  "Beloved Wife",
  "Beloved Husband",
  "Grandma",
  "Grandpa",
  "Our Sister",
  "Our Brother",
  "Son",
  "Daughter",
  "Loving Family",
  "Forever in Our Hearts",
];
