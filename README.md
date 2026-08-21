# devine

Glazed Web pitch and concept build for **DeVine's Flowers & Botanicals**, Marshall,
Michigan. Read `glaze.md` in the `glazedweb` repo before touching any of this.

Two things live here:

- **the proposal**, at the root of `devine.glazedweb.com`
- **the concept site**, at `/demo` — a full rebuild of their site, 57 real products,
  a working cart, and a real order intake: checkout posts to `/api/order`, which
  emails a ticket to the shop over SMTP. No card online; the shop calls to confirm
  and takes payment then. Unconfigured, it degrades honestly (see `.env.example`).

## What is here

| Path | What it is |
|---|---|
| `public/pitch/devine/index.html` | The proposal. One self-contained file, no build step, hand-editable on a phone if a call goes sideways. |
| `public/pitch/devine/og.jpg` | The proposal's link card, 1200x630, 44KB. Rendered from a real page, not assembled by hand. |
| `src/lib/site.ts` | **Every business fact.** Hours, phone, address, delivery towns, staff, policies. One edit fixes any of them everywhere. |
| `src/lib/catalog.ts` | All 57 products with their real names, prices and their own copy. Keyed on slug, never on name. |
| `src/lib/image-manifest.json` | Which products have a real photograph, and its true pixel size. Generated, not hand-written. |
| `src/components/ProductImage.tsx` | Decides photograph or generated art, per product. Nothing above it knows which. |
| `src/lib/seo.ts` | `metadataBase`, the canonical host, and the `LocalBusiness` JSON-LD, all fed from `site.ts`. **`CANONICAL_HOST` is the pitch host today and must become their domain before the noindex comes off.** |
| `src/app/sitemap.ts` | Derived from the nav and the catalog, so adding a product adds a URL. No `lastModified`, deliberately. |
| `src/app/og-card/page.tsx` | The demo's link card as a real route, screenshotted by `tools/og.mjs` into `public/og.jpg`. The photograph fills the frame; the type sits on a paper panel pinned to the iOS-safe centre 630. Not linked, not in the sitemap. |
| `tools/og-products.mjs` | 1200x630 JPEG link cards for every photographed product, plus `src/lib/og-manifest.json`. Re-run when photographs land. Photographed products declare a COMPLETE OpenGraph block (never partial — Next replaces, not merges); Bloom products inherit the site card. |
| `src/components/GreeningInquiry.tsx` | The business brief the proposal promises for Greening, field for field. Same `mailto:` honesty as the wedding form. |
| `src/components/GlazedPlate.tsx`, `GlazedCredit.tsx` | Copied verbatim from `glaze/assets/glazed-credit/`. **Never rebuild these**, and never redraw the mark. |
| `src/lib/order.ts` | `photoFirst()`. Any list that shows only SOME of a category leads with the photographed items; a full category page stays in price order. Becomes a no-op when the last photograph lands. |
| `tools/shots.mjs` | Full-page screenshots at a given width, with the scroll sweep that makes lazy images actually load. |
| `src/components/Bloom.tsx` | The generated botanical print, for products with no photograph yet. **Delete this file when the last photo lands.** |
| `src/app/demo/**` | The site. Home, shop, 8 category pages, 57 product pages, weddings, sympathy, greening, delivery, workshops, about, cart. |
| `src/lib/intake.ts` | Order intake. Server-side pricing from the catalog (a client-supplied total is a number a customer chose), the shop's plain-text ticket, the customer's copy, and the SMTP send with its three honest states. The long comment at the top says why a failed send is told to the customer rather than swallowed, deliberately diverging from glaze.md's contact-form rule. |
| `src/app/api/order/route.ts` | The one route with a side effect. 200 sent, 400 bad order, 503 mail unconfigured, 502 send failed. The cart is honest about each. |
| `src/lib/occasions.ts` | One list, two importers: the form renders it, the intake validates against it. Alone because `intake.ts` is server-only and `CartView` is a client component. |
| `.env.example` | The authority on what checkout needs to actually send. Five variables, set by Kevin in Vercel. While this is a pitch, `ORDER_TO` is Glazed's inbox, not the shop's; the flip is an env edit. |
| `src/app/workroom/**` | **The shop's own tool, Phase 2.** An order board at `/workroom` (web orders land on it by themselves; phone orders get written up on it) and a stem tracker at `/workroom/stems`: purchases, shrink with reasons, per-product recipes, and a Monday-morning week report of bought / tossed / shrink % / revenue / stem cost / margin. Sits outside `/demo` because it is not part of the customer demo and does not move on launch day. |
| `src/lib/workroom/store.ts` | Two storage backends behind one interface, ported from the pjs kitchen system: Postgres when `DATABASE_URL` is set (Neon free tier via Vercel, tables create themselves), in-memory otherwise — and the pages show a plain warning on memory, because a board that silently misses orders is worse than one that says why. |
| `src/lib/workroom/auth.ts` | A PIN and a cookie. A gate, not a vault: nothing behind it moves money. `WORKROOM_PIN`, falling back to the shop phone's last four. |
| `src/app/workroom/quotes/**` | **The quote builder** — the owner's sharpest ask ("a model to input flowers and stem count to accurately produce a quote"). Weddings and funerals as separate templates, flowers priced per stem once per quote (prefilled from purchase history), live totals, a wholesale buy list, autosave, and a print view that is the client's copy: same numbers, none of the workings. |
| `src/lib/workroom/quote-math.ts` | The quote arithmetic, alone in one file with no imports, so the list, the builder and the print can never disagree. **The model is provisional**: flowers × markup (default ×3) + labor % of flower retail (default 25%) + hardgoods + delivery/setup; wedding deposit 50% per their published process. To be rewritten against her real wedding spreadsheet and funeral worksheet after the meeting. |
| `src/lib/workroom/quote-templates.ts` | The starting piece lists, one per model, every piece editable and none carrying an invented stem count. Also provisional until her documents arrive. |
| `next.config.ts` | The root rewrite and the noindex headers. |
| `src/app/robots.ts` | Search engines out, social card scrapers in. |

## Where the photographs come from

Their host answers automated image requests with a captcha, so the images could not be
fetched from their site. **Kevin supplied them directly.** They were matched to
products by their original WordPress filenames (`IMG_0688`, `Large-Dish-Garden`), which
the catalog harvest already recorded, so no photo was matched by eye.

`devine-src/process-supplied.py` does the conversion: two widths per product, WebP, and
a manifest of real pixel dimensions so nothing reflows as it loads.

**20 of 57 products have a photograph.** The whole Plants category does. The remaining
37 render a generated botanical print built from the flower names in their own product
copy. It is deliberately an illustration and never passes as a photograph.

To add the rest: drop the files into the uploads folder, re-run the script, copy
`image-manifest.json` into `src/lib/`. No code changes.

## Zero to live

1. Import this repo into Vercel. One project per repo; check there is not already a
   duplicate, because several Glazed repos ended up imported twice.
2. Add the domain **`devine.glazedweb.com`**. Apex form only. Adding `www.` gives you a
   hostname with no certificate, which has already burned one prospect link.
3. Confirm by fetching the deployed URL rather than assuming:
   - `https://devine.glazedweb.com/` serves the proposal, not the site.
   - `https://devine.glazedweb.com/demo` serves the site.
   - Both carry `X-Robots-Tag: noindex, nofollow`.

   If a URL looks stale in your browser, check `x-vercel-cache` before touching code.
   `MISS` means the origin is fresh and the stale copy is yours. This cost a round trip.
4. Paste the link into Messages **and** one non-Apple surface, and look at the card.
   Apple's preview is fetched by the sending device, so a card can look right in
   Messages and be empty everywhere else.

## Verified, not assumed

Measured against the production build on 2026-08-20, not the dev server:

- **0** axe violations across 15 routes at 390 and 1440. WCAG 2.1 AA.
- **0** horizontal overflow at 320, 390, 768 and 1440. 320 caught two real faults: a
  grid item that would not shrink, and their 37-character email address.
- **0** console errors, **0** 4xx.
- JavaScript, measured per route by observing what the browser actually requests,
  not by summing the build directory: **136.6KB gzip / 116.5KB brotli** on most
  routes, worst case **149KB gzip** on `/demo/cart` since the checkout form landed
  (2026-08-21; it was 142.6KB gzip / 121.7KB brotli before). Against a 150KB bar.
  The earlier "136KB per page" in this file was right for `/demo` and understated
  the worst route, which is the number that matters.
- Every one of the 74 routes has its own title and its own meta description. This
  file previously claimed that when it was not true: the 6" and 8" Peace Lily shared
  a description, and all three "Designer's Choice" shared another. See the note in
  `product/[slug]/page.tsx`.
- Open Graph, canonical, `LocalBusiness` JSON-LD and a sitemap all present and
  checked in the response, not just in the source.

## PLACEHOLDERS — none of this is theirs yet

Each one is visible in the code as `PLACEHOLDER` and must be closed before launch.

- [ ] **37 product photographs.** Listed by `process-supplied.py` on every run.
- [ ] **Team roles.** Their site publishes four names and no titles, so none were
      invented. `site.team` in `src/lib/site.ts`.
- [ ] **Team portraits.** Currently generated art in the team grid.
- [ ] **Delivery fee, order minimum, same-day cutoff.** Their site publishes none of
      the three and this build invents none. `site.delivery`.
- [ ] **"Honey Bee" has no product description.** Their shop shows only the
      substitution clause. The product page says so plainly rather than padding it.
- [ ] **Palette.** Sampled from nothing: their mark is black line art, so the cream,
      ink and green are a choice, not theirs. Swap the six tokens at the top of
      `globals.css` and re-run the auditor if they have brand colours.
- [ ] **"Classic Red Dozen" is on sale** at $75 from $126.95, the only sale in the
      catalog. Confirm that is still intended before it ports over.
- [ ] **Greening proof photos.** The proposal promises "two or three of the rooms
      you already keep green, photographed, with the business's name on it if they
      will let you use it." Those photographs and permissions can only come from the
      owner; the page carries the inquiry form meanwhile.
- [ ] **One edit to their own product copy, for the owner to veto.** Three
      descriptions (Bridget, Helene, Clementine) shipped "grey ceramic". House style
      is American spelling without exception, so they read "gray" here. Everything
      else in `catalog.ts` is verbatim.

## The design system, in one paragraph

`src/app/globals.css` is the whole thing and its header comment carries the reasoning
and the measured contrast figures. Four neutral values and never black; a type scale
that commits to a big display voice and a plain text voice with a tracked micro-label
where a mid-level heading would normally sit; one spacing token, `--u: 8px`; a three
column grid, never four except where a category is exactly four items; hairlines
instead of boxes. The reusable page objects are `.page-head` (every interior page opens
the same way), `.notes` (what the three-tinted-boxes-in-a-row pattern should have
been), `.quiet` (a full-width tinted tier, the rhythm break for pages with no
photograph), `.band` (the same break where there IS one), `.figures`, `.index` and
`.sec-head`. There are four atmosphere photographs and all four are placed: shop-4 the
homepage hero, shop-3 the homepage band, shop-2 greening, shop-1 about.

## Traps, and why things are the way they are

- **A `.sec-head` above a `.notes` draws two rules a few pixels apart.** Use a bare
  `.kicker` when the section head would carry no button.
- **`next start` does not fail loudly when an older instance holds the port.** It logs
  EADDRINUSE and exits, the old server keeps serving the previous build, and the new
  build's stylesheet 500s — so every page screenshots unstyled and looks catastrophic.
  Kill the port (`fuser -k 3111/tcp`), restart, and check the CSS chunk returns 200
  before believing anything a screenshot tells you.

- **Three products are all called "Designer's Choice"**, differing only by price.
  Anything keyed on product name silently merges them and charges the wrong amount.
  Key on slug.
- **Their category badges sum to 66, but there are 57 products.** Nine sit in two
  categories. Nothing is missing.
- **Two different taxonomy terms are both named "Celebration of Life"** — the sympathy
  category and a hidden Plants sub-category. Merging on name folds 8 plants into the
  sympathy list.
- **Slugs do not match names**: Terra Bowl is `terra-bowel`, the 30″ Wind Chime is
  `small-chime-stand`, Harper is `harper-2`, Signature Collection of Chocolates is
  `petite-box-of-chocolates`.
- **Product names use the prime character ″ (U+2033), not a quote.** Preserve the
  encoding or they render as mojibake.
- **The root rewrite is deliberately not host-scoped.** It used to be, the hostname was
  spelled wrong, and `/` quietly served a placeholder to the client with a green build
  and no error anywhere. A rule that fails by serving the wrong page is a bad rule.
- **The wedding form posts to `mailto:`.** It is not a stub pretending to send. A real
  destination and a confirmed inbox are two separate things and neither exists yet.
- **Checkout sends a real order by SMTP, and never pretends when it cannot.** With the
  env unset (or the send failing) the visitor is told plainly that nothing reached the
  shop and handed the phone number and a mailto that opens with everything they typed,
  delivery fields included. The full ticket also goes to the server log on every order,
  sent or not, so nothing is ever only in a failed email.
- **An off-list delivery zip warns and still submits.** ZipCheck's rule: a near miss is
  a phone call, not a wall. The ticket carries a flag line instead.
- **The cart route is 149KB gzip of JavaScript against the 150KB bar** since the
  checkout form landed (was 142.6KB before it; 148KB before the workroom nudged a
  shared chunk). Measured 2026-08-21 with `perf-check.mjs`, LCP 748ms, CLS 0.0006.
  Anything else that wants JS on this route pays for it first. The workroom routes
  measure 145 to 146KB and are internal, but they are inside the bar anyway.
- **The workroom is deliberately NOT linked from the site.** Customers have no
  business finding an order board. Staff bookmark `/workroom`; the PIN is the gate.
- **A web order reaches the board only when its email actually sent.** On the
  unconfigured and send-failed paths the customer was told the order did not go
  through, and a board card for it would be a ghost someone makes flowers for.
  The comment in `api/order/route.ts` carries this.
- **The stem tracker never guesses a dollar figure.** A tossed variety with no
  purchase on record reports "cost unknown"; a product with no recipe reports "no
  recipe" instead of a margin. glaze.md's placeholder rule, applied to arithmetic.
- **The quote's print view filters itself.** Template pieces the conversation never
  reached (price $0) stay off the client document, and each one says "left off the
  print" on screen so nothing disappears silently. The print carries no stem
  counts, markup, or labor split, and only policies the shop has published; a
  drafted "prices hold 30 days" line was cut because their site states no such
  policy. Ask the owner for hers.
- **The quote math lives in one importless file** (`quote-math.ts`) used by the
  list, the builder and the print. Change the model there and nowhere else.

## Before this becomes their site

- [ ] Delete `public/pitch/` and the `rewrites()` block in `next.config.ts`.
- [ ] Delete `src/app/robots.ts` and the `X-Robots-Tag` header, together.
- [ ] Move `src/app/demo/*` to `src/app/` and drop `BASE` in `src/lib/nav.ts`.
- [ ] **Point `CANONICAL_HOST` in `src/lib/seo.ts` at their real domain BEFORE
      lifting the noindex.** It is `devine.glazedweb.com` today. Right now that is
      harmless because every path on this host sends `noindex, nofollow`; the moment
      that comes off, every canonical and every sitemap entry would be advertising a
      copy of their site as the original. Do these two in this order, or not at all.
- [ ] Change the credit line from "Concept build by" to "Double Dipped by" in
      `components/Chrome.tsx`. The plate itself is already the real component with
      the real mark; only the wording is spec-build wording.
- [ ] Re-run `node glaze/scripts/plate.mjs "<footer bg>"` if the footer colour
      changes. `--gw-above` must match `.site-foot` exactly or a seam shows.
- [ ] **Tell the owner the studio credit is in their footer.** `brand.md`: it belongs
      in the contract, not in a surprise deploy.
- [ ] **Create the workroom database** (Vercel > Storage > Create Database > Neon,
      free tier, sets `DATABASE_URL` itself) and set a real `WORKROOM_PIN`. Until
      then the workroom runs on in-memory storage and says so in a warning banner.
- [ ] **Set the five order-intake variables in Vercel** (`.env.example` is the list)
      and point `ORDER_TO` at the shop's inbox. Then place a real order and confirm
      it **arriving in that inbox**, not just returning 200: glaze.md's bar is a real
      destination and a confirmed inbox, two separate things.
- [ ] Ask the owner: delivery fee, order minimum, same-day cutoff. The checkout and
      the ticket currently say the subtotal is settled on the confirm call, which is
      honest but shouldn't be permanent.
- [ ] **Rewrite the wedding model from her real spreadsheet.** She has agreed to
      send it; the provisional markup/labor model and the wedding template are
      stand-ins until it lands. Also ask whether she has a quote-validity policy
      to print.
- [ ] **Reshape the funeral variant around how funerals actually work here.**
      There is no funeral worksheet to copy: she quotes them **on the spot, in
      person, no spreadsheet**. That makes the funeral quote a counter pad, not a
      document pipeline — it needs to be fast enough to use across a desk from a
      family, with print as a same-visit courtesy rather than the point. Watch her
      do one at the meeting before changing it.
- [ ] Wire Stripe hosted Checkout (Phase 1 takes payment on the confirm call, which
      is how the shop already handles phone orders). The cart shape already matches
      what Stripe wants.

## Done, per glaze/launch.md

`launch.md` says this list is "the handover artifact, not a private note" and must be
copied in here as unchecked boxes. It was not, which is why several of these sat
unnoticed. Ticked means measured on the production build, not intended.

### Correctness
- [x] Zero accessibility violations at 390 and 1440 on every route.
- [x] Zero console errors, zero 4xx, on every route.
- [x] `grep -rn PLACEHOLDER` — every hit is on the list above. Two are deliberately
      rendered to the visitor as `.notice` callouts, which is disclosure to a
      prospect rather than leaked scaffolding. No PLACEHOLDER reaches a meta tag.
- [ ] **Every form actually submitted and confirmed arriving in a real inbox.** The
      wedding form is a `mailto:` handoff. There is no inbox to confirm yet.
- [x] Any remote data source verified on the deployment. There is none.
- [x] Every heading, button and body run measured for contrast. Eleven pairings, in
      the `globals.css` header. 0 failures.

### The visitor's experience
- [x] Checked at 320, 390, 768 and 1440.
- [x] Reduced motion produces a complete page. Header verified pixel-identical to
      the static mark; the hero drawing does not start.
- [x] With JavaScript off: nav clicked through to `/demo/shop`, the wedding form
      keeps its `mailto:` action and `post` method, the wordmark is visible with the
      veil parked, and both the petals and the hero drawing are at opacity 0. The
      un-animated state is the finished state. **Note the harness trap:** a first
      pass using `waitUntil: "domcontentloaded"` reported the trace visible and the
      wordmark veiled, because the stylesheet had not applied yet. It was measuring
      an unstyled page. Use `load` plus a settle.
- [x] Keyboard: focus visible on every interactive element, skip link first in tab
      order.
- [x] Tap targets: every control measured, none under 24px in either dimension.
      `.btn` keeps its hairline look and grows its hit area with an invisible
      `::after` overlay to ~48px; footer links and nav links got real padding. The
      one prior failure worth naming: the mobile nav was an `overflow-x: auto`
      scroller with no affordance, which CLIPPED the last item at 390px and the last
      two at 320px — invisible to the page-level overflow check because the clipping
      happened inside the nav's own box. It wraps now and can neither scroll nor
      clip.
- [x] 404s: a styled not-found inside the demo chrome for dead product links (with
      the shop and the phone as ways out), a styled root one for everything else,
      and the route correctly returns status 404 — the auditor flags it, and a 404
      page that returned 200 would be the actual bug.
- [ ] **LCP under 2.5s and CLS under 0.1 on a throttled mobile profile.** JavaScript
      is under the bar (above). LCP and CLS have not been measured on a throttled
      profile.

### Search and sharing
- [x] Every route has its own title and meta description.
- [x] `og:image` absolute, on an origin that serves it, returns 200 as an image.
- [x] Canonical on every route, self-referential. **Points at the pitch host — see
      the pre-launch list.**
- [x] `LocalBusiness` structured data with hours and address.
- [x] `sitemap.xml` and `robots.txt` present; the host is `noindex` by header and by
      metadata, and crawling is ALLOWED, which is the distinction `link-cards.md`
      draws and this build previously got wrong.

### Security and handover
- [x] HTTPS enforced, 308 to HTTPS, HSTS present, no drop to HTTP.
- [x] `npm audit --omit=dev`: **0 vulnerabilities**, 2026-08-21.
- [x] No secret in the repo, in a commit, or in this file.
- [x] Studio credit placed and the plate ground computed with the script.
- [ ] **The owner told the credit is there.** Not done; it is not their site yet.
- [x] README written.

## Facts not to guess at

Confirmed from their own pages on 2026-08-20:

- Address **800 Industrial Rd, Marshall, MI 49068**, on the corner of Industrial and
  Linden. Third-party listings still say 810; that is a finding, not a correction.
- Phone 269-789-0830. Email is a gmail.com address.
- Hours: Mon to Wed 9 to 4, Thu and Fri 9 to 5:30, Sat 9 to 2, closed Sunday.
- Team: Gayle Scantlen, Becky Moore, Lacey Andrews, Shawna Wilcox. No roles published.
- 57 products, 8 categories, 18 delivery towns, 24 zip codes.
- No wire service. No Teleflora, FTD or BloomNet anywhere on their site, so there is
  nothing to license or strip. Checkout is native WooCommerce.
- Incumbent vendor: Creative Web Designing, Inc. of Coldwater, credited in their footer.

Anything not on this list is unconfirmed. Ask rather than write it down.
