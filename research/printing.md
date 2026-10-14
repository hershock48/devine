# Printing orders on the Brother, by themselves

What the shop wants (Kevin, 2026-10-12): website orders print on their own,
overnight included, so the morning's work is already in the printer tray when
they walk in. That is what IRIS did. A browser cannot do it alone (it cannot
print silently to two trays, and nobody has it open at 3 am), so a small
helper runs on the counter PC.

## The printer and the paper

One printer for orders: a **Brother HL-L5200DW** on the counter PC, two trays.
The Star TSP100 by the register is Square's receipt printer and is not involved.

| Tray | Paper | Printer entry | Used for |
|---|---|---|---|
| Bottom | The shop's pre-printed six-panel form (John Henry stock, reorder 1-866-448-8300): letter, landscape, creased 3 across by 2 down, her logo and address pre-printed on the top-left and top-middle panels and a small mark at the foot of the top-right one | **Six-panel forms (bottom tray)** | Delivery orders, and pickups that carry a card message |
| Top | Plain letter paper | **Plain paper (top tray)** | Pickups with no card message |

The rule, from Kevin's notes: a delivery always gets the form; a pickup gets
plain paper, unless it has a card message, because then it needs the
enclosure card panel that only the form has. `layoutFor` in
`lib/workroom/print-pdf.ts` is that rule, in one line.

## The two layouts (one source, `lib/workroom/print-pdf.ts`)

The order is drawn as a PDF, in inches on the page, so the helper's print and
the Print link's copy are the same bytes and nothing is scaled.

**The six-panel form**, for deliveries, and for pickups with a card message, printed around the pre-printed logos:

| Panel | What |
|---|---|
| top-left | The enclosure address card: recipient, address, phone, order number, delivery day. Tears off into the window envelope. |
| top-middle | Nothing but the pre-printed letterhead, as IRIS left it. |
| top-right | The card message, centered, above the small pre-printed mark. |
| bottom-left + middle | The work order: order, delivery day, customer, recipient, items with prices and stems, delivery, tax, total, payment, who took it, who made it, notes. |
| bottom-right | The driver's stub: delivery day, recipient and phone, sold to, the pieces, instructions, signature line. |

**The plain ticket**, for pickups: letter portrait with the letterhead drawn,
who is picking up and when, items and total, paid or not, the card message
boxed, the notes.

Any order prints either way: `/api/workroom/print/<id>?layout=sheet` or
`?layout=plain`. Without `?layout=` the order picks its own by the rule above.

## The morning banner (no helper needed)

When anyone signs into the board, a banner at the top lists every website
order nobody has printed: name, delivery or pickup, and which paper it wants.
Two buttons: **Print the N six-panel forms** (deliveries, and pickups with a card
message) and **Print the N pickup tickets**.
Each opens one PDF with a page per order; the print dialog comes up; pick the
printer entry by name (Six-panel forms or Plain paper); Print. The list clears once
a document is opened, and the card's own Print link reprints any one. The
banner stays through every sign-in and refresh until each order is printed or
marked, so a busy afternoon cannot lose one. Two clicks in the morning; the
only setup is the two printer entries below.

## What prints by itself (optional: the helper)

`tools/print-helper.ps1` runs on the counter PC. Every 30 seconds it asks
`/api/workroom/print/queue` for website orders from the last three days that
have not printed, fetches each through the same door the banner's buttons use
(which marks the order printed as the PDF leaves the site), and prints it
silently with SumatraPDF to **Six-panel forms (bottom tray)** or **Plain paper (top tray)** by the order's
type. The mark is one conditional write on the server, so a phone and the PC
asking for the same order in the same second get it once between them; a
restart or a reload never prints one twice. If the printer refuses a job after
the mark, the helper's window says so loudly and the card's own Print link
reprints it. Phone orders written up at the counter are not auto-printed (the
person is standing there); Print on the card is one tap.

The board shows "printed 7:02 AM" on a card once the helper has done it.

## Setup on the counter PC, once

**Two printer entries for the one Brother**, so the tray is chosen by name.
Both are order forms, so the names say the paper, not the purpose. The shop's
HL-L5200DW has the optional lower tray, so the driver lists Tray 1 (the upper
cassette, plain paper), Tray 2 (the bottom cassette, the six-panel forms) and
the MP Tray (the fold-down at the front, unused). Done on the shop PC,
2026-10-13:

1. Windows Settings, Bluetooth & devices, Printers & scanners, Add device, then
   **Add manually** (not the Brother that appears by itself; that path cannot
   rename). "Add a local printer or network printer with manual settings",
   **Use an existing port** and pick the Brother's own port, driver
   **Brother, HL-L5200DW series**, "Use the driver that is currently
   installed", name it **Six-panel forms (bottom tray)**, do not share, not
   the default. Skip the test page.
2. Six-panel forms (bottom tray), Printing preferences, Basic tab: Paper Size
   Letter; Paper Source, First Page and Other Pages both **Tray 2**; Scaling
   off. Never **Auto Select**: both cassettes hold letter paper, and Auto
   Select is what sent every form to the plain tray.
3. The original Brother entry, Printer properties, General tab: rename it
   **Plain paper (top tray)**. Its Printing preferences: Paper Source both
   **Tray 1**.
4. In Edge's print panel, the Printer dropdown now lists the two by name; pick
   the one the banner row says. More settings, **Scale: Actual size**, not Fit
   to page, because the form is drawn on the creases. Edge remembers it per
   printer.

**The helper:**

5. Make a folder `C:\PrintHelper`. Put `print-helper.ps1` and
   `print-helper.cmd` from this repo's `tools/` in it.
6. Download SumatraPDF, portable 64-bit (free, from sumatrapdfreader.org), and
   save it in that folder as `SumatraPDF.exe`.
7. Open `print-helper.ps1` in Notepad and set `$Pin` to the staff PIN. If the
   printer entries were named differently, set those two lines too. Save.
8. Double-click `print-helper.cmd`. A window opens and says it is up. Leave it
   open, minimised. It logs each sheet it prints.
9. So it starts with Windows: Win+R, type `shell:startup`, Enter, and put a
   shortcut to `print-helper.cmd` in that folder.
10. Windows Settings, System, Power: set the PC never to sleep when plugged in.
    The printer stays on.

**Test:** place an order on the website. Within a minute the helper's window
logs "Printed DV-...", the sheet is in the tray, and the board's card says
"printed" with the time.

## If the form prints off the creases

`lib/workroom/print-pdf.ts`: `PANEL_W` (3.667 in), `PANEL_H` (4.25 in),
`PANEL_INSET` (breathing room inside each crease) and `LETTERHEAD_H` (how far
down the pre-printed logo reaches on the top-left panel). Also check the
Six-panel forms entry says Scaling None and the helper passes `noscale`, which it
does; scaling moves everything at once.

## Not yet

- Phone orders are not auto-printed; say the word if the shop wants them too.
- The driver's stub carries the order number as text, not a barcode. IRIS
  printed a barcode nothing scanned.
