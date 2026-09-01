/**
 * Square's Web Payments SDK, loaded once and shared. Two card fields exist
 * now (the workroom's Take-card pane and the public checkout), and a
 * hostname that lives in one place cannot drift in the other: the first
 * version of this loader pointed at squareup.com from memory, a host that
 * does not resolve, and the card field died on its first live test. The
 * documented homes are web.squarecdn.com and its sandbox twin; both
 * answered 200 when checked 2026-09-01.
 *
 * Browser-only by nature; callers are client components.
 */

export type SquareCard = {
  attach: (sel: string | HTMLElement) => Promise<void>;
  tokenize: () => Promise<{ status: string; token?: string; errors?: { message?: string }[] }>;
  destroy: () => Promise<void>;
};

declare global {
  interface Window {
    Square?: {
      payments: (appId: string, locationId: string) => Promise<{ card: () => Promise<SquareCard> }>;
    };
  }
}

export function loadSquareSdk(env: string): Promise<void> {
  if (window.Square) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const src =
      env === "production" ? "https://web.squarecdn.com/v1/square.js" : "https://sandbox.web.squarecdn.com/v1/square.js";
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Square's script did not load.")));
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Square's script did not load."));
    document.head.appendChild(s);
  });
}
