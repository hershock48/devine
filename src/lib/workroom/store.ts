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

export type OrderStatus = "new" | "confirmed" | "made" | "done" | "canceled";

export type WorkroomLine = {
  /** Catalog slug when the line came from the shop's catalog; null for a custom item. */
  slug: string | null;
  name: string;
  qty: number;
  each: number; // dollars
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

type Store = {
  backend: "postgres" | "memory";
  createOrder(o: WorkroomOrder): Promise<void>;
  /** Every OPEN order regardless of age, plus closed ones from the last
      `days`. The first version filtered everything on createdAt and it was a
      real bug, not a maybe: weddings book up to six months out (site.ts's own
      words), so an open order created in June for September would have
      silently left the board in August, still unmade. Open orders never age
      off; only finished ones do. */
  listOrders(days: number): Promise<WorkroomOrder[]>;
  setOrderStatus(id: string, status: OrderStatus): Promise<void>;
  addStemEvent(e: StemEvent): Promise<void>;
  listStemEvents(days: number): Promise<StemEvent[]>;
  /** Mis-keyed counts happen at 7am. A delete, not an edit: retyping five
      fields beats an edit UI nobody will maintain. */
  deleteStemEvent(id: string): Promise<void>;
  upsertRecipe(r: Recipe): Promise<void>;
  listRecipes(): Promise<Recipe[]>;
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
};

function bag(): Bag {
  const g = globalThis as typeof globalThis & { __devineWorkroom?: Bag };
  if (!g.__devineWorkroom) {
    g.__devineWorkroom = { orders: new Map(), stems: new Map(), recipes: new Map() };
  }
  return g.__devineWorkroom;
}

const cutoff = (days: number) => Date.now() - days * 86_400_000;

const memoryStore: Store = {
  backend: "memory",
  async createOrder(o) {
    bag().orders.set(o.id, o);
  },
  async listOrders(days) {
    const open = (o: WorkroomOrder) => o.status !== "done" && o.status !== "canceled";
    return [...bag().orders.values()]
      .filter((o) => open(o) || o.createdAt >= cutoff(days))
      .sort((a, b) => a.createdAt - b.createdAt);
  },
  async setOrderStatus(id, status) {
    const o = bag().orders.get(id);
    if (o) o.status = status;
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
    `);
  }
  await g.__devinePgReady;
  return g.__devinePgPool;
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
    const r = await pool.query(
      `SELECT data FROM workroom_orders
       WHERE status NOT IN ('done', 'canceled') OR created_at >= $1
       ORDER BY created_at ASC LIMIT 500`,
      [cutoff(days)],
    );
    return r.rows.map((row) => row.data as WorkroomOrder);
  },
  async setOrderStatus(id, status) {
    const pool = await pgPool();
    await pool.query(
      `UPDATE workroom_orders SET status = $2, data = data || jsonb_build_object('status', $2::text) WHERE id = $1`,
      [id, status],
    );
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
      `SELECT data FROM workroom_stems WHERE created_at >= $1 ORDER BY created_at ASC LIMIT 2000`,
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
};

export function getStore(): Store {
  return connectionString() ? postgresStore : memoryStore;
}
