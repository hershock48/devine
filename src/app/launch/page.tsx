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
 * the ask list's dots (asksFor below: the live records, else `done` flipped by hand - the
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
  description: "The shop is live. Where things stand, what happens next, and the short list we still need from you.",
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
  const flags = new Set(
    (process.env.LAUNCH_FLAGS || "").split(",").map((f) => f.trim().toLowerCase()).filter(Boolean),
  );
  // Nothing to ask the rail when both money lights are set by hand.
  if (!(flags.has("build") && flags.has("monthly"))) try {
    const r = await fetch("https://www.glazedweb.com/api/build-status/devine", { cache: "no-store" });
    if (r.ok) {
      const d = (await r.json()) as { build?: string; monthly?: boolean };
      build = d.build === "paid" ? "lit" : d.build === "half" ? "half" : "off";
      monthly = d.monthly === true;
    }
  } catch {}
  // Flags set by hand in Vercel for what the rail cannot see: a build fee
  // or a monthly paid outside it (a check at the counter, 2026-10-14).
  return {
    // The hand flags cover what the records cannot show: a signature on
    // paper, a Square link made outside this site.
    signed: flags.has("signed") || signed,
    build: flags.has("build") ? "lit" : build,
    monthly: flags.has("monthly") || monthly,
    domain: flags.has("domain"),
    square: flags.has("square") || square,
  };
}

/** What only the shop can supply. Launched 2026-10-14: the signature, the
    build fee, Square and the domain read live from their own records, the
    rest is ticked by US as things arrive. The monthly sits first because it
    is the one thing left (Kevin, 2026-10-14). */
type Ask = { what: React.ReactNode; why: React.ReactNode; done: boolean };
function asksFor(s: Awaited<ReturnType<typeof readStatus>>): Ask[] {
  return [
    {
      what: (
        <>
          <a href={agreement.payMonthlyUrl}>Start the monthly</a>: one card form, and done.
        </>
      ),
      why: (
        <>
          The one thing left that only you can do; the other open dots below are ours to collect. The site is live and
          the build is paid; the monthly keeps it up, backed up and yours to change. The link opens one secure card form
          for the monthly in <a href="/agreement">the agreement</a>; this dot turns green on its own once it is in.
        </>
      ),
      done: s.monthly,
    },
    {
      what: (
        <>
          Your name and the business entity, signed at <a href="/agreement">the agreement</a>.
        </>
      ),
      why: s.signed
        ? "Signed. The terms and numbers live there, one tap away, and this page never repeats them."
        : "Unblocks everything below. The terms and numbers live there, one tap away, and this page never repeats them.",
      done: s.signed,
    },
    {
      what: (
        <>
          The build fee, from <a href="/agreement">the agreement</a>.
        </>
      ),
      why: s.build === "lit" ? "Paid in full, October 2026. Thank you." : "The agreement page is where you pay; this dot reads the payment record.",
      done: s.build === "lit",
    },
    {
      what: "Your Square account, connected to the site.",
      why: s.square
        ? "Connected: real card payments, online and at the board, through your own Square."
        : "Unblocks real card payments through your own Square; a short guided step we do together.",
      done: s.square,
    },
    {
      what: "Your domain, pointed at the new site.",
      why: s.domain
        ? "The cutover happened October 14: your address serves this site, and the old one is closed."
        : "Unblocks the cutover: the day your address serves this site instead of the old one.",
      done: s.domain,
    },
    {
      what: (
        <>
          Photos of your designs, through <a href="/photos">your photos page</a>.
        </>
      ),
      why: "54 of 58 designs have a photograph. The page lists the few still waiting (the three classic wedding pieces and Lucy); tap one, pick the shot from your phone, and it is sent.",
      done: true,
    },
    {
      what: "Your delivery zones and rates, confirmed.",
      why: "Your zip sheet is the delivery fee on every order, and the counter can change it while quoting.",
      done: true,
    },
    {
      what: "Your wedding pricing spreadsheet, exactly as it is.",
      why: "Unblocks the wedding quote math becoming yours instead of a stand-in. The model is yours from screenshots; the full sheet confirms it to the cent.",
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
      why: "The Accounts tab is live: who owes what, statements by email. Credit limits and the month-end rhythm wait on this.",
      done: false,
    },
    {
      what: "Your chosen workroom PINs, told to Kevin by phone.",
      why: "Your staff are on the real board.",
      done: true,
    },
    {
      what: "A walk through your current software, before anything about it gets canceled.",
      why: "Your customer and recipient lists came out of IRIS and are on file for the write-up's suggestions.",
      done: true,
    },
    {
      what: "Your real logo file, and the word that we may keep using your site's photography.",
      why: "In hand, on the site and on every email.",
      done: true,
    },
    {
      what: "Half an hour of somebody's memory about Greening.",
      why: "Unblocks that page saying something true: who you keep green, and whether we can name them.",
      done: false,
    },
  ];
}

const PHASES: { name: string; what: string; wait?: string }[] = [
  {
    name: "Live now",
    what: "The store, ordering, the workroom board, phone write-ups, card and cash payments, receipts and delivery notes by email, inventory and the dashboard. Everything the test drive walks you through.",
  },
  {
    name: "Addresses and delivery",
    what: "Address checking as orders come in, miles from the shop on every order, and a delivery fee you can adjust before charging.",
  },
  {
    name: "Orders that bend",
    what: "Editing an order after it is placed, and delivery time windows a customer can ask for.",
  },
  {
    name: "House accounts",
    what: "Business and house accounts laid out plainly: who owes what, credit limits, cards kept on file with Square, and month-end invoices sent from the workroom.",
    wait: "Waiting on item 11.",
  },
  {
    name: "Weddings and big orders",
    what: "Deposits with paid and owed tracked, split payments, and the wedding page rebuilt as a gallery of your work.",
    wait: "Waiting on items 8 and 9.",
  },
];

function Dot({ state }: { state: LightState }) {
  return <span className={`lp-dot${state === "lit" ? " is-lit" : state === "half" ? " is-half" : ""}`} aria-hidden="true" />;
}

export default async function LaunchPage() {
  const s = await readStatus();
  const asks = asksFor(s);
  const open = asks.filter((a) => !a.done).length;
  // The rail is the live records only; the list below carries its own dots.
  const lights: { label: string; state: LightState }[] = [
    { label: "Signed", state: s.signed ? "lit" : "off" },
    { label: s.build === "half" ? "Build fee: half in" : "Build fee", state: s.build },
    { label: "Monthly running", state: s.monthly ? "lit" : "off" },
    { label: "Square connected", state: s.square ? "lit" : "off" },
    { label: "Domain live", state: s.domain ? "lit" : "off" },
  ];
  return (
    <main className="agr">
      <p className="agr-kicker">Glazed Web × DeVine&rsquo;s Flowers &amp; Botanicals</p>
      <h1>The launch plan.</h1>
      <p>
        Your shop has run on this site since October 14, 2026: the store, the board, the
        payments, all real. This page is where things stand, what comes next, and the short list
        only you can supply.
      </p>
      <p className="agr-note">
        The signature, money, Square and domain dots read live from the records themselves; the
        rest of the list is ticked by us as things arrive, so an open one of those means we have
        not received it yet. No meeting to schedule and nothing to remember; the page remembers.
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
        {open === 0
          ? "Everything on it is in. Thank you."
          : `${open} of ${asks.length} still open, the first one first. Most are a phone call or a forwarded email; none of them is homework. We tick them as they arrive.`}
      </p>
      <ol className="lp-asks">
        {asks.map((a, i) => (
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
