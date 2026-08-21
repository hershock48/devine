import GlazedCredit from "@/components/GlazedCredit";

/**
 * The signature plate: Glazed's drip edge, then the studio credit on a Glazed ground.
 *
 * The drip path is the `dripEdge` symbol from glazedweb's components/Logo.jsx, copied
 * verbatim. The idea is his: on glazedweb.com that same edge separates every band of the
 * homepage, in four different colour pairs. This is that element doing the one job it was
 * always right for — marking where the studio signs off.
 *
 * THE PLATE INVERTS AGAINST THE FOOTER. This is the whole trick and it is not a style
 * preference, it is arithmetic. The drip only reads if there is a real tonal step between the
 * colour above it and the plate below. Measured against every footer in the account:
 *
 *   footer                          vs chocolate-2   vs cream
 *   copperac      #191919                 1.00        16.38
 *   cookinwithbeans #141414                1.05        17.17
 *   beanumber     #0d0d0d                  1.10        18.11
 *   mi-gas        #151010                  1.07        17.58
 *   chism         #3B2F28                  1.36        12.06
 *   sprinkles     #FFF6EA                 16.45         1.00
 *   beanumber inline #F9FAFB              16.85         1.03
 *
 * A chocolate plate under a near-black footer is a contrast ratio of 1.00 — the drip would be
 * completely invisible, a flat band pretending to be a graphic. So: dark footer gets the CREAM
 * plate, light footer gets the CHOCOLATE plate, and every site lands a 12–18× step.
 *
 * The happy consequence is that the donut always sits on one of its own two native grounds —
 * cream #FDF6EC or chocolate-2 #201712 — which are exactly the two the mark is drawn against on
 * glazedweb.com. It stops adapting to seven different palettes and starts looking like itself.
 *
 * THREE VALUES, SET ONCE PER SITE, in that site's own CSS where the palette already lives:
 *   --gw-above       the footer colour directly above the plate. This is the drip's fill, so
 *                    it must match exactly or a seam appears along the top edge.
 *   --gw-plate       the plate ground: cream under a dark footer, chocolate-2 under a light one.
 *   --gw-plate-ink   the text colour on it. cream on chocolate is 16.41, chocolate on cream is
 *                    15.05; both pass AA. Taupe #8A7663 measures 4.07 and 4.03 — it clears AA
 *                    for large text only, so it is NOT safe for a 12px credit line. Do not
 *                    reach for it here.
 *
 * THE CLIENT'S COPYRIGHT STAYS IN THE CLIENT'S BAR. Only the credit moves onto the plate.
 * Sweeping their copyright line onto Glazed's chocolate would make the studio's plate the last
 * word on their own site, and that is not what a signature is. Their footer ends where it
 * ended; this hangs beneath it.
 */
export default function GlazedPlate({
  line = "Double Dipped by",
  className = "",
}: {
  line?: string;
  className?: string;
}) {
  return (
    <div className={`gw-plate ${className}`}>
      {/* preserveAspectRatio="none" so the drips stretch to any width, exactly as his
          DripDivider does. fill is currentColor and the element's color is --gw-above, which
          keeps the seam with the footer above in one place. */}
      <svg
        className="gw-plate-drip"
        viewBox="0 0 1440 60"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M0,0 H1440 V16 C1408 16 1400 44 1378 44 C1356 44 1362 16 1332 16 H1180 C1160 16 1156 52 1132 52 C1110 52 1116 16 1088 16 H880 C862 16 860 38 842 38 C824 38 828 16 802 16 H590 C574 16 572 48 550 48 C528 48 532 16 506 16 H300 C284 16 282 36 264 36 C246 36 250 16 224 16 H0 Z" />
      </svg>
      <div className="gw-plate-bar">
        <GlazedCredit line={line} />
      </div>
    </div>
  );
}
