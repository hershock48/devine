/**
 * The quote arithmetic, in one place with no imports, so the list page, the
 * builder and the printed quote can never disagree on a number.
 *
 * THE MODEL RUNS BOTH WAYS, because the two rooms work in opposite
 * directions and one file has to serve both.
 *
 * FORWARD, stems decide the price. How a wedding is quoted: a wish list of
 * pieces, costed up.
 *
 *   stem cost      what the flowers cost the shop, per piece: stems × cost/stem
 *   flower retail  stem cost × markup            (dial, default ×3)
 *   labor          flower retail × labor%        (dial, default 25%)
 *   hardgoods      typed at retail, per piece    (vase, foam, ribbon, easel)
 *   piece each     flower retail + labor + hardgoods
 *
 * REVERSE, the price decides the stems. How funeral work is actually sold:
 * "a standing spray at $225", said across a counter, with the flowers worked
 * out later. Set `price` on a piece and the same relationship is solved for
 * the flower budget instead:
 *
 *   stem budget    (price − hardgoods) ÷ (markup × (1 + labor%))
 *
 * So a $225 spray with a $25 easel at ×3 and 25% leaves $53.33 of flowers to
 * design with — the number the workroom needs and the counter never has to
 * think about. If stems ARE entered on a priced piece, the two are compared
 * and the overage reported, which is the same discipline as the shrink page
 * pointed at design instead of waste.
 *
 *   total          Σ (each × qty) + delivery + setup
 *   deposit        weddings only: 50%, their own published process
 *
 * Every input tolerates the string a half-typed <input> holds; garbage counts
 * as zero and is REPORTED as unpriced rather than silently priced. A quote
 * with unknowns says so; it never guesses (the placeholder rule, applied to
 * arithmetic, same as the stems page).
 */

type NumLike = number | string | undefined;
const num = (v: NumLike): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const cents = (n: number) => Math.round(n * 100) / 100;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type DraftPart = { variety: string; stems: NumLike };
export type DraftPiece = {
  id: string;
  name: string;
  qty: NumLike;
  hardgoods: NumLike;
  parts: DraftPart[];
  /** Set to price the piece directly and solve backwards for the flowers. */
  price?: NumLike;
};
export type DraftQuote = {
  kind: "wedding" | "funeral";
  flowers: { variety: string; costPerStem: NumLike }[];
  pieces: DraftPiece[];
  markup: NumLike;
  laborPct: NumLike;
  delivery: NumLike;
  setup: NumLike;
  budgetTarget?: NumLike;
};

export type PiecePricing = {
  /** "stems" priced forward from flowers; "price" solved back from a price. */
  mode: "stems" | "price";
  stemCost: number;
  flowerRetail: number;
  labor: number;
  hardgoods: number;
  each: number;
  total: number;
  /** Price mode: what the designer has to spend on flowers for one piece. */
  stemBudget: number | null;
  /** Price mode with stems entered: actual stem cost minus the budget.
      Positive means the design is eating the margin. Null when not both. */
  overBudget: number | null;
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
  /** Funeral: what the family said they can spend, and the gap to it. Null
      when no target was named, which is common and not an error. */
  budgetTarget: number | null;
  overTarget: number | null;
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
    const pHard = num(piece.hardgoods);
    const setPrice = num(piece.price);
    const factor = markup * (1 + laborPct / 100); // stem cost -> retail, less hardgoods

    let pRetail: number;
    let pLabor: number;
    let each: number;
    let stemBudget: number | null = null;
    let overBudget: number | null = null;

    if (setPrice > 0) {
      // REVERSE: the price is the fact; solve for the flower budget.
      each = cents(setPrice);
      stemBudget = cents(Math.max(0, (setPrice - pHard) / (factor || 1)));
      const budgetRetail = stemBudget * markup;
      pRetail = budgetRetail;
      pLabor = budgetRetail * (laborPct / 100);
      // Stems entered anyway: say whether the design fits what was sold.
      if (pStem > 0) overBudget = cents(pStem - stemBudget);
    } else {
      // FORWARD: the flowers are the fact; they decide the price.
      pRetail = pStem * markup;
      pLabor = pRetail * (laborPct / 100);
      each = cents(pRetail + pLabor + pHard);
    }
    const total = cents(each * qty);

    perPiece.set(piece.id, {
      mode: setPrice > 0 ? "price" : "stems",
      stemCost: cents(pStem),
      flowerRetail: cents(pRetail),
      labor: cents(pLabor),
      hardgoods: cents(pHard),
      each,
      total,
      stemBudget,
      overBudget,
      unpriced: pUnpriced,
    });

    /*
      Roll up the flowers the shop will actually spend: real stem cost where
      stems were entered, the budget where only a price was set. Otherwise a
      counter-priced quote would report $0 of flowers against a $900 total.
    */
    const rolledStem = setPrice > 0 && pStem === 0 ? (stemBudget ?? 0) : pStem;
    stemCost += rolledStem * qty;
    flowerRetail += pRetail * qty;
    labor += pLabor * qty;
    hardgoods += pHard * qty;
    piecesTotal += total;
  }

  const delivery = num(q.delivery);
  const setup = num(q.setup);
  const total = cents(piecesTotal + delivery + setup);
  const target = num(q.budgetTarget);

  return {
    budgetTarget: target > 0 ? cents(target) : null,
    overTarget: target > 0 ? cents(total - target) : null,
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
