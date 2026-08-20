import type { MetadataRoute } from "next";

/**
 * NO SEARCH ENGINES, BUT YES TO LINK PREVIEWS.
 *
 * This host serves a proposal about a real business, written from their own published
 * pages. Indexing it would put a second copy of DeVine's name and content on the web
 * competing with the shop we are trying to win, and a prospect who finds their own
 * words ranking under somebody else's domain has a fair complaint. So the general rule
 * is "go away", and next.config.ts sends X-Robots-Tag as the belt to these braces.
 *
 * The social crawlers are a different animal and get caught by the same net if you are
 * not careful. Facebook's scraper obeys robots.txt, so a blanket `Disallow: /` means a
 * link pasted into Messenger arrives as a bare URL with no picture and no title. These
 * agents do not index anything into a search result; they fetch one page to draw a
 * card. Letting them through costs none of the protection above and is the difference
 * between a link that sells and a link that looks broken.
 *
 * Remove this file, and the X-Robots-Tag header with it, on the day this becomes their
 * site. It is on the checklist in the README.
 */
const SOCIAL = [
  "facebookexternalhit",
  "facebookcatalog",
  "Facebot",
  "Twitterbot",
  "LinkedInBot",
  "Slackbot",
  "Slackbot-LinkExpanding",
  "WhatsApp",
  "TelegramBot",
  "Discordbot",
  "Applebot",
  "SkypeUriPreview",
  "redditbot",
  "Iframely",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: SOCIAL, allow: "/" },
      { userAgent: "*", disallow: "/" },
    ],
  };
}
