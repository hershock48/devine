import { site, formatHours, addressOneLine } from "@/lib/site";
import { NAV, FOOTER_ONLY, href } from "@/lib/nav";
import { categories } from "@/lib/catalog";
import { CartLink } from "./Cart";
import Logo from "./Logo";
import GlazedPlate from "./GlazedPlate";

/**
 * Header and footer.
 *
 * Both read every fact from lib/site.ts. The phone number appears in three places on
 * this site and is typed once, which is the whole point of the constants file.
 */

export function Header() {
  return (
    <>
    <header className="site-head">
      <div className="wrap bar">
        {/* THE REAL MARK, with the breeze. See components/Logo.tsx: the petal that
            blows off it is lifted out of their own drawing, not drawn to resemble it. */}
        <Logo />

        <nav className="site-nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.path} href={href(n.path)}>
              {n.label}
            </a>
          ))}
        </nav>

        <div className="head-cta">
          {/*
            LIVE INFORMATION, not another menu item. The reference headers put a
            studio's actual state here: what they do, when, for whom. A florist's
            version of that is where they deliver, so this doubles as the route to
            the delivery page that came out of the top nav.
          */}
          <a className="head-info" href={href("/delivery")}>
            <span>Same-day when we can</span>
            <b>Delivery to {site.deliveryTowns.length} towns</b>
          </a>

          {/* A tel: link, because most visitors to a florist are on a phone and the
              single most common action is calling the shop. Their current site
              prints the number as plain text. */}
          <a className="head-info" href={site.phoneHref}>
            <span>Call the shop</span>
            <b>{site.phone}</b>
          </a>

          <CartLink href={href("/cart")} />
        </div>
      </div>

    </header>

    {/*
      THE SAME TWO FACTS, ON PHONES. Below 1020px the labelled head-info
      blocks disappear for width, which quietly hid the delivery promise and
      the tap-to-call number from the one audience the tel: comment above
      says matters most. This strip restores both as a single quiet line.

      In flow BELOW the sticky header, not inside it: the wrapped phone
      header already stands ~104px tall, and a strip that followed the
      visitor would hold a tenth of every screen for a line they need
      once. The footer repeats both facts for anyone mid-page.
    */}
    <div className="head-strip">
      <a href={href("/delivery")}>Same-day to {site.deliveryTowns.length} towns</a>
      <a href={site.phoneHref}>{site.phone}</a>
    </div>
    </>
  );
}

export function Footer() {
  return (
    <footer className="site-foot">
      <div className="wrap cols">
        <div>
          <h4>Visit</h4>
          <ul>
            <li>{site.address.street}</li>
            <li>
              {site.address.city}, {site.address.state} {site.address.zip}
            </li>
            <li style={{ marginTop: 10 }}>
              <a href={site.phoneHref}>{site.phone}</a>
            </li>
            <li>
              {/* The address is wider than a footer column and has no break
                  opportunity, so it painted over the Hours column. min-width: 0
                  on the columns (globals.css, the grouped rule) lets it wrap at
                  all; the <wbr> puts the break before the @ instead of wherever
                  break-word lands mid-word. */}
              <a href={`mailto:${site.email}`}>
                {site.email.split("@")[0]}
                <wbr />@{site.email.split("@")[1]}
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h4>Hours</h4>
          <ul>
            {site.hours.map((h) => (
              <li key={h.day}>
                {h.day}: {formatHours(h)}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4>Shop</h4>
          <ul>
            {categories.map((c) => (
              <li key={c.slug}>
                <a href={href(`/shop/${c.slug}`)}>{c.name}</a>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h4>More</h4>
          <ul>
            {FOOTER_ONLY.map((n) => (
              <li key={n.path}>
                <a href={href(n.path)}>{n.label}</a>
              </li>
            ))}
            <li>
              <a href={href("/about")}>Our shop &amp; team</a>
            </li>
          </ul>
        </div>

        <div>
          <h4>Follow</h4>
          <ul>
            <li>
              <a href={site.social.facebook}>Facebook</a>
            </li>
            <li>
              <a href={site.social.instagram}>Instagram</a>
            </li>
            <li>
              <a href={site.social.pinterest}>Pinterest</a>
            </li>
          </ul>
        </div>
      </div>

      {/* THE CLIENT'S COPYRIGHT STAYS IN THE CLIENT'S BAR. brand.md is explicit
          that sweeping it onto the plate would make the studio's signature the
          last word on their site, which is not what a signature is. */}
      <div className="wrap base">
        <span>
          &copy; {site.name}. {addressOneLine}.
        </span>
      </div>

      {/*
        THE STUDIO CREDIT, the real one.

        This used to be the words "Concept build by Glazed Web" set as plain text
        in the bar above, with a comment saying swap in the real component before
        launch. That comment was the whole bug: brand.md exists because a session
        once reasoned its way to a hand-drawn donut and shipped it to four live
        footers while the real artwork sat in the repo. Plain text is the same
        mistake with the volume turned down — the mark is the signature.

        Last child of <footer> and OUTSIDE the .wrap, so it is full bleed.

        "Double Dipped by", the house default, on Kevin's standing order of
        2026-08-31: "Concept build by" is RETIRED account-wide, spec builds
        included. He had to say it three times before the wording stopped
        coming back, because brand.md used to prescribe it for unsold builds
        and sessions kept obeying the doc over him. The doc is fixed now too.
        Do not reintroduce it here or anywhere.
      */}
      <GlazedPlate line="Double Dipped by" />
    </footer>
  );
}
