/**
 * WHO TOOK IT: two or three letters (Katy, 2026-10-14). One rule and one
 * message, shared by the phone form, the funeral pad, the wedding builder
 * and the orders route's own check. A plain module, not ui.tsx, because the
 * route is server code and ui.tsx is a client file.
 */
export const isInitials = (s: string) => /^[A-Za-z]{2,3}$/.test(s.trim());
export const INITIALS_ERROR = "Your initials, two or three letters, before it goes on the board.";
/** Letters only, capitals, three at most, as they are typed. */
export const cleanInitials = (s: string) => s.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
