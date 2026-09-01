import "server-only";

/**
 * Workroom storage: orders, stem events, recipes.
 *
 * Ported from pjs/lib/ordering/store.js, the diverged (newest) copy of the
 * kitchen system per glaze/catalog/apps.md. The two-backend shape, the
 * jsonb-blob decision and the self-creating tables are all its; what changed is
 * the domain: a florist's workroom keeps orders, stem purchases, shrink, and
 * per-product recipes instead of tickets and 86 boards.
 *
 * Two backends behind one interface:
 *
 *   postgres   when DATABASE_URL (or POSTGRES_URL) is set. One click in Vercel:
 *              project > Storage > Create Database > Neon, free tier — part of
 *              the hosting the client already has, so it does not break the
 *              "nothing rented" rule. Tables create themselves on first use.
 *
 *   memory     fallback so local dev and the build need nothing. On deployed
 *              serverless this only holds within one warm lambda, so the board
 *              can MISS entries that landed elsewhere. The workroom shows a
 *              plain warning when it is on memory, same as the pjs kitchen
 *              screen: a demo that half-works silently is worse than one that
 *              says what is wrong.
 *
 * Everything is one jsonb column keyed by id. The board always wants the whole
 * row, nothing queries inside the blob, and a schema this young will change
 * shape. Normalize when something needs to query it, not before (pjs's words;
 * still true).
 */

/**
 * "out" exists for DELIVERY orders only: made -> out (on the truck) -> done.
 * A pickup goes made -> done when it leaves the counter; there is no van to
 * track. The board enforces which button shows; the store just holds the word.
 */
export type OrderStatus = "new" | "confirmed" | "made" | "out" | "done" | "canceled";

export type WorkroomLine = {
  /** Catalog slug when the line came from the shop's catalog; null for a custom item. */
  slug: string | null;
  name: string;
  qty: number;
  each: number; // dollars
};

/**
 * How an order's money got settled. Set by /api/workroom/pay when the shop
 * takes the card or records cash from the order card, or by the Square
 * webhook when a register ring is recognized as belonging to a board order
 * (reference id from our own API payments, or a DV number typed into the
 * ring's note). Absent means unpaid, which every order historically was,
 * so old rows need no migration.
 */
export type OrderPayment = {
  at: number;
  /** "other" is the by-hand mark for money that moved outside the board (a
      check, an account, an unlinked register ring); its squarePaymentId is
      empty because there is no Square payment to point at. */
  method: "card" | "cash" | "register" | "other";
  squarePaymentId: string;
  totalCents: number;
  /** The customer-paid order fee included in totalCents; 0 on cash. */
  feeCents: number;
};

export type WorkroomOrder = {
  id: string;
  /** The same DV- number the email ticket carries, so a phone call about
      "order DV-0823-1187" finds the same thing in both places. */
  number: string;
  source: "web" | "phone";
  status: OrderStatus;
  name: string;
  phone: string;
  email: string;
  fulfillment: "delivery" | "pickup";
  recipient: string;
  street: string;
  town: string;
  zip: string;
  /** yyyy-mm-dd, the requested date. The board buckets on this, not createdAt:
      a wedding ordered in June belongs on September's board. */
  date: string;
  occasion: string;
  cardMessage: string;
  notes: string;
  lines: WorkroomLine[];
  subtotal: number;
  createdAt: number;
  payment?: OrderPayment | null;
};

export type StemEvent = {
  id: string;
  kind: "purchase" | "shrink";
  /** yyyy-mm-dd, the day it happened, typed by the shop; not createdAt,
      because Monday's toss gets logged Tuesday morning. */
  date: string;
  /** Normalized lowercase. Matching purchases to recipes to shrink happens on
      this string, so "Roses" and "roses" must be the same variety. */
  variety: string;
  stems: number;
  /** Dollars, whole purchase. 0 on shrink: a tossed stem's cost comes from
      what was PAID for that variety, never typed twice. */
  cost: number;
  /** Shrink only: wilted | damaged | overbought | event fell through | other. */
  reason: string;
  createdAt: number;
};

export type Recipe = {
  /** Catalog product slug. Keyed on slug, never name: three products share the
      name "Designer's Choice" (README trap list). */
  slug: string;
  parts: { variety: string; stems: number }[];
};

/**
 * A quote: the owner's sharpest ask, in her words — "a model to input flowers
 * and stem count to accurately produce a quote", with weddings and funerals
 * as different models.
 *
 * THE PRICING MODEL IS PROVISIONAL, on purpose. flowers × markup, plus labor
 * as a percentage of the flower retail, plus hardgoods at typed retail, plus
 * delivery/setup flat. Defaults: markup ×3, labor 25% — industry-common
 * numbers standing in until her real wedding spreadsheet and funeral
 * worksheet arrive after the meeting. Every number is a dial she can turn
 * per quote; nothing is hardcoded into the math.
 */
export type QuotePart = { variety: string; stems: number };
export type QuotePiece = {
  id: string;
  name: string;
  qty: number;
  /** Vase, foam, ribbon, easel — typed at retail, per piece. */
  hardgoods: number;
  parts: QuotePart[];
  /**
   * A retail price set DIRECTLY, which flips the arithmetic for this piece:
   * instead of stems deciding the price, the price decides how much flower
   * the designer has to work with. This is how funeral work is actually
   * sold — "a standing spray at $225" across a counter, stems figured out in
   * the workroom afterwards. Absent or 0 means price it forward from stems,
   * which is how weddings are quoted.
   */
  price?: number;
  /** "Beloved Mother", "Grandma". The ribbon is not the card message and the
      family says it out loud at the counter, so it belongs on the piece. */
  ribbon?: string;
  /** Which family or group is paying for this piece. One service routinely
      splits across several payers, and the ticket has to say which. */
  from?: string;
};
export type Quote = {
  id: string;
  kind: "wedding" | "funeral";
  status: "draft" | "sent" | "accepted" | "declined";
  clientName: string;
  phone: string;
  email: string;
  eventDate: string; // yyyy-mm-dd or ""
  venue: string;
  notes: string;
  /* ---- funeral only. A service is a DEADLINE, not a date: flowers are
     expected about an hour before the family arrives, and an early or Sunday
     service means delivering the day before. A date field alone cannot say
     that, so the time fields are first-class. ---- */
  deceased?: string;
  serviceTime?: string; // HH:MM
  viewingTime?: string; // HH:MM
  /** Open casket takes a half-couch spray, closed takes full couch, cremation
      takes neither. It is the first question that changes the piece. */
  casket?: "open" | "closed" | "cremation" | "";
  /** What the family said they can spend. Funerals are quoted DOWN to a
      number the family names; weddings are built UP from a wish list. */
  budgetTarget?: number;
  /** The quote's own price list, per stem. Prefilled from workroom purchase
      history where known, editable per quote: event flowers are often
      special-ordered at prices the everyday cooler never sees. */
  flowers: { variety: string; costPerStem: number }[];
  pieces: QuotePiece[];
  markup: number;
  laborPct: number;
  delivery: number;
  setup: number;
  createdAt: number;
  updatedAt: number;
};

/**
 * A completed sale rung on the shop's Square register, delivered by webhook.
 * One row per Square payment id, so a redelivered webhook overwrites rather
 * than duplicates. Lines carry our catalog slug where the register item was
 * one of ours (matched by SKU at ingest); null means an item we do not
 * manage, which still counts as revenue but cannot decrement a recipe.
 */
export type SquareSaleLine = {
  slug: string | null;
  name: string;
  qty: number;
  eachCents: number;
  totalCents: number;
};

export type SquareSale = {
  /** Square's payment id. THE dedupe key: webhooks redeliver on any 5xx. */
  id: string;
  /** Set when this sale is a board order's money (matched by reference id
      or by a DV number in the ring's note). Inventory skips linked sales:
      the board order's made-status is the single stem truth for them. */
  workroomOrderId?: string;
  orderId: string;
  locationId: string;
  /** CARD, CASH, WALLET... Square's source_type, verbatim. Cash counts: the
      stems left the cooler either way. */
  source: string;
  totalCents: number;
  /** Square's own timestamp for the payment, ISO. */
  paidAt: string;
  lines: SquareSaleLine[];
  createdAt: number;
};

/**
 * THE MASTER STEM LIST. Everything else hangs off it: recipes pick from it,
 * the weekly order names against it, on-hand counts by it. Keyed on the
 * normalizeVariety() name so "Rose" and "roses " can never become two rows.
 *
 * Sell prices are HER numbers, seeded from the two laminated lists behind
 * the counter (research/weekly-order-and-price-lists.md). Null means she has
 * not priced it, and every surface shows a blank rather than a guess.
 * stemsPerBunch is null until the shop tells us, ONCE, and then bunch
 * purchases convert to stems by themselves. Nothing here invents that
 * number: a wrong stems-per-bunch silently mis-costs every recipe.
 */
export type Variety = {
  name: string;
  kind: "flower" | "green";
  /** What she charges per stem, dollars. Null = not priced yet. */
  sellStem: number | null;
  /** What she charges per bunch, where her list has one. */
  sellBunch: number | null;
  stemsPerBunch: number | null;
  createdAt: number;
};

/**
 * The weekly flower order: the Kennicott Tuesday standing order, digitized.
 * The real one mostly repeats week to week and gets edited in pen, so the
 * screen starts a new order from the last one and the work is the delta.
 * Receiving the truck turns every line into a purchase StemEvent in one tap;
 * until then a draft costs nothing and touches nothing.
 */
export type WeeklyOrderLine = {
  /** normalizeVariety() name. The shop's word, not the distributor's. */
  variety: string;
  qty: number;
  unit: "bunch" | "stem";
  /** Dollars per unit, from the prebook. */
  unitPrice: number;
  /** Required on bunch lines before the order can be received; snapshotted
      here because the count can differ from the variety's usual one week. */
  stemsPerBunch: number | null;
  note: string;
};

export type WeeklyOrder = {
  id: string;
  distributor: string;
  /** yyyy-mm-dd, the truck date. Purchases log on this day. */
  deliveryDate: string;
  status: "draft" | "received";
  lines: WeeklyOrderLine[];
  receivedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * A plant on the par sheet. Live plants are not stems: they are counted
 * whole, reordered to a standard number (her word for par), and carry a
 * stable retail and wholesale cost on the same line, exactly like the
 * printed sheet this replaces. `have` is the latest count; Need is always
 * derived (par minus have), never stored, so it can never go stale.
 */
export type PlantItem = {
  slug: string;
  name: string;
  retail: number | null;
  cost: number | null;
  par: number;
  have: number | null;
  /** yyyy-mm-dd of the latest count, "" before the first one. */
  countedAt: string;
  createdAt: number;
};

/**
 * The owner's Square OAuth grant, stored whole as one document. One row,
 * ever: this deployment serves one shop, and the id column exists only
 * because every table here has a primary key, not because there is a second
 * merchant coming.
 *
 * These are credentials, and the standing caution in glaze.md ("never put a
 * credential in a file") is about files and commits, not about this: an
 * OAuth token is issued at runtime, lives in the database, and is re-issued
 * by reconnecting if lost. The database is the only place it can live,
 * because serverless memory is per-lambda and a token that evaporates means
 * every cold start silently loses the register link.
 */
export type SquareTokens = {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp from Square. Access tokens live about 30 days; the
      refresh token does not expire and mints new ones. */
  expiresAt: string;
  merchantId: string;
  /** The location sync and payments target, picked at connect time from the
      account's active locations. */
  locationId: string;
  locationName: string;
  connectedAt: number;
};

/**
 * A recorded acceptance of the client agreement, clickwrap style. THE EMAIL
 * IS THE LEGAL RECORD, same as the glazedweb menu-order flow: both parties
 * receive a copy carrying the version, the exhibit, the name typed, and the
 * timestamp. This row is the queryable second copy, not the only copy, which
 * is why acceptance still proceeds on the memory backend where an OAuth
 * grant would refuse.
 */
export type AgreementAcceptance = {
  id: string;
  business: string;
  name: string;
  title: string;
  email: string;
  /** ISO, stamped by the server at acceptance. */
  acceptedAt: string;
  version: string;
  exhibit: string;
  ip: string;
  userAgent: string;
  createdAt: number;
};

export type OrderContact = {
  name: string;
  phone: string;
  email: string;
  createdAt: number;
  fulfillment: "delivery" | "pickup";
  recipient: string;
  street: string;
  town: string;
  zip: string;
};

/**
 * One product photograph the owner submitted through /photos. The row is the
 * PROGRESS LEDGER, not the photo: the image itself rides the email to Kevin
 * (a database this small should not hold megabytes of JPEG), and this row is
 * what lets the page show her a checkmark from any device. slug is the
 * catalog slug the photo is for; resubmitting the same slug upserts, because
 * a better second photo of Eliza should not read as two designs done.
 */
export type PhotoSubmission = {
  /** The catalog slug: one row per design, latest submission wins. */
  slug: string;
  name: string;
  filename: string;
  /** Bytes of the JPEG as emailed, for the ledger only. */
  bytes: number;
  createdAt: number;
};

type Store = {
  backend: "postgres" | "memory";
  createOrder(o: WorkroomOrder): Promise<void>;
  /**
   * Every order's contact facts, projected across the WHOLE history (not the
   * board's 60-day window): the board derives "returning customer" from
   * these instead of asking anyone to type it, and a customer's third order
   * in a year should count even when the first two aged off the board.
   *
   * Grown 2026-09-01 to carry each order's delivery details, so the
   * phone-order form can AUTOFILL a repeat caller: who and where, from
   * their latest order. Deliberately NOT the lines or the occasion; an
   * earlier same-day version filled those too and Kevin cut it: the person
   * and the address repeat, but what they are ordering and why is this
   * call's business, and a prefilled "Sympathy" on a birthday order is the
   * kind of wrong that ships. Still a projection, never the full blobs.
   */
  listOrderContacts(): Promise<OrderContact[]>;
  /** Every OPEN order regardless of age, plus closed ones from the last
      `days`. The first version filtered everything on createdAt and it was a
      real bug, not a maybe: weddings book up to six months out (site.ts's own
      words), so an open order created in June for September would have
      silently left the board in August, still unmade. Open orders never age
      off; only finished ones do. */
  listOrders(days: number): Promise<WorkroomOrder[]>;
  getOrder(id: string): Promise<WorkroomOrder | null>;
  /** By the DV number the ticket carries, for matching a register ring's
      typed note. Number collisions do not exist (date + random). */
  getOrderByNumber(number: string): Promise<WorkroomOrder | null>;
  setOrderStatus(id: string, status: OrderStatus): Promise<void>;
  setOrderPayment(id: string, p: OrderPayment): Promise<void>;
  /** The pay route appends the delivery-fee line when it charges a
      delivery ticket that never carried one, so the ticket's rows and its
      payment agree. */
  setOrderLines(id: string, lines: WorkroomLine[], subtotal: number): Promise<void>;
  addStemEvent(e: StemEvent): Promise<void>;
  listStemEvents(days: number): Promise<StemEvent[]>;
  /** Mis-keyed counts happen at 7am. A delete, not an edit: retyping five
      fields beats an edit UI nobody will maintain. */
  deleteStemEvent(id: string): Promise<void>;
  upsertRecipe(r: Recipe): Promise<void>;
  listRecipes(): Promise<Recipe[]>;
  upsertQuote(q: Quote): Promise<void>;
  listQuotes(): Promise<Quote[]>;
  /** One quote by id. Exists because the callers that need exactly one were
      pulling the whole table and scanning it in JS — on every autosave, and
      with a LIMIT that made quotes past the 500th unsaveable. */
  getQuote(id: string): Promise<Quote | null>;
  deleteQuote(id: string): Promise<void>;
  upsertSquareSale(s: SquareSale): Promise<void>;
  listSquareSales(days: number): Promise<SquareSale[]>;
  upsertVariety(v: Variety): Promise<void>;
  listVarieties(): Promise<Variety[]>;
  deleteVariety(name: string): Promise<void>;
  upsertWeeklyOrder(o: WeeklyOrder): Promise<void>;
  /** Newest first. The screen only ever needs a handful. */
  listWeeklyOrders(limit: number): Promise<WeeklyOrder[]>;
  deleteWeeklyOrder(id: string): Promise<void>;
  upsertPlantItem(p: PlantItem): Promise<void>;
  listPlantItems(): Promise<PlantItem[]>;
  deletePlantItem(slug: string): Promise<void>;
  getSquareTokens(): Promise<SquareTokens | null>;
  setSquareTokens(t: SquareTokens): Promise<void>;
  clearSquareTokens(): Promise<void>;
  addAgreementAcceptance(a: AgreementAcceptance): Promise<void>;
  listAgreementAcceptances(): Promise<AgreementAcceptance[]>;
  upsertPhotoSubmission(p: PhotoSubmission): Promise<void>;
  listPhotoSubmissions(): Promise<PhotoSubmission[]>;
};

export const SHRINK_REASONS = ["wilted", "damaged", "overbought", "event fell through", "other"] as const;

export function normalizeVariety(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------ memory ------------------------------ */

type Bag = {
  orders: Map<string, WorkroomOrder>;
  stems: Map<string, StemEvent>;
  recipes: Map<string, Recipe>;
  quotes: Map<string, Quote>;
  squareSales: Map<string, SquareSale>;
  varieties: Map<string, Variety>;
  weeklyOrders: Map<string, WeeklyOrder>;
  plants: Map<string, PlantItem>;
  squareTokens: SquareTokens | null;
  acceptances: Map<string, AgreementAcceptance>;
  photoSubs: Map<string, PhotoSubmission>;
};

function bag(): Bag {
  const g = globalThis as typeof globalThis & { __devineWorkroom?: Bag };
  if (!g.__devineWorkroom) {
    g.__devineWorkroom = {
      orders: new Map(),
      stems: new Map(),
      recipes: new Map(),
      quotes: new Map(),
      squareSales: new Map(),
      varieties: new Map(),
      weeklyOrders: new Map(),
      plants: new Map(),
      squareTokens: null,
      acceptances: new Map(),
      photoSubs: new Map(),
    };
  }
  // A bag created by an older module instance predates the newer maps.
  const b = g.__devineWorkroom;
  if (!b.quotes) b.quotes = new Map();
  if (!b.squareSales) b.squareSales = new Map();
  if (!b.varieties) b.varieties = new Map();
  if (!b.weeklyOrders) b.weeklyOrders = new Map();
  if (!b.plants) b.plants = new Map();
  if (b.squareTokens === undefined) b.squareTokens = null;
  if (!b.acceptances) b.acceptances = new Map();
  if (!b.photoSubs) b.photoSubs = new Map();
  return b;
}

const cutoff = (days: number) => Date.now() - days * 86_400_000;

const memoryStore: Store = {
  backend: "memory",
  async createOrder(o) {
    bag().orders.set(o.id, o);
  },
  async listOrders(days) {
    // Done-but-unpaid counts as open for aging: it is a receivable, and a
    // receivable that quietly leaves the board after 60 days disappears at
    // exactly the moment it most needs seeing. It ages off when paid.
    const open = (o: WorkroomOrder) =>
      (o.status !== "done" && o.status !== "canceled") || (o.status === "done" && !o.payment);
    return [...bag().orders.values()]
      .filter((o) => open(o) || o.createdAt >= cutoff(days))
      .sort((a, b) => a.createdAt - b.createdAt);
  },
  async getOrder(id) {
    return bag().orders.get(id) ?? null;
  },
  async getOrderByNumber(number) {
    return [...bag().orders.values()].find((o) => o.number === number) ?? null;
  },
  async setOrderStatus(id, status) {
    const o = bag().orders.get(id);
    if (o) o.status = status;
  },
  async setOrderPayment(id, p) {
    const o = bag().orders.get(id);
    if (o) o.payment = p;
  },
  async setOrderLines(id, lines, subtotal) {
    const o = bag().orders.get(id);
    if (o) {
      o.lines = lines;
      o.subtotal = subtotal;
    }
  },
  async listOrderContacts() {
    return [...bag().orders.values()]
      .filter((o) => o.status !== "canceled")
      .map((o) => ({
        name: o.name,
        phone: o.phone,
        email: o.email,
        createdAt: o.createdAt,
        fulfillment: o.fulfillment,
        recipient: o.recipient,
        street: o.street,
        town: o.town,
        zip: o.zip,
      }));
  },
  async addStemEvent(e) {
    bag().stems.set(e.id, e);
  },
  async listStemEvents(days) {
    return [...bag().stems.values()]
      .filter((e) => e.createdAt >= cutoff(days))
      .sort((a, b) => a.createdAt - b.createdAt);
  },
  async deleteStemEvent(id) {
    bag().stems.delete(id);
  },
  async upsertRecipe(r) {
    bag().recipes.set(r.slug, r);
  },
  async listRecipes() {
    return [...bag().recipes.values()];
  },
  async upsertQuote(q) {
    bag().quotes.set(q.id, q);
  },
  async listQuotes() {
    return [...bag().quotes.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async getQuote(id) {
    return bag().quotes.get(id) ?? null;
  },
  async deleteQuote(id) {
    bag().quotes.delete(id);
  },
  async upsertSquareSale(s) {
    bag().squareSales.set(s.id, s);
  },
  async listSquareSales(days) {
    return [...bag().squareSales.values()]
      .filter((s) => s.createdAt >= cutoff(days))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
  async upsertVariety(v) {
    bag().varieties.set(v.name, v);
  },
  async listVarieties() {
    return [...bag().varieties.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
  async deleteVariety(name) {
    bag().varieties.delete(name);
  },
  async upsertWeeklyOrder(o) {
    bag().weeklyOrders.set(o.id, o);
  },
  async listWeeklyOrders(limit) {
    return [...bag().weeklyOrders.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  },
  async deleteWeeklyOrder(id) {
    bag().weeklyOrders.delete(id);
  },
  async upsertPlantItem(p) {
    bag().plants.set(p.slug, p);
  },
  async listPlantItems() {
    return [...bag().plants.values()].sort((a, b) => a.name.localeCompare(b.name));
  },
  async deletePlantItem(slug) {
    bag().plants.delete(slug);
  },
  async getSquareTokens() {
    return bag().squareTokens;
  },
  async setSquareTokens(t) {
    bag().squareTokens = t;
  },
  async clearSquareTokens() {
    bag().squareTokens = null;
  },
  async addAgreementAcceptance(a) {
    bag().acceptances.set(a.id, a);
  },
  async listAgreementAcceptances() {
    return [...bag().acceptances.values()].sort((a, b) => b.createdAt - a.createdAt);
  },
  async upsertPhotoSubmission(p) {
    bag().photoSubs.set(p.slug, p);
  },
  async listPhotoSubmissions() {
    return [...bag().photoSubs.values()].sort((a, b) => b.createdAt - a.createdAt);
  },
};

/* ----------------------------- postgres ----------------------------- */

function connectionString(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

type PgPool = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

async function pgPool(): Promise<PgPool> {
  const g = globalThis as typeof globalThis & { __devinePgPool?: PgPool; __devinePgReady?: Promise<unknown> };
  if (!g.__devinePgPool) {
    // Dynamic import so the dependency never loads unless a database is
    // actually configured (pjs pattern, unchanged).
    const { Pool } = await import("pg");
    const cs = connectionString();
    g.__devinePgPool = new Pool({
      connectionString: cs,
      // Neon and friends require TLS; local postgres usually has none.
      ssl: cs?.includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: 3,
    }) as unknown as PgPool;
    /*
      A FAILED SCHEMA INIT MUST NOT BE CACHED. Storing this promise and never
      clearing it meant one unlucky cold start — Neon still waking, a blip —
      left that warm instance permanently broken: every later request awaited
      the same rejected promise long after the database recovered. On failure
      the pool and the promise are dropped so the next request retries.
      Inherited from the pjs store, where the same fix is owed.
    */
    g.__devinePgReady = g.__devinePgPool.query(`
      CREATE TABLE IF NOT EXISTS workroom_orders (
        id text PRIMARY KEY,
        status text NOT NULL,
        created_at bigint NOT NULL,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workroom_stems (
        id text PRIMARY KEY,
        created_at bigint NOT NULL,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workroom_recipes (
        slug text PRIMARY KEY,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workroom_quotes (
        id text PRIMARY KEY,
        updated_at bigint NOT NULL,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS square_sales (
        id text PRIMARY KEY,
        created_at bigint NOT NULL,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workroom_varieties (
        name text PRIMARY KEY,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workroom_weekly_orders (
        id text PRIMARY KEY,
        updated_at bigint NOT NULL,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workroom_plants (
        slug text PRIMARY KEY,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS square_oauth (
        id text PRIMARY KEY,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agreement_acceptances (
        id text PRIMARY KEY,
        created_at bigint NOT NULL,
        data jsonb NOT NULL
      );
      CREATE TABLE IF NOT EXISTS photo_submissions (
        slug text PRIMARY KEY,
        created_at bigint NOT NULL,
        data jsonb NOT NULL
      );
    `).catch((err: unknown) => {
      g.__devinePgPool = undefined;
      g.__devinePgReady = undefined;
      throw err;
    });
  }
  await g.__devinePgReady;
  return g.__devinePgPool!;
}

const postgresStore: Store = {
  backend: "postgres",
  async createOrder(o) {
    const pool = await pgPool();
    await pool.query(`INSERT INTO workroom_orders (id, status, created_at, data) VALUES ($1, $2, $3, $4)`, [
      o.id,
      o.status,
      o.createdAt,
      JSON.stringify(o),
    ]);
  },
  async listOrders(days) {
    const pool = await pgPool();
    // Done-but-unpaid ages like open (see the memory copy's note): the
    // payment key is absent until money lands, so data->'payment' IS NULL
    // is the unpaid test, and it holds for rows written before the payment
    // field existed.
    const r = await pool.query(
      `SELECT data FROM workroom_orders
       WHERE status NOT IN ('done', 'canceled')
          OR (status = 'done' AND data->'payment' IS NULL)
          OR created_at >= $1
       ORDER BY created_at ASC LIMIT 2000`,
      [cutoff(days)],
    );
    return r.rows.map((row) => row.data as WorkroomOrder);
  },
  async getOrder(id) {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM workroom_orders WHERE id = $1`, [id]);
    return r.rows[0] ? (r.rows[0].data as WorkroomOrder) : null;
  },
  async getOrderByNumber(number) {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM workroom_orders WHERE data->>'number' = $1 LIMIT 1`, [number]);
    return r.rows[0] ? (r.rows[0].data as WorkroomOrder) : null;
  },
  async setOrderStatus(id, status) {
    const pool = await pgPool();
    await pool.query(
      `UPDATE workroom_orders SET status = $2, data = data || jsonb_build_object('status', $2::text) WHERE id = $1`,
      [id, status],
    );
  },
  async setOrderPayment(id, p) {
    const pool = await pgPool();
    await pool.query(
      `UPDATE workroom_orders SET data = data || jsonb_build_object('payment', $2::jsonb) WHERE id = $1`,
      [id, JSON.stringify(p)],
    );
  },
  async setOrderLines(id, lines, subtotal) {
    const pool = await pgPool();
    await pool.query(
      `UPDATE workroom_orders SET data = data || jsonb_build_object('lines', $2::jsonb, 'subtotal', $3::numeric) WHERE id = $1`,
      [id, JSON.stringify(lines), subtotal],
    );
  },
  async listOrderContacts() {
    const pool = await pgPool();
    // A projection, not rows: named contact and address fields, never the
    // card messages, notes, or lines that make the full jsonb blobs heavy.
    const r = await pool.query(
      `SELECT data->>'name' AS name, data->>'phone' AS phone, data->>'email' AS email,
              data->>'fulfillment' AS fulfillment, data->>'recipient' AS recipient,
              data->>'street' AS street, data->>'town' AS town, data->>'zip' AS zip, created_at
       FROM workroom_orders WHERE status <> 'canceled' ORDER BY created_at DESC LIMIT 5000`,
    );
    return r.rows.map((row) => ({
      name: (row.name as string) ?? "",
      phone: (row.phone as string) ?? "",
      email: (row.email as string) ?? "",
      createdAt: Number(row.created_at),
      fulfillment: row.fulfillment === "pickup" ? ("pickup" as const) : ("delivery" as const),
      recipient: (row.recipient as string) ?? "",
      street: (row.street as string) ?? "",
      town: (row.town as string) ?? "",
      zip: (row.zip as string) ?? "",
    }));
  },
  async addStemEvent(e) {
    const pool = await pgPool();
    await pool.query(`INSERT INTO workroom_stems (id, created_at, data) VALUES ($1, $2, $3)`, [
      e.id,
      e.createdAt,
      JSON.stringify(e),
    ]);
  },
  async listStemEvents(days) {
    const pool = await pgPool();
    const r = await pool.query(
      `SELECT data FROM workroom_stems WHERE created_at >= $1 ORDER BY created_at ASC LIMIT 5000`,
      [cutoff(days)],
    );
    return r.rows.map((row) => row.data as StemEvent);
  },
  async deleteStemEvent(id) {
    const pool = await pgPool();
    await pool.query(`DELETE FROM workroom_stems WHERE id = $1`, [id]);
  },
  async upsertRecipe(r) {
    const pool = await pgPool();
    await pool.query(
      `INSERT INTO workroom_recipes (slug, data) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET data = $2`,
      [r.slug, JSON.stringify(r)],
    );
  },
  async listRecipes() {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM workroom_recipes`);
    return r.rows.map((row) => row.data as Recipe);
  },
  async upsertQuote(q) {
    const pool = await pgPool();
    await pool.query(
      `INSERT INTO workroom_quotes (id, updated_at, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET updated_at = $2, data = $3`,
      [q.id, q.updatedAt, JSON.stringify(q)],
    );
  },
  async listQuotes() {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM workroom_quotes ORDER BY updated_at DESC LIMIT 500`);
    return r.rows.map((row) => row.data as Quote);
  },
  async getQuote(id) {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM workroom_quotes WHERE id = $1`, [id]);
    return r.rows[0] ? (r.rows[0].data as Quote) : null;
  },
  async deleteQuote(id) {
    const pool = await pgPool();
    await pool.query(`DELETE FROM workroom_quotes WHERE id = $1`, [id]);
  },
  async upsertSquareSale(s) {
    const pool = await pgPool();
    // DO UPDATE, not DO NOTHING: Square redelivers on any non-2xx, and a
    // later delivery can carry a corrected payment. Same id, newest wins.
    await pool.query(
      `INSERT INTO square_sales (id, created_at, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = $3`,
      [s.id, s.createdAt, JSON.stringify(s)],
    );
  },
  async listSquareSales(days) {
    const pool = await pgPool();
    const r = await pool.query(
      `SELECT data FROM square_sales WHERE created_at >= $1 ORDER BY created_at DESC LIMIT 5000`,
      [cutoff(days)],
    );
    return r.rows.map((row) => row.data as SquareSale);
  },
  async upsertVariety(v) {
    const pool = await pgPool();
    await pool.query(
      `INSERT INTO workroom_varieties (name, data) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET data = $2`,
      [v.name, JSON.stringify(v)],
    );
  },
  async listVarieties() {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM workroom_varieties ORDER BY name ASC LIMIT 2000`);
    return r.rows.map((row) => row.data as Variety);
  },
  async deleteVariety(name) {
    const pool = await pgPool();
    await pool.query(`DELETE FROM workroom_varieties WHERE name = $1`, [name]);
  },
  async upsertWeeklyOrder(o) {
    const pool = await pgPool();
    await pool.query(
      `INSERT INTO workroom_weekly_orders (id, updated_at, data) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET updated_at = $2, data = $3`,
      [o.id, o.updatedAt, JSON.stringify(o)],
    );
  },
  async listWeeklyOrders(limit) {
    const pool = await pgPool();
    const r = await pool.query(
      `SELECT data FROM workroom_weekly_orders ORDER BY updated_at DESC LIMIT $1`,
      [Math.min(limit, 200)],
    );
    return r.rows.map((row) => row.data as WeeklyOrder);
  },
  async deleteWeeklyOrder(id) {
    const pool = await pgPool();
    await pool.query(`DELETE FROM workroom_weekly_orders WHERE id = $1`, [id]);
  },
  async upsertPlantItem(p) {
    const pool = await pgPool();
    await pool.query(
      `INSERT INTO workroom_plants (slug, data) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET data = $2`,
      [p.slug, JSON.stringify(p)],
    );
  },
  async listPlantItems() {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM workroom_plants ORDER BY data->>'name' ASC LIMIT 500`);
    return r.rows.map((row) => row.data as PlantItem);
  },
  async deletePlantItem(slug) {
    const pool = await pgPool();
    await pool.query(`DELETE FROM workroom_plants WHERE slug = $1`, [slug]);
  },
  async getSquareTokens() {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM square_oauth WHERE id = 'owner'`);
    return r.rows[0] ? (r.rows[0].data as SquareTokens) : null;
  },
  async setSquareTokens(t) {
    const pool = await pgPool();
    await pool.query(
      `INSERT INTO square_oauth (id, data) VALUES ('owner', $1)
       ON CONFLICT (id) DO UPDATE SET data = $1`,
      [JSON.stringify(t)],
    );
  },
  async clearSquareTokens() {
    const pool = await pgPool();
    await pool.query(`DELETE FROM square_oauth WHERE id = 'owner'`);
  },
  async addAgreementAcceptance(a) {
    const pool = await pgPool();
    await pool.query(`INSERT INTO agreement_acceptances (id, created_at, data) VALUES ($1, $2, $3)`, [
      a.id,
      a.createdAt,
      JSON.stringify(a),
    ]);
  },
  async listAgreementAcceptances() {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM agreement_acceptances ORDER BY created_at DESC LIMIT 100`);
    return r.rows.map((row) => row.data as AgreementAcceptance);
  },
  async upsertPhotoSubmission(p) {
    const pool = await pgPool();
    await pool.query(
      `INSERT INTO photo_submissions (slug, created_at, data) VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET created_at = $2, data = $3`,
      [p.slug, p.createdAt, JSON.stringify(p)],
    );
  },
  async listPhotoSubmissions() {
    const pool = await pgPool();
    const r = await pool.query(`SELECT data FROM photo_submissions ORDER BY created_at DESC LIMIT 200`);
    return r.rows.map((row) => row.data as PhotoSubmission);
  },
};

export function getStore(): Store {
  return connectionString() ? postgresStore : memoryStore;
}
