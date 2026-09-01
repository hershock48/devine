"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MemoryWarning, PinGate, money, todayISO } from "@/components/workroom/ui";

/**
 * THE WEEK, NARRATED. Kevin's critique built this screen, near verbatim:
 * "you put the info in there -- so what. what is the point - where does it
 * go?" The ledgers all feed each other, but every consequence happened
 * silently in another tab, so data entry read as bureaucracy. This screen
 * is the so-what: the florist-native numbers Square's own reports cannot
 * compute (Square sees money; it has never heard of a stem, a recipe, an
 * occasion, or a van), each section naming which ledger feeds it.
 *
 * SECOND PASS, same day, Kevin's five: every tile carries LAST WEEK's
 * number beside this week's, because a figure without a baseline is trivia;
 * tossed stems are PRICED from purchase history, which is her shrink wish
 * ("I wish I had numbers") in its strongest form; Ordered sits beside Taken
 * so a heavy order-taking week with payment at pickup does not read as a
 * dead one; best sellers feed the buying decision; and the window is a
 * MONDAY-TO-SUNDAY week, not a rolling seven days, because the shop thinks
 * in truck weeks and the stems report is already Monday-anchored.
 *
 * DERIVED, NEVER STORED. Every figure traces to rows someone typed or sales
 * the register reported, recomputed on each load. Where a number cannot be
 * known (no recipe, no purchase history) it is counted and named, never
 * guessed (glaze.md's placeholder rule, applied to arithmetic).
 *
 * MONEY DOUBLE-COUNT GUARD: board orders paid by card or cash ARE Square
 * sales (linked by workroomOrderId), so revenue sums sales once and adds
 * only hand-marked payments, which never reached Square.
 */

type StemEvent = { id: string; kind: "purchase" | "shrink"; date: string; variety: string; stems: number; cost: number; reason: string };
type Recipe = { slug: string; parts: { variety: string; stems: number }[] };
type OrderPayment = { at: number; method: string; totalCents: number; feeCents: number };
type OrderLine = { slug: string | null; name: string; qty: number; each: number };
type Order = {
  id: string;
  source: "web" | "phone";
  status: string;
  fulfillment: "delivery" | "pickup";
  date: string;
  occasion: string;
  phone: string;
  email: string;
  lines: OrderLine[];
  subtotal: number;
  createdAt: number;
  payment?: OrderPayment | null;
};
type SaleLine = { slug: string | null; name: string; qty: number; eachCents: number; totalCents: number };
type Sale = { id: string; paidAt: string; source: string; totalCents: number; workroomOrderId?: string; lines: SaleLine[] };
type Contact = { name: string; phone: string; email: string; createdAt: number };

const phoneKey = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length >= 7 ? d.slice(-10) : "";
};

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dollars = (c: number) => money(c / 100);

/** Monday-to-Sunday week containing the date, minus `weeksBack` weeks.
    Same anchoring as the stems report, deliberately: one definition of a
    week across the workroom. */
function weekWindow(weeksBack: number) {
  const d = new Date(todayISO() + "T12:00:00");
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() - day - weeksBack * 7);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const mondayMs = new Date(iso(monday) + "T00:00:00").getTime();
  const endMs = new Date(iso(nextMonday) + "T00:00:00").getTime();
  return { fromISO: iso(monday), toISO: iso(sunday), fromMs: mondayMs, endMs };
}

type Window = ReturnType<typeof weekWindow>;

export default function Week({ initialAuthed }: { initialAuthed: boolean }) {
  const [authed, setAuthed] = useState(initialAuthed);
  const [events, setEvents] = useState<StemEvent[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [backend, setBackend] = useState("memory");
  /** 0 = this week, 1 = last week. The comparison column is always the
      week before whichever is shown. */
  const [weeksBack, setWeeksBack] = useState(0);

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

  const view = useMemo(() => {
    const recipeBySlug = new Map(recipes.map((r) => [r.slug, r]));

    // Cost per stem per variety, from every loaded purchase (90 days), so a
    // toss can be priced even when the buy was a week or two earlier.
    const costAgg = new Map<string, { stems: number; cost: number }>();
    for (const e of events) {
      if (e.kind !== "purchase") continue;
      const c = costAgg.get(e.variety) ?? { stems: 0, cost: 0 };
      c.stems += e.stems;
      c.cost += e.cost;
      costAgg.set(e.variety, c);
    }
    const costPerStem = (variety: string): number | null => {
      const c = costAgg.get(variety);
      return c && c.stems > 0 ? c.cost / c.stems : null;
    };

    const calc = (w: Window) => {
      const inDates = (dateISO: string) => dateISO >= w.fromISO && dateISO <= w.toISO;
      const inMs = (ms: number) => ms >= w.fromMs && ms < w.endMs;

      /* ---------------- money ---------------- */
      const salesIn = sales.filter((s) => inDates((s.paidAt || "").slice(0, 10)));
      const counter = salesIn.filter((s) => !s.workroomOrderId);
      const board = salesIn.filter((s) => !!s.workroomOrderId);
      const handMarked = orders.filter((o) => o.payment && o.payment.method === "other" && inMs(o.payment.at));
      const takenCents =
        salesIn.reduce((sum, s) => sum + s.totalCents, 0) +
        handMarked.reduce((sum, o) => sum + (o.payment?.totalCents ?? 0), 0);
      const cashCents = salesIn.filter((s) => s.source === "CASH").reduce((sum, s) => sum + s.totalCents, 0);
      const feeCents = orders
        .filter((o) => o.payment && inMs(o.payment.at))
        .reduce((sum, o) => sum + (o.payment?.feeCents ?? 0), 0);

      /* ---------------- orders ---------------- */
      const ordersIn = orders.filter((o) => inMs(o.createdAt) && o.status !== "canceled");
      const orderedCents = ordersIn.reduce((sum, o) => sum + Math.round(o.subtotal * 100), 0);
      const web = ordersIn.filter((o) => o.source === "web").length;
      const delivery = ordersIn.filter((o) => o.fulfillment === "delivery").length;
      const occasions = new Map<string, number>();
      for (const o of ordersIn) {
        const k = o.occasion || "not given";
        occasions.set(k, (occasions.get(k) ?? 0) + 1);
      }
      let returning = 0;
      for (const o of ordersIn) {
        const pk = phoneKey(o.phone);
        const ek = o.email.trim().toLowerCase();
        if (contacts.some((c) => c.createdAt < o.createdAt && ((pk && phoneKey(c.phone) === pk) || (ek && c.email.trim().toLowerCase() === ek)))) {
          returning += 1;
        }
      }
      const leads = ordersIn
        .map((o) => Math.round((new Date(o.date + "T12:00:00").getTime() - o.createdAt) / 86_400_000))
        .filter((n) => Number.isFinite(n) && n >= 0)
        .sort((a, b) => a - b);
      const leadMedian = leads.length ? leads[Math.floor(leads.length / 2)] : null;

      /* -------------- best sellers -------------- */
      // What sold: lines on this week's tickets plus item-rung counter
      // sales (linked sales skipped; their lines are the ticket's lines).
      const sold = new Map<string, { qty: number; cents: number }>();
      const add = (name: string, qty: number, cents: number) => {
        const row = sold.get(name) ?? { qty: 0, cents: 0 };
        row.qty += qty;
        row.cents += cents;
        sold.set(name, row);
      };
      for (const o of ordersIn) for (const l of o.lines) add(l.name, l.qty, Math.round(l.each * 100) * l.qty);
      for (const s of counter) for (const l of s.lines) add(l.name, l.qty, l.totalCents);
      const bestSellers = [...sold.entries()]
        .filter(([name]) => name && name !== "(unnamed)" && name !== "Order fee" && name !== "Service fee")
        .sort((a, b) => b[1].cents - a[1].cents)
        .slice(0, 5);

      /* ---------------- stems ---------------- */
      const eventsIn = events.filter((e) => inDates(e.date));
      const bought = eventsIn.filter((e) => e.kind === "purchase");
      const tossed = eventsIn.filter((e) => e.kind === "shrink");
      const boughtStems = bought.reduce((sum, e) => sum + e.stems, 0);
      const boughtCost = bought.reduce((sum, e) => sum + e.cost, 0);
      const tossedStems = tossed.reduce((sum, e) => sum + e.stems, 0);
      let tossedCost = 0;
      let unpricedTossed = 0;
      for (const e of tossed) {
        const per = costPerStem(e.variety);
        if (per === null) unpricedTossed += e.stems;
        else tossedCost += per * e.stems;
      }
      const reasons = new Map<string, number>();
      for (const e of tossed) reasons.set(e.reason || "other", (reasons.get(e.reason || "other") ?? 0) + e.stems);

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
        if (!inDates(o.date)) continue;
        for (const l of o.lines) consume(l.slug, l.qty);
      }
      for (const s of sales) {
        if (s.workroomOrderId) continue;
        if (!inDates((s.paidAt || "").slice(0, 10))) continue;
        for (const l of s.lines) consume(l.slug, l.qty);
      }

      return {
        takenCents, counterCount: counter.length, boardCount: board.length, handMarkedCount: handMarked.length,
        cashCents, feeCents, orderedCents,
        ordersCount: ordersIn.length, web, phone: ordersIn.length - web, delivery, pickup: ordersIn.length - delivery,
        topOccasions: [...occasions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3),
        returning, leadMedian, bestSellers,
        boughtStems, boughtCost, tossedStems, tossedCost, unpricedTossed,
        topReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
        consumedStems, unreciped,
        shrinkPct: boughtStems > 0 ? Math.round((tossedStems / boughtStems) * 100) : null,
      };
    };

    const win = weekWindow(weeksBack);
    const prevWin = weekWindow(weeksBack + 1);
    const now = calc(win);
    const prev = calc(prevWin);

    // Owed is NOW, never windowed: money owed does not care which week it
    // started being owed in, and last week's owed is unknowable from here.
    const owed = orders.filter((o) => o.status === "done" && !o.payment);
    const owedCents = owed.reduce((sum, o) => sum + Math.round(o.subtotal * 100), 0);

    return { win, now, prev, owedCount: owed.length, owedCents };
  }, [events, recipes, orders, sales, contacts, weeksBack]);

  if (!authed) {
    return (
      <>
        <h1>This week</h1>
        <PinGate onAuthed={() => pull().catch(() => {})} />
      </>
    );
  }

  const { win, now, prev } = view;

  const stat = (label: string, value: string, sub?: string, was?: string) => (
    <div className="panel" style={{ padding: 16, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontSize: 30, fontFamily: "var(--serif)", margin: "4px 0 0" }}>{value}</div>
      {sub && <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
      {was && <div style={{ fontSize: 13.5, color: "var(--muted)", marginTop: 2 }}>week before: {was}</div>}
    </div>
  );

  const fedBy = (text: string) => (
    <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--muted)" }}>Fed by: {text}</p>
  );

  const grid: React.CSSProperties = { display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(min(210px, 100%), 1fr))" };
  const h2: React.CSSProperties = { fontFamily: "var(--sans)", fontSize: 15, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)", margin: "34px 0 12px" };

  const quiet = now.ordersCount === 0 && now.takenCents === 0 && now.boughtStems === 0;

  return (
    <>
      <h1>This week</h1>
      <MemoryWarning backend={backend} />
      <p className="lede" style={{ margin: "4px 0 6px" }}>
        What the ledgers add up to, Monday through Sunday. Every number below is computed from
        orders, register sales, and the stem log; nothing here is typed, estimated, or stored.
      </p>
      <p style={{ margin: "0 0 8px", fontSize: 14.5 }}>
        {[0, 1].map((wb) => (
          <button
            key={wb}
            type="button"
            onClick={() => setWeeksBack(wb)}
            style={{
              font: "inherit", border: 0, background: "none", cursor: "pointer", padding: "4px 8px 4px 0",
              fontWeight: weeksBack === wb ? 700 : 400, textDecoration: weeksBack === wb ? "none" : "underline", color: "var(--ink)",
            }}
          >
            {wb === 0 ? "This week" : "Last week"}
          </button>
        ))}
        <span className="muted" style={{ fontSize: 13.5 }}>
          {win.fromISO} to {win.toISO}
        </span>
      </p>

      <h2 style={h2}>Money</h2>
      <div style={grid}>
        {stat("Taken", dollars(now.takenCents), `${now.counterCount} counter · ${now.boardCount} board · ${now.handMarkedCount} by hand`, dollars(prev.takenCents))}
        {stat("Ordered", dollars(now.orderedCents), `${now.ordersCount} ticket${now.ordersCount === 1 ? "" : "s"} written`, dollars(prev.orderedCents))}
        {stat("Cash of the taken", dollars(now.cashCents), undefined, dollars(prev.cashCents))}
        {stat("Owed right now", dollars(view.owedCents), view.owedCount ? `${view.owedCount} order${view.owedCount === 1 ? "" : "s"} out the door unpaid` : "nothing outstanding")}
      </div>
      {now.feeCents + prev.feeCents > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5 }}>
          Order fees passed on to the platform: {dollars(now.feeCents)} (week before {dollars(prev.feeCents)}).
        </p>
      )}
      {fedBy("the register (through the Square link), cards and cash taken on order tickets, and hand-marked payments. Taken is money that moved; Ordered is tickets written, whichever week their money lands. Owed is every finished, unpaid ticket regardless of week.")}

      <h2 style={h2}>Orders</h2>
      <div style={grid}>
        {stat("New orders", String(now.ordersCount), `${now.web} web · ${now.phone} phone`, String(prev.ordersCount))}
        {stat("Deliveries", String(now.delivery), `${now.pickup} pickups`, String(prev.delivery))}
        {stat("Returning customers", now.ordersCount ? `${Math.round((now.returning / now.ordersCount) * 100)}%` : "–", `${now.returning} of ${now.ordersCount}`, prev.ordersCount ? `${Math.round((prev.returning / prev.ordersCount) * 100)}%` : "–")}
        {stat("Lead time", now.leadMedian === null ? "–" : `${now.leadMedian} day${now.leadMedian === 1 ? "" : "s"}`, "order to due date, median", prev.leadMedian === null ? "–" : `${prev.leadMedian}d`)}
      </div>
      {now.topOccasions.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5 }}>
          Occasions: {now.topOccasions.map(([k, n]) => `${k} (${n})`).join(", ")}.
        </p>
      )}
      {now.bestSellers.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5 }}>
          Best sellers: {now.bestSellers.map(([name, r]) => `${name} ×${r.qty} (${dollars(r.cents)})`).join(", ")}.
        </p>
      )}
      {fedBy("web checkout, the phone-order pad, and item-rung counter sales. Returning means a phone or email seen on any earlier order.")}

      <h2 style={h2}>Stems</h2>
      <div style={grid}>
        {stat("Bought", `${now.boughtStems}`, `stems · ${money(now.boughtCost)} paid`, `${prev.boughtStems} · ${money(prev.boughtCost)}`)}
        {stat(
          "Tossed",
          money(now.tossedCost),
          `${now.tossedStems} stems${now.shrinkPct === null ? "" : ` · ${now.shrinkPct}% of stems bought`}`,
          `${money(prev.tossedCost)} · ${prev.tossedStems} stems`,
        )}
        {stat("Made into orders", `${now.consumedStems}`, "stems, via recipes", String(prev.consumedStems))}
      </div>
      {now.topReasons.length > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5 }}>
          Why tossed: {now.topReasons.map(([k, n]) => `${k} (${n})`).join(", ")}.
        </p>
      )}
      {now.unpricedTossed > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5, color: "var(--muted)" }}>
          {now.unpricedTossed} tossed stem{now.unpricedTossed === 1 ? "" : "s"} had no purchase history to
          price {now.unpricedTossed === 1 ? "it" : "them"}; the toss is counted, its dollars are not.
        </p>
      )}
      {now.unreciped > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14.5, color: "var(--muted)" }}>
          {now.unreciped} sold line{now.unreciped === 1 ? "" : "s"} had no recipe, so their stems could not be
          counted. Recipes live on Stems &amp; shrink.
        </p>
      )}
      {fedBy("the stem log (purchases and shrink) and recipes, consumed by finished orders and item-rung register sales. Tossed dollars are priced at each variety's average purchase cost from the last 90 days.")}

      {quiet && (
        <p className="lede" style={{ marginTop: 30 }}>
          A quiet week so far: no orders, no money, no stems logged. Numbers appear here the moment
          the other screens have something to add up.
        </p>
      )}
    </>
  );
}
