import type { Metadata } from "next";

/*
  Deliberately bare. The only thing this app serves today is the placeholder at
  /demo; the proposal is a self-contained HTML file in public/pitch/devine/ and
  carries its own <head>, its own stylesheet and its own link card. When the concept
  build lands, this layout becomes the real one: fonts self-hosted via next/font, the
  site header and footer, and the metadataBase pointed at DeVine's own domain.
*/
export const metadata: Metadata = {
  title: "Glazed Web",
  description: "Internal placeholder.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
