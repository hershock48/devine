# Printing tickets on the Star TSP100

The counter printer is a **Star TSP100 futurePRNT ECO**: a 3-inch thermal receipt
printer on USB, driven by the Windows PC it is plugged into. IRIS printed a slip
for every order the moment it landed. The workroom does the same, with one
setup step on that PC, because a web page cannot print silently on its own.

## Two printers, two pieces of paper

From the shop photos (2026-10-12): the **Star TSP100** prints the working slip,
and a **laser printer** beside it prints the **enclosure card**, the insert that
rides in the window envelope with the flowers: the shop's letterhead, the
recipient's name, address and phone where the window shows them, the order
number and the delivery date, the small mark at the foot. It prints on a
two-part card sheet.

## What exists

- **Every order card has two links.** `Slip` opens the ticket at
  `/workroom/ticket/<id>?print=1` in its own tab, which prints itself and closes.
  `Card` opens the enclosure card at `/workroom/ticket/<id>?card=1`, with a
  Print button, so the laser printer can be picked in the dialog. It prints two
  pieces: the address card for the window, then the message card.
- **The enclosure card** is sized for an A2 insert (5.5 by 4.25 inches). If the
  first live print sits high or low in the envelope window, the two margins at
  the top of `EnclosureCard` in `Ticket.tsx` are the knobs. Still to confirm from
  the shop: the card sheet's brand and size, and the laser printer's model.
- **The ticket** is laid out for 80mm paper (72mm printable): shop name, order
  number, DELIVER or PICKUP in large type, the date, who it goes to and where,
  the items (with stems when a piece was priced by stems), the delivery line,
  subtotal, PAID or NOT PAID, the card message large in the serif, notes, who
  ordered it, who made it, and when it printed.
- **"Print new web orders on this screen"**, a checkbox at the top of the board.
  On, this browser prints the ticket for every website order that arrives from
  that moment on, once each, and remembers what it printed across reloads. It
  is per device: tick it on the counter PC only.

## The one setup step, on the counter PC

Chrome prints without a dialog when it is started with kiosk printing.

1. In Windows, make the Star TSP100 the **default printer** (Settings, Bluetooth
   & devices, Printers & scanners, choose it, Set as default). In its printing
   preferences, paper size 72mm x receipt (or "80mm roll"), and enable the cut
   at document end.
2. Make a desktop shortcut that starts Chrome with the flag. Right-click the
   desktop, New, Shortcut, and for the location paste:

   ```
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://devine.glazedweb.com/workroom
   ```

   Name it "Order board". Use this shortcut to open the board every morning.
   Close any other Chrome windows first: the flag only applies when it starts
   the first Chrome window.
3. Open the board from that shortcut, sign in, and tick **Print new web orders
   on this screen**.
4. Test: place an order on the website. A slip should come out within about
   30 seconds (the board polls at that pace). Tap Print on any card for an
   immediate one.

Without the flag, everything still works; Chrome just shows the print dialog
and someone presses Print.

## What it does not do yet

- Phone orders written up on the board are not auto-printed (the person typing
  them is standing at the printer; Print is one tap). Say the word if the shop
  wants those too.
- No per-piece or driver copy; one slip per order. IRIS had Print Receipt,
  Print Delivery and Print Invoice as three buttons. A second layout is a
  small addition once she says which she used.
