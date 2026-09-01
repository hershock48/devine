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

export default function AgreementPage() {
  return (
    <main className="agr">
      <p className="agr-kicker">Glazed Web × {agreement.client}</p>
      <h1>The agreement, in plain English.</h1>
      <p>
        Two documents make the whole deal, and both are on this page or one tap from it. The first
        is the{" "}
        <a href={agreement.termsUrl} target="_blank" rel="noopener noreferrer">
          Glazed Web Client Agreement v1.0
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
              {money(agreement.buildFee)}, one time. A deposit of {money(agreement.deposit)} is due
              on acceptance and credited against it; the balance is due on launch. Invoiced
              separately; nothing is owed until the invoice arrives.
            </td>
          </tr>
          <tr>
            <td>Monthly service fee</td>
            <td>
              {money(agreement.monthly)} per month from the first of the month after launch.
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
              Remote card payments run through your own Square account at Square&rsquo;s published
              rate: phone orders keyed by your staff on the order board now, and online checkout
              when we both agree in writing to turn it on. Each remote card payment carries a $0.99
              service fee paid by the customer, shown as its own line on the order, retained by
              Glazed Web. It is never charged to you, and sales rung in person on your register
              never carry it. Web checkout otherwise takes the order and payment happens on the
              confirming call.
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
