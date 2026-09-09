import type { Metadata } from "next";
import { agreement, money } from "@/lib/agreement";
import AgreementAccept from "@/components/AgreementAccept";
import "./agreement.css";

/**
 * The custom-order acceptance page, linked from the bottom of the letter.
 *
 * SHAPE: the general terms are NOT restated here. They are the published
 * Glazed Web Client Agreement v1.0, linked and incorporated by reference,
 * exactly the way the glazedweb menu-order clickwrap works. What this page
 * adds is the part v1.0 leaves blank: the Exhibit A with DeVine's scope and
 * numbers, and the acceptance itself. One text, one home, no drift.
 *
 * Numbers come from lib/agreement.ts, never typed here (glaze.md: facts in
 * one place). The letter at public/pitch/devine/index.html repeats them in
 * prose and is named there as a surface that cannot read the constant.
 */

export const metadata: Metadata = {
  title: "Agreement · Glazed Web × DeVine's Flowers & Botanicals",
  description: "The custom-order agreement for DeVine's Flowers & Botanicals: scope, pricing, and acceptance.",
  robots: { index: false, follow: false },
};

/**
 * The pay rail's return notes. The pay buttons land on glazedweb.com's
 * /api/pay/devine, which opens Stripe Checkout and sends every return trip
 * back HERE with a word in the query: session_id after a completed payment
 * (Stripe only redirects there once the charge went through), or pay= for
 * the honest failure and already-paid cases. Unknown values render nothing.
 */
function payNote(sp: { [k: string]: string | string[] | undefined }): string | null {
  if (typeof sp.session_id === "string" && sp.session_id.startsWith("cs_")) {
    return sp.what === "half"
      ? "Payment made; the card receipt is on its way to your email. If that was the deposit, the balance is due at launch through the same deposit button."
      : "Payment made; the card receipt is on its way to your email.";
  }
  const pay = typeof sp.pay === "string" ? sp.pay : "";
  if (pay === "cancelled") return "No charge was made. The payment links are here whenever you are ready.";
  if (pay === "failed" || pay === "off") return "The card page could not be opened just now. Try again in a minute, or email kevin@glazedweb.com.";
  if (pay === "paid") return "The build fee is already paid in full; nothing more is owed on it.";
  if (pay === "half-paid") return "The deposit is already paid. Only the balance remains, due at launch, through the same deposit link below.";
  return null;
}

export default async function AgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const note = payNote((await searchParams) || {});
  return (
    <main className="agr">
      <p className="agr-kicker">Glazed Web × {agreement.client}</p>
      <h1>The agreement, in plain English.</h1>
      {note && (
        <p className="agr-note" role="status" style={{ fontWeight: 700 }}>
          {note}
        </p>
      )}
      <p>
        Two documents make the whole deal, and both are on this page or one tap from it. The first
        is the{" "}
        <a href={agreement.termsUrl} target="_blank" rel="noopener noreferrer">
          glazedweb Client Agreement v1.1
        </a>
        , the same published terms every Glazed Web client gets: you own the site outright when the
        build fee is paid, month to month after launch, thirty days&rsquo; notice, no penalty,
        Michigan law. There is also a{" "}
        <a href={agreement.pdfUrl} target="_blank" rel="noopener noreferrer">
          PDF copy
        </a>{" "}
        to keep. The second is the Exhibit A below,
        which fills in what gets built for you and what it costs. Accepting at the bottom accepts
        both together.
      </p>
      <p className="agr-note">
        If anything is unclear, ask before accepting: kevin@glazedweb.com or a text.
      </p>

      <h2>Exhibit A: scope</h2>
      <ol className="agr-scope">
        {agreement.scope.map((s) => (
          <li key={s.slice(0, 40)}>{s}</li>
        ))}
      </ol>

      <h2>Exhibit A: pricing</h2>
      <table className="agr-terms">
        <tbody>
          <tr>
            <td>Build fee</td>
            <td>
              {money(agreement.buildFee)}, one time, and the pace is your choice on acceptance:
              pay the {money(agreement.deposit)} deposit now with the balance due on launch; pay
              the {money(agreement.buildFee)} in full and be done with it; or pay in full and
              start the monthly right away too, so everything is set up in one sitting and you
              never have to come back to it. Either way the deposit portion is due on acceptance
              and credited against the total.{" "}
              {agreement.payDepositUrl && agreement.payFullUrl ? (
                <>
                  Pay it right here:{" "}
                  <a href={agreement.payDepositUrl} target="_blank" rel="noopener noreferrer">
                    the {money(agreement.deposit)} deposit
                  </a>
                  ,{" "}
                  <a href={agreement.payFullUrl} target="_blank" rel="noopener noreferrer">
                    the full {money(agreement.buildFee)}
                  </a>
                  {agreement.payFullMonthlyUrl ? (
                    <>
                      , or{" "}
                      <a href={agreement.payFullMonthlyUrl} target="_blank" rel="noopener noreferrer">
                        the full {money(agreement.buildFee)} with the monthly started now
                      </a>
                    </>
                  ) : null}
                  .
                </>
              ) : (
                <>The payment link arrives with your signed copy.</>
              )}
            </td>
          </tr>
          <tr>
            <td>Monthly service fee</td>
            <td>
              {money(agreement.monthly)} per month from the first of the month after launch, or
              starting right away if you choose to begin it alongside a full build payment.
              Hosting, SSL, security updates, backups, domain renewal, the store, and the workroom.
            </td>
          </tr>
          <tr>
            <td>Included edits</td>
            <td>
              Up to {agreement.editAllowance} of minor content edits: new arrangements, price
              changes, hours, a workshop date. Send a text.
            </td>
          </tr>
          <tr>
            <td>Beyond scope</td>
            <td>
              {money(agreement.hourlyRate)} per hour, always quoted and approved by you in writing
              before any work starts. Nothing lands on a bill unannounced.
            </td>
          </tr>
          <tr>
            <td>Card payments</td>
            <td>
              Card payments run through your own Square account at Square&rsquo;s published rate:
              phone orders keyed by your staff on the order board now, and online checkout
              when we both agree in writing to turn it on. Every card payment carries a 3% card
              fee paid by the customer, wherever the card is used: the system adds it on phone
              and website orders, and you apply it at your own register. That fee is yours,
              covering your processing. Orders placed through the website additionally carry a
              $0.99 platform fee retained by Glazed Web, and online the two show as one
              Convenience fee line. Cash sales carry no fee, and neither fee is ever charged to
              you. Web checkout otherwise takes the order and payment happens on the confirming
              call.
            </td>
          </tr>
          <tr>
            <td>Timeline</td>
            <td>{agreement.timeline}</td>
          </tr>
        </tbody>
      </table>

      <h2>Accept</h2>
      <p>
        Typing your name and checking the box forms the agreement, the same way checking out online
        forms one. You will get a copy of the signed record by email, and so will we. That email
        records the version, the scope, the numbers, your name, and the time.
      </p>
      <AgreementAccept business={agreement.client} />

      <p className="agr-note" style={{ marginTop: "calc(var(--u) * 4)" }}>
        Glazed Web · Kevin Hershock · Marshall, Michigan · kevin@glazedweb.com ·{" "}
        {agreement.version}
      </p>
    </main>
  );
}
