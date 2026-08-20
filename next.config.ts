import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    THE HOST SPLIT, per glaze/proposal.md. The pitch host serves the proposal at its
    root and the demo under /demo; DeVine's own domain, if this becomes their site,
    serves the site at its root with no proposal anywhere.

    These MUST be beforeFiles. A plain rewrites() array is afterFiles, which only runs
    once Next has failed to find a page, and src/app/page.tsx already answers /, so the
    root rewrite would silently never fire.

    Host scoping rather than basePath, because basePath is global to a build and would
    bury the real site under /demo the day devinesflowersandbotanicals.com goes live.

    NOTE: the concept build does not exist yet. Until it does, /demo on the pitch host
    resolves to the placeholder in src/app/page.tsx, which says so plainly rather than
    pretending. Do not send anyone a /demo link before that page is a real site.

    DELETE this whole block, and public/pitch/, once DeVine's signs or passes.
  */
  async rewrites() {
    const onPitchHost = [{ type: "host" as const, value: "devine.glazedweb.com" }];
    return {
      beforeFiles: [
        { source: "/", destination: "/pitch/devine/index.html", has: onPitchHost },
        { source: "/demo", destination: "/", has: onPitchHost },
        { source: "/demo/:path*", destination: "/:path*", has: onPitchHost },
      ],
    };
  },

  // NOINDEX WHILE THIS IS A PITCH. See the note in src/app/robots.ts.
  // This covers the pitch host and the .vercel.app host, which proposal.md requires:
  // the .vercel.app host is the same duplicate-content risk and is indexable by default.
  // Remove this and the robots rule together on the day the site becomes theirs.
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
