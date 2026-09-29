import { NextResponse } from "next/server";
import { exchangeCode, squareApp, stateOk } from "@/lib/square/oauth";
import { getStore } from "@/lib/workroom/store";

/**
 * Where Square sends the owner's browser back. Not behind the workroom
 * gate, because Square's redirect arrives as a bare browser navigation;
 * what stands in for the gate is the state check: the state was minted by
 * /api/square/connect with the app secret, so a request that never went
 * through the gated front door cannot carry a valid one.
 *
 * Outcomes land on /workroom/payments (the owner's Square panel) as a query flag rather than a JSON blob,
 * because the person seeing them is the owner mid-click, not curl.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A page that forwards itself, not a 302. The workroom cookie is
    SameSite=Strict, and a redirect chain that began at squareup.com is a
    cross-site navigation all the way down, so a 302 landed the owner on the
    sign-in screen with the outcome lost. A navigation started by this page
    is same-site, and the cookie goes with it. */
function done(req: Request, flag: string): NextResponse {
  const to = `/workroom/payments?square=${encodeURIComponent(flag)}`;
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to}"><title>Square</title><p><a href="${to}">Back to the workroom</a></p>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(req: Request) {
  const app = squareApp();
  if (!app) return done(req, "unconfigured");

  const url = new URL(req.url);
  // The owner clicked Deny, or Square reported a failure. Either way there
  // is nothing to exchange and nothing secret to say about it.
  if (url.searchParams.get("error")) return done(req, "denied");

  const code = url.searchParams.get("code");
  if (!code || !stateOk(app, url.searchParams.get("state"))) return done(req, "badstate");

  if (getStore().backend !== "postgres") return done(req, "nodatabase");

  try {
    const tokens = await exchangeCode(app, code);
    await getStore().setSquareTokens(tokens);
    return done(req, "connected");
  } catch (err) {
    console.error("square oauth: exchange failed", err);
    return done(req, "failed");
  }
}
