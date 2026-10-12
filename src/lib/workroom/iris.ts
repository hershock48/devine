import { createHash } from "node:crypto";
import type { Contact } from "./store";

/**
 * HER OLD SYSTEM'S LISTS, READ AS THEY COME. IRIS exports two reports,
 * "Customer List Report" and "Recipient List Report", as CSV with a header
 * row, a blank line, and a period in every empty cell. Nothing is edited by
 * hand before import; this file knows the quirks so nobody has to:
 *
 *   - "." means empty, in every column.
 *   - Some customer rows carry a dollar amount where the phone should be
 *     (an IRIS column slip, 1,437 of 10,356 rows in the 2026-10-12 export).
 *     Those phones are dropped, the rest of the row is kept.
 *   - State is spelled four ways; the common ones collapse to two letters.
 *   - Zip 2 is the +4 and is ignored; Zip 1 is kept only when it is five digits.
 *   - The same person appears many times (once per order, it seems). Rows
 *     collapse on what identifies them: a customer by phone, else by name
 *     and email; a recipient by name, company and street. The row with
 *     the most filled fields wins.
 *
 * The id is a hash of kind + that key, so loading the same export twice
 * writes the same rows again rather than doubling them.
 */

export type IrisKind = Contact["kind"];

const STATES: Record<string, string> = {
  michigan: "MI", mi: "MI", florida: "FL", fl: "FL", indiana: "IN", in: "IN", california: "CA", ca: "CA",
  ohio: "OH", oh: "OH", illinois: "IL", il: "IL", texas: "TX", tx: "TX", arizona: "AZ", az: "AZ",
  "north carolina": "NC", nc: "NC", georgia: "GA", ga: "GA", tennessee: "TN", tn: "TN", wisconsin: "WI", wi: "WI",
  colorado: "CO", co: "CO", "new york": "NY", ny: "NY", kentucky: "KY", ky: "KY", virginia: "VA", va: "VA",
};

const cell = (v: string | undefined): string => {
  const s = (v ?? "").trim();
  return s === "." ? "" : s;
};

/** ###-###-#### from whatever IRIS held; "" when it is not a phone. */
export function cleanPhone(raw: string): string {
  if (!raw || raw.startsWith("$")) return "";
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return "";
}

function cleanState(raw: string): string {
  const k = raw.trim().toLowerCase();
  if (!k) return "";
  return STATES[k] ?? (raw.trim().length === 2 ? raw.trim().toUpperCase() : raw.trim());
}

const cleanZip = (raw: string): string => (/^\d{5}$/.test(raw.trim()) ? raw.trim() : "");

const titleName = (first: string, last: string) => [first, last].map((s) => s.trim()).filter(Boolean).join(" ");

/** A small CSV reader: quoted fields, doubled quotes, CRLF. The exports
    are simple, but a company name with a comma is not unthinkable. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type IrisReport = {
  kind: IrisKind;
  rows: number;
  contacts: Contact[];
  /** Rows with nothing identifying on them. */
  skipped: number;
  /** Rows folded into another by the identity key. */
  merged: number;
  /** Phones that were not phones (the dollar-amount slip, mostly). */
  badPhones: number;
};

const id = (kind: IrisKind, key: string) => `ct_${createHash("sha1").update(`${kind}|${key}`).digest("hex").slice(0, 20)}`;
const filled = (c: Contact) => [c.name, c.business, c.street, c.town, c.zip, c.phone, c.email].filter(Boolean).length;

/** Which report this is, from its header. Null when it is neither. */
export function detectKind(header: string[]): IrisKind | null {
  const h = header.map((x) => x.trim().toLowerCase());
  if (h.includes("recipient first") || h.includes("recipient company")) return "recipient";
  if (h.includes("first name") && h.includes("primary phone")) return "customer";
  return null;
}

export function parseIris(text: string, now = Date.now()): IrisReport | { error: string } {
  const all = parseCsv(text.replace(/^\uFEFF/, ""));
  const headerAt = all.findIndex((r) => r.filter((c) => c.trim()).length >= 4);
  if (headerAt < 0) return { error: "That file has no header row." };
  const header = all[headerAt].map((h) => h.trim());
  const kind = detectKind(header);
  if (!kind) return { error: "That is not an IRIS customer or recipient list; the columns do not match either report." };
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const c = kind === "customer"
    ? { first: col("First Name"), last: col("Last Name"), biz: col("Business"), street: col("Primary Address"), street2: col("Secondary Address"), city: col("City"), state: col("State"), zip: col("Zip 1"), phone: col("Primary Phone"), email: col("Email") }
    : { first: col("Recipient First"), last: col("Recipient Last"), biz: col("Recipient Company"), street: col("Recipient Primary Address"), street2: col("Recipient Secondary Address"), city: col("City"), state: col("State"), zip: col("Zip 1"), phone: col("Primary Phone"), email: -1 };

  const byId = new Map<string, Contact>();
  let rows = 0, skipped = 0, merged = 0, badPhones = 0;
  for (const r of all.slice(headerAt + 1)) {
    if (!r.some((x) => cell(x))) continue;
    rows++;
    const get = (i: number) => (i >= 0 ? cell(r[i]) : "");
    const person = titleName(get(c.first), get(c.last));
    const business = get(c.biz);
    const rawPhone = get(c.phone);
    const phone = cleanPhone(rawPhone);
    if (rawPhone && !phone) badPhones++;
    const email = /@/.test(get(c.email)) ? get(c.email).toLowerCase() : "";
    const street = get(c.street);
    const contact: Contact = {
      id: "",
      kind,
      source: "iris",
      name: person || business,
      business: person ? business : "",
      street,
      street2: get(c.street2),
      town: get(c.city),
      state: cleanState(get(c.state)),
      zip: cleanZip(get(c.zip)),
      phone,
      email,
      createdAt: now,
    };
    if (!contact.name && !phone && !street) {
      skipped++;
      continue;
    }
    const key = kind === "customer"
      ? phone.replace(/\D/g, "") || `${contact.name}|${email}`.toLowerCase()
      : `${contact.name}|${contact.business}|${street}`.toLowerCase();
    contact.id = id(kind, key);
    const prev = byId.get(contact.id);
    if (prev) {
      merged++;
      if (filled(contact) > filled(prev)) byId.set(contact.id, contact);
    } else byId.set(contact.id, contact);
  }
  return { kind, rows, contacts: [...byId.values()], skipped, merged, badPhones };
}
