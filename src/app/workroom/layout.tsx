import type { Metadata } from "next";
import WorkroomChrome from "@/components/workroom/Chrome";

/**
 * The workroom's shell: none of the shop's marketing chrome, all of its
 * tokens. It sits OUTSIDE the storefront's (shop) route group on purpose: it
 * is the shop's tool, not part of what customers see, and the storefront's
 * layout (header, footer, cart) must never wrap it. robots below keeps it out
 * of search results, and robots.txt keeps crawlers off it (an order board
 * has no business in a search index).
 */
export const metadata: Metadata = {
  title: { default: "Workroom · DeVine's", template: "%s · Workroom · DeVine's" },
  description: "DeVine's order board and stem tracker.",
  robots: { index: false, follow: false },
};

export default function WorkroomLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <WorkroomChrome />
      <main id="main" className="section wr-main" style={{ paddingTop: "calc(var(--u) * 4)" }}>
        <div className="wrap" style={{ maxWidth: 1080 }}>{children}</div>
      </main>
      {/* The workroom's page titles at TOOL scale, once, for every screen.
          The shop's display h1 (up to 92px) is a marketing voice; on a
          counter screen it spent the top third of a phone on a word the tab
          bar already says, and the Dashboard had shrunk its own h1 in
          protest, so the seven pages disagreed. Still the serif, still the
          first thing on the page, just sized for work. */}
      {/* Print isolation for the whole workroom: the quote builders print a
          family-facing document (#quote-doc) and hide their own app, but the
          chrome lives OUTSIDE their wrappers, so the tab bar printed at the
          top of a funeral quote handed across the counter (Kevin caught it,
          2026-09-02). Nothing back-of-house reaches paper. */}
      <style>{`
        .wr-main h1 { font-size: clamp(30px, 4.6vw, 46px); }
        @media print {
          .wr-chrome { display: none !important; }
          .wr-main { padding: 0 !important; }
        }
      `}</style>
    </>
  );
}
