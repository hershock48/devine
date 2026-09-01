"use client";

import { usePathname } from "next/navigation";
import { site } from "@/lib/site";

/**
 * THE WORKROOM'S HEADER. One place, every page.
 *
 * Each screen used to carry its own two-link nav written by hand, which meant
 * three different navs, none of them saying where you were, and no way back
 * out to the customer site. This is the whole back-of-house in one strip:
 * where you are, where else you can go, and the door out.
 *
 * Deliberately NOT the shop's header. The customer chrome is a shopfront —
 * logo, cart, delivery line. This is a tool bar on a counter screen: small,
 * dense, unglamorous, and it never scrolls away, because the board is long
 * and the tabs should not be a scroll-to-top errand.
 */

const TABS = [
  { href: "/workroom", label: "Orders" },
  { href: "/workroom/week", label: "This week" },
  { href: "/workroom/stems", label: "Stems & shrink" },
  { href: "/workroom/inventory", label: "Inventory" },
  { href: "/workroom/weekly-order", label: "Weekly order" },
  { href: "/workroom/plants", label: "Plants" },
  { href: "/workroom/quotes", label: "Quotes" },
];

export default function WorkroomChrome() {
  const path = usePathname() || "/workroom";

  /* /workroom matches only itself; the others own their whole subtree, so a
     single quote at /workroom/quotes/<id> still lights the Quotes tab. The
     boundary slash matters: a bare startsWith lit This week (/workroom/week)
     on the Weekly order page (/workroom/weekly-order). */
  const isActive = (href: string) =>
    href === "/workroom" ? path === href : path === href || path.startsWith(href + "/");

  async function lock() {
    await fetch("/api/workroom/logout", { method: "POST" });
    window.location.href = "/workroom";
  }

  return (
    <header className="wr-chrome">
      <div className="wr-chrome-in">
        <div className="wr-brand">
          <span className="wr-shop">{site.shortName}</span>
          <span className="wr-word">Workroom</span>
        </div>

        <nav className="wr-tabs" aria-label="Workroom">
          {TABS.map((t) => (
            <a key={t.href} href={t.href} aria-current={isActive(t.href) ? "page" : undefined}>
              {t.label}
            </a>
          ))}
        </nav>

        <div className="wr-right">
          {/* The way back to what the customer sees. Opens in a new tab so the
              board is never lost behind a shop page. */}
          <a href="/demo" target="_blank" rel="noreferrer">
            The shop <span aria-hidden="true">↗</span>
          </a>
          {/* A shared screen on a counter needs a way to close itself. */}
          <button type="button" onClick={lock}>Lock</button>
        </div>
      </div>

      <style>{`
        .wr-chrome {
          position: sticky; top: 0; z-index: 30;
          background: var(--paper-2);
          border-bottom: 1px solid var(--line);
        }
        .wr-chrome-in {
          max-width: 1080px; margin: 0 auto;
          padding: 8px 24px;
          display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
        }
        .wr-brand { display: flex; align-items: baseline; gap: 8px; flex: 0 0 auto; }
        .wr-shop { font-family: var(--serif); font-size: 19px; line-height: 1; }
        .wr-word {
          font-size: 10px; font-weight: 700; letter-spacing: .16em;
          text-transform: uppercase; color: var(--muted);
        }
        .wr-tabs { display: flex; gap: 18px; flex: 1 1 auto; flex-wrap: wrap; }
        .wr-tabs a {
          font-size: 12px; font-weight: 700; letter-spacing: .1em;
          text-transform: uppercase; text-decoration: none; color: var(--ink);
          padding: 9px 1px; border-bottom: 2px solid transparent; white-space: nowrap;
        }
        .wr-tabs a:hover { color: var(--green); }
        .wr-tabs a[aria-current="page"] { color: var(--green); border-bottom-color: var(--green); }
        .wr-right { display: flex; align-items: center; gap: 16px; flex: 0 0 auto; }
        .wr-right a, .wr-right button {
          font-size: 12px; font-weight: 600; letter-spacing: .04em;
          color: var(--muted); text-decoration: none;
          background: none; border: 0; font-family: inherit;
          cursor: pointer; padding: 9px 1px;
        }
        .wr-right a:hover, .wr-right button:hover { color: var(--rose-ink); }
        /* On a phone the brand and the door out share the first line and the
           tabs take the second, rather than three things fighting for one. */
        @media (max-width: 700px) {
          .wr-chrome-in { padding: 6px 20px; gap: 0 14px; }
          .wr-brand { order: 1; }
          .wr-right { order: 2; margin-left: auto; }
          .wr-tabs { order: 3; width: 100%; gap: 14px; }
          .wr-tabs a { font-size: 11.5px; letter-spacing: .08em; padding: 7px 1px; }
        }
      `}</style>
    </header>
  );
}
