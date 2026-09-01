/**
 * THE DEVINE'S DEAL, IN ONE PLACE.
 *
 * glaze.md: every business fact lives in one constant file so a correction is
 * one edit. These are the numbers from the letter ($2,000 half and half, $150
 * a month) plus the three Exhibit A fields Kevin set on 2026-08-31 (2 hours of
 * edits, $125 an hour beyond scope, timeline agreed in writing later).
 *
 * SURFACES THAT CANNOT READ FROM HERE: the letter at public/pitch/devine/
 * index.html is static HTML and repeats the build fee, monthly fee, and the
 * 99 cent service fee in prose. If a number here changes, the letter changes
 * by hand in the same commit.
 *
 * The general terms are NOT restated here or on the acceptance page. They are
 * the Glazed Web Client Agreement v1.0, published at glazedweb.com/agreement,
 * and the acceptance incorporates them by reference the same way the menu
 * order clickwrap does. One text, one home, no drift.
 */

export const agreement = {
  version: "Glazed Web Client Agreement v1.0",
  termsUrl: "https://glazedweb.com/agreement",
  pdfUrl: "https://glazedweb.com/glazed-web-agreement-v1.pdf",
  exhibit: "Exhibit A: DeVine's Flowers & Botanicals, prepared 2026-08-31",

  client: "DeVine's Flowers & Botanicals",
  clientAddress: "800 Industrial Rd., Marshall, MI 49068",
  domain: "devinesflowersandbotanicals.com",

  buildFee: 2000,
  deposit: 1000,
  monthly: 150,
  editAllowance: "2 hours per month",
  hourlyRate: 125,
  /** Customer-paid, per online card order, shown as its own line at checkout,
      retained by Glazed Web. Dormant until online card payment launches. */
  serviceFeeCents: 99,

  scope: [
    "The website at devinesflowersandbotanicals.com, replacing the current site: home, shop with the full product catalog, product pages, weddings, celebration of life, greening, workshops, about, delivery, and cart.",
    "Online order intake: checkout that takes the order and emails the shop a ticket, with payment taken on the confirming call. No card is charged online in this phase.",
    "The workroom at /workroom, included in the monthly fee: the order board, stem and shrink tracking, the wedding quote builder, the funeral pad, plant par sheet, and the weekly order screen.",
    "The Square register link: the product catalog pushed onto the shop's existing Square register, and completed register sales flowing back into the workroom automatically. Connected with the owner's own one-click authorization; the shop's Square account stays the shop's.",
    "Card payments taken remotely run through the shop's own Square account at Square's published processing rate. That covers phone orders keyed by the shop in the workroom (available now), and online checkout when both parties agree in writing to turn it on. Each such card payment carries a $0.99 service fee paid by the customer, shown as its own line item on the order, retained by Glazed Web as the ordering platform fee. It is never charged to the Client, and sales rung in person on the register never carry it.",
  ],

  timeline:
    "Target launch date and the date Client materials are due will be agreed in writing after acceptance. The build is substantially complete; the schedule waits mostly on Client materials (photography permission, logo file, delivery fee, same-day cutoff).",
} as const;

export const money = (n: number) => `$${n.toLocaleString("en-US")}`;
