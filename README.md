# devine

Glazed Web pitch and concept build for **DeVine's Flowers & Botanicals**, Marshall,
Michigan. Read `glaze.md` in the `glazedweb` repo before touching any of this.

Five things live here, on one host:

- **the proposal**, at the root of `devine.glazedweb.com`, with its four owner-facing
  pages beside it: `/agreement` (Exhibit A and the clickwrap acceptance), `/launch`
  (the delivery tracker, lights read live), `/photos` (her product-photo drop) and
  `/test-drive` (eight guided missions on the real system).
- **the concept site**, at `/demo` — a full rebuild of their site, 57 real products,
  a working cart, and a real order intake: checkout posts to `/api/order`, which
  emails a ticket to the shop over SMTP and lands the order on the workroom board.
  Payment is on the confirming call by default; card payment at checkout exists
  (Square, pickup orders only) and renders only while `CHECKOUT_CARDS=on` and the
  shop's Square is connected. Unconfigured, it degrades honestly (see `.env.example`).
- **the workroom**, at `/workroom`, PIN-gated and unlinked from the site: order board,
  dashboard, inventory, weekly order, plants, quotes. Phase 2.
- **the Square link**: catalog out to her register, sales in by webhook, OAuth so her
  account authorizes the Glazed app, and card charges from the board. Phase 3.
- **the research**, in `research/`: her paper price lists, par sheet and delivery fee
  sheet, transcribed from photos with every unreadable cell left blank.

## What is here

| Path | What it is |
|---|---|
| `public/pitch/devine/index.html` | The proposal. One self-contained file, no build step, hand-editable on a phone if a call goes sideways. |
| `public/pitch/devine/og.jpg` | The proposal's link card, 1200x630, 44KB. Rendered from a real page, not assembled by hand. |
| `src/lib/site.ts` | **Every business fact.** Hours, phone, address, delivery towns and zips, the per-zip delivery fees and the two order minimums (from her IRIS sheet, 2026-09-01), the 3% card fee, staff names and roles, policies. One edit fixes any of them everywhere. |
| `src/lib/catalog.ts` | All 57 products with their real names, prices and their own copy. Keyed on slug, never on name. |
| `src/lib/image-manifest.json` | Which products have a real photograph, and its true pixel size. Generated, not hand-written. |
| `src/components/ProductImage.tsx` | Decides photograph or generated art, per product. Nothing above it knows which. |
| `src/lib/seo.ts` | `metadataBase`, the canonical host, and the `LocalBusiness` JSON-LD, all fed from `site.ts`. **`CANONICAL_HOST` is the pitch host today and must become their domain before the noindex comes off.** |
| `src/app/sitemap.ts` | Derived from the nav and the catalog, so adding a product adds a URL. No `lastModified`, deliberately. |
| `src/app/og-card/page.tsx` | The demo's link card as a real route, screenshotted by `tools/og.mjs` into `public/og.jpg`. The photograph fills the frame; the type sits on a paper panel pinned to the iOS-safe centre 630. Not linked, not in the sitemap. |
| `tools/og-products.mjs` | 1200x630 JPEG link cards for every photographed product, plus `src/lib/og-manifest.json`. Re-run when photographs land. Photographed products declare a COMPLETE OpenGraph block (never partial — Next replaces, not merges); Bloom products inherit the site card. |
| `src/components/InquiryForms.tsx` | The wedding inquiry and the greening brief, submitting for real since 2026-09-01: POST to `/api/inquiry`, which emails the shop over the same SMTP as the order tickets, with the same three honest outcomes as checkout. The prefilled `mailto:` survives as the fallback when mail cannot send. `GreeningInquiry.tsx` is now a re-export so the greening page's import keeps working. |
| `src/app/api/inquiry/route.ts` | Where both inquiries land. Goes to `INQUIRY_TO`, defaulting to the shop's own published Gmail because inquiries are her leads, not tickets. A sent wedding inquiry also seeds a draft quote on `/workroom/quotes`, best effort; the email is the record. |
| `src/components/GlazedPlate.tsx`, `GlazedCredit.tsx` | Copied verbatim from `glaze/assets/glazed-credit/`. **Never rebuild these**, and never redraw the mark. |
| `src/lib/order.ts` | `photoFirst()`. Any list that shows only SOME of a category leads with the photographed items; a full category page stays in price order. Becomes a no-op when the last photograph lands. |
| `tools/shots.mjs` | Full-page screenshots at a given width, with the scroll sweep that makes lazy images actually load. |
| `src/components/Bloom.tsx` | The generated botanical print, for products with no photograph yet. Down to six products (see "Where the photographs come from") plus one decorative use on the workshops page. **Delete this file when the last photo lands.** |
| `src/app/demo/**` | The site. Home, shop, 8 category pages, 57 product pages, weddings, sympathy, greening, delivery, workshops, about, cart. |
| `src/lib/intake.ts` | Order intake. Server-side pricing from the catalog (a client-supplied total is a number a customer chose), the shop's plain-text ticket, the customer's copy, and the SMTP send with its three honest states. The long comment at the top says why a failed send is told to the customer rather than swallowed, deliberately diverging from glaze.md's contact-form rule. |
| `src/app/api/order/route.ts` | The one route with a side effect, and two shapes of order since 2026-09-01. UNPAID (the default): the ticket email is the order. 200 sent, 400 bad order, 503 mail unconfigured, 502 send failed, and a sent order also lands on the workroom board. PAID BY CARD (payload carries a Square token, pickup only, behind `CHECKOUT_CARDS`): the charge is the order. Price, charge through the shop's Square with the board id as reference, store the board row already paid, then email; a failed charge returns 402 and nothing persists. The cart is honest about each. |
| `src/app/api/checkout/config/route.ts` | What the public checkout needs to draw a card field: Square application id, location, environment. Unauthenticated on purpose (both ids are public by design) and empty unless `CHECKOUT_CARDS` is literally `on` and Square is connected. |
| `src/lib/occasions.ts` | One list, two importers: the form renders it, the intake validates against it. Alone because `intake.ts` is server-only and `CartView` is a client component. |
| `src/lib/seasons.ts` | **The seasonal engine.** The demo turns with the calendar on its own: four premade seasons (accent color, hero copy, the homepage's featured six) and the flower holidays highlighted as each approaches (Valentine's, Easter, Mother's Day, Sweetest Day, Thanksgiving, Christmas). Every date is computed, never stored, on the shop's own timezone; the demo tree renders per request so the calendar can never freeze at build time. Seasonal copy and picks are ours, on the checklist for the owner to veto. |
| `src/components/Season.tsx` | The engine's two surfaces: the holiday band under the header, and the footer's preview row (flip the demo through the whole year across a table). Both server components, zero client JavaScript. |
| `src/app/api/season/route.ts` | Sets the preview cookie and bounces back to the page you were on. `?set=winter`, `?set=valentines`, `?set=today` to hand the calendar back the wheel. |
| `.env.example` | The authority on every variable, in five blocks: order intake (five SMTP and address variables, plus `INQUIRY_TO`, `AGREEMENT_TO`, `PHOTO_TO` for the other three inboxes), workroom (`DATABASE_URL`, `WORKROOM_PIN`, `WORKROOM_OWNER_PIN`), Square sandbox credentials, the Glazed platform app (`SQUARE_APP_ID`, `SQUARE_APP_SECRET`, `SQUARE_APP_FEE_CENTS`), and the switches (`CHECKOUT_CARDS`, `SQUARE_ENV`, `SQUARE_VERSION`). Set by Kevin in Vercel; the click paths for Square are written in the file. While this is a pitch, `ORDER_TO` is Glazed's inbox, not the shop's; the flip is an env edit. |
| `src/app/workroom/**` | **The shop's own tool, Phase 2.** Five tabs in `components/workroom/Chrome.tsx`: the order board at `/workroom` (the front door; web orders land on it by themselves, phone orders get written up on it, and each card settles its money by card or cash), the dashboard at `/workroom/dashboard` (owner PIN only; Day / Week / Month / Year, stat tiles with like-for-like comparisons, one chart of register money pulled live from Square's Payments API when the link is up, stem cost of what sold, per-product margins), inventory, weekly order and quotes. The old `/workroom/stems`, `/workroom/week` and `/workroom/orders` addresses redirect. Sits outside `/demo` because it is not part of the customer demo and does not move on launch day. |
| `src/components/workroom/Board.tsx` | The order board, adapted from the pjs kitchen screen at florist pace: buckets on the REQUESTED date, not order age. One button moves an order along a life that differs by fulfillment (delivery: new, confirmed, made, out, done; pickup skips the van). "Confirmed" is the phone call and only the phone call; payment has its own controls. "Returning customer" is derived from order history, never typed. |
| `src/components/workroom/PayControls.tsx`, `src/app/api/workroom/pay/route.ts` | The money corner of an order card: a PAID badge, or "Take card" and "Record cash". Card entry is Square's Web Payments SDK drawing its own iframe, so no card number ever reaches our page or server; the route can only move money INTO the shop's account. Carries the shop's 3% card fee; the 99 cent platform fee rides website orders only. The SDK loads only when someone opens card entry. |
| `src/components/workroom/Dashboard.tsx`, `src/app/api/workroom/summary/route.ts` | The money numbers. Square's own ledger first (her whole register history, including sales that predate the webhook), stored webhook rows as the fallback, and the response says which ledger answered. Windows are computed on the client's clock because serverless runs in UTC and "today" means today in Marshall. Gross, not net: refunds are not subtracted. The summary API 403s a staff cookie. |
| `src/lib/workroom/derive.ts` | The workroom's shared arithmetic, one copy of every rule more than one screen computes, after the 2026-09-01 review caught three screens disagreeing about the same week's tossed dollars. Costing is LOTS, oldest first (a blended average was retracted the same day). Client-safe on purpose. |
| `src/lib/workroom/store.ts` | Two storage backends behind one interface, ported from the pjs kitchen system: Postgres when `DATABASE_URL` is set (Neon free tier via Vercel, tables create themselves), in-memory otherwise — and the pages show a plain warning on memory, because a board that silently misses orders is worse than one that says why. Holds orders, stem events, recipes, varieties, weekly orders, plants, quotes, Square sales and tokens, agreement acceptances and photo submissions, all as jsonb blobs keyed by id. |
| `src/lib/workroom/auth.ts`, `src/app/api/workroom/login/route.ts` | Two PINs and a cookie. A gate, not a vault. `WORKROOM_PIN` opens the working screens; `WORKROOM_OWNER_PIN` (2026-09-02) additionally opens the money: the dashboard and the funeral pad's build-math drawer. **In production an unset PIN closes that tier to everyone**; the shop-phone fallback that used to be committed here survives for `next dev` only. Login is throttled to 10 wrong tries per 10 minutes per IP, because a four-digit space was measured falling in fifteen seconds unthrottled. |
| `src/app/api/workroom/{orders,stems,recipes,quotes,badges}/route.ts` | The board's orders (last 60 days; POST is the counter's phone order), stem events (90 days plus every recipe, computed in the browser), recipes (PUT replaces whole; an empty parts list means "costed at zero, deliberately", no recipe means "not costed yet"), quotes (GET one with the known stem prices so the builder prefills), and the tab badges (answers unauthed with zeros, not 401, so the PIN gate does not spray the console). |
| `src/app/workroom/quotes/**` | **The quote builder** — the owner's sharpest ask ("a model to input flowers and stem count to accurately produce a quote"). Weddings and funerals as separate templates, flowers priced per stem once per quote (prefilled from purchase history), live totals, a wholesale buy list, autosave, and a print view that is the client's copy: same numbers, none of the workings. |
| `src/components/workroom/FuneralPad.tsx` | **A different tool at the same URL**, because funerals are quoted on the spot with no spreadsheet. Price-first menu (one tap per piece per price point), the family's budget as the frame with a live gap, the service treated as a deadline rather than a date, ribbon wording and who each piece is from, and a last button that puts it straight on the board while the family is still standing there. |
| `src/lib/workroom/quote-math.ts` | The quote arithmetic, alone in one file with no imports, so the list, both builders and the print can never disagree. **The model is Katy's own**, rewritten 2026-09-02 from screenshots of her 2026WeddingQuotes sheet and verified against her numbers to the cent: labor is exactly 2/3 of materials (hardgoods included), flat-priced boutonnieres carry no labor, Michigan's 6% tax is on the piece money and not on delivery, and tax is computed on the unrounded sum. Per-stem prices are her RETAIL list, so wedding markup defaults to ×1. Runs BOTH WAYS: forward (stems decide the price) for weddings, reverse (a set price solved back into a flower budget) for the funeral counter and her flat-priced pieces. Still to be checked against the full sheet once she grants access. |
| `src/lib/workroom/quote-templates.ts` | The starting piece lists, one per model. The wedding list is her sheet's own column vocabulary (2026-09-02), with gentle starter quantities and no stems, so nothing here is mistaken for hers. The funeral menu's ranges for vases, easels, casket sprays and urn surrounds are hers, from her texts the same day; the rows she did not name (insert, basket, table piece, boutonniere, corsage) keep the published 2026 industry stand-ins. Every price is editable at the counter. |
| `src/lib/square/client.ts` | **The Square register link, Phase 3's first pipe.** Config and the fetch wrapper. No SDK, four small calls. Sandbox by default: `SQUARE_ENV` must literally say `production` before anything touches the shop's real register. |
| `src/lib/square/oauth.ts`, `src/app/api/square/connect/route.ts`, `src/app/api/square/oauth/callback/route.ts` | **The owner's Square account, connected through the Glazed app.** Two Square accounts are in play and the distinction is the whole design: the SHOP's account owns the register and the money; GLAZED's developer account owns the app she authorizes, and only a token issued through that authorization can carry the platform fee. `GET /api/square/connect` (workroom cookie) sends her browser to Square; the callback checks a state minted with the app secret, stores the grant in Neon (memory storage refuses, and says why) and lands on `/workroom?square=...`. `DELETE` revokes and forgets. With a grant stored, `SQUARE_ACCESS_TOKEN` is no longer consulted. |
| `src/lib/square/payments.ts` | Card charges with the Glazed platform fee riding INSIDE the payment (`app_fee_money`: the customer pays the total, the shop receives it minus processing minus the fee). 99 cents by default, `SQUARE_APP_FEE_CENTS` overrides, 0 disables. Square's two hard rules are enforced here rather than discovered in a 400: fee only on an OAuth token, and never over 60% of a payment, so tiny totals drop the fee rather than fail the sale. Called by checkout and the board's pay route. |
| `src/lib/square/web-sdk.ts`, `src/app/api/workroom/square-web/route.ts` | The Web Payments SDK loader, shared by the checkout and the board's card pane so the script hostname lives in one place: the first version pointed at a host that does not resolve and the card field died on its first live test. The gated route hands the board the ids it needs. |
| `src/lib/square/sync.ts` | Catalog out: all 57 products pushed onto the register, keyed by writing each slug into the variation SKU, so no id mapping is ever stored. Items in her Square catalog that are not ours are counted as strays and never touched. |
| `src/app/api/square/webhook/route.ts` | Sales in. Square posts every payment; completed ones become `square_sales` rows with line items mapped back to catalog slugs by SKU. Signature-verified before parsing, no dev bypass. A sale rung as a custom amount lands with `slug: null`, visibly, because that habit is what starves the inventory numbers. |
| `src/app/api/square/sync/route.ts` | POST runs the catalog push, GET reports integration status. Workroom-gated; the PIN also works as an `x-workroom-pin` header (throttled like login) so setup can be driven by curl. |
| `src/app/api/square/sales/route.ts` | The ingested register sales, raw, for the workroom sales view to come. |
| `src/lib/workroom/inventory-seed.ts` | **Her paper, as data.** The master stem list (~115 varieties with her selling prices, from the laminated lists) and the plant par sheet, transcribed from photos. Occluded values are null, never guessed; seeding is additive and idempotent, so re-seeding cannot overwrite her edits. |
| `src/app/workroom/inventory/**` + `components/workroom/Inventory.tsx` | **The flower ledger, whole, in dependency order.** Five blocks, top to bottom: the STEM LIBRARY (the one namespace: ~115 varieties with her selling prices per stem and per bunch, seeded from the laminated lists; every variety field on this page, the weekly order and the recipes picks from it, and nothing creates a name implicitly, since a typo refused by name beats a phantom "rosesss" beside "rose"), LOG A BUY / LOG A TOSS (the hand ledgers, gated to the library with a one-tap add; a buy takes the invoice total and derives cost per stem, and offers the average paid so far as one tap; the truck never needs this form), IN THE COOLER (on hand = bought − tossed − made over a short window, toss from the row, what the cooler can build per recipe), RECIPES (low and closed: written once, edited rarely; coverage with a worth-writing-first list) and RECENT ENTRIES (the undo). The old week table left this page: the Dashboard owns every windowed figure, and now carries the stem cost of what sold and a per-product margins table. |
| `src/app/workroom/weekly-order/**` + `components/workroom/WeeklyOrderScreen.tsx` | **The Kennicott order, replacing the pen.** Starts each week from last week's lines; "The truck came" turns every line into a purchase in one tap, converting bunches by stems-per-bunch (asked once per variety, remembered, REQUIRED before receive — never guessed). Received orders are closed books: no edit, no delete. |
| `src/app/workroom/plants/**` + `components/workroom/Plants.tsx` | **The plant par sheet.** Walk the shop, type Have, Need derives against the standard number and never gets stored, so it cannot go stale. The order summary is the Need column priced at her wholesale costs. |
| `src/app/api/workroom/{varieties,weekly-orders,plants}/route.ts` | The workroom's list APIs. The master list is the one namespace, and it grows two ways: LEDGER FACTS auto-register (a hand-logged or truck-received purchase happened, so its variety joins the list), while RECIPES only reference it — an unknown variety in a recipe is refused by name, with a one-tap add in the form (retraction of the earlier register-don't-refuse rule, 2026-09-01: a typo was silently becoming a list entry and an uncostable recipe). |
| `next.config.ts` | The root rewrite and the noindex headers. |
| `src/app/robots.ts` | Search engines out, social card scrapers in. |
| `src/lib/agreement.ts`, `src/app/agreement/**`, `src/components/AgreementAccept.tsx`, `src/app/api/agreement/route.ts` | **The DeVine's deal, in one place**, and where it gets signed. The general terms are NOT restated: they are the published Glazed Web Client Agreement, incorporated by reference the way the glazedweb menu-order clickwrap works; the page adds Exhibit A (scope and numbers from `agreement.ts`) and the acceptance. THE EMAIL IS THE RECORD: both parties get a copy with the version string, typed name and server timestamp; the database row is the queryable duplicate. Goes to `AGREEMENT_TO`, never `ORDER_TO`, because that one flips to the shop at launch. The letter in `public/pitch/` repeats the fees in prose and cannot read the constant, so a number change there is by hand, same commit. |
| `src/app/launch/**` | **The launch plan**, the document that starts where the proposal's job ends. Six status lights read live (signed from the acceptance store, build fee and monthly from the studio pay rail's booleans-only endpoint, Square from the real resolution, domain from `LAUNCH_FLAGS=domain`), the fourteen-item list of what only the shop can supply (ticked in code as things arrive; this is the one copy, and the letter points at it), and the build phases each item unblocks. Retires when every light is lit; never becomes a permanent page. |
| `src/lib/photos.ts`, `src/app/photos/**`, `src/components/PhotoDrop.tsx`, `src/app/api/photos/route.ts` | **The owner's photo drop.** The list is DERIVED (catalog minus the image manifest, Designer's Choice excluded by design) so every photo that goes live shrinks the page on the next deploy. Each photo is downscaled in her browser, sent the moment she picks it, emailed to `PHOTO_TO`, and the slug recorded so the checkmark follows her across devices. No PIN: it is for the owner, who has no login, and the throttle keeps abuse boring. |
| `src/app/test-drive/**` | **The test drive**, linked from the proposal header: eight numbered missions she cannot lose, on the real system (real database, real emails, real board). The PINs are deliberately not printed; they travel by text. |
| `tools/ingest-photo.mjs` | One command per photo from the drop to the site: the drop emails each shot as `<slug>.jpg`, so the filename is the match. Writes the two WebP widths, updates the manifest, re-runs `og-products.mjs`. Files whose basename is not a slug are skipped by name, loudly. |
| `tools/process-supplied.py`, `tools/products.json` | The original harvest: Kevin's first batch of photographs matched to products by their WordPress filenames, which the catalog harvest recorded in `products.json`. |
| `src/components/Logo.tsx`, `tools/extract-petal.py` | The mark with a breeze through it. The petal that blows across the header is lifted out of their own logo, not drawn to resemble it. The un-animated state is the finished state. |
| `src/components/HeroTrace.tsx`, `src/lib/hero-trace.json`, `tools/trace-hero.py` | Four blooms traced off the pixels of the summer hero photograph and drawn on, then released. Only arms over the photograph it was traced from (`traced: true` in `seasons.ts`). |
| `tools/motion.mjs`, `tools/filmstrip.mjs` | Sample the logo motion frame by frame and print what it actually does, and a contact sheet of the flight, because every motion bug so far was invisible in the source and obvious in the numbers. |
| `research/*.md` | Her paper, transcribed: the delivery fee sheet (per-zip fees and handwritten minimums, 2026-09-01) and the weekly order and price lists (2026-08-31). Read from angled photos; occluded cells are marked, never guessed; the owner verifies before any number goes live. |
| `.github/workflows/claude-code-review.yml` | Claude reviews every non-draft pull request, inline HIGH and MEDIUM findings plus one summary comment. The other half of the two-agent rule: Codex reviews through its integration, Kevin merges. |

## Where the photographs come from

Their host answers automated image requests with a captcha, so the images could not be
fetched from their site. **Kevin supplied them directly.** They were matched to
products by their original WordPress filenames (`IMG_0688`, `Large-Dish-Garden`), which
the catalog harvest already recorded, so no photo was matched by eye.

`tools/process-supplied.py` did that first conversion: two widths per product, WebP, and
a manifest of real pixel dimensions so nothing reflows as it loads. That batch covered
20 products, the whole Plants category among them.

The rest came from the owner herself, through the photo drop at `/photos`: she taps a
design, picks the shot on her phone, and it is emailed as `<slug>.jpg`. Then
`node tools/ingest-photo.mjs <file-or-folder>` matches by filename, writes both WebP
widths, updates the manifest and regenerates the product link cards. No eyeballing at
either stage, and no code changes.

**51 of 57 products have a photograph.** The six without: the three Designer's Choice
pieces, which are whatever she designs that day and are excluded from the drop list on
purpose, and the three classic wedding pieces (boutonniere, wrist corsage, bridesmaid
bouquet). Those six render a generated botanical print built from the flower names in
their own product copy. It is deliberately an illustration and never passes as a
photograph.

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

Measured against the production build on 2026-08-20, not the dev server. The workroom,
the owner pages, the inquiry POSTs, the card checkout and the 31 later photographs all
landed after these measurements; the numbers below describe the demo as it was then and
have not been re-run since 2026-08-21.

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

- [ ] **6 product photographs.** The three classic wedding pieces, if she has shots of
      them, and the three Designer's Choice, which are optional by definition. `/photos`
      lists what is still open; the Designer's Choice note there is prose, not rows.
- [x] ~~Team roles.~~ Headline roles landed 2026-09-02 from Katy's own printed Team &
      Responsibilities chart, in `site.team`. The about page's PLACEHOLDER notice still
      says no titles were guessed and should come down with the portraits.
- [ ] **Team portraits and bios.** Currently generated art in the team grid. Katy wants
      the portraits retaken, bios added, and herself added as a card; that redesign
      waits for her materials.
- [ ] **Order minimum basis, and the same-day cutoff is settled.** Per-zip delivery
      fees and the two minimums ($45 Marshall, $55 outside) are in `site.ts` from her
      IRIS sheet (confirmed 2026-09-01, transcription caveats in
      `research/delivery-fees.md`). The minimum is enforced against the FLOWERS
      subtotal, fee on top, which is the stricter reading because the sheet does not
      say; her correction can only loosen checkout. The cutoff is `null` on purpose:
      Katy, 2026-09-02, "it's rare we don't accept an order for same day."
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
- [ ] **The seasonal picks and copy, for the owner to veto.** `lib/seasons.ts`
      chooses six featured pieces per season from her own descriptions and writes
      four seasonal hero lines. She knows what actually sells in each season;
      swapping a list is one edit. The fall list is her own homepage six, untouched.
      Spring, summer and winter were each composed to lean on three photographed
      plants back when only 20 of 57 products had photographs; 51 do now, so those
      three lists can be recomposed toward the arrangements.
- [ ] **The four seasonal accents AND ground tints are ours**, chosen to sit
      inside the placeholder palette above. If she supplies brand colors,
      re-derive all of them and re-run the contrast numbers in `globals.css`.
- [ ] **Two seasonal hero photographs, from the owner: spring and winter.** The
      homepage hero is a per-season slot (`HeroPhoto` in `lib/seasons.ts`). Fall
      has its own photograph now (`/img/seasons/fall.webp`, untraced); summer IS the
      default photograph; spring and winter still fall back to it. One photo each
      from her, processed like any product photo, and the site visibly turns four
      times a year. Note HeroTrace only arms over the original photo; a seasonal
      photo needs its own trace or none.

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
- **The wedding form and the greening brief POST to `/api/inquiry`** and email the shop
  over SMTP. They were honest `mailto:` handoffs until 2026-09-01, when Kevin hit the
  seam mid-test ("it should just send"). The prefilled mailto is now the fallback for
  the unconfigured and send-failed states, and the confirmation says where to send
  photos, because no upload endpoint means no size limits and no broken previews.
- **Checkout sends a real order by SMTP, and never pretends when it cannot.** With the
  env unset (or the send failing) the visitor is told plainly that nothing reached the
  shop and handed the phone number and a mailto that opens with everything they typed,
  delivery fields included. The full ticket also goes to the server log on every order,
  sent or not, so nothing is ever only in a failed email.
- **A card-paid order anchors on the charge, not the email.** After a successful Square
  charge the response must be ok even if SMTP hiccups: the money moved, and the board
  row plus the Square sale are the record. Before the charge, nothing persists. Card
  payment is pickup only until the delivery fee question is fully closed, because
  charging a total a fee might later change would be the checkout lying.
- **An off-list delivery zip warns and still submits** on the pay-on-call path.
  ZipCheck's rule: a near miss is a phone call, not a wall. The ticket carries a flag
  line instead. The card path is stricter: a zip must be on the fee sheet and the
  flowers must clear the minimum, or the order falls back to pay-on-call.
- **Env changes need a redeploy to reach the runtime.** Flipping `CHECKOUT_CARDS` or
  any Square variable in Vercel and then testing the live site has bitten three
  times. Redeploy, then test.
- **Two PINs, and an unset one closes its tier to everyone in production.** The staff
  PIN opens the working screens; the owner PIN opens the dashboard and the funeral
  pad's build-math drawer as well. The committed shop-phone fallback is `next dev`
  only. A privacy control that silently stops applying is worse than a dark screen.
- **`SQUARE_APP_SECRET` comes from the app's OAuth page, not its Credentials page.** The
  Credentials page shows an Access Token in the secret's place, and pasting that is
  the trap that cost the first connect attempt a 401 on the token exchange: the
  permission screen works, Allow works, and the exchange dies. Landing on
  `/workroom?square=failed` after a clean-looking flow means check this first.
- **The Web Payments SDK lives at `web.squarecdn.com`**, not squareup.com, which does
  not resolve. `lib/square/web-sdk.ts` is the one place that hostname is written.
- **A sale rung as a custom amount arrives with `slug: null`.** No recipe can decrement
  it. If that is the register habit today, the habit is the first thing the
  integration has to change.
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

- [ ] Delete `public/pitch/` and the `rewrites()` block in `next.config.ts`, and retire
      `/test-drive` with it. `/photos` retires when the list is empty. `/launch` and
      `/agreement` stay until every light on the launch plan is lit, then go the same
      way; neither becomes a permanent page.
- [ ] Set `LAUNCH_FLAGS=domain` in Vercel at cutover so the launch plan's last light
      turns on.
- [ ] Delete `src/app/robots.ts` and the `X-Robots-Tag` header, together.
- [ ] Move `src/app/demo/*` to `src/app/` and drop `BASE` in `src/lib/nav.ts`.
- [ ] **Point `CANONICAL_HOST` in `src/lib/seo.ts` at their real domain BEFORE
      lifting the noindex.** It is `devine.glazedweb.com` today. Right now that is
      harmless because every path on this host sends `noindex, nofollow`; the moment
      that comes off, every canonical and every sitemap entry would be advertising a
      copy of their site as the original. Do these two in this order, or not at all.
- [x] ~~Change the credit line to "Double Dipped by"~~ Done early, on Kevin's
      2026-08-31 ruling retiring "Concept build by" account-wide (brand.md's
      Retired list carries it). The default wording is the wording, spec build
      or not.
- [ ] Re-run `node glaze/scripts/plate.mjs "<footer bg>"` if the footer colour
      changes. `--gw-above` must match `.site-foot` exactly or a seam shows.
- [ ] **Tell the owner the studio credit is in their footer.** `brand.md`: it belongs
      in the contract, not in a surprise deploy.
- [ ] **Set `WORKROOM_PIN` and `WORKROOM_OWNER_PIN` in Vercel. Nothing at `/workroom`
      opens without the first; the dashboard opens for nobody without the second**,
      by design: the old fallback was the shop phone's last four, committed to this
      repo, guarding customer names, phones and addresses. The two must differ. Her
      chosen PINs travel by phone, never by email or webpage (the launch plan's item
      11). Do this before demoing the workroom to anyone, or the PIN screen will
      refuse the demo too.
- [ ] **Create the workroom database** (Vercel > Storage > Create Database > Neon,
      free tier, sets `DATABASE_URL` itself). Until then the workroom runs on
      in-memory storage and says so in a warning banner, and the Square OAuth
      callback refuses to store a grant.
- [ ] **Set the mail variables in Vercel** (`.env.example` is the list): the five for
      order intake, plus `INQUIRY_TO`, `AGREEMENT_TO` and `PHOTO_TO`. At launch
      `ORDER_TO` becomes the shop's inbox and `INQUIRY_TO` comes off (it defaults to
      her published Gmail), while `AGREEMENT_TO` and `PHOTO_TO` keep reaching Glazed.
      Then place a real order and confirm it **arriving in that inbox**, not just
      returning 200: glaze.md's bar is a real destination and a confirmed inbox, two
      separate things.
- [ ] Ask the owner to confirm the delivery minimum's basis (flowers subtotal, fee on
      top, is the stricter reading we chose) and to read the transcribed per-zip fees
      back once. Fee and minimum are otherwise answered; the cutoff is settled as
      none. Then card payment can open to delivery orders too.
- [ ] **Prove the Square loop end to end IN THE SANDBOX** (`.env.example` has the click
      paths for both the sandbox credentials and the Glazed platform app): POST
      `/api/square/sync` and see 57 items appear in the sandbox Dashboard, ring a
      test payment on the sandbox, and see it arrive at `/api/square/sales`, then
      take a sandbox card at the board and at checkout. Production is the OWNER's
      Square account connected through `/api/square/connect` (OAuth, not her
      password; the launch plan's item 3), `SQUARE_ENV=production`, and a fresh
      webhook subscription on the production toggle.
- [ ] **Flip `CHECKOUT_CARDS=on` only after both parties agree in writing**, which is
      what Exhibit A says starts online checkout. Until then the code is there and
      the checkout behaves exactly as Phase 1. Redeploy after flipping.
- [ ] **Ask the owner how the counter is actually rung: catalog items or custom
      amounts.** Custom amounts arrive as `slug: null` sales that no recipe can
      decrement. If that is the register habit today, the habit is the first
      thing the integration has to change, and she should hear that before it
      surprises her in the numbers.
- [ ] **Tap "Load her price lists" and "Load her par sheet" once** (Inventory and
      Plants screens) after the database exists, then have the owner skim the
      seeded prices: they were transcribed from angled photos of her laminated
      lists and par sheet (research/weekly-order-and-price-lists.md), and a few
      unreadable cells are deliberately blank for her to fill.
- [ ] **Ask her the stems-per-bunch counts** for the varieties she buys by the
      bunch. The weekly-order screen asks per variety the first time and
      remembers, so this can also just happen naturally across two truck days.
- [x] ~~Rewrite the wedding model from her real spreadsheet.~~ Done 2026-09-02 from
      screenshots of the Grace tab, verified to the cent. Still open: check it
      against the whole sheet once she grants access rather than screenshots, and
      ask whether she has a quote-validity policy to print.
- [x] ~~Put DeVine's own funeral price points into `FUNERAL_MENU`.~~ Her ranges for
      vases, easels, casket sprays and urn surrounds landed 2026-09-02 from her
      texts. The rows she did not name (insert, basket, table piece, boutonniere,
      corsage) still carry the published 2026 industry stand-ins; ask for those.
- [ ] **Watch her quote one funeral live and correct the pad against it.** What she
      asks first, in what order, what she writes down, what the family walks out
      with. The pad is a researched guess at that motion, not a transcription. Also
      her word on whether the pad's notes get their own block on the order or go
      away (the launch plan's item 9).
- [ ] **Fix the proposal letter's payment paragraph.** `public/pitch/devine/index.html`
      still says online card payment "runs on Stripe's own page at Stripe's published
      rate" and "we take nothing on top". The code is Square, through the shop's own
      account, with the 3% card fee and the 99 cent platform fee shown as one
      Convenience fee line. The letter is static HTML and cannot read the constant,
      so this is a hand edit.

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
- [ ] **Every form actually submitted and confirmed arriving in a real inbox.** Four
      forms send now (order, inquiry, agreement, photo), all to Glazed-side inboxes
      while this is a pitch; the agreement flow has a test acceptance in the store
      from proving it. The shop's own inbox has not been confirmed because `ORDER_TO`
      still points at Glazed and `INQUIRY_TO` is set to a Glazed inbox during build
      sessions.
- [ ] **Any remote data source verified on the deployment.** There are two now: Square
      (sandbox by default; the end-to-end sandbox proof is on the pre-launch list,
      and production waits on the owner's OAuth connect) and the studio pay rail at
      glazedweb.com, which the launch plan reads for its money lights and treats as
      unlit on any failure.
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
- Team: Gayle Scantlen, Becky Moore, Lacey Andrews, Shawna Wilcox. No roles published
  on their site; headline roles came from Katy's own printed chart, 2026-09-02.
- 57 products, 8 categories, 18 delivery towns, 24 zip codes.
- Delivery fees per zip and the two minimums ($45 Marshall, $55 outside), from her
  IRIS zip sheet via Kevin, 2026-09-01. No same-day cutoff exists (Katy, 2026-09-02).
- Wedding quote model: labor is 2/3 of materials, 6% Michigan tax on pieces only,
  50% non-refundable deposit. From her 2026WeddingQuotes sheet, 2026-09-02.
- Funeral ranges: vases $75 to $250ish, easels and casket sprays $150 to $550, urn
  surrounds $125 to $350. From her texts, 2026-09-02.
- No wire service. No Teleflora, FTD or BloomNet anywhere on their site, so there is
  nothing to license or strip. Checkout is native WooCommerce.
- Incumbent vendor: Creative Web Designing, Inc. of Coldwater, credited in their footer.

Anything not on this list is unconfirmed. Ask rather than write it down.
