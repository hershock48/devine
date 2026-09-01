"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MemoryWarning, PinGate, money } from "@/components/workroom/ui";

/**
 * THE WEEK, NARRATED. Kevin's critique built this screen, near verbatim:
 * "you put the info in there -- so what. what is the point - where does it
 * go?" The ledgers all feed each other, but every consequence happened
 * silently in another tab, so data entry read as bureaucracy. This screen
 * is the so-what: the florist-native numbers Square's own reports cannot
 * compute (Square sees money; it has never heard of a stem, a recipe, an
 * occasion, or a van), each section naming which ledger feeds it.
 *
 * DERIVED, NEVER STORED. Same stance as Inventory: every figure traces to
 * rows someone typed or sales the register reported, recomputed on each
 * load. Where a number cannot be known (no recipe, no purchase history)
 * it is counted and named, never guessed (glaze.md's placeholder rule,
 * applied to arithmetic).
 *
 * MONEY DOUBLE-COUNT GUARD: board orders paid by card or cash ARE Square
 * sales (linked by workroomOrderId), so revenue sums sales once and adds
 * only hand-marked payments, which never reached Square.
 */

type StemEvent = { id: string; kind: "purchase" | "shrink"; date: string; variety: string; stems: number; cost: number; reason: string };
type Recipe = { slug: string; parts: { variety: string; stems: number }[] };
type OrderPayment = { at: number; method: string; totalCents: number; feeCents: number };
type Order = {
  id: string;
  source: "web" | "phone";
  status: string;
  fulfillment: "delivery" | "pickup";
  date: string;
  occasion: string;
  phone: string;
  email: string;
  lines: { slug: string | null; qty: number }[];
  subtotal: number;
  createdAt: number;
  payment?: OrderPayment | null;
};
type Sale = { id: string; paidAt: string; source: string; totalCents: number; workroomOrderId?: string; lines: { slug: string | null; qty: number }[] };
type Contact = { name: string; phone: string; email: string; createdAt: number };

const phoneKey = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dollars = (c: number) => money(c / 100);

export default function Week({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [events, setEvents] = useState<StemEvent[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [backend, setBackend] = useState("memory");
  const [days, setDays] = useState(7);

  const pull = useCallback(async () => {
    const [s, o] = await Promise.all([
      fetch("/api/workroom/stems", { cache: "no-store" }),
      fetch("/api/workroom/orders", { cache: "no-store" }),
    ]);
    if (s.status === 401 || o.status === 401) {
      setAuthed(false);
      return;
    }
    const sd = await s.json();
    const od = await o.json();
    setEvents(sd.events ?? []);
    setRecipes(sd.recipes ?? []);
    setSales(sd.squareSales ?? []);
    setOrders(od.orders ?? []);
    setContacts(od.contacts ?? []);
    setBackend(sd.backend ?? "memory");
    setAuthed(true);
  }, []);

  useEffect(() => {
    if (!authed) return;
    pull().catch(() => {});
  }, [authed, pull]);

  const windowStart = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return { iso: iso(d), ms: d.getTime() };
  }, [days]);

  const week = useMemo(() => {
    const recipeBySlug = new Map(recipes.map((r) => [r.slug, r]));

    /* ---------------- money ---------------- */
    const salesIn = sales.filter((s) => (s.paidAt || "").slice(0, 10) >= windowStart.iso);
    const counter = salesIn.filter((s) => !s.workroomOrderId);
    const board = salesIn.filter((s) => !!s.workroomOrderId);
    const handMarked = orders.filter(
      (o) => o.payment && o.payment.method === "other" && o.payment.at >= windowStart.ms,
    );
    const takenCents =
      salesIn.reduce((sum, s) => sum + s.totalCents, 0) +
      handMarked.reduce((sum, o) => sum + (o.payment?.totalCents ?? 0), 0);
    const cashCents = salesIn.filter((s) => s.source === "CASH").reduce((sum, s) => sum + s.totalCents, 0);
    const feeCents = orders
      .filter((o) => o.payment && o.payment.at >= windowStart.ms)
      .reduce((sum, o) => sum + (o.payment?.feeCents ?? 0), 0);

    /* ---------------- orders ---------------- */
    const ordersIn = orders.filter((o) => o.createdAt >= windowStart.ms && o.status !== "canceled");
    const web = ordersIn.filter((o) => o.source === "web").length;
    const delivery = ordersIn.filter((o) => o.fulfillment === "delivery").length;
    const occasions = new Map<string, number>();
    for (const o of ordersIn) {
      const k = o.occasion || "not given";
      occasions.set(k, (occasions.get(k) ?? 0) + 1);
    }
    const topOccasions = [...occasions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);

    // Returning: same phone or email as ANY earlier order in the whole
    // history projection, the board's own definition.
    let returning = 0;
    for (const o of ordersIn) {
      const pk = phoneKey(o.phone);
      const ek = o.email.trim().toLowerCase();
      if (contacts.some((c) => c.createdAt < o.createdAt && ((pk && phoneKey(c.phone) === pk) || (ek && c.email.trim().toLowerCase() === ek)))) {
        returning += 1;
      }
    }

    // Lead time: days between the call/click and the date the flowers are
    // wanted. Median, because one September wedding should not bend it.
    const leads = ordersIn
      .map((o) => Math.round((new Date(o.date + "T12:00:00").getTime() - o.createdAt) / 86_400_000))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);
    const leadMedian = leads.length ? leads[Math.floor(leads.length / 2)] : null;

    // Receivables are NOW, not windowed: money owed does not care which
    // week it started being owed in.
    const owed = orders.filter((o) => o.status === "done" && !o.payment);
    const owedCents = owed.reduce((sum, o) => sum + Math.round(o.subtotal * 100), 0);

    /* ---------------- stems ---------------- */
    const eventsIn = events.filter((e) => e.date >= windowStart.iso);
    const bought = eventsIn.filter((e) => e.kind === "purchase");
    const tossed = eventsIn.filter((e) => e.kind === "shrink");
    const boughtStems = bought.reduce((sum, e) => sum + e.stems, 0);
    const boughtCost = bought.reduce((sum, e) => sum + e.cost, 0);
    const tossedStems = tossed.reduce((sum, e) => sum + e.stems, 0);
    const reasons = new Map<string, number>();
    for (const e of tossed) reasons.set(e.reason || "other", (reasons.get(e.reason || "other") ?? 0) + e.stems);
    const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]);

    // Consumed: same two sources and the same linked-sale skip as
    // Inventory, so this page can never disagree with that one.
    let consumedStems = 0;
    let unreciped = 0;
    const consume = (slug: string | null, qty: number) => {
      const r = slug ? recipeBySlug.get(slug) : undefined;
      if (!r) {
        unreciped += 1;
        return;
      }
      for (const part of r.parts) consumedStems += part.stems * qty;
    };
    for (const o of orders) {
      if (o.status !== "made" && o.status !== "out" && o.status !== "done") continue;
      if (o.date < windowStart.iso) continue;
      for (const l of o.lines) consume(l.slug, l.qty);
    }
    for (const s of sales) {
      if (s.workroomOrderId) continue;
      if ((s.paidAt || "").slice(0, 10) < windowStart.iso) continue;
      for (const l of s.lines) consume(l.slug, l.qty);
    }

    return {
      takenCents, counterCount: counter.length, boardCount: board.length, handMarkedCount: handMarked.length,
      cashCents, feeCents,
      ordersCount: ordersIn.length, web, phone: ordersIn.length - web, delivery, pickup: ordersIn.length - delivery,
      topOccasions, returning, leadMedian, owedCount: owed.length, owedCents,
      boughtStems, boughtCost, tossedStems, topReasons, consumedStems, unreciped,
      shrinkPct: boughtStems > 0 ? Math.round((tossedStems / boughtStems) * 100) : null,
    };
  }, [events, recipes, orders, sales, contacts, windowStart]);

  if (!authed) {
    return (
      <>
        <h1>This week</h1>
        <PinGate onAuthed={() => pull().catch(() => {})} />
      </>
    );
  }

  const stat = (label: string, value: string, sub?: string) => (
    <div className="panel" style={{ padding: 16, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 30, fontFamily: "var(--serif)", margin: "4px 0 0" }}>{value}</div>
      {sub && <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );

  const fedBy = (text: string) => (
    <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)" }}>Fed by: {text}</p>
  );

  const grid: React.CSSProperties = { display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(min(210px, 100%), 1fr))" };
  const h2: React.CSSProperties = { fontFamily: "var(--sans)", fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: "34px 0 12px" };

  return (
    <>
      <h1>This week</h1>
      <MemoryWarning backend={backend} />
      <p className="lede" style={{ margin: "4px 0 6px" }}>
        What the ledgers add up to. Every number below is computed from orders, register sales, and
        the stem log; nothing here is typed, estimated, or stored.
      </p>
      <p style={{ margin: "0 0 8px", fontSize: 14.5 }}>
        Looking at the last{" "}
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            style={{
              font: "inherit", border: 0, background: "none", cursor: "pointer", padding: "4px 6px",
              fontWeight: days === d ? 700 : 400, textDecoration: days === d ? "none" : "underline", color: "var(--ink)",
            }}
          >
            {d} days
          </button>
        ))}
      </p>

      <h2 style={h2}>Money</h2>
      <div style={grid}>
        {stat("Taken", dollars(week.takenCents), `${week.counterCount} counter · ${week.boardCount} board · ${week.handMarkedCount} by hand`)}
        {stat("Cash of that", dollars(week.cashCents))}
        {stat("Owed right now", dollars(week.owedCents), week.owedCount ? `${week.owedCount} order${week.owedCount === 1 ? "" : "s"} out the door unpaid` : "nothing outstanding")}
        {stat("Order fees passed on", dollars(week.feeCents), "customer-paid, to the platform")}
      </div>
      {fedBy("the register (through the Square link), cards and cash taken on order tickets, and hand-marked payments. Owed is every finished, unpaid ticket regardless of week.")}

      <h2 style={h2}>Orders</h2>
      <div style={grid}>
        {stat("New orders", String(week.ordersCount), `${week.web} web · ${week.phone} phone`)}
        {stat("Deliveries", String(week.delivery), `${week.pickup} pickups`)}
        {stat("Returning customers", week.ordersCount ? `${Math.round((week.returning / week.ordersCount) * 100)}%` : "–", `${week.returning} of ${week.ordersCount}`)}
        {stat("Lead time", week.leadMedian === null ? "–" : `${week.leadMedian} day${week.leadMedian === 1 ? "" : "s"}`, "order to due date, median")}
      </div>
      {week.topOccasions.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5 }}>
          Occasions: {week.topOccasions.map(([k, n]) => `${k} (${n})`).join(", ")}.
        </p>
      )}
      {fedBy("web checkout and the phone-order pad. Returning means a phone or email seen on any earlier order.")}

      <h2 style={h2}>Stems</h2>
      <div style={grid}>
        {stat("Bought", `${week.boughtStems}`, `stems · ${money(week.boughtCost)} paid`)}
        {stat("Tossed", `${week.tossedStems}`, week.shrinkPct === null ? "no purchases logged to compare against" : `${week.shrinkPct}% of stems bought`)}
        {stat("Made into orders", `${week.consumedStems}`, "stems, via recipes")}
      </div>
      {week.topReasons.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5 }}>
          Why tossed: {week.topReasons.map(([k, n]) => `${k} (${n})`).join(", ")}.
        </p>
      )}
      {week.unreciped > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5, color: "var(--muted)" }}>
          {week.unreciped} sold line{week.unreciped === 1 ? "" : "s"} had no recipe, so their stems could not be
          counted. Recipes live on Stems &amp; shrink.
        </p>
      )}
      {fedBy("the stem log (purchases and shrink) and recipes, consumed by finished orders and item-rung register sales. The dollar detail per variety lives on Stems & shrink.")}

      {week.ordersCount === 0 && week.takenCents === 0 && week.boughtStems === 0 && (
        <p className="lede" style={{ marginTop: 30 }}>
          A quiet {days} days: no orders, no money, no stems logged. Numbers appear here the moment
          the other screens have something to add up.
        </p>
      )}
    </>
  );
}
