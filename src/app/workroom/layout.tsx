import type { Metadata } from "next";
import WorkroomChrome from "@/components/workroom/Chrome";

/**
 * The workroom's shell: none of the shop's marketing chrome, all of its
 * tokens. It sits OUTSIDE /demo on purpose — it is not part of the customer
 * demo, it is the shop's tool, and it does not move when /demo/* graduates to
 * /* on launch day. The host-wide noindex covers it while this is a pitch;
 * robots below keeps covering it after (an order board has no business in a
 * search index either way).
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
      <style>{`.wr-main h1 { font-size: clamp(30px, 4.6vw, 46px); }`}</style>
    </>
  );
}
