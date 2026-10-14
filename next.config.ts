import type { NextConfig } from "next";

/*
  TWO NAMES, ONE DEPLOYMENT, since launch day (2026-10-14).

    devinesflowersandbotanicals.com   the shop, at the root. Hers.
    devine.glazedweb.com              the proposal at /, and everything else
                                      reachable beside it. Ours.

  Routing by hostname is the thing an earlier note here warned against: a
  host rule that quietly fails serves the wrong page with no error. The
  failure mode is now shaped so a typo cannot hurt the shop. Her domain needs
  NO host rule at all: the shop pages are real routes at the root and serve on
  every hostname. Only the pitch host carries conditions, and if one of them
  ever failed to match, the pitch host would simply show the shop at / too.
  Both hostnames are checked by Host header in the launch test (README).

  /demo is kept as an address, not as a route: the proposal's own links and
  any bookmark from the pitch months say /demo/shop. On her domain those
  REDIRECT to the root address (permanent, so a search engine that ever saw
  one learns the real one); everywhere else they are REWRITTEN, so the
  proposal's links keep working with the pitch host in the bar.

  The pitch host is kept out of search by a host-scoped X-Robots-Tag; her
  domain carries no such header, and every shop page's canonical points at
  her domain (src/lib/seo.ts), so even a crawler that reaches the pitch host
  is told where the real page lives. The workroom and the Glazed pages set
  robots noindex in their own metadata on every host.
*/

const SHOP_HOSTS = ["devinesflowersandbotanicals.com", "www.devinesflowersandbotanicals.com"];
const PITCH_HOST = "devine.glazedweb.com";

const nextConfig: NextConfig = {
  async redirects() {
    return SHOP_HOSTS.flatMap((host) => [
      { source: "/demo", has: [{ type: "host" as const, value: host }], destination: "/", permanent: true },
      { source: "/demo/:path*", has: [{ type: "host" as const, value: host }], destination: "/:path*", permanent: true },
    ]);
  },
  async rewrites() {
    return {
      beforeFiles: [
        // The proposal, on the pitch host only. One self-contained file.
        { source: "/", has: [{ type: "host", value: PITCH_HOST }], destination: "/pitch/devine/index.html" },
        // The old addresses, everywhere the redirect above did not catch them.
        { source: "/demo", destination: "/" },
        { source: "/demo/:path*", destination: "/:path*" },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: PITCH_HOST }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      // Every *.vercel.app name (production aliases and preview builds) is
      // a copy of her site too, and stays out of search the same way.
      {
        source: "/:path*",
        has: [{ type: "host", value: "(?<sub>.*)\\.vercel\\.app" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
