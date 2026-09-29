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

// The shop's name for anything outside the storefront's own layout (the
// root 404, mostly). The storefront and the workroom set their own.
export const metadata: Metadata = {
  title: "DeVine's Flowers & Botanicals",
  description: "Florist in Marshall, Michigan.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
