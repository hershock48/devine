"use client";

import { useEffect } from "react";
import type { WorkroomOrder } from "@/lib/workroom/store";
import { site } from "@/lib/site";
import { longDate, money } from "@/components/workroom/ui";

/**
 * One order at receipt width: 80mm paper, 72mm printable, the Star TSP100's
 * own numbers. What the maker and the driver need, in the order they need
 * it, and nothing from the back office: no stem prices, no margins. The
 * card message is set large and in the serif because it is the one thing
 * on the slip that gets copied by hand onto a card.
 *
 * ?print=1 prints the moment it loads, then closes itself when it was
 * opened as its own tab; inside the board's hidden frame (&embed=1) it
 * prints and stays, and the board removes the frame. On a normal screen
 * the same page is simply readable, with a Print button.
 */
export type TicketLayout = "sheet" | "plain" | "slip";

export default function Ticket({ order: o, layout }: { order: WorkroomOrder; layout: TicketLayout }) {
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get("print") !== "1") return;
    const embed = u.searchParams.get("embed") === "1";
    const done = () => {
      if (!embed) window.close();
    };
    window.addEventListener("afterprint", done, { once: true });
    // A tick, so fonts and the layout have settled before the dialog (or
    // the silent kiosk print) takes its snapshot.
    const t = setTimeout(() => window.print(), 150);
    return () => clearTimeout(t);
  }, []);

  const deliveryLine = o.lines.find((l) => l.name.startsWith("Delivery ("));
  const items = o.lines.filter((l) => l !== deliveryLine);
  const where = [o.street, [o.town, o.zip].filter(Boolean).join(" ")].filter(Boolean);
  const printed = new Date().toLocaleString("en-US", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });

  if (layout === "sheet") return <OrderSheet o={o} where={where} items={items} deliveryLine={deliveryLine} printed={printed} />;
  if (layout === "plain") return <PlainTicket o={o} where={where} items={items} deliveryLine={deliveryLine} printed={printed} />;

  return (
    <>
      <style>{`
        .tk { width: 72mm; max-width: 100%; font-family: var(--sans); font-size: 11.5pt; line-height: 1.3; color: #000; }
        .tk-rule { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
        .tk-big { font-size: 17pt; font-weight: 800; letter-spacing: .02em; }
        .tk-msg { font-family: var(--serif); font-size: 15pt; line-height: 1.25; margin: 1mm 0; }
        .tk-row { display: flex; justify-content: space-between; gap: 3mm; }
        .tk-sub { font-size: 10pt; color: #000; }
        .tk-screen { margin: 0 0 14px; display: flex; gap: 14px; align-items: center; }
        @media print {
          @page { size: 80mm auto; margin: 3mm 4mm; }
          body { background: #fff !important; }
          .tk-screen { display: none; }
          .tk { width: auto; }
        }
      `}</style>
      <p className="tk-screen">
        <button className="btn btn--solid" type="button" onClick={() => window.print()}>
          Print this ticket
        </button>
        <a href="/workroom" style={{ fontSize: 14 }}>Back to the board</a>
        <a href={`/workroom/ticket/${o.id}?layout=sheet`} style={{ fontSize: 14 }}>The order form instead</a>
      </p>
      <div className="tk">
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--serif)", fontSize: "14pt" }}>{site.name}</div>
          <div className="tk-sub">{site.phone}</div>
        </div>
        <hr className="tk-rule" />
        <div className="tk-row">
          <strong>{o.number}</strong>
          <span className="tk-sub">{o.source === "web" ? "website order" : "phone order"}</span>
        </div>
        <div className="tk-big">{o.fulfillment === "delivery" ? "DELIVER" : "PICKUP"}</div>
        <div style={{ fontWeight: 700 }}>{longDate(o.date)}</div>
        {o.occasion && o.occasion !== "Everyday" && <div>{o.occasion}</div>}
        {o.status === "hold" && <div className="tk-big">ON HOLD</div>}
        <hr className="tk-rule" />
        {o.fulfillment === "delivery" ? (
          <div>
            <div className="tk-sub">To</div>
            <div style={{ fontWeight: 700, fontSize: "13pt" }}>{o.recipient || o.name}</div>
            {where.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
            {where.length === 0 && <div>No address yet</div>}
            {o.zip && !(site.deliveryZips as readonly string[]).includes(o.zip) && <div style={{ fontWeight: 700 }}>Off the delivery list: confirm</div>}
          </div>
        ) : (
          <div>
            <div className="tk-sub">Pickup by</div>
            <div style={{ fontWeight: 700, fontSize: "13pt" }}>{o.name}</div>
          </div>
        )}
        <hr className="tk-rule" />
        {items.map((l, i) => (
          <div key={i}>
            <div className="tk-row">
              <span>
                {l.qty} × {l.name}
              </span>
              <span>{money(l.each * l.qty)}</span>
            </div>
            {l.parts && l.parts.length > 0 && (
              <div className="tk-sub" style={{ paddingLeft: "4mm" }}>
                {l.parts.map((pt) => `${pt.stems} ${pt.variety}`).join(", ")}
              </div>
            )}
          </div>
        ))}
        {deliveryLine && (
          <div className="tk-row">
            <span>{deliveryLine.name}</span>
            <span>{money(deliveryLine.each)}</span>
          </div>
        )}
        <div className="tk-row" style={{ fontWeight: 700, marginTop: "1mm" }}>
          <span>Subtotal</span>
          <span>{money(o.subtotal)}</span>
        </div>
        <div className="tk-big" style={{ fontSize: "13pt" }}>
          {o.payment
            ? `PAID · ${o.payment.method === "other" ? "by hand" : o.payment.method} · ${money(o.payment.totalCents / 100)}`
            : o.status === "canceled"
              ? "CANCELED"
              : "NOT PAID · collect on confirm"}
        </div>
        <hr className="tk-rule" />
        <div className="tk-sub">Card message</div>
        <div className="tk-msg">{o.cardMessage ? `“${o.cardMessage}”` : "(none)"}</div>
        {o.notes && (
          <>
            <div className="tk-sub" style={{ marginTop: "1mm" }}>Notes</div>
            <div>{o.notes}</div>
          </>
        )}
        <hr className="tk-rule" />
        <div className="tk-sub">Ordered by</div>
        <div>
          {o.name}
          {o.phone ? ` · ${o.phone}` : ""}
        </div>
        {o.email && <div className="tk-sub">{o.email}</div>}
        {o.madeBy && <div>Made by {o.madeBy}</div>}
        <div className="tk-sub" style={{ marginTop: "2mm" }}>
          Printed {printed}
        </div>
        <div style={{ height: "6mm" }} />
      </div>
    </>
  );
}


/**
 * THE ORDER SHEET, the shop's own form (Kevin's photos, 2026-10-12). One
 * letter page, landscape, on the pre-printed John Henry stock (reorder
 * 1-866-448-8300) that is creased into six panels, 3 across by 2 down, each
 * 3.667 by 4.25 inches. Her logo and address are PRE-PRINTED on the top-left
 * and top-middle panels and a small mark sits at the foot of the top-right
 * one, so those areas are left empty here. What IRIS put in each panel,
 * and what this prints:
 *
 *   top-left      the enclosure address card: recipient, address, phone,
 *                 order number, delivery day. Tears off into the window
 *                 envelope.
 *   top-middle    nothing but the pre-printed header (IRIS left it so).
 *   top-right     the card message, centered, above the small mark.
 *   bottom-left   the work order: order, store, delivery day, customer,
 *   + middle      recipient, items with prices, delivery, tax, total,
 *                 payment, who took it and when.
 *   bottom-right  the driver's stub: delivery day, recipient and phone,
 *                 sold to, the pieces, instructions, a signature line.
 *
 * The Brother HL-L5200DW prints it, landscape, no scaling: the panel grid
 * below is in inches and must land on the creases. If a live print sits
 * off by a hair, PANEL_INSET is the knob. On plain paper the sheet still
 * reads; only the logos are missing.
 */
const PANEL_W = 11 / 3; // inches
const PANEL_H = 4.25;
const PANEL_INSET = 0.22; // inches of breathing room inside each crease
/** How much of the top-left and top-middle panels the pre-printed letterhead takes. */
const LETTERHEAD_H = 1.25;

function OrderSheet({
  o,
  where,
  items,
  deliveryLine,
  printed,
}: {
  o: WorkroomOrder;
  where: string[];
  items: WorkroomOrder["lines"];
  deliveryLine: WorkroomOrder["lines"][number] | undefined;
  printed: string;
}) {
  const day = longDate(o.date);
  const weekday = new Date(o.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
  const taxLine = o.lines.find((l) => l.name.startsWith("Sales tax"));
  const paid = o.payment
    ? `Paid · ${o.payment.method === "other" ? "by hand" : o.payment.method} · ${money(o.payment.totalCents / 100)}`
    : o.status === "canceled"
      ? "Canceled"
      : "Not paid";
  const panel = (col: number, row: number, extraCols = 1): React.CSSProperties => ({
    position: "absolute",
    left: `${col * PANEL_W + PANEL_INSET}in`,
    top: `${row * PANEL_H + PANEL_INSET}in`,
    width: `${PANEL_W * extraCols - PANEL_INSET * 2}in`,
    height: `${PANEL_H - PANEL_INSET * 2}in`,
    overflow: "hidden",
  });
  return (
    <>
      <style>{`
        .os { font-family: var(--sans); color: #000; font-size: 10pt; line-height: 1.3; }
        .os-page { position: relative; width: 11in; height: 8.5in; background: #fff; }
        .os-onscreen .os-page { border: 1px dashed var(--line); margin-bottom: 14px; }
        .os-onscreen .os-crease { position: absolute; border: 0; border-top: 1px dashed #ccc; left: 0; right: 0; }
        .os-onscreen .os-crease-v { position: absolute; border: 0; border-left: 1px dashed #ccc; top: 0; bottom: 0; }
        .os-screen { margin: 0 0 14px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
        .os-row { display: flex; justify-content: space-between; gap: 2mm; }
        .os-h { font-size: 9pt; letter-spacing: .06em; text-transform: uppercase; color: #333; margin: 0 0 1px; }
        .os-name { font-size: 12pt; font-weight: 800; }
        .os-big { font-size: 13pt; font-weight: 800; }
        .os-msg { font-family: var(--serif); font-size: 14pt; line-height: 1.35; text-align: center; white-space: pre-wrap; }
        .os table { border-collapse: collapse; width: 100%; font-size: 9.5pt; }
        .os th { text-align: left; font-size: 8pt; letter-spacing: .05em; text-transform: uppercase; border-bottom: 1px solid #000; padding: 1px 2px; }
        .os td { padding: 1px 2px; vertical-align: top; }
        .os .num { text-align: right; white-space: nowrap; }
        @media print {
          @page { size: 11in 8.5in; margin: 0; }
          body { background: #fff !important; }
          .os-screen, .os-crease, .os-crease-v { display: none !important; }
          .os-onscreen .os-page { border: 0; margin: 0; }
        }
      `}</style>
      <p className="os-screen">
        <button className="btn btn--solid" type="button" onClick={() => window.print()}>
          Print the order sheet
        </button>
        <a href="/workroom" style={{ fontSize: 14 }}>Back to the board</a>
        <a href={`/workroom/ticket/${o.id}?layout=plain`} style={{ fontSize: 14 }}>Plain paper instead</a>
        <span className="muted" style={{ fontSize: 13.5 }}>Letter, landscape, no scaling, on the pre-printed six-panel form (bottom tray).</span>
      </p>
      <div className="os os-onscreen">
        <div className="os-page">
          <hr className="os-crease" style={{ top: `${PANEL_H}in` }} />
          <hr className="os-crease-v" style={{ left: `${PANEL_W}in` }} />
          <hr className="os-crease-v" style={{ left: `${PANEL_W * 2}in` }} />

          {/* top-left: the enclosure address card (letterhead pre-printed) */}
          <div style={panel(0, 0)}>
            <div style={{ height: `${LETTERHEAD_H}in` }} />
            <div className="os-name">{o.recipient || o.name}</div>
            {where.map((w, i) => (
              <div key={i} style={{ fontWeight: 600 }}>{w}</div>
            ))}
            {o.fulfillment === "pickup" && <div style={{ fontWeight: 600 }}>Pickup at the shop</div>}
            <div style={{ marginTop: "2mm" }}>[ Order {o.number} ]</div>
            <div className="os-big">
              {o.fulfillment === "delivery" ? "Delivery" : "Pickup"}: {day}
            </div>
            <div style={{ fontWeight: 800, textTransform: "uppercase" }}>{weekday}</div>
          </div>

          {/* top-middle: pre-printed letterhead only, as IRIS left it */}

          {/* top-right: the card message, above the small pre-printed mark */}
          <div style={{ ...panel(2, 0), display: "flex", alignItems: "center", justifyContent: "center", paddingBottom: "0.9in", boxSizing: "border-box" }}>
            <div className="os-msg">{o.cardMessage || ""}</div>
          </div>

          {/* bottom-left + bottom-middle: the work order */}
          <div style={panel(0, 1, 2)}>
            <div className="os-row" style={{ fontWeight: 700 }}>
              <span>Order {o.number} · {site.shortName}</span>
              <span>
                {o.fulfillment === "delivery" ? "Delivery" : "Pickup"}: {day} | {weekday}
              </span>
            </div>
            <div className="os-row" style={{ fontSize: "9pt", marginTop: "1mm" }}>
              <span>Taken: {new Date(o.createdAt).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              <span>Occ: {o.occasion || "none"}</span>
              <span>Printed: {printed}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3mm", marginTop: "2mm" }}>
              <div>
                <p className="os-h">Customer</p>
                <div style={{ fontWeight: 700 }}>{o.name}</div>
                {o.fulfillment === "pickup" && where.map((w, i) => <div key={i}>{w}</div>)}
                {o.phone && <div>Phone: {o.phone}</div>}
                {o.email && <div>Email: {o.email}</div>}
                <div style={{ marginTop: "1mm" }}>{o.source === "web" ? "Website order" : "Phone order"}</div>
              </div>
              <div>
                <p className="os-h">Recipient</p>
                <div style={{ fontWeight: 700 }}>{o.recipient || o.name}</div>
                {o.fulfillment === "delivery" ? where.map((w, i) => <div key={i}>{w}</div>) : <div>Pickup at the shop</div>}
                {o.zip && o.fulfillment === "delivery" && !(site.deliveryZips as readonly string[]).includes(o.zip) && (
                  <div style={{ fontWeight: 700 }}>Off the delivery list: confirm</div>
                )}
              </div>
            </div>
            <table style={{ marginTop: "2mm" }}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th className="num">Qty</th>
                  <th className="num">Price</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((l, i) => (
                  <tr key={i}>
                    <td>{l.slug ?? "custom"}</td>
                    <td>
                      {l.name}
                      {l.parts && l.parts.length > 0 && (
                        <div style={{ fontSize: "8.5pt" }}>{l.parts.map((pt) => `${pt.stems} ${pt.variety}`).join(", ")}</div>
                      )}
                    </td>
                    <td className="num">{l.qty}</td>
                    <td className="num">{money(l.each)}</td>
                    <td className="num">{money(l.each * l.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="os-row" style={{ marginTop: "2mm", fontWeight: 700 }}>
              <span>
                {deliveryLine ? `Delivery: ${money(deliveryLine.each)}` : o.fulfillment === "delivery" ? "Delivery: on the confirm call" : ""}
                {taxLine ? `   Tax: ${money(taxLine.each)}` : ""}
              </span>
              <span>Total: {money(o.subtotal)}</span>
            </div>
            <div className="os-row" style={{ marginTop: "1mm" }}>
              <span>Method of payment: {paid}</span>
              <span>{o.madeBy ? `Made by: ${o.madeBy}` : ""}</span>
            </div>
            {o.notes && (
              <div style={{ marginTop: "1mm" }}>
                <span className="os-h" style={{ display: "inline" }}>Order notes: </span>
                {o.notes}
              </div>
            )}
          </div>

          {/* bottom-right: the driver's stub */}
          <div style={panel(2, 1)}>
            <div style={{ fontWeight: 700 }}>Order {o.number} · {site.shortName}</div>
            <div className="os-big">
              {o.fulfillment === "delivery" ? "DELIVERY" : "PICKUP"}: {day} | {weekday}
            </div>
            <div style={{ marginTop: "2mm", fontWeight: 700 }}>{o.recipient || o.name}</div>
            {o.fulfillment === "delivery" ? where.map((w, i) => <div key={i}>{w}</div>) : <div>Pickup at the shop</div>}
            <div style={{ marginTop: "2mm" }}>Sold to: {o.name}</div>
            {o.phone && <div>Phone: {o.phone}</div>}
            <div style={{ marginTop: "2mm" }}>
              {items.map((l, i) => (
                <div key={i}>
                  {l.name} x {l.qty}
                </div>
              ))}
            </div>
            <div style={{ marginTop: "2mm" }}>Instructions: {o.notes || ""}</div>
            <div style={{ position: "absolute", bottom: "0.1in", left: 0, right: 0 }}>
              <div style={{ borderTop: "1px solid #000", width: "2.6in", paddingTop: "1px", fontSize: "8.5pt" }}>Signature</div>
              <div style={{ fontSize: "8.5pt" }}>{o.number}</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * THE PLAIN-PAPER TICKET (Kevin, 2026-10-12: "pickup tickets are printed on
 * the normal computer paper"). Letter, portrait, from the top tray, nothing
 * pre-printed, so the letterhead is printed here. The same facts as the
 * six-panel sheet's work order, on one plain page: who is picking up,
 * when, what, what it costs, whether it is paid, the card message, the
 * notes. The sheet's window card and driver's stub do not apply to a
 * pickup, so they are not here. Any order can be printed this way; the
 * board just picks it first for pickups.
 */
function PlainTicket({
  o,
  where,
  items,
  deliveryLine,
  printed,
}: {
  o: WorkroomOrder;
  where: string[];
  items: WorkroomOrder["lines"];
  deliveryLine: WorkroomOrder["lines"][number] | undefined;
  printed: string;
}) {
  const day = longDate(o.date);
  const weekday = new Date(o.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long" });
  const taxLine = o.lines.find((l) => l.name.startsWith("Sales tax"));
  const paid = o.payment
    ? `Paid · ${o.payment.method === "other" ? "by hand" : o.payment.method} · ${money(o.payment.totalCents / 100)}`
    : o.status === "canceled"
      ? "Canceled"
      : "Not paid · collect at pickup";
  return (
    <>
      <style>{`
        .pt { font-family: var(--sans); color: #000; font-size: 11pt; line-height: 1.35; width: 7.5in; max-width: 100%; }
        .pt-head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 3mm; margin-bottom: 4mm; }
        .pt-head img { width: 2.2in; height: auto; }
        .pt-addr { text-align: right; font-size: 10pt; line-height: 1.35; }
        .pt-big { font-size: 20pt; font-weight: 800; }
        .pt-h { font-size: 9.5pt; letter-spacing: .06em; text-transform: uppercase; color: #333; margin: 4mm 0 1mm; }
        .pt table { border-collapse: collapse; width: 100%; }
        .pt th { text-align: left; font-size: 9pt; letter-spacing: .05em; text-transform: uppercase; border-bottom: 1px solid #000; padding: 2px 3px; }
        .pt td { padding: 2px 3px; vertical-align: top; border-bottom: 1px solid #ddd; }
        .pt .num { text-align: right; white-space: nowrap; }
        .pt-msg { font-family: var(--serif); font-size: 15pt; line-height: 1.35; border: 1px solid #000; padding: 4mm; margin-top: 1mm; white-space: pre-wrap; }
        .pt-screen { margin: 0 0 14px; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
        @media print {
          @page { size: 8.5in 11in; margin: 0.5in; }
          body { background: #fff !important; }
          .pt-screen { display: none; }
        }
      `}</style>
      <p className="pt-screen">
        <button className="btn btn--solid" type="button" onClick={() => window.print()}>
          Print on plain paper
        </button>
        <a href="/workroom" style={{ fontSize: 14 }}>Back to the board</a>
        <a href={`/workroom/ticket/${o.id}?layout=sheet`} style={{ fontSize: 14 }}>The order form instead</a>
        <span className="muted" style={{ fontSize: 13.5 }}>Letter, portrait, plain paper (top tray).</span>
      </p>
      <div className="pt">
        <div className="pt-head">
          <img src="/img/brand/logo.webp" alt={site.name} />
          <div className="pt-addr">
            {site.address.street}
            <br />
            {site.address.city}, {site.address.state} {site.address.zip}
            <br />
            {site.phone}
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "4mm" }}>
          <div className="pt-big">{o.fulfillment === "pickup" ? "PICKUP" : "DELIVERY"}</div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700 }}>Order {o.number}</div>
            <div>{o.source === "web" ? "Website order" : "Phone order"}</div>
          </div>
        </div>
        <div style={{ fontSize: "14pt", fontWeight: 700 }}>
          {day}, {weekday}
        </div>
        {o.occasion && o.occasion !== "Everyday" && <div>{o.occasion}</div>}
        {o.status === "hold" && <div className="pt-big">ON HOLD</div>}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6mm" }}>
          <div>
            <p className="pt-h">{o.fulfillment === "pickup" ? "Picking up" : "Ordered by"}</p>
            <div style={{ fontWeight: 700, fontSize: "12pt" }}>{o.name}</div>
            {o.phone && <div>{o.phone}</div>}
            {o.email && <div>{o.email}</div>}
          </div>
          <div>
            <p className="pt-h">{o.fulfillment === "pickup" ? "Their address, for the file" : "Deliver to"}</p>
            {o.fulfillment === "delivery" && <div style={{ fontWeight: 700 }}>{o.recipient || o.name}</div>}
            {where.length ? where.map((w, i) => <div key={i}>{w}</div>) : <div>{o.fulfillment === "pickup" ? "none given" : "No address yet"}</div>}
          </div>
        </div>

        <p className="pt-h">Items</p>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th className="num">Qty</th>
              <th className="num">Each</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((l, i) => (
              <tr key={i}>
                <td>
                  {l.name}
                  {l.parts && l.parts.length > 0 && <div style={{ fontSize: "9.5pt" }}>{l.parts.map((pt) => `${pt.stems} ${pt.variety}`).join(", ")}</div>}
                </td>
                <td className="num">{l.qty}</td>
                <td className="num">{money(l.each)}</td>
                <td className="num">{money(l.each * l.qty)}</td>
              </tr>
            ))}
            {deliveryLine && (
              <tr>
                <td>{deliveryLine.name}</td>
                <td className="num">1</td>
                <td className="num">{money(deliveryLine.each)}</td>
                <td className="num">{money(deliveryLine.each)}</td>
              </tr>
            )}
            {taxLine && (
              <tr>
                <td>{taxLine.name}</td>
                <td className="num">1</td>
                <td className="num">{money(taxLine.each)}</td>
                <td className="num">{money(taxLine.each)}</td>
              </tr>
            )}
            <tr>
              <td colSpan={3} style={{ fontWeight: 700, borderBottom: 0 }}>Total</td>
              <td className="num" style={{ fontWeight: 700, borderBottom: 0 }}>{money(o.subtotal)}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontWeight: 700, fontSize: "12pt", marginTop: "2mm" }}>{paid}</div>

        <p className="pt-h">Card message</p>
        <div className="pt-msg">{o.cardMessage || "(none)"}</div>

        {o.notes && (
          <>
            <p className="pt-h">Notes</p>
            <div>{o.notes}</div>
          </>
        )}
        <div style={{ marginTop: "6mm", fontSize: "9.5pt", color: "#333", display: "flex", justifyContent: "space-between" }}>
          <span>Taken {new Date(o.createdAt).toLocaleString("en-US", { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
          <span>{o.madeBy ? `Made by ${o.madeBy}` : ""}</span>
          <span>Printed {printed}</span>
        </div>
      </div>
    </>
  );
}
