/**
 * THE SEASONAL ENGINE.
 *
 * The owner said it herself: the change of seasons is a huge part of her sales.
 * Spring wants pastels, fall wants rust, and a florist's site that looks
 * identical in February and October is ignoring the thing her customers walk in
 * feeling. This file makes the demo change with the calendar on its own, with
 * nothing for anyone to edit: four premade seasons as the base, and the flower
 * holidays highlighted on top as each one approaches.
 *
 * WHAT A SEASON CHANGES: the accent color every hover and link on the demo
 * borrows (one token, overridden per season in globals.css), the hero's kicker,
 * headline and closing clause, and which six pieces the homepage features. WHAT
 * IT NEVER CHANGES: prices, hours, products, or any other business fact. Those
 * live in site.ts and catalog.ts, and a season has no business touching them.
 *
 * WHAT A HOLIDAY ADDS: a slim band under the header naming the day and its
 * date, with one link into her own catalog. Nothing in a band invents a
 * business fact: no order cutoffs, no delivery promises, no "going fast". She
 * has published none of those (glaze/clients/devine.md: no fee, minimum or
 * cutoff is invented anywhere), so the bands state the date and point at the
 * shop.
 *
 * DATES ARE COMPUTED, NEVER STORED. Valentine's is fixed, Easter is the
 * Computus, Mother's Day is the second Sunday of May. The engine never needs a
 * yearly edit, which is the entire point of building it.
 *
 * RENDERED PER REQUEST. glaze.md's failure log has a build that printed
 * "taking orders for 2027" because new Date() froze at build time, and its rule
 * is that route caching and time do not mix. The demo layout forces dynamic
 * rendering, and "today" is computed in the shop's own timezone
 * (America/Detroit), because the server clock is UTC and a holiday band should
 * not appear or vanish at 8pm Michigan time.
 *
 * PREVIEW: the footer offers the seasons and the three biggest holidays as
 * one-click previews, a cookie set by /api/season. That is the demo move for
 * the meeting (flip her site through a whole year across the table), and it is
 * also how a session verifies all the states without waiting for February.
 *
 * The seasonal copy and the featured picks are OURS, drawn from her own product
 * descriptions but not approved by her. On the README checklist for the owner
 * to veto, next to the palette note.
 */

import { cookies } from "next/headers";

/* ---- calendar plumbing ---------------------------------------------------- */

/** A plain calendar date, month 1 to 12. All comparisons go through serial(). */
export type YMD = { y: number; m: number; d: number };

const serial = ({ y, m, d }: YMD) => y * 10000 + m * 100 + d;

/** Today on the shop's own clock, not the server's. Vercel runs UTC. */
export function todayInMarshall(): YMD {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const weekdayOf = ({ y, m, d }: YMD) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

function minusDays({ y, m, d }: YMD, days: number): YMD {
  const t = new Date(Date.UTC(y, m - 1, d) - days * 86400000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** e.g. the second Sunday of May: nthWeekday(y, 5, 0, 2). weekday 0 is Sunday. */
function nthWeekday(y: number, m: number, weekday: number, n: number): YMD {
  const first = weekdayOf({ y, m, d: 1 });
  return { y, m, d: 1 + ((weekday - first + 7) % 7) + (n - 1) * 7 };
}

/** e.g. Memorial Day, the last Monday of May: lastWeekday(y, 5, 1). */
function lastWeekday(y: number, m: number, weekday: number): YMD {
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, d: last - ((weekdayOf({ y, m, d: last }) - weekday + 7) % 7) };
}

/** Easter Sunday, Gregorian, by the anonymous Computus (Meeus/Jones/Butcher). */
function easter(y: number): YMD {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - dd - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const mm = Math.floor((a + 11 * h + 22 * l) / 451);
  return { y, m: Math.floor((h + l - 7 * mm + 114) / 31), d: ((h + l - 7 * mm + 114) % 31) + 1 };
}

/* ---- the four seasons ----------------------------------------------------- */

export type SeasonSlug = "spring" | "summer" | "fall" | "winter";

/**
 * The homepage hero photograph, as a slot the seasons can fill.
 *
 * Every season's `hero` is null today because the four photographs do not
 * exist: they are the owner's to take, and a guess written as a plain value is
 * worse than a blank (glaze.md). When one lands, fill the entry: process the
 * image like any product photo, put the real pixel size here (width and height
 * are required so nothing reflows while it loads), and write alt text that
 * describes THAT photograph. On the README checklist.
 *
 * A config slot rather than a filesystem scan, deliberately. Scanning
 * public/img for spring.webp would mean a misnamed file silently changes the
 * homepage, and there would be nowhere to keep the photo's true size and its
 * alt text. One edit per photo, next to the season it belongs to.
 *
 * `traced` exists because of HeroTrace: the four blooms it draws are traced
 * out of the default photograph's exact pixels (lib/hero-trace.json). Over any
 * other image those strokes would outline flowers that are not there, so only
 * the photo the trace was made from may arm it. A seasonal photo gets
 * traced: false until someone re-traces against its own pixels.
 */
export type HeroPhoto = {
  src: string;
  width: number;
  height: number;
  alt: string;
  traced: boolean;
};

/** The photograph the site shipped with, and the one the trace belongs to. */
const DEFAULT_HERO: HeroPhoto = {
  src: "/img/shop/shop-4.webp",
  width: 1000,
  height: 1100,
  alt: "A hand-tied arrangement of purple lisianthus, delphinium and pink alstroemeria, made at DeVine's",
  traced: true,
};

export const heroFor = (season: Season): HeroPhoto => season.hero ?? DEFAULT_HERO;

export type Season = {
  slug: SeasonSlug;
  /** Lowercase, because it prints inside sentences. */
  name: string;
  /** The hero's small line. The town stays in it; the season joins it. */
  kicker: string;
  /** Second line of the hero headline: "Grown, gathered, / arranged for fall." */
  headlineTail: string;
  /**
   * Completes the hero lede after "...and source the rest close by, ". The
   * first sentence of the lede is fixed because it carries the business facts;
   * only this closing clause turns with the year.
   */
  ledeTail: string;
  /** The kicker over the homepage grid. */
  featureKicker: string;
  /**
   * Six pieces per season, picked from HER OWN descriptions, never invented:
   * Clementine's copy says "the warmth of summer", Maeve's says "autumn tones".
   *
   * AT LEAST HALF PHOTOGRAPHED, by construction. Only 20 of 57 products have a
   * photograph, and a first draft of these lists put six Bloom prints on the
   * summer homepage at once: a wall of placeholder art doing the selling, the
   * exact pattern lib/order.ts exists to prevent. So each list carries three of
   * her real photographs (the plants cover the photo-poor seasons; living
   * things are honestly in season all year), the homepage renders them through
   * photoFirst(), and when the remaining photographs land these lists should be
   * recomposed toward the arrangements. On the checklist.
   */
  featuredSlugs: string[];
  /** This season's hero photograph, or null for the default. See HeroPhoto. */
  hero: HeroPhoto | null;
};

/**
 * Meteorological quarters, not astronomical. A florist's spring starts when the
 * pastel orders start, March 1, not at the equinox on the 20th.
 */
export const SEASONS: Record<SeasonSlug, Season> = {
  spring: {
    slug: "spring",
    name: "spring",
    kicker: "Spring in Marshall, Michigan",
    headlineTail: "arranged for spring.",
    ledeTail: "so what you send is whatever spring has just started doing.",
    featureKicker: "This spring from the studio",
    // Her pastels in art: "delicate pastels" (Butterfly Kisses), "petite peach
    // spray roses and baby's breath" (Hanna), "butterfly ranunculus" (Eliza).
    // Her photographs: "three bright butterflies" (Beautiful Memory), the dove
    // garden (Peaceful Garden), the white-blooming peace lily.
    featuredSlugs: ["butterfly-kisses", "hanna", "eliza", "beautiful-memory", "peaceful-garden-2", "6-peace-lily"],
    hero: null, // PLACEHOLDER until her spring photo lands; see HeroPhoto
  },
  summer: {
    slug: "summer",
    name: "summer",
    kicker: "Summer in Marshall, Michigan",
    headlineTail: "arranged for summer.",
    ledeTail: "so what you send is whatever the garden is doing at full height.",
    featureKicker: "This summer from the studio",
    // In art: "the warmth of summer" (Clementine, her words), "the energy of a
    // garden in full bloom" (Nicole), "a garden of bold color" (Looking
    // Lovely). Photographed: the earthy Terra Bowl, the sun-happy succulents,
    // and the wind chime whose own copy is about a garden and the breeze.
    featuredSlugs: ["clementine", "nicole", "looking-lovely", "terra-bowel", "succulent-garden", "cylinder-wind-chime"],
    hero: null, // the default photograph IS the summer photograph
  },
  fall: {
    slug: "fall",
    name: "fall",
    kicker: "Fall in Marshall, Michigan",
    headlineTail: "arranged for fall.",
    ledeTail: "so what you send is whatever fall is doing outside.",
    featureKicker: "This fall from the studio",
    // Her own homepage six, unchanged: every description in this list says
    // autumn out loud, and all six are photographed. This is the set the
    // catalog used to export as `featured` before the seasons took over.
    featuredSlugs: ["helene", "maeve", "ginger", "gwendolyn", "harper-2", "della"],
    hero: null, // PLACEHOLDER until her fall photo lands; see HeroPhoto
  },
  winter: {
    slug: "winter",
    name: "winter",
    kicker: "Winter in Marshall, Michigan",
    headlineTail: "arranged for winter.",
    ledeTail: "so what you send in winter is something alive, in the quietest part of the year.",
    featureKicker: "This winter from the studio",
    // Red and white when nothing blooms, and the plants carry the season:
    // "the classic way to say I love you" (Classic Red Dozen), Serena's white
    // lilies and roses, the slow-down basket, then the photographed living
    // things for the months when something alive is the whole point.
    featuredSlugs: ["dozen-roses", "serena", "mindful-moments-basket", "8-peace-lily", "rustic-box-planter", "large-ceramic-dish-garden"],
    hero: null, // PLACEHOLDER until her winter photo lands; see HeroPhoto
  },
};

export function seasonFor(today: YMD): Season {
  const m = today.m;
  if (m >= 3 && m <= 5) return SEASONS.spring;
  if (m >= 6 && m <= 8) return SEASONS.summer;
  if (m >= 9 && m <= 11) return SEASONS.fall;
  return SEASONS.winter;
}

/* ---- the holidays --------------------------------------------------------- */

type HolidayDef = {
  slug: string;
  name: string;
  day: (y: number) => YMD;
  /** The band appears this many days before the day, and leaves the day after. */
  leadDays: number;
  /**
   * One editorial line after the date. Nothing here is a claim about her shop's
   * stock, hours or deadlines. Where a line leans on a fact, the fact is hers:
   * "a dozen red roses" is her own product copy, the Albion chocolate is her
   * own supplier note on the truffle boxes.
   */
  note: string;
  cta: { label: string; path: string };
};

const HOLIDAYS: HolidayDef[] = [
  {
    slug: "valentines",
    name: "Valentine's Day",
    day: (y) => ({ y, m: 2, d: 14 }),
    leadDays: 13, // February 1
    note: "The classic way to say it is a dozen red roses.",
    cta: { label: "The Classic Red Dozen", path: "/product/dozen-roses" },
  },
  {
    slug: "easter",
    name: "Easter",
    day: easter,
    leadDays: 14,
    note: "Lilies, gardens and living things.",
    cta: { label: "Shop plants", path: "/shop/plants" },
  },
  {
    // One of the real business flower days, and it points at her business
    // audience. Wednesday of the last FULL (Sunday to Saturday) week of April:
    // the last Saturday of the month, minus three. Verified against the
    // published 2024 to 2027 dates.
    slug: "admin-professionals",
    name: "Administrative Professionals Day",
    day: (y) => {
      const sat = lastWeekday(y, 4, 6);
      return { y, m: 4, d: sat.d - 3 };
    },
    leadDays: 8,
    note: "For the people who keep the place running.",
    cta: { label: "Shop arrangements", path: "/shop" },
  },
  {
    slug: "mothers-day",
    name: "Mother's Day",
    day: (y) => nthWeekday(y, 5, 0, 2), // second Sunday of May
    leadDays: 16,
    note: "The biggest flower day of the year.",
    cta: { label: "Shop arrangements", path: "/shop" },
  },
  {
    // Graveside flowers in small-town Michigan. Her own category blurb wrote
    // the note's register: "a service, a graveside, or a kitchen table that
    // needs softening." Last Monday of May.
    slug: "memorial-day",
    name: "Memorial Day",
    day: (y) => lastWeekday(y, 5, 1),
    leadDays: 12,
    note: "For a graveside, and for remembering.",
    cta: { label: "Celebration of Life", path: "/celebration-of-life" },
  },
  {
    // A Great Lakes holiday most of the country has never heard of, and a real
    // one for a Michigan flower shop. Third Saturday of October.
    slug: "sweetest-day",
    name: "Sweetest Day",
    day: (y) => nthWeekday(y, 10, 6, 3),
    leadDays: 9,
    note: "A Michigan tradition.",
    cta: { label: "Shop just because", path: "/shop/just-because" },
  },
  {
    slug: "thanksgiving",
    name: "Thanksgiving",
    day: (y) => nthWeekday(y, 11, 4, 4), // fourth Thursday of November
    leadDays: 12,
    note: "Flowers for the table.",
    cta: { label: "Shop arrangements", path: "/shop" },
  },
  {
    slug: "christmas",
    name: "Christmas",
    day: (y) => ({ y, m: 12, d: 25 }),
    leadDays: 24, // December 1
    note: "Plants, gifts and chocolate from down the road in Albion.",
    cta: { label: "Shop gifts & add ons", path: "/shop/gifts-add-ons" },
  },
];

export type ActiveHoliday = {
  slug: string;
  name: string;
  /** "Valentine's Day is Saturday, February 14." Computed, never typed. */
  line: string;
  note: string;
  cta: { label: string; path: string };
};

function activate(h: HolidayDef, day: YMD): ActiveHoliday {
  return {
    slug: h.slug,
    name: h.name,
    line: `${h.name} is ${WEEKDAYS[weekdayOf(day)]}, ${MONTHS[day.m - 1]} ${day.d}.`,
    note: h.note,
    cta: h.cta,
  };
}

/**
 * The holiday whose band should show today, or null. Windows can in principle
 * overlap (Easter can land inside Mother's Day's lead in an extreme year), so
 * the nearest upcoming day wins: the band always names the next thing coming.
 */
export function holidayFor(today: YMD): ActiveHoliday | null {
  const t = serial(today);
  let best: { h: HolidayDef; day: YMD } | null = null;
  for (const h of HOLIDAYS) {
    const day = h.day(today.y);
    if (t < serial(minusDays(day, h.leadDays)) || t > serial(day)) continue;
    if (!best || serial(day) < serial(best.day)) best = { h, day };
  }
  return best ? activate(best.h, best.day) : null;
}

/* ---- resolution and preview ----------------------------------------------- */

export type Seasonal = {
  season: Season;
  holiday: ActiveHoliday | null;
  /** The preview slug in force, or null when the calendar is in charge. */
  preview: string | null;
};

/**
 * A season preview shows that season plain, with no holiday band, so each of
 * the four base looks can be seen by itself. A holiday preview shows the band
 * on top of the season the holiday lives in, dated to its next occurrence.
 */
export function resolveSeasonal(today: YMD, override?: string | null): Seasonal {
  if (override && override in SEASONS) {
    return { season: SEASONS[override as SeasonSlug], holiday: null, preview: override };
  }
  const def = override ? HOLIDAYS.find((h) => h.slug === override) : undefined;
  if (def) {
    let day = def.day(today.y);
    if (serial(day) < serial(today)) day = def.day(today.y + 1);
    return { season: seasonFor(day), holiday: activate(def, day), preview: def.slug };
  }
  return { season: seasonFor(today), holiday: holidayFor(today), preview: null };
}

export const isPreviewSlug = (s: string): boolean =>
  s in SEASONS || HOLIDAYS.some((h) => h.slug === s);

/**
 * What the footer offers. All four seasons, then the three holidays that sell
 * the idea hardest across a table. The other three still fire on the calendar;
 * they are just not worth seven links of footer.
 */
export const PREVIEW_CHOICES = [
  { slug: "spring", label: "Spring" },
  { slug: "summer", label: "Summer" },
  { slug: "fall", label: "Fall" },
  { slug: "winter", label: "Winter" },
  { slug: "valentines", label: "Valentine's Day" },
  { slug: "mothers-day", label: "Mother's Day" },
  { slug: "christmas", label: "Christmas" },
] as const;

export const SEASON_COOKIE = "season";

/** The one entry point pages and layouts use. Reads the preview cookie. */
export async function currentSeasonal(): Promise<Seasonal> {
  const jar = await cookies();
  const override = jar.get(SEASON_COOKIE)?.value ?? null;
  return resolveSeasonal(todayInMarshall(), override);
}
