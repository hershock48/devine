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
 * where things stand today. Layout follows the studio's project page
 * (glazedweb repo, /build/{slug}, spec in glaze/project-page.md), living in
 * THIS repo because DeVine's agreement and data live on this host.
 *
 * TWO RULES SHAPE EVERYTHING HERE.
 *
 * No restated terms: every phrase about money or scope links to /agreement
 * instead of repeating it, because two descriptions of the same deal drift
 * the moment one gets edited, and then the client quotes whichever favors
 * them. Not one dollar figure appears on this page. The same rule holds for
 * the ask list: the letter points HERE instead of carrying its own copy.
 *
 * No hand-updated status where live truth exists: Signed reads the
 * acceptance store; Square connected reads the real Square resolution; the
 * build fee and the monthly read the studio pay rail through its
 * booleans-only endpoint (glazedweb.com/api/build-status/devine), so no
 * Stripe key ever enters this repo. What cannot be read is ticked by hand:
 * the ask list's dots (ASKS below, `done` flipped as things arrive - the
 * honest state is what we have actually received) and the domain light
 * (LAUNCH_FLAGS="domain", flipped in Vercel at cutover).
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

type LightState = "lit" | "half" | "off";

async function readStatus() {
  // Booleans only, agreement-GET style: the page says whether, never what.
  // Only an acceptance of the CURRENT version counts: the store also holds
  // a test acceptance from proving the flow (v1.0 era), and the first
  // production render of this page showed Signed lit before anyone signed.
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
  // The money lights, live from the studio pay rail. "off" and "due" both
  // render unlit, so a railside hiccup can never claim an unpaid fee, and
  // a fetch failure reads as not-yet, same as the store above.
  let build: LightState = "off";
  let monthly = false;
  try {
    const r = await fetch("https://www.glazedweb.com/api/build-status/devine", { cache: "no-store" });
    if (r.ok) {
      const d = (await r.json()) as { build?: string; monthly?: boolean };
      build = d.build === "paid" ? "lit" : d.build === "half" ? "half" : "off";
      monthly = d.monthly === true;
    }
  } catch {}
  const flags = new Set(
    (process.env.LAUNCH_FLAGS || "").split(",").map((f) => f.trim().toLowerCase()).filter(Boolean),
  );
  return { signed, square, build, monthly, domain: flags.has("domain") };
}

/** What only the shop can supply, ordered by what each item unblocks. The
    dots are ticked by US, by flipping `done` here as things arrive; this is
    the one copy of the list, and the letter points at it. */
const ASKS: { what: React.ReactNode; why: React.ReactNode; done: boolean }[] = [
  {
    what: (
      <>
        Your name and the business entity, signed at <a href="/agreement">the agreement</a>.
      </>
    ),
    why: "Unblocks everything below. The terms and numbers live there, one tap away, and this page never repeats them.",
    done: false,
  },
  {
    what: (
      <>
        The build fee, at your pace, from <a href="/agreement">the agreement</a>.
      </>
    ),
    why: "Unblocks the build schedule. Your choice: the deposit now with the balance due on launch, the full amount up front and done, or the full amount with the monthly started right away so everything is set up in one sitting. The agreement page is where you pay.",
    done: false,
  },
  {
    what: "Your Square account, connected to the site.",
    why: "Unblocks real card payments, online and at the board. Today the site runs on Square's practice sandbox, which is why the test card works; connecting your account is a short guided step we do together.",
    done: false,
  },
  {
    what: "Your domain, or access to wherever it is registered.",
    why: "Unblocks the cutover: the day your address serves this site instead of the old one.",
    done: false,
  },
  {
    what: (
      <>
        Photos of your designs, through <a href="/photos">your photos page</a>.
      </>
    ),
    why: "Unblocks the shop pages selling at full strength. Twenty designs have a photograph on the new site; the rest can only be read about, and a flower customer buys the photograph. The page lists every design still waiting, in the order that helps most; tap one, pick the shot from your phone, and it is sent.",
    done: false,
  },
  {
    what: "Your delivery zones and rates, confirmed.",
    why: "Unblocks the delivery-distance work: miles from the shop on every order, and a delivery fee you can adjust before charging.",
    done: false,
  },
  {
    what: "Your wedding pricing spreadsheet, exactly as it is.",
    why: "Unblocks the wedding quote math becoming yours instead of a stand-in.",
    done: false,
  },
  {
    what: "Wedding photos, as many as you like.",
    why: "Unblocks the wedding gallery. The page becomes a portfolio of your own work, so the best pictures win.",
    done: false,
  },
  {
    what: "The word on the funeral pad, and letting us watch you quote one.",
    why: "Unblocks that cleanup: whether the pad's notes get their own labeled block on the order or go away, and the quote tool corrected by the person who actually has that conversation.",
    done: false,
  },
  {
    what: "Your house-account customers, and what each may run up.",
    why: "Unblocks house and business accounts: the tab, the credit limit, the month-end invoice, the on and off switch.",
    done: false,
  },
  {
    what: "Your chosen workroom PINs, told to Kevin by phone.",
    why: "Unblocks your staff on the real board. Spoken, never written down, and never sent by email.",
    done: false,
  },
  {
    what: "A walk through your current software, before anything about it gets canceled.",
    why: "Unblocks the switch losing nothing: order history or customer names it quietly keeps come out before it goes.",
    done: false,
  },
  {
    what: "Your real logo file, and the word that we may keep using your site's photography.",
    why: "Unblocks the last of the stand-ins: the logo from whoever made your sign or printed your shirts, at full quality.",
    done: false,
  },
  {
    what: "Half an hour of somebody's memory about Greening.",
    why: "Unblocks that page saying something true: who you keep green, and whether we can name them.",
    done: false,
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
    wait: "Waiting on item 6.",
  },
  {
    name: "Orders that bend",
    what: "Editing an order after it is placed, and delivery time windows a customer can ask for.",
  },
  {
    name: "House accounts",
    what: "Business and house accounts laid out plainly: who owes what, credit limits, cards kept on file with Square, and month-end invoices sent from the workroom.",
    wait: "Waiting on item 10.",
  },
  {
    name: "Weddings and big orders",
    what: "Deposits with paid and owed tracked, split payments, and the wedding page rebuilt as a gallery of your work.",
    wait: "Waiting on items 7 and 8.",
  },
];

function Dot({ state }: { state: LightState }) {
  return <span className={`lp-dot${state === "lit" ? " is-lit" : state === "half" ? " is-half" : ""}`} aria-hidden="true" />;
}

export default async function LaunchPage() {
  const s = await readStatus();
  const asksDone = ASKS.filter((a) => a.done).length;
  const listLit: LightState = asksDone === ASKS.length ? "lit" : asksDone > 0 ? "half" : "off";
  const lights: { label: string; state: LightState }[] = [
    { label: "Signed", state: s.signed ? "lit" : "off" },
    { label: s.build === "half" ? "Build fee: half in" : "Build fee", state: s.build },
    { label: "Monthly running", state: s.monthly ? "lit" : "off" },
    { label: "Square connected", state: s.square ? "lit" : "off" },
    { label: `Your list: ${asksDone} of ${ASKS.length}`, state: listLit },
    { label: "Domain live", state: s.domain ? "lit" : "off" },
  ];
  return (
    <main className="agr">
      <p className="agr-kicker">Glazed Web × DeVine&rsquo;s Flowers &amp; Botanicals</p>
      <h1>The launch plan.</h1>
      <p>
        You have driven the site, written up orders, and taken a payment or two on the practice
        card. This page is the road from that demo to your shop running on it for real: where
        things stand, what happens in what order, and the short list only you can supply.
      </p>
      <p className="agr-note">
        The signature and money lights read live from the records themselves. The list is ticked
        by us as things arrive, so if a dot is still open, we have not received it yet. No meeting
        to schedule and nothing to remember; the page remembers.
      </p>

      <h2>Where things stand</h2>
      <ul className="lp-lights">
        {lights.map((l) => (
          <li key={l.label} className={l.state === "off" ? "lp-unlit" : "lp-lit"}>
            <Dot state={l.state} />
            {l.label}
            <span className="sr-only">{l.state === "lit" ? ": done" : l.state === "half" ? ": partly done" : ": not yet"}</span>
          </li>
        ))}
      </ul>

      <h2>What we need from you</h2>
      <p>
        In order, because the early ones unblock the later ones. Most are a phone call or a
        forwarded email; none of them is homework. We tick them as they arrive.
      </p>
      <ol className="lp-asks">
        {ASKS.map((a, i) => (
          <li key={i}>
            <p className="lp-ask-what">
              <Dot state={a.done ? "lit" : "off"} /> {a.what}
            </p>
            <p className="lp-ask-why">{a.why}</p>
          </li>
        ))}
      </ol>

      <h2>What we are building, in order</h2>
      <p>
        The sequence, not the scope; the scope is <a href="/agreement">Exhibit A</a>. No dates
        until your list is in, because the list is the only real variable and a schedule written
        before it lands is a broken promise waiting for week two.
      </p>
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

      <h2>Your stuff</h2>
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
          <a href="/photos">Your photos page</a>
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
