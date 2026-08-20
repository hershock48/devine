/**
 * EVERY BUSINESS FACT ABOUT DEVINE'S LIVES HERE.
 *
 * glaze.md: "Every business fact goes in one constant file, so a correction is one
 * edit." Copper's TV count shipped wrong three times because it was typed into six
 * separate pieces of copy. Nothing in this build hardcodes an hour, a town, a phone
 * number or a price.
 *
 * SOURCE: harvested from devinesflowersandbotanicals.com on 2026-08-20. Anything
 * carrying PLACEHOLDER below was NOT on their site and must be confirmed with the
 * owner before launch. Each one is on the README checklist.
 */

export const site = {
  name: "DeVine's Flowers & Botanicals",
  shortName: "DeVine's",
  /**
   * The capital V is theirs and it is load-bearing. Their current site spells the
   * name four different ways across eight pages and only two of them keep it. The
   * whole build uses this constant so that cannot happen again.
   */
  tagline: "Sharing happiness through flowers and plants.",
  town: "Marshall, Michigan",
  region: "Southwest Michigan",

  phone: "269-789-0830",
  phoneHref: "tel:+12697890830",
  email: "devinesflowersandbotanicals@gmail.com",

  address: {
    street: "800 Industrial Rd.",
    city: "Marshall",
    state: "MI",
    zip: "49068",
    /** Their own words on the Our Shop page. */
    crossStreet: "the corner of Industrial Road and Linden Street",
    parking: "On-site parking with accessibility space.",
  },

  /**
   * Times are verbatim from their Our Shop page. Their site renders these twice in
   * two different formats (dot leaders and "to" on one page, en dashes on another);
   * we normalize the formatting and keep the times exactly.
   */
  hours: [
    { day: "Monday", open: "9:00 am", close: "4:00 pm" },
    { day: "Tuesday", open: "9:00 am", close: "4:00 pm" },
    { day: "Wednesday", open: "9:00 am", close: "4:00 pm" },
    { day: "Thursday", open: "9:00 am", close: "5:30 pm" },
    { day: "Friday", open: "9:00 am", close: "5:30 pm" },
    { day: "Saturday", open: "9:00 am", close: "2:00 pm" },
    { day: "Sunday", open: null, close: null },
  ] as const,

  social: {
    /** Their footer publishes this as http. Corrected to https here on purpose. */
    facebook: "https://www.facebook.com/devinesflowersandbotanicals",
    instagram: "https://www.instagram.com/devinesflowers/",
    pinterest: "https://pin.it/1b6CqL4QG",
  },

  /** From "Where we deliver:", in their own order. */
  deliveryTowns: [
    "Marshall", "Battle Creek", "Springfield", "Climax", "East Leroy", "Bellevue",
    "Ceresco", "Olivet", "Charlotte", "Albion", "Tekonsha", "Homer", "Burlington",
    "Union City", "Coldwater", "Athens", "Jackson", "Springport",
  ],

  deliveryZips: [
    "48813", "49011", "49014", "49015", "49016", "49017", "49021", "49029",
    "49033", "49034", "49036", "49037", "49051", "49068", "49076", "49092",
    "49094", "49201", "49202", "49203", "49224", "49245", "49252", "49284",
  ],

  /**
   * DELIVERY TERMS: their site publishes NO fee, NO order minimum and NO same-day
   * cutoff. We are not inventing any of the three. Their only timing language is
   * "same-day delivery whenever possible" and the hedge is deliberate, so it is
   * quoted rather than upgraded into a promise.
   */
  delivery: {
    sameDay: "Same-day delivery whenever possible.",
    fee: null as string | null, // PLACEHOLDER: ask the owner
    minimum: null as string | null, // PLACEHOLDER: ask the owner
    cutoff: null as string | null, // PLACEHOLDER: ask the owner
    hospitalNote: "Please include the patient's full name and room information when ordering.",
    funeralNote: "Our team coordinates delivery timing directly with the service location.",
  },

  /**
   * Names are from their team page. It publishes photographs and names and no roles
   * at all, so roles stay null rather than being guessed. "Gayle's Garden" shares a
   * first name with Gayle Scantlen, which is a hint and not a fact.
   */
  team: [
    { name: "Gayle Scantlen", role: null }, // PLACEHOLDER: role
    { name: "Becky Moore", role: null }, // PLACEHOLDER: role
    { name: "Lacey Andrews", role: null }, // PLACEHOLDER: role
    { name: "Shawna Wilcox", role: null }, // PLACEHOLDER: role
  ],

  /** Their wedding process, verbatim, from /wedding-florists/. */
  weddingProcess: [
    "Reach out to schedule a consult. In person, phone, or email, whichever suits you.",
    "Share your vision and inspiration: your ideal budget, pictures that capture your color palette, your dress, the bridal bouquet, ceremony arrangements, reception visuals.",
    "From our discussions we curate a floral design plan. The quote usually takes a week to put together and is sent by email.",
    "If you choose to move forward, you have 30 days to make adjustments, review and sign our wedding contract with a 50% non-refundable deposit.",
    "After the deposit is paid and the contract is signed, your date is saved.",
  ],
  weddingLeadTime: "up to 6 months in advance if possible",
  weddingFollowUp:
    "We'll contact you one month before your day to confirm quantities, arrange the drop off of any vases or special containers, and collect the remaining balance.",

  /**
   * The most current and most common of the three substitution clauses on their
   * products. Their site repeats a variant of this on nearly every floral item;
   * here it is stated once and referenced.
   */
  substitutionPolicy:
    "Substitutions of containers and flowers may occur at the discretion of the florist depending on availability and seasonality. If a substitution does occur it will be items of equal or greater value.",

  /** Neighbouring businesses in the building, from their Our Shop page. */
  neighbors: ["Studio 810 by Sam Lee", "Styled by Syd", "Mane Haven", "Still Haus Spa"],
} as const;

export const DAYS_CLOSED = site.hours.filter((h) => h.open === null).map((h) => h.day);

/** "9:00 am to 4:00 pm", or "Closed". One formatter, used everywhere. */
export function formatHours(h: (typeof site.hours)[number]): string {
  return h.open && h.close ? `${h.open} to ${h.close}` : "Closed";
}

export const addressOneLine = `${site.address.street}, ${site.address.city}, ${site.address.state} ${site.address.zip}`;
