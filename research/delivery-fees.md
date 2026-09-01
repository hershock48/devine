# The delivery fee sheet, transcribed

Source: a photo (2026-09-01, from Kevin) of the laminated sheet inside a
cabinet at the shop. IRIS-generated, header "DeVine's Flowers &
Botanicals: Zip Code List", current user **Katy DeVine**, generated
05/06/2026. Handwritten minimums in the margin.

This answers two of the three delivery questions the build has refused to
invent (fee, minimum). The same-day cutoff remains unanswered.

**OWNER VERIFIES BEFORE ANY NUMBER GOES LIVE**, same rule as the price
lists: transcribed from a photo, and one alignment is worth reading back
to her (below).

## Fees by zip

The 24 zips on the sheet are exactly the 24 in `site.ts deliveryZips`,
same order. The photo's amount column starts slightly below the zip
column, so the pairing was checked by count (24 amounts for 24 zips) and
by sanity anchor: this mapping puts **$8.95 on 49068, Marshall itself**,
the shop's own town and the cheapest run, which is the only mapping that
makes geographic sense. Read back to the owner anyway; a one-row slip
would move every fee.

| Zip | Fee | | Zip | Fee |
|---|---|---|---|---|
| 48813 (Charlotte) | 32.00 | | 49076 (Olivet) | 20.00 |
| 49011 (Athens) | 25.00 | | 49092 (Tekonsha) | 20.00 |
| 49014 (Battle Creek) | 20.00 | | 49094 (Union City) | 24.00 |
| 49015 (Battle Creek) | 20.00 | | 49201 (Jackson) | 32.00 |
| 49016 (Battle Creek) | 20.00 | | 49202 (Jackson) | 32.00 |
| 49017 (Battle Creek) | 20.00 | | 49203 (Jackson) | 32.00 |
| 49021 (Bellevue) | 24.00 | | 49224 (Albion) | 20.00 |
| 49029 (Burlington) | 24.00 | | 49245 (Homer) | 24.00 |
| 49033 (Ceresco) | 16.95 | | 49252 (Litchfield) | 32.00 |
| 49034 (Climax) | 32.00 | | 49284 (Springport) | 24.00 |
| 49036 (Coldwater) | 32.00 | | | |
| 49037 (Battle Creek) | 25.00 | | | |
| 49051 (East Leroy) | 25.00 | | | |
| 49068 (Marshall) | **8.95** | | | |

Town names are from the zip, added here for the read-back; the sheet
prints zips only.

## Minimum order, handwritten

Two values crossed out and replaced. Current reading:

- **$45 minimum in Marshall** (a crossed-out $38 beneath it)
- **$55 minimum outside of Marshall** (a crossed-out figure beneath it)

Whether the minimum is product subtotal before the delivery fee, or
includes it, is not on the sheet: ask.

## What this unlocks, once she confirms

1. Delivery fees in checkout: a delivery order can show its real fee and
   a real total, which removes the reason card payment is pickup-only.
2. The minimums as checkout behavior: below-minimum delivery attempts
   get told, not walled (the zip rule's spirit: a near miss is a phone
   call).
3. The fee-per-zip table belongs in `site.ts`, one constant, once
   verified.

## Still open

- Same-day cutoff time.
- Whether 48813 truly carries a fee (the count says yes; the photo's
  first row is the blurriest).
- Minimum: before or after the delivery fee.
