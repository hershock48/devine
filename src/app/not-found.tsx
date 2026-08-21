import Link from "next/link";

/**
 * THE 404, STYLED, BECAUSE THE DEFAULT ONE WAS SHIPPING.
 *
 * Next's built-in not-found page was serving on every bad URL: framework styling
 * that matches nothing on this site, and (per the audit) two <title> elements in
 * one document. A visitor lands here from exactly two places — a mistyped link or
 * a link to something that moved — and both deserve the site's own voice and a
 * way back in, not a stack trace aesthetic.
 *
 * This is the ROOT not-found, so it renders inside the root layout, which has no
 * header or footer (the root of this host is the proposal, a static file the
 * layout never touches). Hence the self-contained centering and the explicit link
 * to the demo's front door. The demo segment has its own not-found next to its
 * layout, which does get the full chrome.
 */
export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "48px 24px",
        background: "var(--paper)",
      }}
    >
      <p className="kicker">404</p>
      <h1 style={{ fontSize: "clamp(38px, 6vw, 64px)", maxWidth: "16ch", textWrap: "balance" }}>
        Nothing growing at this address.
      </h1>
      <p className="lede" style={{ margin: "0 auto" }}>
        The page may have moved, or the link had a typo in it.
      </p>
      <p className="btnrow" style={{ justifyContent: "center" }}>
        <Link className="btn btn--solid" href="/demo">
          The shop
        </Link>
        <Link className="btn" href="/">
          The proposal
        </Link>
      </p>
    </main>
  );
}
