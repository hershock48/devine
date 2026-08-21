import type { QuotePiece } from "@/lib/workroom/store";

/**
 * Starter piece lists, one per model. "Funerals are a different model from
 * weddings" — her words, so the two templates are separate lists, not one
 * with a flag. These are the pieces a quote conversation usually walks
 * through, in the order it walks through them; every one is editable,
 * removable, and starts with no stems so no number is ever invented.
 *
 * PROVISIONAL, and the two halves are provisional in different ways:
 *
 *   wedding   she is sending her real spreadsheet. This list and the pricing
 *             model get rewritten from it.
 *   funeral   THERE IS NO DOCUMENT TO COPY. She quotes funerals on the spot,
 *             in person, no spreadsheet (her note, 2026-08-21). So this list
 *             is not a transcription of anything: it is a guess at the pieces
 *             a family is offered, and the funeral variant's real design
 *             problem is speed at a counter, not paperwork. Watch her quote
 *             one before changing either.
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
  funeral: [
    piece("Casket spray", 1),
    piece("Standing easel spray", 2),
    piece("Urn arrangement", 1),
    piece("Family arrangement", 2),
    piece("Pallbearer boutonniere", 6),
  ],
};

/** markup ×3 and labor 25% are industry-common stand-ins, dials not truths. */
export const QUOTE_DEFAULTS = { markup: 3, laborPct: 25, delivery: 0, setup: 0 };
