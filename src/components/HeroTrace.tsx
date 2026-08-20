import trace from "@/lib/hero-trace.json";

/*
  THE HERO, DRAWN ON BY HAND, THEN LET GO.

  Their mark is an ink line drawing of a lily. Their photography is photography. This
  is the join: four blooms traced out of the actual hero photograph and drawn on in
  sequence, held for a beat, and released — the same hand that drew the logo, passing
  over the picture and leaving it alone.

  The paths are not decorative squiggles. Every one of them was measured off the
  pixels of this exact file; see tools/trace-hero.py, which is repeatable and which
  documents why the four blooms are chosen by hand rather than found by threshold.

  THE THREE MOTION RULES, same as the logo:

  1. THE UN-ANIMATED STATE IS THE FINISHED STATE, and here the finished state is the
     PHOTOGRAPH WITH NOTHING ON IT. The group is opacity:0 by default and only ever
     becomes visible inside `.is-drawing`, which the same one-line script that arms
     the logo adds on load. Script blocked, JS error, an old browser: the visitor gets
     the photograph, which is what they came for. Nothing is hidden and then revealed.

  2. REDUCED MOTION GETS NOTHING, NOT A STATIC VERSION. A drawing that is *about* the
     act of drawing has no meaningful still frame — leaving the finished linework
     sitting permanently on the photograph would be a different design, not a degraded
     one. The arming script already checks the preference, so this never starts.

  3. THE CURVE. Each stroke draws on an ease-out so the pen arrives and settles rather
     than stopping dead, and the whole group leaves on a long, slow fade — the drawing
     should dissolve, not be switched off.

  WHY pathLength="1". These paths differ in real length by more than a factor of two.
  Normalising every one of them to a length of 1 means a single dash rule in the
  stylesheet covers all of them; the per-path `--rel` then scales only the DURATION,
  so a long outline takes longer than a short petal fold and the pen appears to move
  at one constant speed rather than every line taking the same time regardless.

  WHY preserveAspectRatio="slice". The photograph is `object-fit: cover`. `slice` is
  the SVG spelling of exactly that, so the overlay crops identically at every viewport
  and the lines stay welded to the flowers they were traced from. `meet` — the default
  — would letterbox the drawing against a cropped photo and slide it off the blooms at
  every width except one.
*/

const DRAW_MS = 620; // one stroke, at rel = 1
const STAGGER_MS = 145;
const LEAD_IN_MS = 900; // the photograph gets a moment on its own first

export default function HeroTrace() {
  return (
    <svg
      className="hero-trace"
      viewBox={`0 0 ${trace.w} ${trace.h}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <g className="hero-trace-ink">
        {trace.strokes.map((s, i) => (
          <path
            key={i}
            d={s.d}
            pathLength={1}
            className={`ht ht--${s.kind}`}
            style={
              {
                "--dur": `${Math.round(DRAW_MS * s.rel)}ms`,
                "--delay": `${LEAD_IN_MS + i * STAGGER_MS}ms`,
              } as React.CSSProperties
            }
          />
        ))}
      </g>
    </svg>
  );
}

/** When the last stroke has finished drawing, for timing the fade in the stylesheet. */
export const HERO_TRACE_END_MS =
  LEAD_IN_MS + (trace.strokes.length - 1) * STAGGER_MS + DRAW_MS;
