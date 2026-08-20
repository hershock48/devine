import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    ROUTING, and why it is deliberately not clever.

      /      the proposal
      /demo  the concept build, once it exists (says so plainly until then)

    This used to be scoped with `has: [{ type: "host", value: "..." }]`, so that only
    the pitch domain served the proposal. That cost us: the rule said
    "devines.glazedweb.com", the domain attached in Vercel was "devine.glazedweb.com",
    the condition quietly did not match, and / fell through to the placeholder. The app
    was behaving exactly as written, and the URL looked broken to the person we sent it
    to. A rule that fails by silently serving the wrong page is a bad rule.

    So the host condition is gone. There is one destination for /, it does not depend on
    which name the request arrived under, and the .vercel.app URL serves what the custom
    domain serves. Nothing to keep in sync, nothing to typo, no way to land on the
    placeholder by accident.

    /demo is a real route (src/app/demo/page.tsx) rather than a rewrite back into the
    app, because a route that exists is easier to reason about than a rewrite that
    points at another rewrite.

    Still beforeFiles: afterFiles only runs once Next has failed to find a route, and a
    rewrite for / has to win before the router looks.

    Duplicate-content risk on the extra hostname is handled where it belongs, in the
    X-Robots-Tag below and in src/app/robots.ts, both of which apply on every host.

    DELETE this rewrite, and public/pitch/, once DeVine's signs or passes.
  */
  async rewrites() {
    return {
      beforeFiles: [{ source: "/", destination: "/pitch/devine/index.html" }],
    };
  },

  // NOINDEX WHILE THIS IS A PITCH. See the note in src/app/robots.ts.
  // Applies to every host, so the .vercel.app name is covered as well as the custom
  // domain. Remove this and the robots rule together on the day this becomes their site.
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
