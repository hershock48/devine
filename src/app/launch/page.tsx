import type { Metadata } from "next";
import { getStore } from "@/lib/workroom/store";
import { resolveSquare } from "@/lib/square/oauth";
import { agreement } from "@/lib/agreement";
import "../agreement/agreement.css";
import "./launch.css";

/**
 * THE LAUNCH PLAN. The document that starts where the proposal's job ends:
 * the selling is over, and what the owner needs now is orientation, not
 * persuasion. What happens in what order, what only she can supply, and
 * where things stand today.
 *
 * TWO RULES SHAPE EVERYTHING HERE.
 *
 * No restated terms: every phrase about money or scope links to /agreement
 * instead of repeating it, because two descriptions of the same deal drift
 * the moment one gets edited, and then the client quotes whichever favors
 * them. Not one dollar figure appears on this page.
 *
 * No hand-updated status: each light is either read live (the acceptance
 * store, the Square connection) or an env flag Kevin flips in Vercel
 * (LAUNCH_FLAGS="deposit,content,domain" - same pattern as CHECKOUT_CARDS,
 * where flipping the var IS the milestone). A status page someone has to
 * remember to edit is a status page that lies within a month.
 *
 * RETIREMENT: at domain cutover the pitch letter and test drive retire
 * (next.config.ts already promises that); this page stays as the delivery
 * tracker until every light is lit, then the folder gets deleted the same
 * way. It never becomes a permanent page.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Launch Plan · Glazed Web × DeVine's Flowers & Botanicals",
  description: "The road from the demo to the shop running on it: where things stand, what happens next, and what we need from you.",
  robots: { index: false, follow: false },
};

async function readLights() {
  // Booleans only, agreement-GET style: the page says whether, never what.
  // Only an acceptance of the CURRENT version counts: the store also holds
  // a test acceptance from proving the flow (v1.0 era), and the first
  // production render of this page showed Signed lit before anyone signed.
  // A signature on a superseded version is not the current signed state
  // anyway, so the honest filter and the bug fix are the same line.
  let signed = false;
  try {
    signed = (await getStore().listAgreementAcceptances()).some((a) => a.version === agreement.version);
  } catch {
    // An unreachable store reads as not-yet, never as an error page.
  }
  let square = false;
  try {
    const cfg = await resolveSquare();
    square = !!cfg && cfg.env === "production";
  } catch {}
  const flags = new Set(
    (process.env.LAUNCH_FLAGS || "").split(",").map((f) => f.trim().toLowerCase()).filter(Boolean),
  );
  return [
    { label: "Signed", lit: signed },
    { label: "Deposit in", lit: flags.has("deposit") },
    { label: "Square connected", lit: square },
    { label: "Content in", lit: flags.has("content") },
    { label: "Domain live", lit: flags.has("domain") },
  ];
}

/** What only the shop can supply, ordered by what each item unblocks. */
const ASKS: { what: React.ReactNode; why: string }[] = [
  {
    what: (
      <>
        Your name and the business entity, signed at <a href="/agreement">the agreement</a>.
      </>
    ),
    why: "Unblocks everything below. The terms and numbers live there, one tap away, and this page never repeats them.",
  },
  {
    what: (
      <>
        The build fee, at your pace, from <a href="/agreement">the agreement</a>.
      </>
    ),
    why: "Unblocks the build schedule. Your choice: the deposit now with the balance due on launch, or the full amount up front and done. The agreement page is where you pay either one.",
  },
  {
    what: "Your Square account, connected to the site.",
    why: "Unblocks real card payments, online and at the board. Today the site runs on Square’s practice sandbox, which is why the test card works; connecting your account is a short guided step we do together.",
  },
  {
    what: "Your domain, or access to wherever it is registered.",
    why: "Unblocks the cutover: the day your address serves this site instead of the old one.",
  },
  {
    what: "Your delivery zones and rates, confirmed.",
    why: "Unblocks the delivery-distance work: miles from the shop on every order, and a delivery fee you can adjust per order.",
  },
  {
    what: "Wedding photos, as many as you like.",
    why: "Unblocks the wedding gallery. The page becomes a portfolio of your own work, so the best pictures win.",
  },
  {
    what: "The word on the funeral pad.",
    why: "Unblocks that cleanup: whether the pad’s notes get their own labeled block on the order or go away.",
  },
  {
    what: "Your house-account customers, and what each may run up.",
    why: "Unblocks house and business accounts: the tab, the credit limit, the month-end invoice, the on and off switch.",
  },
  {
    what: "Your chosen workroom PINs, told to Kevin by phone.",
    why: "Unblocks your staff on the real board. Spoken, never written down, and never sent by email.",
  },
];

const PHASES: { name: string; what: string; wait?: string }[] = [
  {
    name: "Live now",
    what: "The store, ordering, the workroom board, phone write-ups, card and cash payments, receipts and delivery notes by email, inventory and the dashboard. Everything the test drive walks you through.",
  },
  {
    name: "Addresses and delivery",
    what: "Address checking as orders come in, miles from the shop on every order, and a delivery fee you can adjust before charging.",
    wait: "Waiting on item 5.",
  },
  {
    name: "Orders that bend",
    what: "Editing an order after it is placed, and delivery time windows a customer can ask for.",
  },
  {
    name: "House accounts",
    what: "Business and house accounts laid out plainly: who owes what, credit limits, cards kept on file with Square, and month-end invoices sent from the workroom.",
    wait: "Waiting on item 8.",
  },
  {
    name: "Weddings and big orders",
    what: "Deposits with paid and owed tracked, split payments, and the wedding page rebuilt as a gallery of your work.",
    wait: "Waiting on item 6 for the gallery.",
  },
];

export default async function LaunchPage() {
  const lights = await readLights();
  return (
    <main className="agr">
      <p className="agr-kicker">Glazed Web × DeVine&rsquo;s Flowers &amp; Botanicals</p>
      <h1>The launch plan.</h1>
      <p>
        You have driven the site, written up orders, and taken a payment or two on the practice
        card. This page is the road from that demo to your shop running on it for real: where
        things stand, what happens in what order, and the short list only you can supply. It
        updates itself as things move, so it is always current when you open it.
      </p>

      <h2>Where things stand</h2>
      <ul className="lp-lights">
        {lights.map((l) => (
          <li key={l.label} className={l.lit ? "lp-lit" : "lp-unlit"}>
            <span className="lp-dot" aria-hidden="true" />
            {l.label}
            <span className="sr-only">{l.lit ? ": done" : ": not yet"}</span>
          </li>
        ))}
      </ul>

      <h2>What we need from you</h2>
      <p>
        In order, because the early ones unblock the later ones. Most are a phone call or a
        forwarded email; none of them is homework.
      </p>
      <ol className="lp-asks">
        {ASKS.map((a, i) => (
          <li key={i}>
            <p className="lp-ask-what">{a.what}</p>
            <p className="lp-ask-why">{a.why}</p>
          </li>
        ))}
      </ol>

      <h2>What we are building, in order</h2>
      {PHASES.map((p) => (
        <p key={p.name} className="lp-phase">
          <strong>{p.name}.</strong> {p.what}
          {p.wait ? <span className="lp-wait"> {p.wait}</span> : null}
        </p>
      ))}
      <p className="agr-note">
        What each piece costs and what is included lives in one place,{" "}
        <a href="/agreement">the agreement</a>, so this page can never disagree with it.
      </p>

      <h2>Your pages</h2>
      <ul className="lp-links">
        <li>
          <a href="/demo">The site</a>
        </li>
        <li>
          <a href="/workroom">The workroom</a>
        </li>
        <li>
          <a href="/test-drive">The test drive</a>
        </li>
        <li>
          <a href="/agreement">The agreement</a>
        </li>
      </ul>

      <h2>After launch</h2>
      <p>
        The monthly service is simple: the site stays up, secure, backed up, and yours to change.
        Minor edits are a text to Kevin: a new arrangement, a price, a workshop date, holiday
        hours. Bigger asks get a written quote first, and nothing lands on a bill unannounced.
        The agreement carries the numbers.
      </p>

      <p className="agr-note" style={{ marginTop: "calc(var(--u) * 4)" }}>
        Glazed Web · Kevin Hershock · Marshall, Michigan · kevin@glazedweb.com
      </p>
    </main>
  );
}
