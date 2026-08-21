/**
 * The quote arithmetic, in one place with no imports, so the list page, the
 * builder and the printed quote can never disagree on a number.
 *
 * THE MODEL, provisional until her spreadsheets arrive:
 *
 *   stem cost      what the flowers cost the shop, per piece: stems × cost/stem
 *   flower retail  stem cost × markup            (dial, default ×3)
 *   labor          flower retail × labor%        (dial, default 25%)
 *   hardgoods      typed at retail, per piece    (vase, foam, ribbon, easel)
 *   piece each     flower retail + labor + hardgoods, rounded to the cent
 *   total          Σ (each × qty) + delivery + setup
 *   deposit        weddings only: 50%, their own published process
 *
 * Every input tolerates the string a half-typed <input> holds; garbage counts
 * as zero and is REPORTED as unpriced rather than silently priced. A quote
 * with unknowns says so; it never guesses (the placeholder rule, applied to
 * arithmetic, same as the stems page).
 */

type NumLike = number | string;
const num = (v: NumLike): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const cents = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type DraftPart = { variety: string; stems: NumLike };
export type DraftPiece = { id: string; name: string; qty: NumLike; hardgoods: NumLike; parts: DraftPart[] };
export type DraftQuote = {
  kind: "wedding" | "funeral";
  flowers: { variety: string; costPerStem: NumLike }[];
  pieces: DraftPiece[];
  markup: NumLike;
  laborPct: NumLike;
  delivery: NumLike;
  setup: NumLike;
};

export type PiecePricing = {
  stemCost: number;
  flowerRetail: number;
  labor: number;
  hardgoods: number;
  each: number;
  total: number;
  /** Varieties used in this piece with stems but no price on the list. */
  unpriced: string[];
};

export type QuotePricing = {
  perPiece: Map<string, PiecePricing>; // by piece id
  stemCost: number;
  flowerRetail: number;
  labor: number;
  hardgoods: number;
  piecesTotal: number;
  delivery: number;
  setup: number;
  total: number;
  deposit: number;
  /** Every variety used somewhere with stems but no price. Empty = fully priced. */
  unpricedVarieties: string[];
  /** The buy list: total stems per variety across the whole quote, priced
      where a price exists. This is the wholesale order the quote implies. */
  buyList: { variety: string; stems: number; cost: number | null }[];
};

export function priceQuote(q: DraftQuote): QuotePricing {
  const priceMap = new Map<string, number>();
  for (const f of q.flowers) {
    const v = norm(f.variety);
    if (v) priceMap.set(v, num(f.costPerStem));
  }

  const markup = Math.max(1, num(q.markup) || 1);
  const laborPct = num(q.laborPct);

  const perPiece = new Map<string, PiecePricing>();
  const unpricedSet = new Set<string>();
  const buy = new Map<string, { stems: number; known: boolean; cost: number }>();

  let stemCost = 0;
  let flowerRetail = 0;
  let labor = 0;
  let hardgoods = 0;
  let piecesTotal = 0;

  for (const piece of q.pieces) {
    const qty = Math.max(1, Math.round(num(piece.qty) || 1));
    let pStem = 0;
    const pUnpriced: string[] = [];
    for (const part of piece.parts) {
      const v = norm(part.variety);
      const stems = Math.round(num(part.stems));
      if (!v || stems <= 0) continue;
      const price = priceMap.get(v);
      const b = buy.get(v) ?? { stems: 0, known: price != null && price > 0, cost: 0 };
      b.stems += stems * qty;
      if (price != null && price > 0) {
        pStem += stems * price;
        b.cost += stems * qty * price;
      } else {
        pUnpriced.push(v);
        unpricedSet.add(v);
        b.known = false;
      }
      buy.set(v, b);
    }
    const pRetail = pStem * markup;
    const pLabor = pRetail * (laborPct / 100);
    const pHard = num(piece.hardgoods);
    const each = cents(pRetail + pLabor + pHard);
    const total = cents(each * qty);

    perPiece.set(piece.id, {
      stemCost: cents(pStem),
      flowerRetail: cents(pRetail),
      labor: cents(pLabor),
      hardgoods: cents(pHard),
      each,
      total,
      unpriced: pUnpriced,
    });

    stemCost += pStem * qty;
    flowerRetail += pRetail * qty;
    labor += pLabor * qty;
    hardgoods += pHard * qty;
    piecesTotal += total;
  }

  const delivery = num(q.delivery);
  const setup = num(q.setup);
  const total = cents(piecesTotal + delivery + setup);

  return {
    perPiece,
    stemCost: cents(stemCost),
    flowerRetail: cents(flowerRetail),
    labor: cents(labor),
    hardgoods: cents(hardgoods),
    piecesTotal: cents(piecesTotal),
    delivery: cents(delivery),
    setup: cents(setup),
    total,
    deposit: q.kind === "wedding" ? cents(total * 0.5) : 0,
    unpricedVarieties: [...unpricedSet].sort(),
    buyList: [...buy.entries()]
      .map(([variety, b]) => ({ variety, stems: b.stems, cost: b.known ? cents(b.cost) : null }))
      .sort((a, b) => b.stems - a.stems),
  };
}
