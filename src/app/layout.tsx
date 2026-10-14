import type { Metadata } from "next";
import { Cormorant_Garamond, Karla } from "next/font/google";
import "./globals.css";

/*
  Fonts are self-hosted at build time by next/font/google, which downloads the files
  and serves them from this origin. That matters beyond speed: glaze.md forbids a
  runtime <link> to a font CDN, because a client site must not depend on somebody
  else's service staying up, staying free, or staying fast.

  Cormorant Garamond for display, Karla for text. A florist reads as a boutique or as
  a supermarket counter almost entirely on type.
*/
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-display",
  display: "swap",
});

const body = Karla({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  // Overridden by every real page: the shop's layout sets its own, the
  // workroom and the Glazed pages set theirs. This is what a bare page
  // (the 404) falls back to.
  title: "DeVine's Flowers & Botanicals",
  description: "A full-service flower and plant shop in Marshall, Michigan.",
  // No noindex here since launch day: the shop's domain is meant to be found.
  // The pitch host (devine.glazedweb.com) stays out of search by a host-scoped
  // X-Robots-Tag header in next.config.ts, and the owner-only pages carry
  // their own robots metadata.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
