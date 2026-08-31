"use client";

import { useState } from "react";

/**
 * The acceptance form. Clickwrap: type the name, tick the box, one button.
 *
 * THE FAILURE PATHS TELL THE TRUTH. "unconfigured" and "send-failed" both
 * hand the visitor a prefilled mailto carrying the server's own record text,
 * so the acceptance can still reach a person even when mail plumbing cannot
 * send it. A false "you're all set" on a legal record would be worse than the
 * order-intake version of the same lie, and that one was already ruled out.
 */

type State =
  | { step: "form"; error?: string; busy?: boolean }
  | { step: "done" }
  | { step: "fallback"; record: string };

const MAILTO = "kevin@glazedweb.com";

export default function AgreementAccept({ business }: { business: string }) {
  const [state, setState] = useState<State>({ step: "form" });
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [biz, setBiz] = useState(business);
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);

  if (state.step === "done") {
    return (
      <div className="agr-done" role="status">
        <h3>Accepted. Welcome aboard.</h3>
        <p>
          A copy of the signed record is on its way to your email, and to ours. The deposit invoice
          follows separately, and nothing is due until it does.
        </p>
      </div>
    );
  }

  if (state.step === "fallback") {
    const href = `mailto:${MAILTO}?subject=${encodeURIComponent("Agreement acceptance, " + biz)}&body=${encodeURIComponent(state.record)}`;
    return (
      <div className="agr-done" role="status">
        <h3>One more tap to deliver it.</h3>
        <p>
          Your acceptance was recorded on our server, but the confirmation email could not be sent
          from here right now. Tap the button below and hit send; it carries the exact record, so
          both of us have the copy that matters.
        </p>
        <a className="agr-btn" href={href}>
          Email the signed record
        </a>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState({ step: "form", busy: true });
    try {
      const res = await fetch("/api/agreement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, title, business: biz, email, agreed }),
      });
      const json = (await res.json()) as { state?: string; error?: string; record?: string };
      if (!res.ok) {
        setState({ step: "form", error: json.error || "Something went wrong. Nothing was recorded." });
        return;
      }
      if (json.state === "sent") setState({ step: "done" });
      else setState({ step: "fallback", record: json.record || "" });
    } catch {
      setState({
        step: "form",
        error: `The connection dropped before anything was recorded. Try again, or email ${MAILTO}.`,
      });
    }
  }

  const busy = state.step === "form" && state.busy;

  return (
    <form className="agr-form" onSubmit={submit}>
      <label>
        Your full name
        <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" maxLength={120} />
      </label>
      <label>
        Title <span className="agr-opt">(optional; Owner, for example)</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoComplete="organization-title" maxLength={120} />
      </label>
      <label>
        Business name
        <input value={biz} onChange={(e) => setBiz(e.target.value)} required autoComplete="organization" maxLength={160} />
      </label>
      <label>
        Email <span className="agr-opt">(your signed copy goes here)</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" maxLength={200} />
      </label>
      <label className="agr-check">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} required />
        <span>
          I have read the Glazed Web Client Agreement v1.0 and the Exhibit A above, and I accept both
          on behalf of the business named here.
        </span>
      </label>
      {state.step === "form" && state.error ? <p className="agr-error" role="alert">{state.error}</p> : null}
      <button className="agr-btn" type="submit" disabled={busy}>
        {busy ? "Recording…" : "Accept the agreement"}
      </button>
    </form>
  );
}
