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
 *   funeral   THERE IS NO DOCUMENT TO COPY. She quotes funerals on the spot,
 *             in person, no spreadsheet. So the funeral side is not a
 *             transcription — it is built from how funeral work is sold
 *             everywhere: by naming a piece and a price, with the flowers
 *             worked out afterwards in the workroom. The price points below
 *             come from published 2026 industry ranges (Kremp, funeral.com,
 *             Ever Loved: standing sprays $125–$350, half-couch $150–$400,
 *             full-couch $300–$600, baskets from ~$50), NOT from DeVine's.
 *             Every one is editable at the counter, and swapping them for
 *             hers is the first thing to do after the meeting.
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
  { name: "Casket spray, half couch", prices: [175, 250, 350], hardgoods: 0, note: "Open casket", casket: "open" },
  { name: "Casket spray, full couch", prices: [300, 450, 600], hardgoods: 0, note: "Closed casket", casket: "closed" },
  { name: "Casket insert / pillow", prices: [95, 150], hardgoods: 0 },
  { name: "Standing spray on easel", prices: [150, 225, 325], hardgoods: 25, note: "Easel included" },
  { name: "Wreath on easel", prices: [150, 225, 300], hardgoods: 25, note: "Easel included" },
  { name: "Cross on easel", prices: [175, 250], hardgoods: 25, note: "Easel included" },
  { name: "Urn surround", prices: [125, 200], hardgoods: 0, note: "Cremation" },
  { name: "Pedestal arrangement", prices: [75, 125, 175], hardgoods: 0 },
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
