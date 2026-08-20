import { site } from "@/lib/site";
import { href } from "@/lib/nav";

/*
  THE MARK, WITH A BREEZE THROUGH IT.

  THE PETAL IS THEIRS. It is not drawn to look like their line work, it is lifted
  out of it. Their logo was traced, the interior of the lower-left petal was flood
  filled, that region was grown just past the stroke bounding it, and the result was
  re-traced on its own. So the wobble in this outline is the wobble in the drawing
  the DeVines already own. glaze.md: "If the real asset exists, use the real asset."
  The work is in tools/extract-petal.py and it is repeatable.

  An earlier attempt clipped an ellipse over the flower instead. It amputated three
  strokes mid-line and looked like a torn sticker. Rendered, looked at, thrown away.

  WHAT HAPPENS. On a full page load one petal lifts off the lily, tumbles right on a
  gust, and the wordmark wipes in just behind it, so the letters arrive as if the
  petal uncovered them.

  THE THREE MOTION RULES, from glaze.md section 4:

  1. THE UN-ANIMATED STATE IS THE FINISHED STATE. Everything below renders complete
     and static by default. The animation only exists inside `.breeze .is-blowing`,
     and that class is added by the two-line script at the bottom. Scripting off,
     script blocked, JS error anywhere: the visitor gets the whole logo, sitting
     still. Nothing is hidden by default and then revealed, which is the trap.

  2. REDUCED MOTION DEGRADES TO SOMETHING, AND I LOOKED AT IT. The media query wins
     because it is declared after, and it restores the finished state rather than
     setting `animation: none` and hoping. Screenshotted at 1440 and 390 with
     prefers-reduced-motion forced on: identical to the static logo.

  3. THE CURVE, NOT JUST THE DURATION. The petal uses cubic-bezier(.33,0,.30,1),
     which holds still for a beat, accelerates, then settles. A default ease spends
     most of its travel in the first third and then creeps, which reads as a slide
     transition rather than as air moving.

  DESYNCHRONISED, because that is what makes it read as weather: the petal leaves at
  120ms, the wipe follows at 300ms, and the lily's own sway runs on a longer period
  that never lines up with either.
*/

/*
  potrace emits path data in tenth-of-a-point units with the Y axis pointing up, and
  relies on the group transform below to place it. Dropping the transform and using a
  277x310 viewBox drew the petal at ten times the size and upside down, so the header
  showed one solid corner of it. Caught by looking at the frames, which is the only
  way that class of bug ever gets caught.
*/
const PETAL_VIEWBOX = "0 0 2770 3100";
const PETAL_TRANSFORM = "translate(0,3100) scale(1,-1)";
const PETAL_PATH = "M2322 3078 c-24 -11 -57 -38 -74 -59 -17 -21 -35 -36 -40 -33 -4 3 -22 -5 -40 -17 l-31 -22 5 26 c6 32 6 32 -33 11 -17 -8 -35 -28 -40 -44 -15 -41 -70 -74 -194 -114 -60 -20 -132 -51 -160 -69 -27 -18 -76 -39 -108 -46 -32 -7 -99 -34 -150 -61 -51 -26 -119 -56 -152 -66 -33 -10 -67 -24 -76 -31 -8 -7 -29 -13 -46 -13 -16 0 -64 -9 -107 -20 -71 -18 -80 -18 -116 -4 -86 35 -310 9 -310 -35 0 -15 93 -34 111 -23 15 9 19 7 28 -18 12 -35 14 -35 47 -13 24 15 29 15 77 0 106 -33 157 -33 269 2 236 74 374 131 393 162 4 5 19 9 36 9 17 0 49 14 78 35 60 41 100 59 172 74 30 7 83 30 119 51 36 22 108 58 160 81 52 22 100 44 105 48 6 5 53 25 104 46 198 79 249 107 275 153 14 24 -250 15 -302 -10z M2658 3054 c-26 -23 -38 -44 -38 -62 0 -15 -4 -34 -9 -41 -6 -9 -6 -23 1 -35 7 -12 10 -66 9 -129 -1 -92 2 -115 21 -160 24 -54 25 -71 20 -263 -2 -93 -4 -102 -23 -107 -20 -5 -20 -10 -17 -229 3 -219 3 -224 -20 -252 -12 -16 -25 -45 -28 -66 -4 -26 -22 -54 -65 -100 -46 -48 -63 -76 -75 -119 -22 -76 -73 -166 -130 -226 -26 -27 -66 -75 -88 -105 -22 -30 -43 -57 -46 -60 -3 -3 -31 -40 -63 -82 -32 -42 -62 -80 -68 -84 -6 -3 -23 -24 -39 -46 -102 -141 -245 -281 -262 -256 -25 37 19 303 68 413 26 59 82 201 94 237 7 23 23 44 41 55 16 10 39 36 50 59 11 23 47 72 79 109 33 37 64 83 69 102 6 19 30 57 55 83 43 46 65 110 38 110 -17 0 -81 -67 -116 -123 -20 -31 -47 -62 -60 -68 -14 -7 -47 -48 -75 -93 -29 -44 -73 -110 -99 -146 -26 -36 -58 -90 -71 -120 -13 -30 -34 -75 -48 -100 -14 -25 -32 -76 -40 -115 -8 -38 -24 -86 -35 -107 -13 -23 -19 -46 -15 -64 3 -15 -3 -44 -14 -68 -15 -32 -19 -65 -19 -158 0 -132 -3 -139 -79 -178 -22 -11 -56 -36 -76 -56 -19 -19 -39 -32 -45 -29 -5 3 -17 -3 -27 -14 -10 -10 -33 -22 -52 -26 -19 -4 -83 -31 -142 -60 -126 -62 -275 -84 -471 -70 -217 16 -354 1 -413 -45 -69 -54 -137 -79 -170 -63 l-35 17 0 231 c0 213 1 232 19 247 27 23 26 275 -2 325 -11 22 -17 54 -17 100 0 46 -10 102 -30 172 -37 127 -40 226 -10 292 11 24 20 62 20 85 0 27 8 54 24 76 50 74 75 125 86 172 11 51 25 69 127 173 29 29 53 57 53 62 0 19 63 82 101 101 20 11 47 33 59 50 12 16 54 54 94 84 87 66 128 105 120 117 -11 19 -54 7 -94 -26 -23 -19 -49 -35 -57 -35 -14 0 -205 -168 -278 -245 -110 -115 -215 -259 -215 -295 0 -10 -18 -53 -40 -96 -80 -157 -111 -444 -60 -549 32 -66 39 -351 13 -505 -12 -70 -16 -167 -17 -370 l-1 -275 165 -3 165 -3 84 43 83 43 267 5 266 5 49 34 c26 18 74 41 107 51 32 10 70 27 86 38 15 11 51 30 78 43 28 12 81 42 118 66 37 24 70 43 72 43 3 0 24 14 47 30 52 38 54 38 65 -6 l8 -37 32 27 c32 27 32 28 35 129 l3 102 80 3 c89 3 100 9 140 78 14 24 45 57 70 74 24 16 47 39 50 50 3 11 13 20 20 20 8 0 33 25 56 55 22 30 49 57 60 60 10 4 19 12 19 20 0 17 81 127 141 190 57 61 121 155 150 221 29 65 98 164 112 161 6 -1 19 18 27 43 9 25 26 64 38 87 21 40 22 55 22 257 0 181 2 215 15 220 24 9 22 534 -2 579 -13 23 -19 68 -24 162 -11 208 -14 214 -71 159z M1888 2881 c-16 -9 -28 -19 -28 -23 0 -14 37 -8 50 7 20 24 7 32 -22 16z";

export default function Logo() {
  return (
    <a className="brand breeze" href={href("")} aria-label={`${site.name}, home`}>
      {/*
        The mark and the wipe are the same file. The wordmark is not a separate
        asset: it is revealed by an inset clip that opens left to right, so there is
        nothing to keep in sync and nothing that can fall out of alignment.
      */}
      <span className="brand-plate">
        <img
          className="brand-img"
          src="/img/brand/logo.webp"
          srcSet="/img/brand/logo-sm.webp 480w, /img/brand/logo.webp 1200w"
          sizes="200px"
          width={1200}
          height={744}
          alt={site.name}
        />
        {/*
          aria-hidden and focusable=false: it is one petal off a mark whose alt text
          already says the name. Announcing it would read the business name twice.
        */}
        <svg className="brand-petal" viewBox={PETAL_VIEWBOX} width="2770" height="3100" aria-hidden="true" focusable="false">
          <g transform={PETAL_TRANSFORM}>
            <path d={PETAL_PATH} fill="currentColor" />
          </g>
        </svg>
      </span>
    </a>
  );
}

/*
  Adds the class that arms the animation, on mount, once per document load.

  It is a client component holding no state and rendering nothing. It sits in the
  layout rather than inside Logo so that Logo itself stays a server component and
  ships no JavaScript of its own.
*/
export function BreezeOnLoad() {
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{
        __html:
          "try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches){" +
          "document.querySelectorAll('.breeze').forEach(function(n){n.classList.add('is-blowing')})}}catch(e){}",
      }}
    />
  );
}
