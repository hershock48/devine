import type { MetadataRoute } from "next";
import { CANONICAL_HOST } from "@/lib/seo";

/**
 * The shop's own site since cutover: crawl and index the storefront.
 *
 * The workroom and the API are kept out of crawling here, and the workroom
 * also carries noindex in its own layout (robots.txt governs fetching, not
 * listing, so the noindex is what keeps a linked workroom URL out of results;
 * link-cards.md explains the difference). The sitemap line is why this file
 * stays: it is how crawlers find the full product list.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/workroom", "/api/"] }],
    sitemap: `${CANONICAL_HOST}/sitemap.xml`,
  };
}
