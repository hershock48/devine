# devine

Glazed Web pitch repo for **DeVine's Flowers & Botanicals**, Marshall, Michigan.

Right now this repo holds one thing: the proposal. The concept build does not exist
yet. Read `glaze.md` in the `glazedweb` repo before touching any of this.

## What is here

| Path | What it is |
|---|---|
| `public/pitch/devine/index.html` | The proposal. One self-contained file, no build step, hand-editable on a phone if a call goes sideways. |
| `public/pitch/devine/og.jpg` | The proposal's link card, 1200x630, 44KB. Rendered from a real page, not assembled by hand. |
| `public/pitch/devine/icon.png` | Favicon, 256px. |
| `src/app/page.tsx` | Placeholder. On the pitch host this answers `/demo`. **Do not send anyone a `/demo` link until this is a real site.** |
| `next.config.ts` | The host split and the noindex headers. |
| `src/app/robots.ts` | Search engines out, social card scrapers in. |

## Zero to live

1. Import this repo into Vercel. One project per repo; check there is not already a
   duplicate, because several Glazed repos ended up imported twice.
2. Add the domain **`devine.glazedweb.com`** to the project. Add the apex form only.
   Adding `www.` gives you a hostname with no certificate, which fails in the browser
   and has already burned one prospect link.
3. Confirm, by fetching the deployed URL rather than assuming:
   - `https://devine.glazedweb.com/` serves the proposal, not the placeholder.
   - The response carries `X-Robots-Tag: noindex, nofollow`.
   - `https://devine.glazedweb.com/pitch/devine/og.jpg` returns 200 and an image
     content type.
4. Paste the link into Messages **and** into one non-Apple surface, and look at the
   card. Apple's preview is fetched by the sending device, so a card can look right in
   Messages and be empty everywhere else.

The proposal links out to DeVine's own pages and to seven third-party listings. Those
are other people's sites and they change. Re-check the links before sending if this has
been sitting for a while.

## Before this is sent

- [ ] Every audit finding still true. Verified 2026-08-20; see `VERIFICATION.md` in the
      Cowork session output for how each one was checked.
- [ ] The Yelp category claim is **not** in the letter, because Yelp blocks automated
      fetching and it could not be confirmed. Check it on a phone before saying it out loud.
- [ ] Price is a number: $2,000 build, $150/mo. It is.
- [ ] Read it once as the owner rather than as the builder.

## Before this becomes their site

- [ ] Delete `public/pitch/` and the `rewrites()` block in `next.config.ts`.
- [ ] Delete `src/app/robots.ts` and the `X-Robots-Tag` header together.
- [ ] Replace `src/app/page.tsx` and the bare `layout.tsx`.
- [ ] Point `metadataBase` at `devinesflowersandbotanicals.com`, never at the
      `.vercel.app` host.

## Facts not to guess at

Confirmed from their own pages on 2026-08-20:

- Address **800 Industrial Rd, Marshall, MI 49068**. They moved into the old Gathering
  building. Third-party listings still say 810; that is a finding, not a correction to
  make to the letter.
- Phone 269-789-0830. Contact email is currently a gmail.com address.
- Hours: Mon to Wed 9 to 4, Thu and Fri 9 to 5:30, Sat 9 to 2, closed Sunday.
- Designers: Gayle Scantlen, Becky Moore, Lacey Andrews, Shawna Wilcox.
- 66 products across 8 store categories. 18 delivery towns, 24 zip codes.
- 4.8 stars from 70 Google reviews.
- Incumbent vendor: Creative Web Designing, Inc. of Coldwater, credited in their footer.

Anything not on this list is unconfirmed. Ask rather than write it down.
