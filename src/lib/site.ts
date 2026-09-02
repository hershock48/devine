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
   * DELIVERY FEES AND MINIMUMS, confirmed by the owner 2026-09-01: her
   * laminated IRIS zip sheet, photographed at the shop and confirmed back
   * through Kevin (provenance and the transcription caveats in
   * research/delivery-fees.md). 49068 is Marshall itself, the cheapest run.
   *
   * THE MINIMUM IS ENFORCED AGAINST THE FLOWERS SUBTOTAL, fee on top. The
   * sheet does not say which way; this is the stricter reading, so her
   * correction can only ever loosen checkout, never surprise-tighten it.
   * The question sits on her list. The same-day CUTOFF remains genuinely
   * unanswered and stays a placeholder.
   */
  deliveryFees: {
    "48813": 32, "49011": 25, "49014": 20, "49015": 20, "49016": 20,
    "49017": 20, "49021": 24, "49029": 24, "49033": 16.95, "49034": 32,
    "49036": 32, "49037": 25, "49051": 25, "49068": 8.95, "49076": 20,
    "49092": 20, "49094": 24, "49201": 32, "49202": 32, "49203": 32,
    "49224": 20, "49245": 24, "49252": 32, "49284": 24,
  } as Record<string, number>,
  marshallZip: "49068",
  /** Flowers subtotal a delivery order starts at (see the note above). */
  deliveryMinimums: { marshall: 45, outside: 55 },

  delivery: {
    sameDay: "Same-day delivery whenever possible.",
    // No fixed cutoff exists, confirmed by Katy 2026-09-02: "It's rare we
    // don't accept an order for same day." null is the answer, not a gap.
    cutoff: null as string | null,
    hospitalNote: "Please include the patient's full name and room information when ordering.",
    funeralNote: "Our team coordinates delivery timing directly with the service location.",
  },

  /**
   * Names are from their team page; roles are from Katy's own printed
   * Team & Responsibilities chart, texted 2026-09-02. Headline role only,
   * per person; the full duty lists (delivery, corporate accounts, wedding
   * consult and so on) live in glaze/clients/devine.md for the bio pass.
   * Katy wants the portraits retaken, bios added, and HERSELF added as a
   * card; that redesign waits for her materials, so only the roles land now.
   */
  team: [
    { name: "Gayle Scantlen", role: "Floral artist, silk & dried expert" },
    { name: "Becky Moore", role: "Certified floral artist & plant expert" },
    { name: "Lacey Andrews", role: "Plant expert & floral artist" },
    { name: "Shawna Wilcox", role: "Grower & floral artist" },
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
