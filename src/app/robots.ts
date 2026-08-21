import type { MetadataRoute } from "next";
import { CANONICAL_HOST } from "@/lib/seo";

/**
 * NO SEARCH RESULTS, BUT CRAWLING IS ALLOWED. THOSE ARE DIFFERENT SWITCHES.
 *
 * This host serves a proposal about a real business, written from their own published
 * pages, plus a full copy of their site at /demo. Neither may ever compete with the
 * shop for their own name.
 *
 * THIS FILE USED TO SAY `Disallow: /` FOR EVERYONE, with fourteen social crawlers
 * allowlisted so link previews would still draw. That solved half the problem and
 * quietly kept the other half. link-cards.md, verbatim:
 *
 *   "To keep a build out of the index, use noindex, not Disallow. They are different
 *   switches. robots.txt governs FETCHING; a crawler told not to fetch can never see
 *   the noindex, so a URL discovered from a link elsewhere can still be listed, with
 *   no title and no snippet. Allow crawling and send X-Robots-Tag: noindex plus
 *   robots: { index: false } in the metadata."
 *
 * That is exactly the hole this had. Googlebot was disallowed from fetching, so it
 * could never read the X-Robots-Tag that was being sent to it, and one inbound link
 * would have been enough to list a bare URL for DeVine's name under our domain.
 *
 * So: everyone may crawl. Nobody may index. The noindex is carried twice, in
 * next.config.ts's X-Robots-Tag header on every path and in the metadata robots block
 * in both layouts, and both apply on every host including the .vercel.app one.
 *
 * The happy side effect is that the social allowlist is no longer needed. It existed
 * to buy back link previews from a Disallow that should not have been there.
 *
 * Remove this file, the header, and the metadata robots block TOGETHER on the day this
 * becomes their site. It is on the checklist in the README.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${CANONICAL_HOST}/sitemap.xml`,
  };
}
