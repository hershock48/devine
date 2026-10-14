import "server-only";
import { resolveSquare } from "./oauth";

/**
 * ARE CARDS ON? One answer for the checkout's config route and the order
 * route, so the cart and the server can never disagree: the switch is
 * literally "on", the Glazed app id is set, and Square resolves (her
 * OAuth grant, or the env token). Any of the three missing and the site
 * is in call mode everywhere: the cart offers no card, and the server
 * accepts an unpaid order as it always did.
 */
export async function cardsEnabled(): Promise<{ on: false } | { on: true; appId: string; cfg: NonNullable<Awaited<ReturnType<typeof resolveSquare>>> }> {
  if (process.env.CHECKOUT_CARDS?.trim() !== "on") return { on: false };
  const appId = process.env.SQUARE_APP_ID?.trim();
  if (!appId) return { on: false };
  const cfg = await resolveSquare();
  if (!cfg) return { on: false };
  return { on: true, appId, cfg };
}
