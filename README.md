# devine

Glazed Web pitch and concept build for **DeVine's Flowers & Botanicals**, Marshall,
Michigan. Read `glaze.md` in the `glazedweb` repo before touching any of this.

Two things live here:

- **the proposal**, at the root of `devine.glazedweb.com`
- **the concept site**, at `/demo` — a full rebuild of their site, 57 real products,
  a working cart, and a checkout that is honest about being switched off

## What is here

| Path | What it is |
|---|---|
| `public/pitch/devine/index.html` | The proposal. One self-contained file, no build step, hand-editable on a phone if a call goes sideways. |
| `public/pitch/devine/og.jpg` | The proposal's link card, 1200x630, 44KB. Rendered from a real page, not assembled by hand. |
| `src/lib/site.ts` | **Every business fact.** Hours, phone, address, delivery towns, staff, policies. One edit fixes any of them everywhere. |
| `src/lib/catalog.ts` | All 57 products with their real names, prices and their own copy. Keyed on slug, never on name. |
| `src/lib/image-manifest.json` | Which products have a real photograph, and its true pixel size. Generated, not hand-written. |
| `src/components/ProductImage.tsx` | Decides photograph or generated art, per product. Nothing above it knows which. |
| `src/components/Bloom.tsx` | The generated botanical print, for products with no photograph yet. **Delete this file when the last photo lands.** |
| `src/app/demo/**` | The site. Home, shop, 8 category pages, 57 product pages, weddings, sympathy, greening, delivery, workshops, about, cart. |
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
- JavaScript **136KB gzipped** per page, against a 150KB bar.
- Every route has its own title and meta description.

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

## Traps, and why things are the way they are

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
- **Checkout is switched off and says so.** No card, nothing reaching the shop, and the
  email fallback arrives with the order already written into it.

## Before this becomes their site

- [ ] Delete `public/pitch/` and the `rewrites()` block in `next.config.ts`.
- [ ] Delete `src/app/robots.ts` and the `X-Robots-Tag` header, together.
- [ ] Move `src/app/demo/*` to `src/app/` and drop `BASE` in `src/lib/nav.ts`.
- [ ] Point `metadataBase` at `devinesflowersandbotanicals.com`, never the
      `.vercel.app` host.
- [ ] Swap the footer's "Concept build by Glazed Web" for the real credit component in
      `glaze/assets/glazed-credit/`, with the real donut mark.
- [ ] Wire Stripe hosted Checkout. The cart shape already matches what it wants.

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
