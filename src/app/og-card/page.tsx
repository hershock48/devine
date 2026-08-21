import { site } from "@/lib/site";
import { products } from "@/lib/catalog";

/**
 * THE DEMO'S LINK CARD, AS A REAL PAGE.
 *
 * link-cards.md: "Render it from a real page rather than assembling it in an image
 * editor, so the card uses the site's own type, palette and artwork and cannot
 * drift from them." This is that throwaway route. tools/og.mjs screenshots it at
 * 1200x630 and writes public/og.jpg.
 *
 * THIS CARD IS THEIRS, NOT OURS. The two-card table in link-cards.md: the proposal
 * card at /pitch/devine/og.jpg carries Glazed Web's argument in Glazed Web's
 * colours and asks a question the owner cannot answer comfortably. This one wears
 * the client's brand entirely and says what the business is, because it is the
 * card that appears when the OWNER FORWARDS THE DEMO to someone.
 *
 * THE CENTRE 630 IS THE ONLY PART GUARANTEED TO SURVIVE. Newer iOS crops link
 * previews toward square, so x 285-915 is the safe band and the outer 285px on
 * each side can simply vanish. Everything that has to be read is inside it, which
 * is why the composition is centred rather than the left-aligned layout the rest
 * of this site uses. Verified by cropping the finished file and looking at it.
 *
 * Deliberately NOT in the sitemap and NOT linked from anywhere. It is a rendering
 * surface, not a page. Delete it and public/og.jpg together if the card is ever
 * replaced by a photograph.
 */
export const dynamic = "force-static";

export const metadata = { robots: { index: false, follow: false } };

export default function OgCard() {
  return (
    <div
      style={{
        width: 1200,
        height: 630,
        background: "var(--paper)",
        color: "var(--ink)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        /* The safe band is 285px in from each edge. Nothing readable outside it. */
        padding: "0 300px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Their mark, the real file, not set in type. */}
      <img
        src="/img/brand/logo.webp"
        width={1200}
        height={744}
        alt=""
        style={{ width: 300, height: "auto", marginBottom: 34 }}
      />

      <p
        style={{
          font: "700 19px/1 var(--sans)",
          letterSpacing: ".26em",
          textTransform: "uppercase",
          color: "var(--muted)",
          margin: "0 0 22px",
        }}
      >
        {site.town}
      </p>

      <h1
        style={{
          font: "400 62px/1.06 var(--serif)",
          letterSpacing: "-0.02em",
          margin: 0,
          textWrap: "balance",
        }}
      >
        Grown, gathered,
        <br />
        arranged by hand.
      </h1>

      <p
        style={{
          font: "400 25px/1.45 var(--sans)",
          color: "var(--muted)",
          margin: "26px 0 0",
          maxWidth: 560,
        }}
      >
        {products.length} arrangements, plants and gifts. Delivered across{" "}
        {site.region}.
      </p>

      {/* A hairline at the foot, the site's own rule, for a bit of ground. */}
      <div
        style={{
          position: "absolute",
          left: 300,
          right: 300,
          bottom: 74,
          borderTop: "1px solid var(--line)",
        }}
      />
    </div>
  );
}
