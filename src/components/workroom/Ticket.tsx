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
export default function Ticket({ order: o, card = false }: { order: WorkroomOrder; card?: boolean }) {
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

  if (card) return <EnclosureCard o={o} where={where} />;

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
 * THE ENCLOSURE CARD (from Kevin's photo, 2026-10-12): the insert that rides
 * in the window envelope with the flowers. IRIS printed it on the laser
 * printer on a two-part card sheet: the shop's letterhead across the top,
 * the recipient's name, address and phone where the window shows them, the
 * order number and the delivery date under that, and the small mark at the
 * foot. This is that card, sized for an A2 envelope's insert (5.5 by 4.25
 * inches), with the card message on the sheet's second half so one print
 * makes both pieces. Window alignment is set by the margins below; if the
 * first live print sits high or low in the window, those two numbers move.
 */
function EnclosureCard({ o, where }: { o: WorkroomOrder; where: string[] }) {
  return (
    <>
      <style>{`
        .ec { font-family: var(--sans); color: #1a1611; }
        .ec-page { width: 5.5in; height: 4.25in; box-sizing: border-box; padding: 0.3in 0.35in; position: relative; }
        .ec-head { display: flex; justify-content: space-between; align-items: flex-start; }
        .ec-head img { width: 1.9in; height: auto; }
        .ec-addr { text-align: right; font-size: 9.5pt; line-height: 1.35; color: #4c463d; }
        .ec-to { margin-top: 0.45in; font-size: 12pt; line-height: 1.3; font-weight: 700; }
        .ec-to div { font-weight: 600; }
        .ec-to .ec-name { font-size: 13pt; font-weight: 800; }
        .ec-meta { margin-top: 0.18in; font-size: 11pt; line-height: 1.35; }
        .ec-meta .ec-date { font-size: 13pt; font-weight: 800; }
        .ec-foot { position: absolute; left: 0; right: 0; bottom: 0.2in; text-align: center; }
        .ec-foot img { width: 1.1in; height: auto; }
        .ec-msg-page { display: flex; align-items: center; justify-content: center; text-align: center; }
        .ec-msg { font-family: var(--serif); font-size: 16pt; line-height: 1.35; max-width: 4.4in; white-space: pre-wrap; }
        .ec-screen { margin: 0 0 14px; display: flex; gap: 14px; align-items: center; }
        .ec-onscreen .ec-page { border: 1px dashed var(--line); margin-bottom: 16px; background: #fff; }
        @media print {
          @page { size: 5.5in 4.25in; margin: 0; }
          body { background: #fff !important; }
          .ec-screen { display: none; }
          .ec-onscreen .ec-page { border: 0; margin: 0; page-break-after: always; }
          .ec-onscreen .ec-page:last-child { page-break-after: auto; }
        }
      `}</style>
      <p className="ec-screen">
        <button className="btn btn--solid" type="button" onClick={() => window.print()}>
          Print the card
        </button>
        <a href="/workroom" style={{ fontSize: 14 }}>Back to the board</a>
        <span className="muted" style={{ fontSize: 13.5 }}>Two pieces: the address card for the window, then the message card.</span>
      </p>
      <div className="ec ec-onscreen">
        <div className="ec-page">
          <div className="ec-head">
            {/* The real mark, never redrawn (glaze.md). */}
            <img src="/img/brand/logo.webp" alt={site.name} />
            <div className="ec-addr">
              {site.address.street}
              <br />
              {site.address.city}, {site.address.state} {site.address.zip}
              <br />
              {site.phone}
            </div>
          </div>
          <div className="ec-to">
            <div className="ec-name">{o.recipient || o.name}</div>
            {where.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
            {o.fulfillment === "pickup" && <div>Pickup at the shop</div>}
            {o.phone && o.fulfillment === "pickup" && <div>{o.phone}</div>}
          </div>
          <div className="ec-meta">
            <div>[ Order {o.number} ]</div>
            <div className="ec-date">
              {o.fulfillment === "delivery" ? "Delivery" : "Pickup"}: {longDate(o.date)}
            </div>
          </div>
          <div className="ec-foot">
            <img src="/img/brand/logo.webp" alt="" />
          </div>
        </div>
        <div className="ec-page ec-msg-page">
          <div className="ec-msg">{o.cardMessage || " "}</div>
        </div>
      </div>
    </>
  );
}
