/**
 * The season preview switch. GET /api/season?set=winter puts the demo in
 * winter; ?set=today hands the calendar back the wheel. A cookie rather than a
 * query string so the preview survives navigation: flip to winter once, browse
 * the whole demo in winter. See lib/seasons.ts for what a preview changes.
 *
 * Session cookie on purpose. A preview that quietly persisted for days would
 * mean the owner opens her demo in March and sees Christmas, with nothing on
 * screen saying why.
 */
import { NextResponse } from "next/server";
import { isPreviewSlug, SEASON_COOKIE } from "@/lib/seasons";

export function GET(req: Request) {
  const url = new URL(req.url);
  const set = url.searchParams.get("set") ?? "";

  // Back to the page the link was clicked on, same origin only, else the demo
  // home. The footer link cannot know its own page server side; the referer does.
  let to = "/demo";
  const ref = req.headers.get("referer");
  if (ref) {
    try {
      const r = new URL(ref);
      if (r.origin === url.origin) to = r.pathname + r.search;
    } catch {
      /* an unparseable referer just falls back to /demo */
    }
  }

  // 303: this is a GET acting like a form submit, and the redirect must be a GET.
  const res = NextResponse.redirect(new URL(to, url.origin), 303);
  if (set === "today") {
    res.cookies.delete(SEASON_COOKIE);
  } else if (isPreviewSlug(set)) {
    res.cookies.set(SEASON_COOKIE, set, { path: "/", sameSite: "lax", httpOnly: true });
  }
  // An unknown ?set= value sets nothing and just goes back. Not worth an error
  // page: the only authors of these links are the footer and a typed URL.
  return res;
}
