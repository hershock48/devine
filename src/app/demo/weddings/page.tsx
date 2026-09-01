import type { Metadata } from "next";
import { inCategory, money } from "@/lib/catalog";
import { href } from "@/lib/nav";
import { site } from "@/lib/site";
import { WeddingInquiry } from "@/components/InquiryForms";

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
            We grow and source many of our own botanicals, so your wedding flowers come
            out of this place and this season.
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
            A florist who grows some of it is a different conversation.
          </p>
          <p className="pull-note">
            It changes what we can say yes to, when we have to know by, and what happens
            when a crop comes in early. You hear all of that in February, while it is still
            useful.
          </p>
        </div>
      </section>

      {/*
        A generated Bloom print used to sit beside this list as decoration.
        Cut, same reasoning as the Visit page: generated art stands in for
        products awaiting photographs, and a couple reading how their wedding
        flowers get made should not be looking at fake ones while they do.
        The measure below keeps the list readable at full width; a real
        photograph of her wedding work takes the old spot the day it exists.
      */}
      <section className="section">
        <div className="wrap" style={{ maxWidth: 720 }}>
          <p className="kicker">The process</p>
          <h2>How it works</h2>
          <ol className="steps" style={{ marginTop: "calc(var(--u) * 4)" }}>
            {site.weddingProcess.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="muted small" style={{ margin: 0 }}>{site.weddingFollowUp}</p>
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
              No commitment, and no quote at the end of it. A person reads it.
            </p>
          </div>

          {/* A form is one of the few places a surface is earned: it marks where the
              page stops being read and starts being filled in. Submits for real
              since 2026-09-01 (SMTP + a draft quote on the workroom's Quotes tab);
              the mailto handoff survives inside it as the failure fallback. */}
          <WeddingInquiry />
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
          {/*
            These were four ProductCards, and every one rendered generated art
            because no Wedding-category product has a photograph yet - a solid
            wall of fake prints as the page's closing image. In the shop grids
            a Bloom sits among twenty real photographs and reads as the
            stand-in it is; four in a row with no real photo anywhere reads as
            the product. So until the photographs land, this is the site's own
            contents-page treatment: names and prices, each one tap from its
            page. The card grid comes back with the photos.
          */}
          <ul className="index">
            {weddingItems.map((p) => (
              <li key={p.slug}>
                <a href={href(`/product/${p.slug}`)}>
                  <span className="index-name">{p.name}</span>
                  <span className="index-meta">{money(p.price)}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}

