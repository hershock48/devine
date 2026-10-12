import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { WorkroomOrder } from "./store";
import { site } from "@/lib/site";
import { LOGO_PNG_BASE64 } from "./logo-png";

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
export type PrintLayout = "sheet" | "plain";

/**
 * Which paper an order wants (Kevin's notes from the shop, 2026-10-12):
 * deliveries get the six-panel form; pickups get plain paper, unless the
 * pickup carries a card message, because then it needs the enclosure card
 * panel only the form has.
 */
export const layoutFor = (o: WorkroomOrder): PrintLayout => (o.fulfillment === "pickup" && !o.cardMessage.trim() ? "plain" : "sheet");

const IN = 72;
const PANEL_W = (11 * IN) / 3;
const PANEL_H = 4.25 * IN;
/** Breathing room inside each crease. */
const PANEL_INSET = 0.22 * IN;
/** How far down the pre-printed letterhead reaches on the top-left panel. */
const LETTERHEAD_H = 1.25 * IN;

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
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, "");
}

function wrap(font: PDFFont, size: number, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of clean(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
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
const SHOP_TZ = "America/Detroit";
const stamp = (ms: number) => new Date(ms).toLocaleString("en-US", { timeZone: SHOP_TZ, month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

type Pen = {
  page: PDFPage;
  reg: PDFFont;
  bold: PDFFont;
  serif: PDFFont;
};

/** A writing cursor inside a box: top-down text with wrapping. */
class Cursor {
  y: number;
  constructor(
    private pen: Pen,
    public x: number,
    yTop: number,
    public w: number,
  ) {
    this.y = yTop;
  }
  gap(pt: number) {
    this.y -= pt;
  }
  line(text: string, size = 10, font: PDFFont = this.pen.reg, opts: { color?: ReturnType<typeof rgb>; align?: "left" | "right" | "center"; x?: number; w?: number } = {}) {
    const x = opts.x ?? this.x;
    const w = opts.w ?? this.w;
    for (const l of wrap(font, size, text, w)) {
      this.y -= size * 1.25;
      const tw = font.widthOfTextAtSize(l, size);
      const dx = opts.align === "right" ? w - tw : opts.align === "center" ? (w - tw) / 2 : 0;
      this.pen.page.drawText(l, { x: x + dx, y: this.y, size, font, color: opts.color ?? ink });
    }
  }
  /** Two texts on one line, left and right. */
  row(left: string, right: string, size = 10, font: PDFFont = this.pen.reg) {
    this.y -= size * 1.25;
    this.pen.page.drawText(clean(left), { x: this.x, y: this.y, size, font, color: ink });
    const r = clean(right);
    this.pen.page.drawText(r, { x: this.x + this.w - font.widthOfTextAtSize(r, size), y: this.y, size, font, color: ink });
  }
  rule(thick = 0.6) {
    this.y -= 4;
    this.pen.page.drawLine({ start: { x: this.x, y: this.y }, end: { x: this.x + this.w, y: this.y }, thickness: thick, color: ink });
    this.y -= 3;
  }
  heading(text: string) {
    this.gap(5);
    this.line(text.toUpperCase(), 7.5, this.pen.reg, { color: grey });
  }
}

function whereLines(o: WorkroomOrder): string[] {
  return [o.street, [o.town, o.zip].filter(Boolean).join(" ")].filter(Boolean);
}
const items = (o: WorkroomOrder) => o.lines.filter((l) => !l.name.startsWith("Delivery (") && !l.name.startsWith("Sales tax"));
const deliveryLine = (o: WorkroomOrder) => o.lines.find((l) => l.name.startsWith("Delivery ("));
const taxLine = (o: WorkroomOrder) => o.lines.find((l) => l.name.startsWith("Sales tax"));
const paidWord = (o: WorkroomOrder, atPickup: boolean) =>
  o.payment
    ? `PAID - ${o.payment.method === "other" ? "by hand" : o.payment.method} - ${money(o.payment.totalCents / 100)}`
    : o.status === "canceled"
      ? "CANCELED"
      : atPickup
        ? "NOT PAID - collect at pickup"
        : "NOT PAID";

function itemsTable(c: Cursor, pen: Pen, o: WorkroomOrder, size: number) {
  const cols = [0, c.w * 0.58, c.w * 0.68, c.w * 0.83];
  const head = (t: string, i: number, right = false) =>
    pen.page.drawText(t, { x: c.x + cols[i] + (right ? 0 : 0), y: c.y, size: size - 2, font: pen.reg, color: grey });
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
  if (dl) rows.push({ name: dl.name, sub: "", qty: 1, each: dl.each });
  if (tl) rows.push({ name: tl.name, sub: "", qty: 1, each: tl.each });
  for (const r of rows) {
    const nameLines = wrap(pen.reg, size, r.name, cols[1] - 6);
    c.y -= size * 1.25;
    cell(nameLines[0], 0, false);
    cell(String(r.qty), 1, true);
    cell(money(r.each), 2, true);
    cell(money(r.each * r.qty), 3, true);
    for (const extra of nameLines.slice(1)) {
      c.y -= size * 1.25;
      cell(extra, 0, false);
    }
    if (r.sub) {
      c.y -= (size - 1.5) * 1.2;
      pen.page.drawText(clean(r.sub), { x: c.x + 8, y: c.y, size: size - 1.5, font: pen.reg, color: grey });
    }
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
  const page = doc.addPage([11 * IN, 8.5 * IN]);
  const pen: Pen = { page, ...fonts };
  const box = (col: number, row: number, cols = 1) => ({
    x: col * PANEL_W + PANEL_INSET,
    top: 8.5 * IN - row * PANEL_H - PANEL_INSET,
    w: PANEL_W * cols - PANEL_INSET * 2,
    bottom: 8.5 * IN - (row + 1) * PANEL_H + PANEL_INSET,
  });
  const day = longDate(o.date);
  const weekday = weekdayOf(o.date);
  const where = whereLines(o);
  const deliver = o.fulfillment === "delivery";

  // top-left: the enclosure address card, under the pre-printed letterhead
  {
    const b = box(0, 0);
    const c = new Cursor(pen, b.x, b.top - LETTERHEAD_H, b.w);
    c.line(o.recipient || o.name, 12, pen.bold);
    for (const w of where) c.line(w, 10.5, pen.bold);
    if (!deliver) c.line("Pickup at the shop", 10.5, pen.bold);
    if (o.phone) c.line(o.phone, 10, pen.reg);
    c.gap(6);
    c.line(`[ Order ${o.number} ]`, 10);
    c.line(`${deliver ? "Delivery" : "Pickup"}: ${day}`, 12.5, pen.bold);
    c.line(weekday.toUpperCase(), 11, pen.bold);
  }

  // top-right: the card message, centered, above the small pre-printed mark
  {
    const b = box(2, 0);
    const size = 13;
    const lines = wrap(pen.serif, size, o.cardMessage || "", b.w - 10);
    const blockH = lines.length * size * 1.4;
    const areaTop = b.top - 10;
    const areaBottom = b.bottom + 0.9 * IN;
    let y = areaTop - (areaTop - areaBottom - blockH) / 2;
    for (const l of lines) {
      y -= size * 1.4;
      const tw = pen.serif.widthOfTextAtSize(l, size);
      page.drawText(l, { x: b.x + (b.w - tw) / 2, y, size, font: pen.serif, color: ink });
    }
  }

  // bottom-left + middle: the work order
  {
    const b = box(0, 1, 2);
    const c = new Cursor(pen, b.x, b.top, b.w);
    c.row(`Order ${o.number} - ${site.shortName}`, `${deliver ? "Delivery" : "Pickup"}: ${day} | ${weekday}`, 10, pen.bold);
    c.row(`Taken: ${stamp(o.createdAt)}    Occ: ${o.occasion || "none"}`, `Printed: ${stamp(printedAt)}`, 8, pen.reg);
    c.gap(4);
    // two columns: customer, recipient
    const colW = (b.w - 12) / 2;
    const left = new Cursor(pen, b.x, c.y, colW);
    left.heading("Customer");
    left.line(o.name, 10.5, pen.bold);
    if (!deliver) for (const w of where) left.line(w, 9.5);
    if (o.phone) left.line(`Phone: ${o.phone}`, 9.5);
    if (o.email) left.line(`Email: ${o.email}`, 9.5);
    left.line(o.source === "web" ? "Website order" : "Phone order", 9.5, pen.reg, { color: grey });
    const right = new Cursor(pen, b.x + colW + 12, c.y, colW);
    right.heading("Recipient");
    right.line(o.recipient || o.name, 10.5, pen.bold);
    if (deliver) for (const w of where) right.line(w, 9.5);
    else right.line("Pickup at the shop", 9.5);
    if (deliver && o.zip && !(site.deliveryZips as readonly string[]).includes(o.zip)) right.line("Off the delivery list: confirm", 9.5, pen.bold);
    c.y = Math.min(left.y, right.y) - 4;
    itemsTable(c, pen, o, 9.5);
    c.gap(2);
    c.row(`Method of payment: ${paidWord(o, !deliver)}`, o.madeBy ? `Made by: ${o.madeBy}` : "", 9.5, pen.bold);
    if (o.notes) {
      c.heading("Order notes");
      c.line(o.notes, 9.5);
    }
  }

  // bottom-right: the driver's stub
  {
    const b = box(2, 1);
    const c = new Cursor(pen, b.x, b.top, b.w);
    c.line(`Order ${o.number} - ${site.shortName}`, 9.5, pen.bold);
    c.line(`${deliver ? "DELIVERY" : "PICKUP"}: ${day} | ${weekday}`, 11, pen.bold);
    c.gap(6);
    c.line(o.recipient || o.name, 10.5, pen.bold);
    if (deliver) for (const w of where) c.line(w, 9.5);
    else c.line("Pickup at the shop", 9.5);
    c.gap(6);
    c.line(`Sold to: ${o.name}`, 9.5);
    if (o.phone) c.line(`Phone: ${o.phone}`, 9.5);
    c.gap(6);
    for (const l of items(o)) c.line(`${l.name} x ${l.qty}`, 9.5);
    c.gap(6);
    c.line(`Instructions: ${o.notes || ""}`, 9.5);
    // signature line pinned to the panel's foot
    const sy = b.bottom + 14;
    page.drawLine({ start: { x: b.x, y: sy }, end: { x: b.x + b.w * 0.75, y: sy }, thickness: 0.6, color: ink });
    page.drawText("Signature", { x: b.x, y: sy - 10, size: 8, font: pen.reg, color: grey });
    page.drawText(o.number, { x: b.x + b.w * 0.75 - pen.reg.widthOfTextAtSize(o.number, 8) + 0, y: sy - 10, size: 8, font: pen.reg, color: grey });
  }
}

/* ------------------------------ plain paper ------------------------------ */

async function drawPlain(doc: PDFDocument, fonts: Omit<Pen, "page">, o: WorkroomOrder, printedAt: number) {
  const page = doc.addPage([8.5 * IN, 11 * IN]);
  const pen: Pen = { page, ...fonts };
  const M = 0.5 * IN;
  const W = 8.5 * IN - M * 2;
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
  const logoW = 2.2 * IN;
  const logoH = (logo.height / logo.width) * logoW;
  page.drawImage(logo, { x: M, y: 11 * IN - M - logoH, width: logoW, height: logoH });
  {
    const c = new Cursor(pen, M, 11 * IN - M - 2, W);
    c.line(site.address.street, 10, pen.reg, { align: "right" });
    c.line(`${site.address.city}, ${site.address.state} ${site.address.zip}`, 10, pen.reg, { align: "right" });
    c.line(site.phone, 10, pen.reg, { align: "right" });
  }
  const c = new Cursor(pen, M, 11 * IN - M - logoH - 10, W);
  c.rule(1.5);
  c.gap(6);
  const pickup = o.fulfillment === "pickup";
  const where = whereLines(o);
  c.row(pickup ? "PICKUP" : "DELIVERY", `Order ${o.number}`, 20, pen.bold);
  c.row(`${longDate(o.date)}, ${weekdayOf(o.date)}`, o.source === "web" ? "Website order" : "Phone order", 13, pen.bold);
  if (o.occasion && o.occasion !== "Everyday") c.line(o.occasion, 10.5);
  if (o.status === "hold") c.line("ON HOLD", 16, pen.bold);
  c.gap(6);
  const colW = (W - 24) / 2;
  const left = new Cursor(pen, M, c.y, colW);
  left.heading(pickup ? "Picking up" : "Ordered by");
  left.line(o.name, 12, pen.bold);
  if (o.phone) left.line(o.phone, 10.5);
  if (o.email) left.line(o.email, 10.5);
  const right = new Cursor(pen, M + colW + 24, c.y, colW);
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
    const lines = wrap(pen.serif, size, o.cardMessage || "(none)", W - 24);
    const h = lines.length * size * 1.4 + 20;
    page.drawRectangle({ x: M, y: c.y - h, width: W, height: h, borderColor: ink, borderWidth: 0.8 });
    let y = c.y - 10;
    for (const l of lines) {
      y -= size * 1.4;
      page.drawText(l, { x: M + 12, y, size, font: pen.serif, color: ink });
    }
    c.y -= h;
  }
  if (o.notes) {
    c.heading("Notes");
    c.line(o.notes, 10.5);
  }
  c.gap(14);
  c.row(`Taken ${stamp(o.createdAt)}${o.madeBy ? `    Made by ${o.madeBy}` : ""}`, `Printed ${stamp(printedAt)}`, 8.5, pen.reg);
}

export async function renderOrderPdf(o: WorkroomOrder, layout: PrintLayout, printedAt = Date.now()): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${o.number} ${layout === "sheet" ? "order form" : "ticket"}`);
  doc.setProducer("DeVine's workroom");
  const fonts = await pens(doc);
  if (layout === "sheet") drawSheet(doc, fonts, o, printedAt);
  else await drawPlain(doc, fonts, o, printedAt);
  return doc.save();
}
