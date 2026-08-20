import type { Metadata } from "next";
import ProductCard from "@/components/ProductCard";
import Bloom from "@/components/Bloom";
import { inCategory } from "@/lib/catalog";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Wedding flowers",
  description:
    "Custom wedding florals grown and sourced locally, designed with you in Marshall, Michigan. Consultations up to six months ahead, and micro weddings welcome.",
};

/**
 * WEDDINGS.
 *
 * Their wedding page is their strongest content and their weakest conversion: the
 * process is laid out properly, and then the only way to act on it is an email address
 * in the middle of a paragraph. The page ends without asking for anything.
 *
 * So the process stays, almost in their words, and it ends in a real form.
 *
 * THE FORM POSTS NOWHERE YET. glaze.md: a form needs a real destination and a
 * confirmed inbox, and those are two separate things. Until both exist this hands off
 * to mail with every field already filled in, which works today, on a phone, with no
 * account and no third-party service. The seam for a server action is named in the
 * README.
 *
 * FLOW. The page used to be three equal sections at one width: a split, a split, a
 * grid. Nothing on it changed pace, so an eight-hundred-word page read as long as it
 * was. It now steps: a narrow opening, a full-width quiet tier holding the one line
 * that is actually the argument, the process against the studio print, the ask, and
 * only then the four things you can buy without talking to anyone.
 */
export default function Weddings() {
  const weddingItems = inCategory("wedding");

  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="kicker">Weddings &amp; events</p>
          <h1>Flowers that look like they came from somewhere.</h1>
          <p className="lede">
            We grow and source many of our own botanicals, so your wedding flowers are
            connected to this place and this season rather than flown in to match a
            catalog photograph.
          </p>
          <p className="btnrow">
            <a className="btn btn--solid" href="#inquire">
              Start a conversation
            </a>
            <a className="btn" href={site.phoneHref}>
              {site.phone}
            </a>
          </p>
        </div>
      </section>

      {/* The rhythm break. There is no wedding photograph in the library yet, so this
          tier is typographic rather than photographic. When they send us the wedding
          work, this is the section that becomes a full-bleed band. */}
      <section className="quiet">
        <div className="wrap split split--wide-left" style={{ alignItems: "end" }}>
          <p className="pull">
            A florist who grows some of it is a different conversation than a florist who
            orders all of it.
          </p>
          <p className="pull-note">
            It changes what we can say yes to, when we have to know by, and what happens
            when a crop comes in early. We would rather tell you that in February than
            surprise you with it in June.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="wrap split split--wide-left" style={{ alignItems: "start" }}>
          <div>
            <p className="kicker">The process</p>
            <h2>How it works</h2>
            <ol className="steps" style={{ marginTop: "calc(var(--u) * 4)" }}>
              {site.weddingProcess.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p className="muted small" style={{ margin: 0 }}>{site.weddingFollowUp}</p>
          </div>
          <div style={{ maxWidth: 420, marginInline: "auto", width: "100%" }}>
            <Bloom
              slug="wedding-hero"
              desc="white roses white spray roses baby's breath ivory ribbon greenery eucalyptus"
              name="A DeVine's bridal bouquet"
              detail
            />
          </div>
        </div>
      </section>

      <section className="section" id="inquire" style={{ paddingTop: 0 }}>
        <div className="wrap split" style={{ alignItems: "start" }}>
          <div>
            <p className="kicker">Tell us about it</p>
            <h2>Start a conversation.</h2>
            <p className="lede">
              We recommend meeting {site.weddingLeadTime}. We also love micro and
              spontaneous weddings, so ask anyway.
            </p>
            <p className="muted small">
              Nothing here is a commitment and there is no quote at the end of it. It is a
              first message, and a person reads it.
            </p>
          </div>

          {/* A form is one of the few places a surface is earned: it marks where the
              page stops being read and starts being filled in. */}
          <div className="panel">
            {/* method="post" on a mailto is not a real submission. It opens the
                customer's mail app with the body prefilled. Honest, works with no
                JavaScript, needs no account. Replaced by a server action when the
                inbox is confirmed. */}
            <form action={`mailto:${site.email}`} method="post" encType="text/plain">
              <Field label="Your name" name="Name" required />
              <Field label="Email" name="Email" type="email" required />
              <Field label="Wedding date" name="Wedding date" type="date" />
              <Field label="Venue" name="Venue" placeholder="Where is it happening?" />
              <Field label="Roughly how many people" name="Guest count" type="number" />
              <label style={{ display: "block", marginBottom: 14 }}>
                <span style={{ display: "block", fontSize: 14.5, fontWeight: 600, marginBottom: 5 }}>
                  Colors, flowers, anything you have saved
                </span>
                <textarea
                  name="Vision"
                  rows={4}
                  style={{ width: "100%", padding: "10px 12px", font: "inherit", fontSize: 15.5, border: "1px solid var(--line)", borderRadius: 3, background: "var(--paper)", color: "var(--ink)" }}
                />
              </label>
              <button className="btn btn--solid" type="submit">
                Send inquiry
              </button>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 14, marginBottom: 0 }}>
                This opens your email with the details filled in. Prefer to talk?{" "}
                <a href={site.phoneHref}>{site.phone}</a>.
              </p>
            </form>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="sec-head">
            <p className="kicker" style={{ margin: 0 }}>
              Or order without asking anyone
            </p>
          </div>
          <p className="lede" style={{ marginBottom: "calc(var(--u) * 5)" }}>
            Everything else is designed with you. These four are ready as they are, which is
            useful for a courthouse morning, a last-minute groomsman, or a mother of the
            bride who was not counted.
          </p>
          {/* Four across, once, on purpose: this category is exactly four items, so a
              three-column grid would leave one of them alone on a second row. */}
          <div className="grid grid--four">
            {weddingItems.map((p) => (
              <ProductCard key={p.slug} p={p} />
            ))}
          </div>
        </div>
      </section>
    </>
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
