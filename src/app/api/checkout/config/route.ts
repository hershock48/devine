import { NextResponse } from "next/server";
import { cardsEnabled } from "@/lib/square/cards";
import { appFeeCents } from "@/lib/square/payments";

/**
 * What the public checkout needs to know about card payment. Unauthenticated
 * on purpose: the application id and location id are public identifiers by
 * design (they sit in the page source of every site using the Web Payments
 * SDK), and nothing else leaves here.
 *
 * THE SWITCH: cards are offered only while CHECKOUT_CARDS is literally
 * "on". The code shipped before the switch was flipped, deliberately; the
 * agreement's Exhibit A says online checkout starts when both parties agree
 * in writing, and an env variable Kevin flips IS that start, not a deploy.
 * Off, or with Square unconnected, checkout behaves exactly as before:
 * order in, payment on the confirming call.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cards = await cardsEnabled();
  if (!cards.on) return NextResponse.json({ cards: false });
  return NextResponse.json({
    cards: true,
    applicationId: cards.appId,
    locationId: cards.cfg.locationId,
    env: cards.cfg.env,
    // The whole Convenience fee since 2026-10-06: the 99 cent platform fee
    // alone, the shop's 3% card fee being retired (site.ts).
    feeCents: cards.cfg.viaOAuth ? appFeeCents() : 0,
  });
}
