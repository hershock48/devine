"use client";

import { useState } from "react";
import { site } from "@/lib/site";

/**
 * The wedding inquiry and the greening brief, submitting FOR REAL. Both
 * spent Phase 1 as honest mailto handoffs (a form with no destination must
 * not pretend), and Kevin hit the seam mid-test: "why when you fill out
 * the damn form it opens your email? it should just send." It does now:
 * POST to /api/inquiry, which emails the shop over the same SMTP as the
 * order tickets. Three honest outcomes, same contract as checkout:
 *
 *   sent      an in-place thank-you; a person reads it and replies.
 *   invalid   the server's message, next to the button.
 *   unreached the mailto that always worked, prefilled, offered plainly.
 *
 * Photos (both forms want them) ride the reply: no upload endpoint means
 * no size limits, no storage, and no broken previews; the confirmation
 * says where to send them.
 */

const field: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  font: "inherit",
  fontSize: 15.5,
  border: "1px solid var(--line)",
  borderRadius: 3,
  background: "var(--paper)",
  color: "var(--ink)",
};

const labelText: React.CSSProperties = { display: "block", fontSize: 14.5, fontWeight: 600, marginBottom: 5 };

function Field({
  label, value, onChange, type = "text", required, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string;
}) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={labelText}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} style={field} />
    </label>
  );
}

type Outcome =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent" }
  | { state: "invalid"; message: string }
  | { state: "unreached" };

function useSubmit(kindPayload: () => Record<string, string>, mailtoBody: () => string) {
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setOutcome({ state: "sending" });
    try {
      const res = await fetch("/api/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kindPayload()),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && body?.ok) setOutcome({ state: "sent" });
      else if (res.status === 400) setOutcome({ state: "invalid", message: body?.error || "Something needs another look." });
      else setOutcome({ state: "unreached" });
    } catch {
      setOutcome({ state: "unreached" });
    }
  }

  const mailtoHref = () =>
    `mailto:${site.email}?subject=${encodeURIComponent("From the website")}&body=${encodeURIComponent(mailtoBody() + "\n")}`;

  return { outcome, submit, mailtoHref };
}

function Fallbacks({ outcome, mailtoHref }: { outcome: Outcome; mailtoHref: () => string }) {
  return (
    <div aria-live="polite">
      {outcome.state === "invalid" && (
        <p style={{ color: "var(--rose-ink)", fontWeight: 600, marginTop: 10, marginBottom: 0 }}>{outcome.message}</p>
      )}
      {outcome.state === "unreached" && (
        <div className="notice" role="status" style={{ marginTop: 14 }}>
          <p style={{ margin: "0 0 10px" }}>
            <strong>We couldn&rsquo;t send that just now, so it did not reach the shop.</strong>
          </p>
          <p style={{ margin: 0 }}>
            Two routes that do work: call <a href={site.phoneHref}><strong>{site.phone}</strong></a>{" "}
            or <a href={mailtoHref()}>email the shop</a>; the email opens with everything you typed
            already written in.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ weddings ------------------------------ */

export function WeddingInquiry() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [venue, setVenue] = useState("");
  const [guests, setGuests] = useState("");
  const [vision, setVision] = useState("");

  const { outcome, submit, mailtoHref } = useSubmit(
    () => ({ kind: "wedding", name, email, phone, date, venue, guests, vision }),
    () =>
      [
        "Hello, I'm planning a wedding.", "",
        `Name: ${name}`, `Email: ${email}`, phone ? `Phone: ${phone}` : "",
        date ? `Date: ${date}` : "", venue ? `Venue: ${venue}` : "",
        guests ? `Guests: ${guests}` : "", "", vision,
      ].filter(Boolean).join("\n"),
  );

  if (outcome.state === "sent") {
    return (
      <div className="panel" role="status">
        <h3 style={{ marginTop: 0 }}>It&rsquo;s in.</h3>
        <p>
          A person reads every inquiry; we&rsquo;ll reply from the shop, usually within a day. The
          pictures you have saved? Email them to{" "}
          <a href={`mailto:${site.email}`}>{site.email}</a> or bring them to the consult; either
          works.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <Field label="Your name" value={name} onChange={setName} required />
        <Field label="Email" value={email} onChange={setEmail} type="email" required />
        <Field label="Phone" value={phone} onChange={setPhone} type="tel" placeholder="If a call is easier" />
        <Field label="Wedding date" value={date} onChange={setDate} type="date" />
        <Field label="Venue" value={venue} onChange={setVenue} placeholder="Where is it happening?" />
        <Field label="Roughly how many people" value={guests} onChange={setGuests} type="number" />
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={labelText}>Colors, flowers, anything you have saved</span>
          <textarea value={vision} onChange={(e) => setVision(e.target.value)} rows={4} style={field} />
        </label>
        <button className="btn btn--solid" type="submit" disabled={outcome.state === "sending"}>
          {outcome.state === "sending" ? "Sending…" : "Send inquiry"}
        </button>
        <p className="muted" style={{ fontSize: 13.5, marginTop: 14, marginBottom: 0 }}>
          Goes straight to the shop. Prefer to talk? <a href={site.phoneHref}>{site.phone}</a>.
        </p>
        <Fallbacks outcome={outcome} mailtoHref={mailtoHref} />
      </form>
    </div>
  );
}

/* ------------------------------ greening ------------------------------ */

export function GreeningInquiry() {
  const [business, setBusiness] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [space, setSpace] = useState("");
  const [size, setSize] = useState("");
  const [locations, setLocations] = useState("");
  const [light, setLight] = useState("");

  const { outcome, submit, mailtoHref } = useSubmit(
    () => ({ kind: "greening", business, contact, email, space, size, locations, light }),
    () =>
      [
        "Hello, a greening brief:", "",
        `Business: ${business}`, `Contact: ${contact}`, `Email: ${email}`,
        space ? `Space: ${space}` : "", size ? `Size: ${size}` : "",
        locations ? `Locations: ${locations}` : "", light ? `Natural light: ${light}` : "",
      ].filter(Boolean).join("\n"),
  );

  if (outcome.state === "sent") {
    return (
      <div className="panel" role="status" style={{ marginTop: "calc(var(--u) * 4)", maxWidth: 560 }}>
        <h3 style={{ marginTop: 0 }}>The brief is in.</h3>
        <p style={{ marginBottom: 0 }}>
          We&rsquo;ll reply from the shop. A photo or two of the space, emailed to{" "}
          <a href={`mailto:${site.email}`}>{site.email}</a>, saves everyone a site visit.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ marginTop: "calc(var(--u) * 4)", maxWidth: 560 }}>
      <Field label="Business name" value={business} onChange={setBusiness} required />
      <Field label="Your name" value={contact} onChange={setContact} required />
      <Field label="Email" value={email} onChange={setEmail} type="email" required />
      <Field label="What kind of space" value={space} onChange={setSpace} placeholder="Office, lobby, waiting room, dining room" />
      <Field label="Roughly how big" value={size} onChange={setSize} placeholder="A guess is fine: one room, a whole floor" />
      <Field label="How many locations" value={locations} onChange={setLocations} type="number" />

      <fieldset style={{ border: 0, padding: 0, margin: "0 0 14px" }}>
        <legend style={{ fontSize: 14.5, fontWeight: 600, padding: 0, marginBottom: 7 }}>Natural light</legend>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {["Plenty", "Some", "Almost none"].map((v) => (
            <label key={v} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15.5, padding: "6px 0", cursor: "pointer" }}>
              <input
                type="radio"
                name="light"
                checked={light === v}
                onChange={() => setLight(v)}
                style={{ accentColor: "var(--green)", width: 17, height: 17 }}
              />
              {v}
            </label>
          ))}
        </div>
      </fieldset>

      <button className="btn btn--solid" type="submit" disabled={outcome.state === "sending"}>
        {outcome.state === "sending" ? "Sending…" : "Send the brief"}
      </button>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 14, marginBottom: 0 }}>
        Goes straight to the shop. Prefer to talk? <a href={site.phoneHref}>{site.phone}</a>.
      </p>
      <Fallbacks outcome={outcome} mailtoHref={mailtoHref} />
    </form>
  );
}
