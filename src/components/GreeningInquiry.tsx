import { site } from "@/lib/site";

/**
 * THE GREENING BRIEF: the form the proposal promises, field for field.
 *
 * Section four of the letter: "A short request form built for a business rather
 * than a shopper: what kind of space, roughly how big, how many locations, natural
 * light or none, and a photo or two. It arrives as a brief you can price without a
 * site visit." Those five are exactly the fields below, so a prospect reading the
 * letter with this page open finds the thing the letter describes.
 *
 * SAME HONESTY AS THE WEDDING FORM. glaze.md: a form needs a real destination and
 * a confirmed inbox, which are two separate things, and neither exists yet. Until
 * both do, this hands off to mail with the brief already written. The photos ride
 * along the same way: the customer's own mail client is open, so they attach them
 * there, which needs no upload endpoint and no size limit of ours.
 *
 * A radio group, not a select, for the light question. Three options is below the
 * threshold where a dropdown earns its tap, and radios show every answer at once,
 * which is what makes a short form feel short.
 */
export default function GreeningInquiry() {
  return (
    <form
      action={`mailto:${site.email}`}
      method="post"
      encType="text/plain"
      style={{ marginTop: "calc(var(--u) * 4)", maxWidth: 560 }}
    >
      <Field label="Business name" name="Business" required />
      <Field label="Your name" name="Contact" required />
      <Field label="Email" name="Email" type="email" required />
      <Field label="What kind of space" name="Space" placeholder="Office, lobby, waiting room, dining room" />
      <Field label="Roughly how big" name="Size" placeholder="A guess is fine: one room, a whole floor" />
      <Field label="How many locations" name="Locations" type="number" />

      <fieldset style={{ border: 0, padding: 0, margin: "0 0 14px" }}>
        <legend style={{ fontSize: 14.5, fontWeight: 600, padding: 0, marginBottom: 7 }}>
          Natural light
        </legend>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          {["Plenty", "Some", "Almost none"].map((v) => (
            <label key={v} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 15.5, padding: "6px 0", cursor: "pointer" }}>
              <input type="radio" name="Natural light" value={v} style={{ accentColor: "var(--green)", width: 17, height: 17 }} />
              {v}
            </label>
          ))}
        </div>
      </fieldset>

      <button className="btn btn--solid" type="submit">
        Send the brief
      </button>
      <p className="muted" style={{ fontSize: 13.5, marginTop: 14, marginBottom: 0 }}>
        This opens your email with the brief filled in. A photo or two of the space,
        attached to that email, saves everyone a site visit. Prefer to talk?{" "}
        <a href={site.phoneHref}>{site.phone}</a>.
      </p>
    </form>
  );
}

function Field({
  label, name, type = "text", required, placeholder,
}: { label: string; name: string; type?: string; required?: boolean; placeholder?: string }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, marginBottom: 5 }}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </span>
      <input
        type={type}
        name={name}
        required={required}
        placeholder={placeholder}
        style={{ width: "100%", padding: "10px 12px", font: "inherit", fontSize: 15.5, border: "1px solid var(--line)", borderRadius: 3, background: "var(--paper)", color: "var(--ink)" }}
      />
    </label>
  );
}
