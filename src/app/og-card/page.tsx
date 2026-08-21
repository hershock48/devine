import { site } from "@/lib/site";
import { products } from "@/lib/catalog";

/**
 * THE DEMO'S LINK CARD, AS A REAL PAGE.
 *
 * link-cards.md: "Render it from a real page rather than assembling it in an image
 * editor, so the card uses the site's own type, palette and artwork and cannot
 * drift from them." tools/og.mjs screenshots this at 1200x630 into public/og.jpg.
 *
 * THE PHOTOGRAPH IS NOT DECORATION, IT IS THE POINT. The first version of this
 * card was the mark and type on paper — handsome, and a contradiction of our own
 * letter, whose finding two ends: "You are a florist. The photograph is the pitch,
 * and right now it is the one thing that does not make the trip." A card we ship
 * without a photograph would be that finding, made permanent, by us. So the
 * photograph fills the frame and the type sits on a paper panel over it.
 *
 * WHY A PANEL AND NOT TEXT OVER THE PHOTO. Two of link-cards.md's rules at once:
 * the centre 630x630 (x 285-915) is the only region guaranteed to survive iOS's
 * square crop, and "a headline over artwork is the single most common place a card
 * fails" on contrast. A paper panel pinned to that exact band solves both: the
 * text's ground is the site's own #FAF7F1 wherever the photograph is busy, and
 * everything readable lives inside the safe zone by construction. The flowers
 * bleed on both sides and are what you see first; the panel is what you read.
 *
 * THIS CARD IS THEIRS, NOT OURS — the two-card table in link-cards.md. The
 * proposal card asks Glazed Web's question; this one shows the client's flowers.
 *
 * Deliberately not linked, not in the sitemap. Delete with public/og.jpg together.
 */
export const dynamic = "force-static";

export const metadata = { robots: { index: false, follow: false } };

export default function OgCard() {
  return (
    <div style={{ width: 1200, height: 630, position: "relative", overflow: "hidden", background: "var(--paper)" }}>
      {/* Their own arrangement, edge to edge. The crop favors the upper half of
          the photograph, where the lisianthus are. */}
      <img
        src="/img/shop/shop-4.webp"
        width={1000}
        height={1100}
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 26%" }}
      />

      {/* The panel: pinned to the iOS-safe centre band, x 285-915. */}
      <div
        style={{
          position: "absolute",
          left: 285,
          width: 630,
          top: 96,
          bottom: 96,
          background: "var(--paper)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 54px",
        }}
      >
        <img
          src="/img/brand/logo.webp"
          width={1200}
          height={744}
          alt=""
          style={{ width: 228, height: "auto", marginBottom: 26 }}
        />
        <h1
          style={{
            font: "400 47px/1.08 var(--serif)",
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
            font: "700 15px/1 var(--sans)",
            letterSpacing: ".22em",
            textTransform: "uppercase",
            color: "var(--muted)",
            margin: "24px 0 0",
          }}
        >
          {site.town} &middot; {products.length} designs
        </p>
      </div>
    </div>
  );
}
