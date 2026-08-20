/**
 * BLOOM: generated botanical artwork, standing in for photography.
 *
 * WHY THIS EXISTS
 * We have the owner's permission to use their photographs, but their host answers
 * automated image requests with a captcha, and defeating a captcha is not something
 * this build will do. Until the real photos arrive, every product needs something in
 * the frame, and the two obvious options are both bad: a grey box says the site is
 * broken, and stock flowers misrepresent what this shop actually sells.
 *
 * So this draws from their own words. Every product description on their shop names
 * the real flowers and the real colors. Ginger is "deep toned hydrangeas, orange
 * daisies, butterscotch cremones, dark purple button mums, Free Spirit roses, orange
 * carnations, solidago" — a palette and a composition, written by the florist who
 * made it. This reads that sentence and draws it.
 *
 * WHAT IT IS NOT
 * A first version drew a literal bouquet: stems fanning from one point into a vase.
 * It read as clipart, which on a florist's site is worse than no picture, because it
 * makes their work look cheap. Rendered, looked at, thrown away.
 *
 * This draws a pressed-botanical print instead: a dense field of blooms and foliage,
 * overlapping, cropped by the frame, at four scales. That is a visual language
 * florists already use, on their papers and their fabrics, and it succeeds or fails
 * as pattern rather than as representation. It cannot be mistaken for a photograph,
 * which is the honest outcome.
 *
 * PLACEHOLDER, and on the README checklist as one. When the photographs land this
 * file is deleted, not kept.
 *
 * DETERMINISTIC, seeded from the slug: identical on server and client (a reshuffle
 * between the two is a hydration error) and identical between builds (a reshuffle
 * between builds is a visual diff nobody can review).
 *
 * NO CLIENT JAVASCRIPT. Server-rendered SVG, so it costs nothing at runtime and
 * survives with scripting off, which the launch checklist requires.
 */

type Props = {
  slug: string;
  desc: string;
  name: string;
  /** Detail pages get a denser field than grid cards. */
  detail?: boolean;
  className?: string;
};

/* ---- colour lexicon ------------------------------------------------------
   Keyed on the words their florists actually write. Longer keys are tested
   first, so "dark purple" beats "purple" and "light blue" beats "blue". */
const COLORS: [string, string][] = [
  ["deep purple", "#5B2A83"], ["dark purple", "#4A2270"], ["light blue", "#8FC7E8"],
  ["burnt orange", "#C2571E"], ["sunset orange", "#E0692B"], ["peachy orange", "#EE9E6C"],
  ["butterscotch", "#D2913F"], ["champagne", "#E3CDA4"], ["burgundy", "#7C2138"],
  ["lavender", "#AD95D1"], ["magenta", "#BE2C68"], ["chocolate", "#5C4033"],
  ["mauve", "#BC8093"], ["apricot", "#EEAC79"], ["ivory", "#F2EADC"],
  ["cream", "#EDE0C8"], ["peach", "#F0AF8C"], ["coral", "#E9836A"],
  ["purple", "#77419A"], ["orange", "#E07B2C"], ["yellow", "#E8BE3E"],
  ["golden", "#D6A636"], ["gold", "#D6A636"], ["blue", "#5386C0"],
  ["pink", "#E086A8"], ["red", "#BC3A2E"], ["white", "#FAF6EE"],
  ["green", "#5C8A4A"], ["grey", "#96968F"], ["gray", "#96968F"],
];

/** Four shapes cover the catalog. Dozens of species, four ways of drawing them. */
type Form = "round" | "rose" | "spike" | "berry";
const FORMS: [string, Form][] = [
  ["rose", "rose"], ["ranunculus", "rose"], ["peony", "rose"], ["lisianthus", "rose"],
  ["dahlia", "rose"], ["anemone", "rose"],
  ["mum", "round"], ["carnation", "round"], ["daisy", "round"], ["hydrangea", "round"],
  ["aster", "round"], ["gerbera", "round"], ["sunflower", "round"], ["scabiosa", "round"],
  ["chamomile", "round"], ["calendula", "round"], ["cremone", "round"], ["viking", "round"],
  ["lily", "round"], ["iris", "round"], ["succulent", "round"],
  ["delphinium", "spike"], ["snapdragon", "spike"], ["stock", "spike"], ["larkspur", "spike"],
  ["solidago", "spike"], ["veronica", "spike"], ["statice", "spike"], ["limonium", "spike"],
  ["thistle", "spike"], ["lavender", "spike"], ["alstroemeria", "spike"], ["waxflower", "spike"],
  ["hypericum", "berry"], ["berries", "berry"], ["berry", "berry"], ["craspedia", "berry"],
  ["baby's breath", "berry"], ["strawflower", "berry"], ["bunny tail", "berry"], ["rice", "berry"],
];

/** mulberry32, seeded off the slug. Small, fast, stable across builds. */
function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function read(desc: string) {
  const d = desc.toLowerCase();
  const palette: string[] = [];
  for (const [word, hex] of COLORS) if (d.includes(word) && !palette.includes(hex)) palette.push(hex);
  const forms: Form[] = [];
  for (const [word, form] of FORMS) if (d.includes(word) && !forms.includes(form)) forms.push(form);
  return {
    // A garden palette for the few products whose copy names no colour: the teas,
    // the plush toys, the dish gardens.
    palette: palette.length >= 2 ? palette.slice(0, 5) : ["#E086A8", "#E8BE3E", "#77419A", "#5386C0"],
    forms: forms.length ? forms : (["round", "rose", "spike", "berry"] as Form[]),
  };
}

/** One petal, drawn as a bezier teardrop. Ellipse spokes were what read as clipart. */
const PETAL = "M0 0C7 -11 11 -25 0 -38C-11 -25 -7 -11 0 0Z";
const LEAF = "M0 0C16 -9 30 -30 34 -56C10 -50 -6 -28 0 0Z";

function Bloom_({ form, color, r, seed }: { form: Form; color: string; r: number; seed: () => number }) {
  const s = r / 38; // petal path is drawn at 38 units tall
  switch (form) {
    case "round": {
      const petals = 7 + Math.floor(seed() * 4);
      return (
        <g>
          {[0.62, 1].map((k, layer) => (
            <g key={layer} opacity={layer ? 1 : 0.55} transform={`rotate(${layer * 24})`}>
              {Array.from({ length: petals }, (_, i) => (
                <path
                  key={i}
                  d={PETAL}
                  fill={color}
                  transform={`rotate(${(i * 360) / petals}) scale(${s * k})`}
                />
              ))}
            </g>
          ))}
          <circle r={r * 0.17} fill="#F0DFA8" />
          <circle r={r * 0.09} fill="#C9A94E" opacity="0.8" />
        </g>
      );
    }
    case "rose":
      return (
        <g>
          <circle r={r * 0.92} fill={color} opacity="0.34" />
          {[0.78, 0.6, 0.44, 0.3, 0.17].map((k, i) => (
            <circle key={i} r={r * k} fill={color} opacity={0.34 + i * 0.13} />
          ))}
          <path
            d={`M${r * 0.06} ${-r * 0.16}A${r * 0.17} ${r * 0.17} 0 1 1 ${-r * 0.02} ${-r * 0.12}`}
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity="0.42"
            strokeWidth={Math.max(0.9, r * 0.045)}
          />
        </g>
      );
    case "spike":
      return (
        <g>
          {Array.from({ length: 9 }, (_, i) => {
            const k = 1 - i * 0.085;
            return (
              <ellipse
                key={i}
                cx={(i % 2 ? 1 : -1) * r * 0.17 * k}
                cy={-i * r * 0.27}
                rx={r * 0.3 * k}
                ry={r * 0.21 * k}
                fill={color}
                opacity={0.94 - i * 0.055}
              />
            );
          })}
        </g>
      );
    case "berry":
      return (
        <g>
          {Array.from({ length: 9 }, (_, i) => {
            const a = (i / 9) * Math.PI * 2 + seed();
            const d = r * (0.28 + (i % 3) * 0.16);
            return (
              <circle
                key={i}
                cx={Math.cos(a) * d}
                cy={Math.sin(a) * d}
                r={r * 0.19}
                fill={color}
                opacity="0.93"
              />
            );
          })}
        </g>
      );
  }
}

export default function Bloom({ slug, desc, name, detail = false, className }: Props) {
  const { palette, forms } = read(desc);
  const rand = rng(slug);
  const uid = `b${slug.replace(/[^a-z0-9]/g, "")}`; // this renders many times per page, so ids must differ

  const W = 400;
  const H = 500;

  /* Foliage first: big, soft, low-contrast, deliberately running off the edges so the
     frame reads as a crop out of a larger print rather than an object on a card. */
  const GREENS = ["#5C8A4A", "#3F6B3C", "#6E9159", "#2F5D3A"];
  const leaves = Array.from({ length: detail ? 26 : 20 }, () => ({
    x: rand() * W,
    y: rand() * H,
    rot: rand() * 360,
    scale: 0.8 + rand() * 1.7,
    tone: GREENS[Math.floor(rand() * GREENS.length)],
    op: 0.24 + rand() * 0.3,
  }));

  /* Blooms at four scales. A handful of large ones carry the composition, the rest
     fill. Even placement with jitter rather than pure random, because pure random
     clumps and leaves holes at these counts. */
  const N = detail ? 30 : 23;
  const cols = 4;
  const rows = Math.ceil(N / cols);
  const blooms = Array.from({ length: N }, (_, i) => {
    const cx = ((i % cols) + 0.5) * (W / cols) + (rand() - 0.5) * (W / cols) * 1.15;
    const cy = (Math.floor(i / cols) + 0.5) * (H / rows) + (rand() - 0.5) * (H / rows) * 1.15;
    const roll = rand();
    const r = roll > 0.8 ? 44 + rand() * 22 : roll > 0.34 ? 26 + rand() * 15 : 16 + rand() * 9;
    return {
      x: cx, y: cy, r,
      rot: rand() * 360,
      form: forms[Math.floor(rand() * forms.length)],
      color: palette[Math.floor(rand() * palette.length)],
      seed: rand,
    };
  }).sort((a, b) => a.r - b.r); // small behind large, so the big blooms read as nearest

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      className={className}
      role="img"
      aria-label={`Botanical illustration for ${name}`}
      /* width and height are stated as well as the viewBox: a viewBox alone gives
         Safari an aspect ratio with no intrinsic size and it falls back to 150px. */
    >
      <defs>
        <radialGradient id={`${uid}w`} cx="42%" cy="34%" r="78%">
          <stop offset="0%" stopColor={palette[0]} stopOpacity="0.15" />
          <stop offset="60%" stopColor={palette[1] ?? palette[0]} stopOpacity="0.07" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${uid}c`}>
          <rect width={W} height={H} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${uid}c)`}>
        <rect width={W} height={H} fill="#F6F0E4" />
        <rect width={W} height={H} fill={`url(#${uid}w)`} />

        {leaves.map((l, i) => (
          <path
            key={`l${i}`}
            d={LEAF}
            fill={l.tone}
            opacity={l.op}
            transform={`translate(${l.x} ${l.y}) rotate(${l.rot}) scale(${l.scale})`}
          />
        ))}

        {blooms.map((b, i) => (
          <g key={`b${i}`} transform={`translate(${b.x} ${b.y}) rotate(${b.rot})`}>
            <Bloom_ form={b.form} color={b.color} r={b.r} seed={b.seed} />
          </g>
        ))}
      </g>
    </svg>
  );
}
