import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.STUDIO_BUILD_CHECK === "1" ? ".next-check" : ".next",
  ...(process.env.STUDIO_BUILD_CHECK === "1" ? { experimental: { workerThreads: true, webpackBuildWorker: false, useTypeScriptCli: false, cpus: 2 } } : {}),

  /*
    REDIRECTS, from the cutover (the storefront moved from /demo to the root,
    the pitch pages retired, and the shop's own domain took over).

    Every one is permanent (308), because each old address has one new home
    for good and search engines should move their listing to it.

      /demo and /demo/*   links shared while this was the concept build
      the old site        the WordPress/WooCommerce addresses Google has
                          indexed for the shop today, mapped from the pitch's
                          own survey of that site (verify by crawling the old
                          site once before DNS moves; see the launch to-dos)
      the pitch pages     proposal-era pages that no longer exist here

    Product addresses need no rule: the old /product/<slug>/ and this site's
    /product/<slug> share their slugs, and Next's trailing-slash redirect
    joins them. Category slugs likewise match the old taxonomy.
  */
  async redirects() {
    return [
      { source: "/demo", destination: "/", permanent: true },
      { source: "/demo/:path*", destination: "/:path*", permanent: true },
      { source: "/funeral-arrangements", destination: "/celebration-of-life", permanent: true },
      { source: "/wedding-florists", destination: "/weddings", permanent: true },
      { source: "/devines-flowers-and-botanicals", destination: "/about", permanent: true },
      { source: "/events-in-marshall", destination: "/workshops", permanent: true },
      { source: "/flower-and-plant-delivery", destination: "/delivery", permanent: true },
      { source: "/product-category/:slug", destination: "/shop/:slug", permanent: true },
      { source: "/checkout", destination: "/cart", permanent: true },
      { source: "/my-account", destination: "/", permanent: true },
      { source: "/test-drive", destination: "/", permanent: true },
      { source: "/launch", destination: "/", permanent: true },
      { source: "/agreement", destination: "/", permanent: true },
      { source: "/photos", destination: "/", permanent: true },
    ];
  },

  async headers() {
    return [
      /* Security headers, permanent (2026-09-28 audit found none). Nothing
         here frames the site's own pages, so framing is refused outright;
         Square's card field is an iframe INSIDE our page, which
         frame-ancestors does not govern. No full Content-Security-Policy
         yet: the Square SDK and Next's inline scripts need a nonce setup
         that is its own careful change. HSTS comes from Vercel.

         The pitch-era X-Robots-Tag: noindex header is gone with the pitch:
         this is the shop's site, and search engines should list it. The
         workroom keeps its own noindex in its layout. */
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
