# Printing orders on the Brother

One printer for orders: a **Brother HL-L5200DW** on the counter PC, two trays.
The Star TSP100 by the register is Square's receipt printer and is not involved.

| Tray | Paper | Used for |
|---|---|---|
| Bottom | The shop's pre-printed six-panel form (John Henry stock, reorder 1-866-448-8300): letter, landscape, creased 3 across by 2 down, her logo and address pre-printed on the top-left and top-middle panels and a small mark at the foot of the top-right one. | Delivery orders |
| Top | Plain letter paper | Pickup orders |

IRIS printed one page the moment an order landed. The workroom does the same,
and the employee chooses the tray in the print dialog, which is the one thing
a web page cannot do for them.

## The two layouts

**The order form** (deliveries), one landscape page on the six-panel stock,
printed around the pre-printed logos:

| Panel | What |
|---|---|
| top-left | The enclosure address card: recipient, address, phone, order number, delivery day. Tears off into the window envelope. |
| top-middle | Nothing but the pre-printed letterhead, as IRIS left it. |
| top-right | The card message, centered, above the small pre-printed mark. |
| bottom-left + middle | The work order: order, delivery day, customer, recipient, items with prices and stems, delivery, tax, total, payment, who took it, who made it, notes. |
| bottom-right | The driver's stub: delivery day, recipient and phone, sold to, the pieces, instructions, signature line. |

**The plain ticket** (pickups), one portrait page on plain paper with the
letterhead printed: who is picking up and when, the items and total, paid or
not, the card message boxed, the notes.

Also a receipt-width **slip** (`?layout=slip`), in case a receipt printer is ever
wanted for orders.

## What the board does

- **Print**, on every order card, opens the right layout for that order in its
  own tab (form for a delivery, plain for a pickup), brings up the print dialog,
  and closes after printing. Each layout page links to the other, so an employee
  can print a delivery on plain paper or a pickup on the form when they want to.
- **"Print new web orders on this screen"**, a checkbox at the top of the board.
  On, every website order that arrives brings up the print dialog with its layout
  ready; the employee picks the tray and presses Print. Once each, remembered
  across reloads. Per device: tick it on the counter PC only.

## Setup on the counter PC, once

Two printer entries for the one Brother, so the tray is a choice by name:

1. Windows Settings, Printers & scanners. The Brother is installed once already.
   Add it a second time (Add device, or Add manually with the same connection),
   so there are two entries.
2. Rename them: **Order forms** and **Plain paper**.
3. **Order forms**: Printing preferences, paper Letter, orientation Landscape,
   scaling None, paper source **Tray 2** (the bottom tray). Save.
4. **Plain paper**: paper Letter, Portrait, scaling None, paper source **Tray 1**.
   Save. Make this one the default printer.
5. In Chrome's print dialog, Margins: None for the form, Default for plain,
   Scale 100%. Chrome remembers the last printer and settings it used.

Then the daily routine is: open the board, tick the checkbox, and press Print in
the dialog when a sheet pops up.

## Silent printing, if the shop ever wants it

Chrome started with `--kiosk-printing` prints without any dialog, to the default
printer only. That is one tray for everything, so it suits a shop that prints
every order on the same paper. If that is ever the case here, the shortcut is:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://devine.glazedweb.com/workroom
```

## If the form prints off the creases

The panel grid in `components/workroom/Ticket.tsx` is in inches: `PANEL_W`
(3.667), `PANEL_H` (4.25), `PANEL_INSET` (breathing room inside each crease)
and `LETTERHEAD_H` (how far down the pre-printed logo reaches on the top-left
panel). Nudge those; nothing else moves. "Scaling: None" in the driver and
"Margins: None" in the dialog matter more than any of them.

## Not yet

- Phone orders written up on the board are not auto-printed; Print is one tap on
  the card. Say the word if the shop wants them automatic too.
- The driver's stub carries the order number as text, not a barcode. IRIS
  printed a barcode nothing scanned; add one if something ever does.
