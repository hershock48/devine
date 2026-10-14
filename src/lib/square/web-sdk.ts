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

/** The billing contact Square accepts at tokenize time. Postal code is the
    one that moves the needle (AVS); the rest rides along when known. */
export type BillingContact = {
  givenName?: string;
  familyName?: string;
  addressLines?: string[];
  locality?: string;
  /** The state, two letters (Square's name for it). */
  administrativeDistrictLevel1?: string;
  postalCode?: string;
  countryCode?: string;
};

/** Square's verification details, whole: when any are passed the SDK wants
    the charge intent, the amount as a decimal string in major units, the
    currency, and the two initiated flags, not billingContact on its own. */
export type VerificationDetails = {
  intent: "CHARGE" | "STORE";
  amount: string;
  currencyCode: "USD";
  billingContact: BillingContact;
  customerInitiated: boolean;
  sellerKeyedIn: boolean;
};

export type SquareCard = {
  attach: (sel: string | HTMLElement) => Promise<void>;
  tokenize: (details?: VerificationDetails) => Promise<{ status: string; token?: string; errors?: { message?: string }[] }>;
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
