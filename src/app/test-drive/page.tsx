import type { Metadata } from "next";
import "./test-drive.css";

/**
 * THE TEST DRIVE, linked from the proposal header (Kevin's ask, 2026-09-03:
 * "a Test Me page... make it fun"). Photo-drop shape: top level, no site
 * chrome, noindexed, shared by link, one measured column.
 *
 * The design brief in one line: eight numbered missions she cannot lose.
 * Everything she touches is the real system (real database, real emails,
 * real board), the page says so plainly, and the one practice-register
 * corner (cards, until her Square connects) is named instead of hidden.
 * The PINs are deliberately NOT printed here: the page is a public URL on
 * the pitch host, so the keys travel by Kevin's text, not by webpage.
 */

export const metadata: Metadata = {
  title: "Test drive · DeVine's Flowers & Botanicals",
  description: "Eight things to try on the new site and its workroom. Nothing can break.",
  robots: { index: false, follow: false },
};

type Mission = {
  title: string;
  where: string;
  href: string;
  body: React.ReactNode;
  payoff: string;
};

const MISSIONS: Mission[] = [
  {
    title: "Order flowers from yourself",
    where: "The shop",
    href: "/demo/shop",
    body: (
      <>
        On your phone, like a customer would: pick an arrangement (those are your photographs),
        add it to the cart, and check out. Sending it with no payment is the everyday flow, and
        the site says so: settled on the confirming call, like your phone orders. Or try the
        card option with the practice card below; it rings a pretend register, never a real one.
      </>
    ),
    payoff: "The order emails itself to the shop the moment you tap send.",
  },
  {
    title: "Watch it land on the board",
    where: "Workroom · Orders",
    href: "/workroom",
    body: (
      <>
        Open the workroom with the PIN from Kevin&rsquo;s text and look at the Orders board.
        The order you just placed is sitting there with its own ticket number, sorted under the
        day you asked for. Nobody retyped it. This is how every web order arrives from now on.
      </>
    ),
    payoff: "Tap Made, then Out the door, and walk it through a whole shop day.",
  },
  {
    title: "Write up a phone order",
    where: "Workroom · Orders",
    href: "/workroom",
    body: (
      <>
        Tap <em>Write up a phone order</em> and take an imaginary call: a name, a day, an
        arrangement off the catalog or a custom piece with its price. It lands on the board
        beside the web ones, already marked confirmed, because you were just talking to them.
      </>
    ),
    payoff: "One screen for the counter, the phone, and the website.",
  },
  {
    title: "Send yourself a bride",
    where: "The weddings page",
    href: "/demo/weddings",
    body: (
      <>
        Fill out the wedding form as a made-up couple. Then look at the workroom&rsquo;s Quotes
        tab: a red count appears on the tab itself, the inquiry is flagged{" "}
        <em>New, from the website</em>, and a draft quote is already started with everything
        they typed.
      </>
    ),
    payoff: "No inquiry waits in an inbox nobody checked.",
  },
  {
    title: "Receive a truck",
    where: "Workroom · Weekly order",
    href: "/workroom/weekly-order",
    body: (
      <>
        Build a small prebook: a few varieties, real-ish prices. Beside each line the sheet
        shows what the cooler already holds. Then tap <em>The truck came</em> and open
        Inventory: every line is in the cooler ledger, counted in stems, priced off what you
        typed.
      </>
    ),
    payoff: "The Tuesday order and the inventory stop being two jobs.",
  },
  {
    title: "Toss something on purpose",
    where: "Workroom · Inventory",
    href: "/workroom/inventory",
    body: (
      <>
        In the cooler table, tap <em>Toss</em> on a variety from your mission-five truck, count
        a few stems, pick why. The toss is priced from what those exact stems cost when they
        came in, and the dollar figure waits for you on the dashboard in mission eight.
      </>
    ),
    payoff: "The shrink numbers you said you wished you had start right here.",
  },
  {
    title: "Quote a funeral in ninety seconds",
    where: "Workroom · Quotes",
    href: "/workroom/quotes",
    body: (
      <>
        Start a funeral quote and take an imaginary family through it: tap pieces at your own
        price ranges, watch the running total against what they said they could spend, add a
        ribbon. Then tap <em>Print for the family</em> and look at what they would walk out
        holding.
      </>
    ),
    payoff: "Your on-the-spot quoting, with the arithmetic done for you.",
  },
  {
    title: "Look at the money, alone",
    where: "Workroom · Dashboard",
    href: "/workroom/dashboard",
    body: (
      <>
        The Dashboard asks for the second PIN in Kevin&rsquo;s text, the one that is yours
        alone. Takings, margins, best sellers, averages. Try the staff PIN on it first and
        watch it politely refuse: your team runs the whole workroom without ever seeing this
        screen.
      </>
    ),
    payoff: "Numbers for you, flowers for everyone else.",
  },
];

export default function TestDrivePage() {
  return (
    <main className="td">
      <p className="td-kicker">DeVine&rsquo;s Flowers &amp; Botanicals</p>
      <h1>Go ahead. Try to break it.</h1>
      <p className="lede">
        Eight things to try, best taken top to bottom: the truck you receive in five is the
        stems you toss in six. This is the live system, not a slideshow: what you make is
        saved, what you send arrives, and the order board is the same one your team would work
        from. You cannot hurt anything, and Kevin clears the test orders after.
      </p>
      <p className="lede">
        The two PINs are in Kevin&rsquo;s text: one opens the workroom for the whole team, the
        second opens the money screens for you alone.
      </p>

      <ol className="td-missions">
        {MISSIONS.map((m, i) => (
          <li key={m.title} className="td-mission">
            <span className="td-num" aria-hidden="true">{i + 1}</span>
            <div>
              <p className="td-where">
                <a href={m.href}>{m.where} &#8599;</a>
              </p>
              <h2>{m.title}</h2>
              <p className="td-body">{m.body}</p>
              <p className="td-payoff">{m.payoff}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="td-aside">
        <p>
          <strong>The practice credit card:</strong> anywhere a card is asked for, use{" "}
          <strong>4111 1111 1111 1111</strong>, CVV <strong>111</strong>, any future date, any
          zip. Every charge rings a pretend register, never a real one, and a real card would
          be refused; that stays true until your own Square is connected, which is a single
          Allow click on your login whenever you are ready. Everything else here is the real
          thing.
        </p>
        <p>
          <strong>Found something confusing, slow, or just wrong?</strong> That is the most
          valuable thing you can send. Text Kevin the screen and the sentence. It usually gets
          fixed the same day.
        </p>
      </div>
    </main>
  );
}
