"use client";

import { useState, useMemo } from "react";
import { site } from "@/lib/site";

/**
 * "Do we come to you", answered in one field.
 *
 * NO PAID SERVICE. No maps API, no address validation subscription. Their own
 * published zip list is the whole dataset and it lives in lib/site.ts, so the answer
 * comes from their service area rather than a third party's idea of the boundary.
 *
 * An accelerator, not a gate: the full lists stay on the page underneath, so with
 * JavaScript off the page is still complete and still answers the question.
 *
 * A near miss is never a hard no. Someone one town over should be told to call rather
 * than turned away by a form.
 */
export default function ZipCheck() {
  const [q, setQ] = useState("");
  const cleaned = q.trim().toLowerCase();

  const result = useMemo(() => {
    if (cleaned.length < 3) return null;
    if (/^\d+$/.test(cleaned)) {
      // Wait for a full five digits before judging, so 490 does not read as "no".
      if (cleaned.length < 5) return null;
      // site is `as const`, so these are readonly tuples of literal types and
      // .includes() will not accept a plain string. Widened at the call.
      return { ok: (site.deliveryZips as readonly string[]).includes(cleaned), what: `zip ${cleaned}` };
    }
    const town = site.deliveryTowns.find((t) => t.toLowerCase().startsWith(cleaned));
    return town ? { ok: true, what: town } : { ok: false, what: q.trim() };
  }, [cleaned, q]);

  return (
    <div className="panel" style={{ maxWidth: 560, marginTop: 32 }}>
      <label htmlFor="zip" style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
        Enter your town or zip code
      </label>
      <input
        id="zip"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Marshall, or 49068"
        autoComplete="postal-code"
        style={{ width: "100%", padding: "12px 14px", font: "inherit", fontSize: 17, border: "1px solid var(--line)", borderRadius: 3, background: "var(--paper)", color: "var(--ink)" }}
      />
      {/* aria-live, so the answer is announced rather than only drawn */}
      <p aria-live="polite" style={{ margin: "14px 0 0", fontSize: 16, minHeight: "1.6em" }}>
        {result?.ok && (
          <span style={{ color: "var(--green)", fontWeight: 600 }}>
            Yes, we deliver to {result.what}.
          </span>
        )}
        {result && !result.ok && (
          <span style={{ color: "var(--rose-ink)", fontWeight: 600 }}>
            {result.what} is not on our delivery list. Call the shop on{" "}
            <a href={site.phoneHref}>{site.phone}</a> and ask anyway.
          </span>
        )}
      </p>
    </div>
  );
}
