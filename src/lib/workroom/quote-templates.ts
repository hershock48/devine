import type { QuotePiece } from "@/lib/workroom/store";

/**
 * Starter pieces, one set per model. "Funerals are a different model from
 * weddings" — the owner's words, and the two templates differ in shape, not
 * just contents.
 *
 * PROVISIONAL, in two different ways:
 *
 *   wedding   she is sending her real spreadsheet. This list and the pricing
 *             model get rewritten from it. Pieces start with no stems, so no
 *             quantity here is ever mistaken for one of hers.
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
    piece("Boutonniere", 6),
    piece("Corsage", 2),
    piece("Ceremony arrangement", 2),
    piece("Reception centerpiece", 10),
    piece("Cake flowers", 1),
    piece("Toss bouquet", 1),
  ],
  /* A funeral pad starts EMPTY. The family names what they want and the
     counter taps it in from the menu below; a prefilled list of caskets and
     crosses is the wrong thing to hand someone who just lost their mother. */
  funeral: [],
};

/** markup ×3 and labor 25% are industry-common stand-ins, dials not truths. */
export const QUOTE_DEFAULTS = { markup: 3, laborPct: 25, delivery: 0, setup: 0 };

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
