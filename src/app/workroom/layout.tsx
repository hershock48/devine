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
      <main id="main" className="section" style={{ paddingTop: "calc(var(--u) * 4)" }}>
        <div className="wrap" style={{ maxWidth: 1080 }}>{children}</div>
      </main>
    </>
  );
}
