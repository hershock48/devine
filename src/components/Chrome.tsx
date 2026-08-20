import { site, formatHours, addressOneLine } from "@/lib/site";
import { NAV, FOOTER_ONLY, href } from "@/lib/nav";
import { categories } from "@/lib/catalog";
import { CartLink } from "./Cart";
import Logo from "./Logo";

/**
 * Header and footer.
 *
 * Both read every fact from lib/site.ts. The phone number appears in three places on
 * this site and is typed once, which is the whole point of the constants file.
 */

export function Header() {
  return (
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
              <a href={`mailto:${site.email}`}>{site.email}</a>
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

      <div className="wrap base">
        <span>
          &copy; {site.name}. {addressOneLine}.
        </span>
        {/* THE STUDIO CREDIT. glaze/brand.md owns the real component and the real
            donut mark; this is a concept build on a Glazed Web host, so it carries
            the plain wording rather than the client-footer mark. Swap in the real
            credit component from glaze/assets/glazed-credit/ before launch. */}
        <span>Concept build by Glazed Web</span>
      </div>
    </footer>
  );
}
