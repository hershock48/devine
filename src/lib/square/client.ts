import "server-only";

/**
 * Square, spoken over plain fetch.
 *
 * Square keeps the counter and we keep the brain: the shop already owns a
 * Square register, and her actual complaint is retyping everything from IRIS
 * into it. So the integration is two pipes. This file is the shared plumbing;
 * the pipes live next door in sync.ts (catalog out) and the webhook route
 * (sales in).
 *
 * No Square SDK, deliberately. The four calls this repo makes are small JSON
 * over HTTPS, and glaze.md's rule about not renting what can be written
 * applies to dependencies too: the SDK is a large package that would be doing
 * fetch with types. The types we need are declared where they are used.
 *
 * SANDBOX BY DEFAULT. SQUARE_ENV must literally read "production" to touch
 * the real register. Any other value, including unset, talks to
 * connect.squareupsandbox.com, where a test account and a virtual register
 * live. A typo therefore lands in the sandbox, not in the shop.
 *
 * The Square-Version header is only sent when SQUARE_VERSION is set. Unset,
 * the API version pinned on the app in Square's developer dashboard governs,
 * which for a freshly created app is current. Pin it in the dashboard (or
 * here) once the integration is proven, so a Square release cannot change
 * behavior under us.
 */

export type SquareConfig = {
  token: string;
  base: string;
  env: "sandbox" | "production";
  locationId: string;
};

/** Null means "this deployment has no Square", and callers say so plainly. */
export function squareConfig(): SquareConfig | null {
  const token = process.env.SQUARE_ACCESS_TOKEN?.trim();
  const locationId = process.env.SQUARE_LOCATION_ID?.trim();
  if (!token || !locationId) return null;
  const env = process.env.SQUARE_ENV?.trim() === "production" ? "production" : "sandbox";
  return {
    token,
    env,
    locationId,
    base: env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com",
  };
}

export class SquareError extends Error {
  status: number;
  body: unknown;
  constructor(path: string, status: number, body: unknown) {
    // Square's error bodies are an array of {category, code, detail}; the
    // whole thing goes in the message because "402 on /v2/catalog/batch-upsert"
    // alone has cost debugging hours on other integrations.
    super(`Square ${status} on ${path}: ${JSON.stringify(body).slice(0, 600)}`);
    this.status = status;
    this.body = body;
  }
}

export async function square<T>(
  cfg: SquareConfig,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.token}`,
    "Content-Type": "application/json",
  };
  const version = process.env.SQUARE_VERSION?.trim();
  if (version) headers["Square-Version"] = version;

  const res = await fetch(`${cfg.base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    // Square answers are per-request state, never CDN-cacheable.
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new SquareError(path, res.status, json);
  return json;
}
