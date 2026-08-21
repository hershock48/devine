/**
 * The studio credit for a client footer. Drop-in, self-contained, one file.
 *
 * THE MARK IS HIS ACTUAL MARK. Every path string below is copied verbatim out of
 * glazedweb's `components/Logo.jsx` — the v9 symbol, `<symbol id="mark" viewBox="0 0 200 250">` —
 * and every gradient carries his exact stops. An earlier version of this file had a donut I
 * drew myself, and it was wrong: not his colours, not his drips, not his silhouette. A studio
 * mark is the one graphic on a site that cannot be approximated, because it is the signature.
 *
 * FOUR THINGS ARE DIFFERENT FROM HIS SOURCE, AND THESE ARE ALL OF THEM.
 *
 * 1. THE VIEWBOX IS CROPPED TO THE INK. His is `0 0 200 250`; a pixel scan of a 4x render puts
 *    the actual painted bounds at x 48.00–151.75, y 18.00–199.75 — so 48% of his declared width
 *    and 27% of his height is empty margin. `46 16 110 186` is those bounds plus two units of
 *    bleed. Not one coordinate moves; the window around them tightens. This is what makes his
 *    real mark usable at footer size: at a 26px render the disc goes from 12.5px across to
 *    19.1px, and the hole from 3.2px to 4.7px, purely from dropping the padding. My first
 *    instinct was that his mark was "too detailed for 26px" and needed redrawing. It wasn't.
 *    It was matted.
 *
 * 2. THE HOLE IS PUNCHED, NOT FILLED. His source paints the hole as an opaque
 *    `fill="var(--hole, #FDF6EC)"` circle, which is right on glazedweb.com because that cream
 *    IS his page background — the fill and the hole are indistinguishable there. Dropped into a
 *    near-black client footer the same circle reads as a cream dot sitting on the donut rather
 *    than a hole through it. So his `<circle cx="100" cy="70" r="52">` disc and his
 *    `<circle cx="100" cy="72" r="13">` hole are expressed as one path with `fill-rule="evenodd"`:
 *    same centres, same radii, same 2-unit downward offset of the hole against the disc, and the
 *    footer's own background shows through whatever it happens to be — flat, gradient or image.
 *    Verified by pixel diff against his original circle: identical everywhere outside the hole.
 *
 * 3. THE GRADIENT IDS ARE PREFIXED `gwc-`. His `#pinkGrad` / `#lgGrad` / `#creepGrad` / `#dgGrad`
 *    are generic enough to collide with a client's own defs, and duplicate SVG ids are undefined
 *    behaviour — that class of bug already cost this project a day when two instances of the MI Gas
 *    sun shared a filter id and painted a dark square on the page. Prefixing renames the strings
 *    and nothing else. It is also why the defs live inline here rather than requiring his
 *    `LogoDefs()` to be mounted: one file to drop in, no second component to keep in sync.
 *
 *    Worth knowing while editing: rewrite BOTH ends of every reference. The harness that chose
 *    these settings rewrote `url(#x)` but not `id="x"`, so all four gradients resolved to nothing
 *    and rendered as invisible shapes — a whole comparison run wasted on a search-and-replace.
 *
 * 4. THE DRIPS EXTEND ON HOVER. Resting, they are exactly his lengths — the default state is his
 *    drawing, untouched. Hover runs the glaze a little further down. A footer is the last thing
 *    before somebody leaves and on several of these sites it holds the one call to action, so an
 *    animation that plays forever down there competes with the client's own business. On hover it
 *    rewards the person who noticed and costs everyone else nothing, and under reduced motion the
 *    resting state is unchanged and the hover simply snaps — there is no autoplay to suppress,
 *    which is the easiest kind of motion to make accessible.
 *
 *    The glaze pool at the donut's base (his `<ellipse cx="100" cy="110">`) is deliberately NOT in
 *    the scaling group — it is the collar where the glaze meets the donut, not a drip, and
 *    stretching it pulls the whole mark out of shape. Everything below it scales: his two short
 *    stalactites, his three long drips, the cream highlight strokes that run down them, and the
 *    droplet near the longest tip. Paint order inside the group is unchanged from his file.
 *
 * ON THE LINE: `line` is a prop with a plain default. "Double dipped by Glazed Web" is the
 * studio's voice and it fits a farm or a bakery. MI Gas gets "Baked by" — a facility director
 * selling SOPs to licensed operators is a different room, and a donut pun in that footer reads as
 * the studio talking about itself while the visitor is mid-decision. Pick per client.
 *
 * ON THE LINK: leave it followed. A designer credit is a genuine editorial link. The anchor text
 * stays "Glazed Web" and not anything keyword-shaped — a sitewide footer link reading "website
 * design in Marshall Michigan" is the version that looks like a scheme.
 *
 * REMOVING IT is deleting one line from the footer. Worth being able to say that to a client, and
 * worth actually asking them: a credit in someone else's footer is theirs to decline, and it
 * belongs in the contract rather than in a surprise.
 */
export default function GlazedCredit({
  line = "Built by",
  className = "",
}: {
  /** The words before the name. See the note on the line above before reaching for the pun. */
  line?: string;
  className?: string;
}) {
  return (
    <a
      href="https://www.glazedweb.com"
      className={`gw-credit ${className}`}
      // A new tab, deliberately. This is the one link on the page whose job is to take the
      // visitor AWAY from the client, and doing that in their own tab is a small unkindness to
      // the person paying for the site.
      target="_blank"
      // noopener for the usual reason. NOT nofollow — see the note on the link above.
      rel="noopener noreferrer"
    >
      {line}{" "}
      <span className="gw-credit-name">Glazed&nbsp;Web</span>
      <svg
        className="gw-credit-mark"
        viewBox="46 16 110 186"
        // His own symbol declares overflow="visible" and it is needed here for the same reason:
        // the hover extension runs the drips past the ink bounds the viewBox is cropped to.
        overflow="visible"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <radialGradient id="gwc-pinkGrad" cx="40%" cy="34%" r="75%">
            <stop offset="0%" stopColor="#F887B2" />
            <stop offset="55%" stopColor="#E84D8A" />
            <stop offset="100%" stopColor="#CE3672" />
          </radialGradient>
          <linearGradient id="gwc-lgGrad" x1="0" y1="92" x2="0" y2="215" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#D9EDA0" />
            <stop offset="55%" stopColor="#BFE07A" />
            <stop offset="100%" stopColor="#A3CE55" />
          </linearGradient>
          <linearGradient id="gwc-creepGrad" x1="0" y1="90" x2="0" y2="124" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#E3F2B0" />
            <stop offset="100%" stopColor="#C3E181" />
          </linearGradient>
          <linearGradient id="gwc-dgGrad" x1="0" y1="92" x2="0" y2="165" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#5FA850" />
            <stop offset="100%" stopColor="#43813A" />
          </linearGradient>
        </defs>

        {/* The glaze pool at the base of the donut. Static — see note 4. */}
        <ellipse cx="100" cy="110" rx="38" ry="15" fill="url(#gwc-dgGrad)" />

        <g className="gw-credit-drips">
          {/* Dark glaze: his two short stalactites. */}
          <g fill="url(#gwc-dgGrad)">
            <path d="M 86 100 C 86 116, 87 130, 88 142 C 88 148, 91 149, 92 142 C 93 130, 92 114, 92 100 Z" />
            <path d="M 114 100 C 114 112, 115 124, 116 134 C 116 140, 119 141, 120 134 C 121 124, 120 110, 120 100 Z" />
          </g>
          {/* Light glaze: his three long drips with the rounded tips. */}
          <g fill="url(#gwc-lgGrad)">
            <path d="M 64 100 C 63 120, 65 138, 66 152 C 66 164, 68 172, 74 173 C 80 172, 83 165, 82 154 C 84 136, 85 116, 86 100 Z" />
            <path d="M 92 100 C 91 128, 93 152, 94 172 C 94 188, 97 199, 104 200 C 111 199, 114 190, 112 174 C 113 150, 114 124, 114 100 Z" />
            <path d="M 120 100 C 119 116, 120 130, 121 142 C 121 152, 123 159, 129 160 C 134 159, 137 153, 135 144 C 136 130, 137 114, 137 100 Z" />
          </g>
          <path d="M 97 144 Q 103 151 109 144" fill="none" stroke="#55974A" strokeWidth="4" strokeLinecap="round" />
          <g stroke="#F1F8DC" fill="none" strokeLinecap="round">
            <path d="M 97 128 C 96 148, 97 166, 100 182" strokeWidth="4.5" opacity="0.85" />
            <path d="M 69 118 C 68 132, 70 146, 71 156" strokeWidth="3.5" opacity="0.8" />
            <path d="M 124 114 C 123 124, 125 138, 126 148" strokeWidth="3.5" opacity="0.8" />
          </g>
          <circle cx="100" cy="192" r="2.5" fill="#F1F8DC" opacity="0.9" />
        </g>

        {/* The donut. His circle cx100 cy70 r52 and his hole cx100 cy72 r13, as one evenodd
            path so the hole is a hole. See note 2 — this is the only geometry that is expressed
            differently from his file, and it describes the same two circles. */}
        <path
          fillRule="evenodd"
          d="M 100 18 A 52 52 0 1 1 100 122 A 52 52 0 1 1 100 18 Z M 100 59 A 13 13 0 1 1 100 85 A 13 13 0 1 1 100 59 Z"
          fill="url(#gwc-pinkGrad)"
        />
        {/* The thin glaze lip creeping over the donut's bottom edge. */}
        <path
          d="M 56 98 A 52 52 0 0 0 144 98 C 142 94, 138 92, 134 94 C 130 97, 129 102, 125 104 C 119 106, 116 98, 110 96 C 104 94, 103 102, 98 105 C 93 107, 90 100, 84 97 C 78 95, 76 100, 71 102 C 66 103, 62 100, 56 98 Z"
          fill="url(#gwc-creepGrad)"
        />
        <path d="M 68 106 A 42 42 0 0 0 84 116" fill="none" stroke="#F1F8DC" strokeWidth="4" strokeLinecap="round" opacity="0.85" />
        {/* His soft inner edge on the hole. Kept — with the hole punched it now reads as the
            glaze lipping over the rim rather than as a ring drawn around a dot. */}
        <circle cx="100" cy="72" r="13" fill="none" stroke="#C22F6B" strokeWidth="3" opacity="0.3" />
        {/* Specular highlight: the arc and the dot, at his opacity. */}
        <path d="M 62 46 A 44 44 0 0 1 82 28" fill="none" stroke="#FFFFFF" strokeWidth="8" strokeLinecap="round" opacity="0.75" />
        <circle cx="92" cy="26" r="3.5" fill="#FFFFFF" opacity="0.75" />
      </svg>
    </a>
  );
}
