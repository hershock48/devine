import type { QuotePiece } from "@/lib/workroom/store";

/**
 * Starter piece lists, one per model. "Funerals are a different model from
 * weddings" — her words, so the two templates are separate lists, not one
 * with a flag. These are the pieces a quote conversation usually walks
 * through, in the order it walks through them; every one is editable,
 * removable, and starts with no stems so no number is ever invented.
 *
 * PROVISIONAL until her real documents arrive: the meeting ask is one actual
 * wedding spreadsheet and one funeral worksheet, and these lists get
 * rewritten from those.
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
