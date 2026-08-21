/**
 * One list, two importers: the checkout form renders it, the intake validates
 * against it. It lives alone because lib/intake.ts is marked server-only and
 * CartView is a client component, so neither can import the other.
 */
export const occasions = [
  "Everyday",
  "Birthday",
  "Anniversary",
  "Sympathy or funeral",
  "Hospital",
  "New baby",
  "Just because",
  "Other",
] as const;

export type Occasion = (typeof occasions)[number];
