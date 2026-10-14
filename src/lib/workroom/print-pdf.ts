import "server-only";
import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type PDFPageDrawImageOptions,
  type PDFPageDrawLineOptions,
  type PDFPageDrawRectangleOptions,
  type PDFPageDrawTextOptions,
} from "pdf-lib";
import type { WorkroomOrder } from "./store";
import { site } from "@/lib/site";
import { LOGO_PNG_BASE64 } from "./logo-png";
import { isDeliveryLine, isTaxLine, type PrintLayout } from "./derive";

/** Decoded once; pdf-lib still embeds it per document. */
const LOGO_PNG = Buffer.from(LOGO_PNG_BASE64, "base64");

/**
 * THE PRINTED ORDER, AS A PDF (2026-10-12). One layout per paper, drawn in
 * points on the page itself, so what the print helper on the counter PC
 * sends to the Brother and what the Print link opens in a tab are the
 * same bytes. No browser, no dialog, no scaling: what is drawn at 3.667
 * inches lands at 3.667 inches.
 *
 * TWO LAYOUTS, after Kevin's photos of what IRIS printed and on what:
 *
 *   sheet   deliveries. The shop's pre-printed six-panel form (John Henry
 *           stock): letter, landscape, creased 3 across by 2 down, each
 *           panel 3.667 by 4.25 inches. Her logo and address are already on
 *           the top-left and top-middle panels and a small mark sits at the
 *           foot of the top-right one, so those areas stay empty here.
 *           Top-left: the enclosure address card (tears off into the window
 *           envelope). Top-right: the card message. Bottom-left and middle:
 *           the work order with prices. Bottom-right: the driver's stub
 *           with a signature line.
 *
 *   plain   pickups. Plain letter paper, portrait, so the letterhead is
 *           drawn: who is picking up and when, the items and total, paid or
 *           not, the card message boxed, the notes.
 *
 * Any order can be printed either way; the order picks its own by
 * fulfillment and the caller may override.
 */
/** Which paper an order wants is one rule, printLayoutFor in derive.ts,
    shared by the routes and the board's banner; nothing here chooses. */
export type { PrintLayout };

const IN = 72;
/** THE FORM IS LEGAL, 8.5 BY 14 (Kevin, 2026-10-13, after four prints
    that each covered exactly 11/14 of the sheet with the heights right:
    "the paper we're using is longer than the paper the system expects").
    The lower tray was set to Legal on the printer and in Windows because
    that is what is in it. Three panels of 4 2/3 in across, the fold 3.5 in
    down. Every earlier number in inches was read off a 14 in sheet as if
    it were 11, so each is re-derived below at the true scale. */
const SHEET_W = 14 * IN;
const SHEET_H = 8.5 * IN;
const PANEL_W = SHEET_W / 3;
/** THE FOLD IS NOT IN THE MIDDLE (Kevin's photo of an IRIS print beside
    ours, 2026-10-13): the pre-printed shading, and the crease, end 3.5 in
    from the top, so the top row is 3.5 in and the bottom row 5 in. Rows
    drawn as two equal halves left an inch of the big panel blank. */
const TOP_ROW_H = 3.5 * IN;
const ROW_TOP = [8.5 * IN, 8.5 * IN - TOP_ROW_H];
const ROW_BOTTOM = [8.5 * IN - TOP_ROW_H, 0];
/** Breathing room inside each crease. */
const PANEL_INSET = 0.22 * IN;
/** The address card sits where the window envelope shows it, as IRIS
    placed it: about an inch in from the left edge and an inch and a
    half down, under the letterhead. */
const CARD_X = 1.2 * IN;
const CARD_TOP = 8.5 * IN - 1.5 * IN;
/** The card message's band on the top-right panel (Kevin's side-by-side
    print, 2026-10-13): IRIS starts the message high, about 0.8 in from
    the top, and the small pre-printed mark begins about 2.85 in down, so
    the band is 0.8 to 2.75 in, and the message hangs from its top rather
    than floating in the middle. */
const MESSAGE_TOP = 8.5 * IN - 0.8 * IN;
const MESSAGE_BOTTOM = 8.5 * IN - 2.75 * IN;
/** The driver's stub starts a little further in than the other panels,
    as IRIS's does. */
const STUB_INSET = 0.5 * IN;
/** THE SHEET IS A PORTRAIT PAGE WITH THE LAYOUT LYING SIDEWAYS IN IT
    (Kevin's prints, 2026-10-13, and the research after them). Edge, like
    Chrome, mishandles a PDF page that is wider than it is tall: it
    scaled the landscape form onto portrait paper instead of turning it
    (Microsoft Q&A), the Chromium tracker has the wide-page print bug
    open (issue 372435414), and a /Rotate flag on the page is ignored by
    parts of the Windows print path, which is what the one print with it
    showed. So the form is not a wide page at all: it is drawn in its
    landscape coordinates, as before, through a surface that lays every
    line and word sideways into an upright 8.5 by 14 page. Edge sees an
    ordinary portrait Legal page and prints it as is; on the sheet, fed
    short edge first, the layout comes out along the long edge, which is
    where Windows puts a landscape page too. SHEET_TURN is the direction
    of the turn, 90 or 270; if a print lands upside down against the
    letterhead, flip it. */
const SHEET_TURN: 90 | 270 = 90;

const ink = rgb(0, 0, 0);
const grey = rgb(0.25, 0.23, 0.2);

/** The standard fonts speak WinAnsi only: the ″ in product names, curly
    quotes and dashes have to be spelled in characters they know. */
function clean(s: string): string {
  return s
    .replace(/″/g, '"')
    .replace(/′/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/×/g, "x")
    .replace(/·/g, "-")
    .replace(/…/g, "...")
    .replace(/\t/g, " ")
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, "");
}

/** A single token wider than the column (a long email, a pasted URL, a
    run of dashes) is cut at the edge rather than drawn past it. */
function breakToken(font: PDFFont, size: number, w: string, maxW: number): string[] {
  if (font.widthOfTextAtSize(w, size) <= maxW) return [w];
  const parts: string[] = [];
  let cur = "";
  for (const ch of w) {
    if (cur && font.widthOfTextAtSize(cur + ch, size) > maxW) {
      parts.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function wrap(font: PDFFont, size: number, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    const words = para
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((w) => breakToken(font, size, w, maxW));
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= maxW || !line) line = next;
      else {
        out.push(line);
        line = w;
      }
    }
    out.push(line);
  }
  return out;
}

const money = (n: number) => `$${n.toFixed(2)}`;
const longDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const weekdayOf = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
/** The shop's clock. Serverless runs in UTC; a slip stamped 2:14 AM for a
    10:14 PM order would be read as a mistake at the counter. */
const SHOP_TZ = site.timeZone;
const stamp = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: SHOP_TZ, month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** What the layout code draws on: a page, or a page turned sideways. */
type Surface = {
  drawText(text: string, options?: PDFPageDrawTextOptions): void;
  drawLine(options: PDFPageDrawLineOptions): void;
  drawRectangle(options?: PDFPageDrawRectangleOptions): void;
  drawImage(image: PDFImage, options?: PDFPageDrawImageOptions): void;
};

/** A portrait page onto which the landscape layout is laid sideways. The
    layout keeps its own coordinates (x along the 11 in edge, y up the
    8.5 in edge); every point is mapped into the upright page and every
    word turned with it. */
function turned(page: PDFPage, turn: 90 | 270): Surface {
  const W = SHEET_H;
  const H = SHEET_W;
  // 90: the layout's left edge lies along the page's bottom; 270: along its top.
  const map = turn === 90 ? (x: number, y: number) => ({ x: W - y, y: x }) : (x: number, y: number) => ({ x: y, y: H - x });
  const rot = degrees(turn);
  return {
    drawText: (text, o = {}) => page.drawText(text, { ...o, ...map(o.x ?? 0, o.y ?? 0), rotate: rot }),
    drawLine: (o) => page.drawLine({ ...o, start: map(o.start.x, o.start.y), end: map(o.end.x, o.end.y) }),
    drawRectangle: (o = {}) => {
      const x = o.x ?? 0, y = o.y ?? 0, w = o.width ?? 0, h = o.height ?? 0;
      const a = map(x, y), b = map(x + w, y + h);
      page.drawRectangle({ ...o, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
    },
    drawImage: (image, o = {}) => page.drawImage(image, { ...o, ...map(o.x ?? 0, o.y ?? 0), rotate: rot }),
  };
}

type Pen = {
  page: Surface;
  reg: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
};

/**
 * A writing cursor inside a box: top-down text with wrapping, and a FLOOR.
 * Paper has edges and the form has creases; nothing here ever draws below
 * the floor it was given. When something would, the cursor stops, remembers
 * it overflowed, and the layout writes one short line saying the rest is
 * on the board, rather than printing on the next panel or off the page.
 */
class Cursor {
  y: number;
  overflowed = false;
  constructor(
    private pen: Pen,
    public x: number,
    yTop: number,
    public w: number,
    public floor = 0,
  ) {
    this.y = yTop;
  }
  /** Room for one more line of this size? */
  fits(size: number) {
    return this.y - size * 1.25 >= this.floor;
  }
  gap(pt: number) {
    this.y -= pt;
  }
  line(text: string, size = 10, font: PDFFont = this.pen.reg, opts: { color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; x?: number; w?: number } = {}) {
    const x = opts.x ?? this.x;
    const w = opts.w ?? this.w;
    for (const l of wrap(font, size, text, w)) {
      if (!this.fits(size)) {
        this.overflowed = true;
        return;
      }
      this.y -= size * 1.25;
      const tw = font.widthOfTextAtSize(l, size);
      const dx = opts.align === "right" ? w - tw : opts.align === "center" ? (w - tw) / 2 : 0;
      this.pen.page.drawText(l, { x: x + dx, y: this.y, size, font, color: opts.color ?? ink });
    }
  }
  /** Two texts on one line, left and right. */
  row(left: string, right: string, size = 10, font: PDFFont = this.pen.reg) {
    if (!this.fits(size)) {
      this.overflowed = true;
      return;
    }
    this.y -= size * 1.25;
    this.pen.page.drawText(clean(left), { x: this.x, y: this.y, size, font, color: ink });
    const r = clean(right);
    this.pen.page.drawText(r, { x: this.x + this.w - font.widthOfTextAtSize(r, size), y: this.y, size, font, color: ink });
  }
  rule(thick = 0.6) {
    if (this.y - 7 < this.floor) {
      this.overflowed = true;
      return;
    }
    this.y -= 4;
    this.pen.page.drawLine({ start: { x: this.x, y: this.y }, end: { x: this.x + this.w, y: this.y }, thickness: thick, color: ink });
    this.y -= 3;
  }
  /** The one honest line when the box ran out: drawn just BELOW the floor,
      in the gap every box keeps under its text, so it never lands on the
      last line written and is always the last thing readable. */
  more(what = "more on the board") {
    if (!this.overflowed) return;
    this.pen.page.drawText(`... ${what}`, { x: this.x, y: this.floor - 9, size: 8, font: this.pen.reg, color: grey });
  }
  heading(text: string) {
    this.gap(5);
    this.line(text.toUpperCase(), 7.5, this.pen.reg, { color: grey });
  }
}

function whereLines(o: WorkroomOrder): string[] {
  return [o.company ?? "", o.street, [o.town, o.zip].filter(Boolean).join(" ")].filter(Boolean);
}
const items = (o: WorkroomOrder) => o.lines.filter((l) => !isDeliveryLine(l) && !isTaxLine(l));
const deliveryLine = (o: WorkroomOrder) => o.lines.find(isDeliveryLine);
const taxLine = (o: WorkroomOrder) => o.lines.find(isTaxLine);
const paidWord = (o: WorkroomOrder, atPickup: boolean) =>
  o.payment
    ? `PAID - ${o.payment.method === "other" ? "by hand" : o.payment.method} - ${money(o.payment.totalCents / 100)}${
        // A website card payment carries the 99 cent ordering fee, which
        // is not a line of the order; said here so PAID and TOTAL agree.
        o.payment.feeCents > 0 ? ` (incl. ${money(o.payment.feeCents / 100)} online fee)` : ""
      }`
    : o.status === "canceled"
      ? "CANCELED"
      : o.account
        ? "ON ACCOUNT - billed, not paid"
        : atPickup
          ? "NOT PAID - collect at pickup"
          : "NOT PAID";

function itemsTable(c: Cursor, pen: Pen, o: WorkroomOrder, size: number) {
  const cols = [0, c.w * 0.58, c.w * 0.68, c.w * 0.83];
  const head = (t: string, i: number) => pen.page.drawText(t, { x: c.x + cols[i], y: c.y, size: size - 2, font: pen.reg, color: grey });
  if (!c.fits(size)) {
    c.overflowed = true;
    return;
  }
  c.y -= size * 1.25;
  head("DESCRIPTION", 0);
  head("QTY", 1);
  head("EACH", 2);
  head("TOTAL", 3);
  c.rule(0.6);
  const cell = (t: string, i: number, right: boolean, font: PDFFont = pen.reg) => {
    const s = clean(t);
    const w = i === 3 ? c.w - cols[3] : cols[i + 1] - cols[i] - 4;
    const x = right ? c.x + cols[i] + w - font.widthOfTextAtSize(s, size) : c.x + cols[i];
    pen.page.drawText(s, { x, y: c.y, size, font, color: ink });
  };
  const rows = items(o).map((l) => ({ name: l.name, sub: l.parts?.length ? l.parts.map((p) => `${p.stems} ${p.variety}`).join(", ") : "", qty: l.qty, each: l.each }));
  const dl = deliveryLine(o);
  const tl = taxLine(o);
  if (dl) rows.push({ name: dl.name, sub: "", qty: dl.qty, each: dl.each });
  if (tl) rows.push({ name: tl.name, sub: "", qty: tl.qty, each: tl.each });
  // The TOTAL row is kept back, so a long order loses item rows, never
  // the total; the "more" line says what was cut.
  const reserve = size * 1.25 * 2 + 7;
  for (const r of rows) {
    const nameLines = wrap(pen.reg, size, r.name, cols[1] - 6);
    if (c.y - size * 1.25 - reserve < c.floor) {
      c.overflowed = true;
      break;
    }
    c.y -= size * 1.25;
    cell(nameLines[0], 0, false);
    cell(String(r.qty), 1, true);
    cell(money(r.each), 2, true);
    cell(money(r.each * r.qty), 3, true);
    for (const extra of nameLines.slice(1)) {
      if (c.y - size * 1.25 - reserve < c.floor) break;
      c.y -= size * 1.25;
      cell(extra, 0, false);
    }
    if (r.sub && c.y - (size - 1.5) * 1.2 - reserve >= c.floor) {
      c.y -= (size - 1.5) * 1.2;
      pen.page.drawText(clean(r.sub), { x: c.x + 8, y: c.y, size: size - 1.5, font: pen.reg, color: grey });
    }
  }
  if (o.taxExempt && c.fits(size)) {
    c.y -= size * 1.25;
    pen.page.drawText("TAX EXEMPT - no sales tax", { x: c.x, y: c.y, size: size - 1, font: pen.bold, color: grey });
  }
  c.rule(0.6);
  c.row("TOTAL", money(o.subtotal), size, pen.bold);
}

async function pens(doc: PDFDocument): Promise<Omit<Pen, "page">> {
  const [reg, bold, serif] = await Promise.all([doc.embedFont(StandardFonts.Helvetica), doc.embedFont(StandardFonts.HelveticaBold), doc.embedFont(StandardFonts.TimesRoman)]);
  return { reg, bold, serif };
}

/* ------------------------------ the sheet ------------------------------ */

function drawSheet(doc: PDFDocument, fonts: Omit<Pen, "page">, o: WorkroomOrder, printedAt: number) {
  const page = turned(doc.addPage([SHEET_H, SHEET_W]), SHEET_TURN);
  const pen: Pen = { page, ...fonts };
  const box = (col: number, row: number, cols = 1, inset = PANEL_INSET) => ({
    x: col * PANEL_W + inset,
    top: ROW_TOP[row] - PANEL_INSET,
    w: PANEL_W * cols - inset - PANEL_INSET,
    bottom: ROW_BOTTOM[row] + PANEL_INSET,
  });
  const day = longDate(o.date);
  const weekday = weekdayOf(o.date);
  const where = whereLines(o);
  const deliver = o.fulfillment === "delivery";

  // top-left: the enclosure address card, under the pre-printed letterhead
  {
    const b = box(0, 0);
    const c = new Cursor(pen, CARD_X, CARD_TOP, PANEL_W - CARD_X - PANEL_INSET, b.bottom);
    c.line(o.recipient || o.name, 12, pen.bold);
    for (const w of where) c.line(w, 10.5, pen.bold);
    if (!deliver && o.company) c.line(o.company, 10.5, pen.bold);
    if (!deliver) c.line("Pickup at the shop", 10.5, pen.bold);
    if (o.phone) c.line(o.phone, 10, pen.reg);
    c.gap(6);
    c.line(`[ Order ${o.number} ]`, 10);
    c.line(`${deliver ? "Delivery" : "Pickup"}: ${day}`, 12.5, pen.bold);
    c.line(weekday.toUpperCase(), 11, pen.bold);
    // A long address can push the date under the floor; say so rather
    // than hand the driver a card with no date on it.
    c.more();
  }

  // top-right: the card message, centered, above the small pre-printed mark
  {
    const b = box(2, 0);
    // A long message shrinks to fit, down to 8pt; past that it is cut with
    // a mark, because a card that spills onto the logo is worse than one
    // that says "see the board".
    const areaTop = MESSAGE_TOP;
    const areaBottom = MESSAGE_BOTTOM;
    const areaH = areaTop - areaBottom;
    let size = 13;
    let lines = wrap(pen.serif, size, o.cardMessage || "", b.w - 10);
    while (lines.length * size * 1.4 > areaH && size > 8) {
      size -= 1;
      lines = wrap(pen.serif, size, o.cardMessage || "", b.w - 10);
    }
    const maxLines = Math.max(1, Math.floor(areaH / (size * 1.4)));
    if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), "(... the rest is on the board)"];
    // Hung from the top of the band, like IRIS, not centered in it.
    let y = areaTop;
    for (const l of lines) {
      y -= size * 1.4;
      const tw = pen.serif.widthOfTextAtSize(l, size);
      page.drawText(l, { x: b.x + (b.w - tw) / 2, y, size, font: pen.serif, color: ink });
    }
  }

  // bottom-left + middle: the work order
  {
    const b = box(0, 1, 2);
    const c = new Cursor(pen, b.x, b.top, b.w, b.bottom + 10);
    c.row(`Order ${o.number} - ${site.shortName}`, `${deliver ? "Delivery" : "Pickup"}: ${day} | ${weekday}`, 10, pen.bold);
    c.row(`Taken: ${stamp(o.createdAt)}${o.takenBy ? ` by ${o.takenBy}` : ""}    Occ: ${o.occasion || "none"}`, `Printed: ${stamp(printedAt)}`, 8, pen.reg);
    c.gap(4);
    // two columns: customer, recipient
    const colW = (b.w - 12) / 2;
    const left = new Cursor(pen, b.x, c.y, colW, c.floor);
    left.heading("Customer");
    left.line(o.name, 10.5, pen.bold);
    if (!deliver) for (const w of where) left.line(w, 9.5);
    if (o.phone) left.line(`Phone: ${o.phone}`, 9.5);
    if (o.email) left.line(`Email: ${o.email}`, 9.5);
    left.line(o.source === "web" ? "Website order" : "Phone order", 9.5, pen.reg, { color: grey });
    const right = new Cursor(pen, b.x + colW + 12, c.y, colW, c.floor);
    right.heading("Recipient");
    right.line(o.recipient || o.name, 10.5, pen.bold);
    if (deliver) for (const w of where) right.line(w, 9.5);
    else {
      if (o.company) right.line(o.company, 9.5);
      right.line("Pickup at the shop", 9.5);
    }
    if (deliver && o.zip && !(site.deliveryZips as readonly string[]).includes(o.zip)) right.line("Off the delivery list: confirm", 9.5, pen.bold);
    c.y = Math.min(left.y, right.y) - 4;
    itemsTable(c, pen, o, 9.5);
    c.gap(2);
    c.row(`Method of payment: ${paidWord(o, !deliver)}`, o.madeBy ? `Made by: ${o.madeBy}` : "", 9.5, pen.bold);
    if (o.notes) {
      c.heading("Order notes");
      c.line(o.notes, 9.5);
    }
    c.more();
  }

  // bottom-right: the driver's stub; its floor sits above the signature line
  {
    const b = box(2, 1, 1, STUB_INSET);
    const sy = b.bottom + 14;
    const c = new Cursor(pen, b.x, b.top, b.w, sy + 16);
    c.line(`Order ${o.number} - ${site.shortName}`, 9.5, pen.bold);
    c.line(`${deliver ? "DELIVERY" : "PICKUP"}: ${day} | ${weekday}`, 11, pen.bold);
    c.gap(6);
    c.line(o.recipient || o.name, 10.5, pen.bold);
    if (deliver) for (const w of where) c.line(w, 9.5);
    else {
      if (o.company) c.line(o.company, 9.5);
      c.line("Pickup at the shop", 9.5);
    }
    c.gap(6);
    c.line(`Sold to: ${o.name}`, 9.5);
    if (o.phone) c.line(`Phone: ${o.phone}`, 9.5);
    c.gap(6);
    for (const l of items(o)) c.line(`${l.name} x ${l.qty}`, 9.5);
    c.gap(6);
    c.line(`Instructions: ${o.notes || ""}`, 9.5);
    c.more();
    // signature line pinned to the panel's foot
    page.drawLine({ start: { x: b.x, y: sy }, end: { x: b.x + b.w * 0.75, y: sy }, thickness: 0.6, color: ink });
    page.drawText("Signature", { x: b.x, y: sy - 10, size: 8, font: pen.reg, color: grey });
    page.drawText(o.number, { x: b.x + b.w * 0.75 - pen.reg.widthOfTextAtSize(o.number, 8), y: sy - 10, size: 8, font: pen.reg, color: grey });
  }
}

/* ------------------------------ plain paper ------------------------------ */

function drawPlain(doc: PDFDocument, fonts: Omit<Pen, "page">, logo: PDFImage, o: WorkroomOrder, printedAt: number) {
  const page = doc.addPage([8.5 * IN, 11 * IN]);
  const pen: Pen = { page, ...fonts };
  const M = 0.5 * IN;
  const W = 8.5 * IN - M * 2;
  const logoW = 2.2 * IN;
  const logoH = (logo.height / logo.width) * logoW;
  page.drawImage(logo, { x: M, y: 11 * IN - M - logoH, width: logoW, height: logoH });
  {
    const c = new Cursor(pen, M, 11 * IN - M - 2, W);
    c.line(site.address.street, 10, pen.reg, { align: "right" });
    c.line(`${site.address.city}, ${site.address.state} ${site.address.zip}`, 10, pen.reg, { align: "right" });
    c.line(site.phone, 10, pen.reg, { align: "right" });
  }
  /* THE TEAR-OFF STUB (Kevin's photo of the IRIS ticket, 2026-10-13):
     the bottom of the page repeats the order, the day, the customer and
     the recipient, says what to collect, and has a line the customer
     signs when they take it. The body's floor sits above it. */
  const STUB_H = 1.9 * IN;
  const stubTop = M + 26 + STUB_H;
  // The floor keeps room for the "more" line, the stub and the footer stamp.
  const c = new Cursor(pen, M, 11 * IN - M - logoH - 10, W, stubTop);
  c.rule(1.5);
  c.gap(6);
  const pickup = o.fulfillment === "pickup";
  const where = whereLines(o);
  const balance = o.payment ? 0 : o.status === "canceled" ? 0 : o.subtotal;
  c.row(pickup ? "PICKUP" : "DELIVERY", `Order ${o.number}`, 20, pen.bold);
  // What the counter reads first (IRIS put it top right too).
  c.row(`${longDate(o.date)}, ${weekdayOf(o.date)}`, `Balance due: ${money(balance)}`, 13, pen.bold);
  c.line(o.source === "web" ? "Website order" : "Phone order", 10.5, pen.reg, { align: "right" });
  if (o.occasion && o.occasion !== "Everyday") c.line(o.occasion, 10.5);
  if (o.status === "hold") c.line("ON HOLD", 16, pen.bold);
  c.gap(6);
  const colW = (W - 24) / 2;
  const left = new Cursor(pen, M, c.y, colW, c.floor);
  left.heading(pickup ? "Picking up" : "Ordered by");
  left.line(o.name, 12, pen.bold);
  if (o.phone) left.line(o.phone, 10.5);
  if (o.email) left.line(o.email, 10.5);
  const right = new Cursor(pen, M + colW + 24, c.y, colW, c.floor);
  right.heading(pickup ? "Their address, for the file" : "Deliver to");
  if (!pickup) right.line(o.recipient || o.name, 11, pen.bold);
  if (where.length) for (const w of where) right.line(w, 10.5);
  else right.line(pickup ? "none given" : "No address yet", 10.5, pen.reg, { color: grey });
  c.y = Math.min(left.y, right.y);
  c.heading("Items");
  itemsTable(c, pen, o, 10.5);
  c.gap(4);
  c.line(paidWord(o, pickup), 12, pen.bold);
  c.heading("Card message");
  {
    const size = 14;
    let lines = wrap(pen.serif, size, o.cardMessage || "(none)", W - 24);
    // The box takes what fits above the floor, leaving room for the stamp.
    const room = c.y - c.floor - 20 - 30;
    const maxLines = Math.floor(room / (size * 1.4));
    if (maxLines < 1) {
      // A long item list ate the page; the box would sit below the floor.
      // The "more" line says the rest is on the board; a reprint on the
      // form has the room.
      c.overflowed = true;
    } else {
      if (lines.length > maxLines) {
        lines = [...lines.slice(0, Math.max(0, maxLines - 1)), "(... the rest is on the board)"];
        c.overflowed = true;
      }
      const h = lines.length * size * 1.4 + 20;
      page.drawRectangle({ x: M, y: c.y - h, width: W, height: h, borderColor: ink, borderWidth: 0.8 });
      let y = c.y - 10;
      for (const l of lines) {
        y -= size * 1.4;
        page.drawText(l, { x: M + 12, y, size, font: pen.serif, color: ink });
      }
      c.y -= h;
    }
  }
  // Instructions are the customer's words; order notes are the shop's,
  // a labelled space to write in (IRIS had both).
  c.heading("Instructions");
  c.line(o.notes || "(none)", 10.5, pen.reg, o.notes ? {} : { color: grey });
  c.heading("Order notes");
  c.gap(14);
  c.more();

  // The stub, below a cut line, in its own cursor so the body can never
  // run into it.
  {
    const top = stubTop;
    const y = top + 6;
    for (let x = M; x < M + W; x += 9) {
      page.drawLine({ start: { x, y }, end: { x: Math.min(x + 4.5, M + W), y }, thickness: 0.6, color: grey });
    }
    const s = new Cursor(pen, M, top - 6, W, M + 26);
    s.row(`Order ${o.number}`, pickup ? "PICKUP" : "DELIVERY", 13, pen.bold);
    s.row(`${longDate(o.date)}, ${weekdayOf(o.date)}`, balance > 0 ? `Please collect ${money(balance)}` : o.payment ? "Paid in full" : "", 11, pen.bold);
    s.gap(4);
    const sl = new Cursor(pen, M, s.y, colW, M + 26);
    sl.heading("Customer");
    sl.line(o.name, 10.5, pen.bold);
    if (o.phone) sl.line(o.phone, 10);
    const sr = new Cursor(pen, M + colW + 24, s.y, colW, M + 26);
    sr.heading("Recipient");
    sr.line(o.recipient || o.name, 10.5, pen.bold);
    if (where.length) sr.line(where[0], 10);
    s.y = Math.min(sl.y, sr.y);
    s.gap(16);
    if (s.y - 14 > M + 26) {
      page.drawLine({ start: { x: M, y: s.y }, end: { x: M + 3.4 * IN, y: s.y }, thickness: 0.8, color: ink });
      page.drawText("Received by", { x: M, y: s.y - 10, size: 8, font: pen.reg, color: grey });
    }
  }
  // The footer stamp, at the page margin, always.
  c.y = M + 8.5 * 1.25;
  c.floor = 0;
  c.row(`Taken ${stamp(o.createdAt)}${o.takenBy ? ` by ${o.takenBy}` : ""}${o.madeBy ? `    Made by ${o.madeBy}` : ""}`, `Printed ${stamp(printedAt)}`, 8.5, pen.reg);
}

export async function renderOrderPdf(o: WorkroomOrder, layout: PrintLayout, printedAt = Date.now()): Promise<Uint8Array> {
  return renderBatchPdf([{ order: o, layout }], printedAt);
}

/**
 * Several orders as one document, a page each, all on the same paper: the
 * morning's "print the 3 delivery forms" is one PDF and one trip through
 * the print dialog, not three.
 */
export async function renderBatchPdf(batch: { order: WorkroomOrder; layout: PrintLayout }[], printedAt = Date.now()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(
    batch.length === 1
      ? `${batch[0].order.number} ${batch[0].layout === "sheet" ? "order form" : "ticket"}`
      : `${batch.length} ${batch[0]?.layout === "sheet" ? "order forms" : "tickets"}`,
  );
  doc.setProducer("DeVine's workroom");
  const fonts = await pens(doc);
  // One copy of the logo per document, however many plain pages share it.
  const logo = batch.some((b) => b.layout === "plain") ? await doc.embedPng(LOGO_PNG) : null;
  for (const { order, layout } of batch) {
    if (layout === "sheet" || !logo) drawSheet(doc, fonts, order, printedAt);
    else drawPlain(doc, fonts, logo, order, printedAt);
  }
  return doc.save();
}
