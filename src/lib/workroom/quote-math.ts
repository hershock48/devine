/**
 * The quote arithmetic, in one place with no imports, so the list page, the
 * builder and the printed quote can never disagree on a number.
 *
 * THE MODEL IS KATY'S OWN, rewritten 2026-09-02 from her 2026WeddingQuotes
 * sheet (screenshots of the Grace 5-30-26 tab; Kevin's call to rebuild from
 * what she sent rather than wait for sheet access). Verified against her own
 * numbers to the cent: every labor cell is exactly 2/3 of its materials,
 * flat-priced boutonnieres carry no labor, tax is Michigan's 6% on the piece
 * money and NOT on pickup/delivery, and her grand total (4998.02) only
 * reproduces when tax is computed on the UNROUNDED sum - so this file keeps
 * raw precision internally and rounds at the edges.
 *
 * FORWARD, stems decide the price (weddings):
 *
 *   materials      stems × price/stem × markup + hardgoods
 *                  (per-stem prices are HER RETAIL list - peony 13, ruscus 7,
 *                  seeded eucalyptus 4.50 - so wedding markup defaults to ×1;
 *                  the old wholesale-times-3 reading of this field is retired)
 *   labor          materials × labor%   (default 66.67, her exact 2/3, and it
 *                  applies to hardgoods too: her 268 of bridal materials
 *                  INCLUDES the vase and ribbon, and 178.67 is 268 × 2/3)
 *   piece each     materials + labor
 *
 * REVERSE, the price decides the stems (funerals, and her flat-priced
 * boutonnieres): set `price` on a piece and the relationship solves for the
 * flower budget instead:
 *
 *   materials budget   price ÷ (1 + labor%)
 *   stem budget        (materials budget − hardgoods) ÷ markup
 *
 * Funerals keep their own dials (markup ×3 over wholesale, labor 25%) until
 * her funeral cost structure is observed; the dials live on the quote, not
 * here.
 *
 *   tax            Σ piece money × tax%   (6 for weddings, her sheet; 0 for
 *                  funerals until Friday says otherwise; delivery and setup
 *                  ride untaxed, exactly like her Pick Up line)
 *   total          Σ (each × qty) + tax + delivery + setup
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
  /** Sales tax percent on the piece money. Absent (older rows) means 0, so a
      quote already sent never reprices itself under the new model. */
  taxPct?: NumLike;
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
  /** The sales-tax line: taxPct% of the piece money, never of delivery. */
  tax: number;
  taxPct: number;
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

    let pRetail: number;
    let pLabor: number;
    /** UNROUNDED. Her grand total only reproduces when the qty multiply and
        the tax happen on raw values; `each` is the rounded display twin. */
    let eachRaw: number;
    let stemBudget: number | null = null;
    let overBudget: number | null = null;

    if (setPrice > 0) {
      // REVERSE: the price is the fact; solve for the flower budget. Labor
      // comes off the whole price first (her labor base includes hardgoods),
      // then hardgoods, then the markup unwinds to a stem budget.
      eachRaw = setPrice;
      const materialsBudget = setPrice / (1 + laborPct / 100);
      stemBudget = cents(Math.max(0, (materialsBudget - pHard) / (markup || 1)));
      pRetail = stemBudget * markup;
      pLabor = setPrice - materialsBudget;
      // Stems entered anyway: say whether the design fits what was sold.
      if (pStem > 0) overBudget = cents(pStem - stemBudget);
    } else {
      // FORWARD: the flowers are the fact; they decide the price. Labor is
      // laborPct of ALL materials, hardgoods included: her bridal column
      // takes 2/3 of 268, and the 268 already holds the vase and ribbon.
      pRetail = pStem * markup;
      const materials = pRetail + pHard;
      pLabor = materials * (laborPct / 100);
      eachRaw = materials + pLabor;
    }
    const each = cents(eachRaw);
    const total = cents(eachRaw * qty);

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
    piecesTotal += eachRaw * qty; // raw, so the tax below matches her sheet
  }

  const taxPct = num(q.taxPct);
  const tax = piecesTotal * (taxPct / 100);
  const delivery = num(q.delivery);
  const setup = num(q.setup);
  // Tax rides the piece money only; delivery and setup are untaxed, exactly
  // like the Pick Up line on her sheet.
  const total = cents(piecesTotal + tax + delivery + setup);
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
    tax: cents(tax),
    taxPct,
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
