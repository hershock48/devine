import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getStore, type SquareTokens } from "@/lib/workroom/store";
import { square, squareConfig, type SquareConfig } from "./client";

/**
 * OAuth: the owner's Square account, connected through the Glazed app.
 *
 * Two Square accounts are in play and the distinction is the whole design.
 * The SHOP's account owns the register, the catalog and the money. GLAZED's
 * developer account owns the application (SQUARE_APP_ID / SQUARE_APP_SECRET)
 * that the shop authorizes. Payments created with a token issued through
 * that authorization can carry app_fee_money, the platform's per-order fee,
 * which accrues to the Glazed account. A plain access token pasted from the
 * shop's own dashboard can do everything else, but it can NEVER carry an app
 * fee. That is why this file exists instead of a second pasted token.
 *
 * Square's OAuth differs from the RFC default in one convenient way: the
 * redirect URL is registered in the app dashboard and is never sent as a
 * request parameter. So there is no origin derivation behind Vercel's proxy
 * to get subtly wrong; the URL typed into the dashboard is simply where
 * Square sends the browser back.
 *
 * The state parameter is minted and verified here, stateless: a timestamp
 * plus an HMAC over it, keyed with the app secret. Nobody without the secret
 * can mint one, so a forged callback carrying an attacker's authorization
 * code is refused before any exchange. Ten minutes of validity, which is a
 * person clicking "Allow", not a build pipeline.
 */

const STATE_TTL_MS = 10 * 60_000;

/** Everything OAuth needs about the Glazed app, or null meaning "this
    deployment has no platform app configured". */
export type SquareApp = {
  appId: string;
  secret: string;
  env: "sandbox" | "production";
  base: string;
};

export function squareApp(): SquareApp | null {
  const appId = process.env.SQUARE_APP_ID?.trim();
  const secret = process.env.SQUARE_APP_SECRET?.trim();
  if (!appId || !secret) return null;
  const env = process.env.SQUARE_ENV?.trim() === "production" ? "production" : "sandbox";
  return {
    appId,
    secret,
    env,
    base: env === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com",
  };
}

/**
 * Requested up front, all of them, because Square scopes are granted at
 * authorization time: adding one later means asking the owner to reconnect.
 * PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS is the one that permits
 * app_fee_money, requested now even though the site does not yet take cards
 * online, so turning cards on later is a deploy and not a reconnect.
 */
const SCOPES = [
  "MERCHANT_PROFILE_READ",
  "ITEMS_READ",
  "ITEMS_WRITE",
  "ORDERS_READ",
  "ORDERS_WRITE",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE",
  "PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS",
];

export function mintState(app: SquareApp): string {
  const ts = Date.now().toString(36);
  const mac = createHmac("sha256", app.secret).update(ts).digest("base64url");
  return `${ts}.${mac}`;
}

export function stateOk(app: SquareApp, state: string | null): boolean {
  if (!state) return false;
  const [ts, mac] = state.split(".");
  if (!ts || !mac) return false;
  const expected = createHmac("sha256", app.secret).update(ts).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return false;
  const minted = parseInt(ts, 36);
  return Number.isFinite(minted) && Date.now() - minted < STATE_TTL_MS;
}

export function authorizeUrl(app: SquareApp): string {
  const q = new URLSearchParams({
    client_id: app.appId,
    scope: SCOPES.join(" "),
    state: mintState(app),
  });
  return `${app.base}/oauth2/authorize?${q}`;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: string;
  merchant_id?: string;
  errors?: unknown;
};

async function tokenCall(app: SquareApp, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${app.base}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: app.appId, client_secret: app.secret, ...body }),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new Error(`Square oauth2/token ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 400)}`);
  }
  return json;
}

type LocationsResponse = {
  locations?: { id?: string; name?: string; status?: string }[];
};

/**
 * The full exchange: authorization code in, stored grant out. The location
 * is picked here, once, because sync and payments both need one and asking
 * the owner to find a location id in a dashboard is not a step that should
 * exist. A shop with one active location (this shop) gets that one; more
 * than one active gets the first, named in the stored record so a wrong
 * pick is visible rather than mysterious.
 */
export async function exchangeCode(app: SquareApp, code: string): Promise<SquareTokens> {
  const t = await tokenCall(app, { grant_type: "authorization_code", code });
  const probe: SquareConfig = {
    token: t.access_token!,
    base: app.base,
    env: app.env,
    locationId: "",
  };
  const { locations } = await square<LocationsResponse>(probe, "GET", "/v2/locations");
  const active = (locations ?? []).filter((l) => l.status === "ACTIVE" && l.id);
  if (active.length === 0) throw new Error("Square account has no active location.");
  return {
    accessToken: t.access_token!,
    refreshToken: t.refresh_token!,
    expiresAt: t.expires_at ?? "",
    merchantId: t.merchant_id ?? "",
    locationId: active[0].id!,
    locationName: active[0].name ?? "",
    connectedAt: Date.now(),
  };
}

/** Days until the access token dies; 0 for expired or unparsable. */
function daysLeft(t: SquareTokens): number {
  const at = Date.parse(t.expiresAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, (at - Date.now()) / 86_400_000);
}

/**
 * A SquareConfig plus where its authority came from, because one caller
 * cares: app_fee_money is only legal on payments made with an OAuth token,
 * so payments.ts refuses to attach the fee to an env-token config rather
 * than sending a request Square will reject wholesale.
 */
export type ResolvedSquare = SquareConfig & { viaOAuth: boolean };

/**
 * The one config resolver routes should use. Order of preference:
 *
 * 1. The stored OAuth grant, refreshed when inside its last week. Access
 *    tokens live about 30 days and this app may go quiet for longer than
 *    that, so refresh happens lazily on use rather than on a schedule. A
 *    failed refresh keeps the current token if it still has life in it;
 *    a dead token with a failed refresh falls through to (2) instead of
 *    pretending.
 * 2. The env-token config from client.ts, which remains the whole sandbox
 *    story and the local-dev story.
 * 3. null, and callers keep saying "Square is not configured" plainly.
 */
export async function resolveSquare(): Promise<ResolvedSquare | null> {
  const app = squareApp();
  if (app) {
    let t: SquareTokens | null = null;
    try {
      t = await getStore().getSquareTokens();
    } catch {
      // A cold Neon start should degrade to the env token, not throw the
      // webhook into a retry loop over config resolution.
      t = null;
    }
    if (t) {
      if (daysLeft(t) < 7) {
        try {
          const fresh = await tokenCall(app, { grant_type: "refresh_token", refresh_token: t.refreshToken });
          t = {
            ...t,
            accessToken: fresh.access_token!,
            refreshToken: fresh.refresh_token!,
            expiresAt: fresh.expires_at ?? t.expiresAt,
          };
          await getStore().setSquareTokens(t);
        } catch (err) {
          if (daysLeft(t) <= 0) {
            console.error("square oauth: token expired and refresh failed; falling back to env token", err);
            t = null;
          } else {
            console.error("square oauth: refresh failed, using current token while it lasts", err);
          }
        }
      }
      if (t) {
        return {
          token: t.accessToken,
          base: app.base,
          env: app.env,
          // An env override survives on purpose: a multi-location future
          // client can pin the location without a reconnect.
          locationId: process.env.SQUARE_LOCATION_ID?.trim() || t.locationId,
          viaOAuth: true,
        };
      }
    }
  }
  const env = squareConfig();
  return env ? { ...env, viaOAuth: false } : null;
}

/** Disconnect: revoke at Square, then forget. Revocation is best effort;
    the stored grant is cleared even if Square cannot be reached, because
    "the owner asked to disconnect and we kept the token" is the worse bug. */
export async function revokeAndClear(app: SquareApp): Promise<void> {
  const t = await getStore().getSquareTokens().catch(() => null);
  if (t) {
    await fetch(`${app.base}/oauth2/revoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Client ${app.secret}`,
      },
      body: JSON.stringify({ client_id: app.appId, access_token: t.accessToken }),
      cache: "no-store",
    }).catch((err) => console.error("square oauth: revoke did not reach Square", err));
  }
  await getStore().clearSquareTokens();
}
