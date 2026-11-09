"use client";

/** The one thing a server-rendered sheet cannot do for itself: ask the
    browser to print. Left off the paper (.no-print). */
export default function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <button type="button" className="btn btn--solid no-print" onClick={() => window.print()}>
      {label}
    </button>
  );
}
