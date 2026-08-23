/**
 * Page-local derivations for the Product Detail page — rev1 (buy-on-demand).
 *
 * Every number here is computed from the canonical data layer
 * (@/data/products + @/data/decisionEngine) — nothing is hardcoded.
 * Where the spec needs per-day shapes the dataset doesn't store
 * (chat/website order splits, campaign metrics), values are derived
 * deterministically from product fields using the data layer's seeded PRNG,
 * so the page is stable between reloads and works for all 14 products.
 */

import {
  ANCHOR_DATE,
  getProductSeries,
  hasLiveDaily,
  seededRandom,
  type Category,
  type Product,
} from "@/data/products";
import { ALERT_THRESHOLDS, supplierCoverDays } from "@/data/decisionEngine";
import { fmtMoney, fmtMoney2 } from "@/lib/money";

// ─── Formatting helpers ──────────────────────────────────────────────────────

/** Currency-aware money (USD mock / IQD live), 0 decimals. */
export const money = fmtMoney;

/** Two-decimal money (CAC-style); 0 decimals for non-USD live currencies. */
export const money2 = fmtMoney2;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** Format an ISO date string ("2025-12-04") as "Dec 4". */
export function fmtIso(iso: string): string {
  return fmtDate(new Date(`${iso}T00:00:00`));
}

/** Date that is `daysAgo` days before the mock anchor ("today"). */
export function daysAgoDate(daysAgo: number): Date {
  const d = new Date(ANCHOR_DATE);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

/** Whole days between an ISO date and the mock anchor ("today"). */
export function daysSinceIso(iso: string): number {
  return Math.max(
    0,
    Math.round((ANCHOR_DATE.getTime() - new Date(`${iso}T00:00:00`).getTime()) / 86_400_000)
  );
}

function skuSeed(p: Product, salt: number): () => number {
  return seededRandom(p.sku.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), salt));
}

/** Stages where Meta ads are (or should be) running. */
export const ADS_RUNNING_STAGES = ["ads-live", "selling", "supplier-low"] as const;
/** Stages past the ads era — only organic / returned stock sells. */
export const POST_ADS_STAGES = ["organic-only", "selling-returns", "completed"] as const;

export const isAdsRunning = (p: Product): boolean =>
  (ADS_RUNNING_STAGES as readonly string[]).includes(p.stage);
export const isPostAds = (p: Product): boolean =>
  (POST_ADS_STAGES as readonly string[]).includes(p.stage);

// ─── Returned-stock curve (warehouse stock = returned units) ─────────────────

export interface ReturnedStockPoint {
  /** Series day index, 1-based. */
  day: number;
  label: string;
  /** End-of-day returned units on hand (the warehouse stock). */
  stock: number;
  /** Units returned that day. */
  returns: number;
  /** Orders that day (chat + website). */
  orders: number;
  /** Projected returned stock (only set from today onward). */
  proj?: number;
}

export interface ReturnedStockCurve {
  points: ReturnedStockPoint[];
  /** Series day index of "today" (last actual point). */
  todayDay: number;
  /** Days until the returned stock sells out at the 7-day order velocity. */
  sellOutInDays: number | null;
}

/**
 * Returned-stock-over-time with a projection to zero. History comes from the
 * seeded per-product series (ends exactly at `product.returnedStock`). The
 * projection assumes today's 7-day order velocity and no new supplier stock —
 * i.e. "if we stopped buying from the supplier today, this is how fast the
 * returned units sell off."
 */
export function returnedStockCurve(p: Product): ReturnedStockCurve {
  const series = getProductSeries(p.id, 30);
  const points: ReturnedStockPoint[] = series.map((s) => ({
    day: s.day,
    label: s.label,
    stock: s.returnedStock,
    returns: s.returns,
    orders: s.orders,
  }));
  const todayDay = points[points.length - 1]?.day ?? 1;

  // Pin the last actual day to the canonical on-hand value so the chart always
  // agrees with the vitals rail (the seeded series can drift by a few units).
  if (points.length > 0) points[points.length - 1].stock = p.returnedStock;

  const velocity = p.orderVelocity7d;
  const sellOutInDays =
    p.returnedStock > 0 && velocity > 0 ? Math.ceil(p.returnedStock / velocity) : null;

  if (sellOutInDays != null && sellOutInDays <= 30 && points.length > 0) {
    const startStock = p.returnedStock;
    points[points.length - 1].proj = startStock;
    for (let i = 1; i <= sellOutInDays; i++) {
      points.push({
        day: todayDay + i,
        label: fmtDate(daysAgoDate(-i)),
        stock: startStock,
        returns: 0,
        orders: 0,
        proj: Math.max(0, Math.round(startStock * (1 - i / sellOutInDays))),
      });
    }
  }

  return { points, todayDay, sellOutInDays };
}

// ─── Orders vs returns (chat / website split) ────────────────────────────────

export interface OrdersDay {
  day: number;
  label: string;
  chat: number;
  website: number;
  returns: number;
}

/**
 * Daily orders split by channel for the last `days` days.
 * Mock mode: the dataset stores lifetime chat/website totals; the per-day
 * split uses the lifetime share with seeded noise so the two channels sum
 * exactly to the series' orders.
 * Live mode: REAL per-day orders from Odoo buckets — Odoo doesn't tag the
 * channel and per-product daily returns aren't tracked (stock moves are
 * portfolio-level), so everything lands in `chat` and `returns` stays 0;
 * the chart hides those series instead of plotting fakes.
 */
export function ordersDistribution(p: Product, days = 30): OrdersDay[] {
  const series = getProductSeries(p.id, days);
  if (hasLiveDaily()) {
    return series.map((s) => ({
      day: s.day,
      label: s.label,
      chat: s.orders,
      website: 0,
      returns: 0,
    }));
  }
  const rand = skuSeed(p, 53);
  const share = p.totalOrders > 0 ? p.chatOrders / p.totalOrders : 0.6;
  return series.map((s) => {
    const jitter = (rand() - 0.5) * 0.16;
    const chat = Math.min(s.orders, Math.max(0, Math.round(s.orders * (share + jitter))));
    return { day: s.day, label: s.label, chat, website: s.orders - chat, returns: s.returns };
  });
}

// ─── Ad estimates & campaigns ────────────────────────────────────────────────

export interface AdEstimates {
  ctr: number | null;
  cpm: number | null;
  cac: number | null;
  marginPct: number;
}

export function adEstimates(p: Product): AdEstimates {
  const rand = skuSeed(p, 97);
  const marginPct = 42 + Math.round(rand() * 16);
  if (p.adSpend <= 0) return { ctr: null, cpm: null, cac: null, marginPct };
  const ctr = Math.round((1.6 + rand() * 1.6) * 10) / 10;
  const cpm = Math.round((5.5 + rand() * 5.5) * 10) / 10;
  const cac = p.totalOrders > 0 ? Math.round((p.adSpend / p.totalOrders) * 100) / 100 : null;
  return { ctr, cpm, cac, marginPct };
}

const CAMPAIGN_NAMES: Record<Category, [string, string]> = {
  "LED Lighting": ["Cozy Room Glow", "Desk Setup ASMR"],
  "Phone Accessories": ["Daily Carry Hook", "Unbox & Test"],
  "Kitchen Gadgets": ["5-Second Prep", "Kitchen Hack Demo"],
  "Fitness Gear": ["Morning Routine", "Gym Bag Essential"],
  "Wellness Tech": ["Sleep Better Tonight", "Self-Care Sunday"],
  "Pet Accessories": ["Night Walk Safety", "Happy Pup Moments"],
};

export interface Campaign {
  id: string;
  name: string;
  /** Meta campaign objective label. */
  platform: string;
  spend: number;
  roas: number | null;
  ctr: number;
  cpm: number;
  cpc: number;
  /** 7-day spend sparkline. */
  spark: number[];
}

/** Lifetime Meta campaigns for the product (buy-on-demand runs Meta ads only). */
export function getCampaigns(p: Product): Campaign[] {
  if (p.adSpend <= 0) return [];
  const rand = skuSeed(p, 31);
  // Live Odoo categories (e.g. "All") fall back to generic campaign names.
  const [nameA, nameB] = CAMPAIGN_NAMES[p.category] ?? ["Launch Hook", "Evergreen Retarget"];
  const shareA = 0.62 + rand() * 0.1;
  const spendA = Math.round(p.adSpend * shareA);
  const spendB = p.adSpend - spendA;
  const roasA = p.roas == null ? null : Math.round(p.roas * (1.05 + rand() * 0.1) * 100) / 100;
  const roasB = p.roas == null ? null : Math.max(0.4, Math.round(p.roas * (0.76 + rand() * 0.14) * 100) / 100);

  const series = getProductSeries(p.id);
  const sparkBase = series.slice(-7).map((d) => d.adSpend);
  const mk = (share: number, roas: number | null, idx: number): Campaign => {
    const ctr = Math.round((1.8 + rand() * 1.4) * 10) / 10;
    const cpm = Math.round((6 + rand() * 5) * 10) / 10;
    return {
      id: `${p.id}-c${idx}`,
      name: idx === 0 ? nameA : nameB,
      platform: idx === 0 ? "Meta · Prospecting" : "Meta · Retargeting",
      spend: idx === 0 ? spendA : spendB,
      roas,
      ctr,
      cpm,
      cpc: Math.round((cpm / (ctr * 10)) * 100) / 100,
      spark: sparkBase.map((v) => Math.round(v * share)),
    };
  };
  return [mk(shareA, roasA, 0), mk(1 - shareA, roasB, 1)];
}

// ─── Lifecycle timeline (buy-on-demand milestones) ──────────────────────────

export type LifecycleNodeKey =
  | "shared"
  | "created"
  | "first-ad"
  | "first-order"
  | "measurable"
  | "supplier-risk"
  | "ads-stopped"
  | "today"
  | "sell-out";

export interface LifecycleNode {
  key: LifecycleNodeKey;
  /** Lifecycle day (0 = shared by supplier on butiksistem). */
  day: number;
  name: string;
  color: string;
  state: "done" | "current" | "future";
  oneLiner: string;
  detail: string;
  chips: string[];
}

const STAGE_IDX: Record<Product["stage"], number> = {
  shared: 0,
  created: 1,
  "ads-live": 2,
  "no-ads": 2,
  selling: 3,
  "supplier-low": 4,
  "organic-only": 5,
  "selling-returns": 6,
  completed: 7,
};

export function lifecycleNodes(p: Product): LifecycleNode[] {
  /** Lifecycle day of an ISO date (sharedDate = day 0). */
  const dayOf = (iso: string): number =>
    Math.max(
      0,
      Math.round(
        (new Date(`${iso}T00:00:00`).getTime() - new Date(`${p.sharedDate}T00:00:00`).getTime()) /
          86_400_000
      )
    );

  const D = daysSinceIso(p.sharedDate);
  const createdDay = p.odooCreatedDate ? dayOf(p.odooCreatedDate) : 2;
  const adDay = p.firstAdDate ? dayOf(p.firstAdDate) : createdDay + 2;
  const orderDay = p.firstOrderDate ? dayOf(p.firstOrderDate) : adDay + 1;
  const stageIdx = STAGE_IDX[p.stage];
  const cover = supplierCoverDays(p.supplierStock.qty, p.orderVelocity7d);
  const coverDays = Number.isFinite(cover) ? cover : null;

  const nodes: LifecycleNode[] = [];

  // 1 — Shared by supplier.
  nodes.push({
    key: "shared",
    day: 0,
    name: "Shared by supplier",
    color: "#A78BFA",
    state: "done",
    oneLiner: `Listed on butiksistem by ${p.supplier}`,
    detail: `${p.supplier} shared ${p.name} on butiksistem.com${
      p.supplierStock.qty != null
        ? ` with ${p.supplierStock.qty.toLocaleString()} units available at the time`
        : ""
    }. Nothing bought yet — buy-on-demand starts only once orders exist.`,
    chips: [fmtIso(p.sharedDate), p.supplier],
  });

  // 2 — Created in Odoo.
  const created = p.odooCreatedDate != null;
  nodes.push({
    key: "created",
    day: createdDay,
    name: "Created in Odoo",
    color: "#8B7CFF",
    state: created ? "done" : "future",
    oneLiner: created ? "Product page + SKU live in Odoo" : "Not created in Odoo yet",
    detail: created
      ? `Staff created the product in Odoo on ${fmtIso(p.odooCreatedDate!)} — ${createdDay - 0} day${createdDay === 1 ? "" : "s"} after the supplier shared it. Odoo is the single source of truth for orders from here on.`
      : "Next step: create the product in Odoo (page, photos, SKU) so ads and orders can be tracked.",
    chips: created ? [fmtIso(p.odooCreatedDate!)] : ["pending"],
  });

  // 3 — First Meta ad.
  const hasAds = p.firstAdDate != null;
  nodes.push({
    key: "first-ad",
    day: adDay,
    name: "First ad live",
    color: "#45B7F5",
    state: hasAds ? "done" : "future",
    oneLiner: hasAds ? "First Meta campaign live" : "No campaigns yet",
    detail: hasAds
      ? `First Meta campaign went live on ${fmtIso(p.firstAdDate!)} · ${money(p.adSpend)} lifetime spend.`
      : "No ads launched yet — a seeding campaign is the next step after the Odoo listing.",
    chips: hasAds ? [fmtIso(p.firstAdDate!), `${money(p.adSpend)} spend`] : ["pending"],
  });

  // 4 — First order.
  const hasOrders = p.firstOrderDate != null;
  nodes.push({
    key: "first-order",
    day: orderDay,
    name: "First order",
    color: "#3EE6D8",
    state: hasOrders ? "done" : "future",
    oneLiner: hasOrders ? "First order recorded in Odoo" : "Awaiting first order",
    detail: hasOrders
      ? `First order on ${fmtIso(p.firstOrderDate!)} — the first supplier purchase was placed against it (buy-on-demand). Lifetime: ${p.totalOrders.toLocaleString()} orders (${
          hasLiveDaily()
            ? // Odoo doesn't tag channel; show the honest units count.
              `${p.units.toLocaleString()} units`
            : `${p.chatOrders} chat · ${p.websiteOrders} website`
        }).`
      : "No orders recorded yet — ads need time to gather signal.",
    chips: hasOrders
      ? [fmtIso(p.firstOrderDate!), `${p.totalOrders.toLocaleString()} orders`]
      : ["pending"],
  });

  // 5 — 10th delivered: the return rate becomes measurable.
  const measurableDone = p.delivered >= ALERT_THRESHOLDS.DELIVERED_EARLY;
  const ordersPerDay = hasOrders ? p.totalOrders / Math.max(1, D - orderDay) : 0;
  const measurableDay = measurableDone
    ? Math.min(D, orderDay + Math.ceil(ALERT_THRESHOLDS.DELIVERED_EARLY / Math.max(0.2, ordersPerDay)))
    : orderDay + Math.ceil(ALERT_THRESHOLDS.DELIVERED_EARLY / Math.max(0.2, ordersPerDay || 0.8));
  nodes.push({
    key: "measurable",
    day: measurableDay,
    name: "10th delivered",
    color: "#4ADE80",
    state: measurableDone ? "done" : "future",
    oneLiner: measurableDone
      ? `Return rate measurable (n=${p.delivered})`
      : `${p.delivered}/${ALERT_THRESHOLDS.DELIVERED_EARLY} delivered — collecting data`,
    detail: measurableDone
      ? `With ${p.delivered} delivered orders the return rate (${
          p.returnRate != null ? `${p.returnRate.toFixed(1)}%` : "—"
        }) crossed the ${ALERT_THRESHOLDS.DELIVERED_EARLY}-delivered threshold — it can be judged against the ${ALERT_THRESHOLDS.RETURN_RATE_OK}% healthy band.`
      : `Return rate stays "collecting data" until ${ALERT_THRESHOLDS.DELIVERED_EARLY} orders are delivered (currently ${p.delivered}).`,
    chips: measurableDone
      ? [`n=${p.delivered} delivered`, p.returnRate != null ? `${p.returnRate.toFixed(1)}% returns` : "no returns"]
      : [`${p.delivered}/${ALERT_THRESHOLDS.DELIVERED_EARLY}`],
  });

  // 6 — Supplier low / out (only once the product reaches that part of the arc).
  if (stageIdx >= STAGE_IDX["supplier-low"]) {
    const supQty = p.supplierStock.qty;
    const unknown = supQty == null;
    const out = supQty === 0;
    const happened =
      p.stage === "supplier-low"
        ? D // happening now
        : Math.max(orderDay + 1, D - Math.max(2, (p.daysSinceLastOrder ?? 3) + (p.stage === "completed" ? 6 : 2)));
    nodes.push({
      key: "supplier-risk",
      day: happened,
      name: unknown ? "Supplier unknown" : out ? "Supplier out" : "Supplier low",
      color: unknown ? "#93A1B0" : out ? "#FB5D7A" : "#FBBF24",
      state: "done",
      oneLiner: unknown
        ? "butiksistem not connected"
        : out
          ? "butiksistem stock hit 0"
          : `${supQty} units left at supplier`,
      detail: unknown
        ? "Supplier stock level is unknown — butiksistem isn't connected yet, so the low/out point in the lifecycle can't be reconstructed."
        : out
          ? `${p.supplier} ran out of stock on butiksistem (checked ${fmtIso(p.supplierStock.lastChecked ?? p.odooCreatedDate ?? p.sharedDate)}). Ads were stopped — organic orders and returned stock only from here.`
          : `${p.supplier} is down to ${supQty} units${
              coverDays != null ? ` ≈ ${coverDays} days at the current ${p.orderVelocity7d}/day order velocity` : ""
            } (checked ${fmtIso(p.supplierStock.lastChecked ?? p.odooCreatedDate ?? p.sharedDate)}). Prepare to stop ads when it hits 0.`,
      chips: unknown
        ? ["unknown stock"]
        : out
          ? ["0 units", `checked ${fmtIso(p.supplierStock.lastChecked ?? p.odooCreatedDate ?? p.sharedDate)}`]
          : [`${supQty} units`, coverDays != null ? `~${coverDays}d cover` : "no velocity"],
    });

    // 7 — Ads stopped.
    if (isPostAds(p)) {
      nodes.push({
        key: "ads-stopped",
        day: Math.min(D, happened + 1),
        name: "Ads stopped",
        color: "#FB923C",
        state: "done",
        oneLiner: "Switched to organic-only",
        detail: `Meta campaigns paused — orders now come from organic chat + website traffic only. Current velocity: ${p.orderVelocity7d}/day (7-day).`,
        chips: ["organic only", `${p.orderVelocity7d}/day now`],
      });
    } else {
      nodes.push({
        key: "ads-stopped",
        day: coverDays != null ? D + Math.ceil(coverDays) : D + 7,
        name: "Ads stop (est.)",
        color: "#FB923C",
        state: "future",
        oneLiner: "Projected when supplier stock hits 0",
        detail: coverDays != null
          ? `At ${p.orderVelocity7d}/day the supplier's ${p.supplierStock.qty ?? "?"} units cover ~${coverDays} more days. Plan to pause campaigns and switch to organic-only at that point.`
          : "Order velocity is too low to project — pause campaigns when the supplier hits 0.",
        chips: coverDays != null ? [`in ~${Math.ceil(coverDays)}d`] : ["no velocity"],
      });
    }
  }

  // 8 — Today.
  nodes.push({
    key: "today",
    day: D,
    name: "Today",
    color: "#C6F04D",
    state: "current",
    oneLiner: `${p.returnedStock} returned units on hand`,
    detail: `${p.returnedStock} returned units on hand (the warehouse stock) · ${p.orderVelocity7d}/day orders (7-day)${
      p.daysSinceLastOrder != null ? ` · last order ${p.daysSinceLastOrder === 0 ? "today" : `${p.daysSinceLastOrder}d ago`}` : ""
    }.`,
    chips: [`${p.returnedStock} units`, `${p.orderVelocity7d}/day`],
  });

  // 9 — Projected returned-stock sell-out.
  if (p.returnedStock > 0) {
    const sellOutDays =
      p.orderVelocity7d > 0 ? Math.ceil(p.returnedStock / p.orderVelocity7d) : null;
    nodes.push({
      key: "sell-out",
      day: D + Math.min(30, sellOutDays ?? 14),
      name: "Sell-out est.",
      color: "#8A95A1",
      state: "future",
      oneLiner:
        sellOutDays != null
          ? `Returned stock gone in ~${sellOutDays} days`
          : "No order velocity — needs a revival play",
      detail:
        sellOutDays != null
          ? `At ${p.orderVelocity7d}/day the ${p.returnedStock} returned units sell off in ~${sellOutDays} days, ending the lifecycle at zero stock.`
          : `${p.returnedStock} returned units are sitting with no orders in ${p.daysSinceLastOrder ?? "?"} days — run a revival play (re-post, new angle, discount, bundle) to restart sell-through.`,
      chips: [`${p.returnedStock} units left`, sellOutDays != null ? `~${sellOutDays}d` : "stalled"],
    });
  }

  return nodes;
}

// ─── Sync / event log (bottom strip) ─────────────────────────────────────────

export interface SyncEvent {
  key: string;
  label: string;
  dateLabel: string;
  detail: string;
  color: string;
}

/** Dated event log for the bottom strip — real lifecycle dates + sync events. */
export function syncLog(p: Product): SyncEvent[] {
  const events: SyncEvent[] = [
    {
      key: "shared",
      label: "Shared by supplier",
      dateLabel: fmtIso(p.sharedDate),
      detail: `${p.supplier} · butiksistem`,
      color: "#A78BFA",
    },
  ];
  if (p.odooCreatedDate) {
    events.push({
      key: "created",
      label: "Created in Odoo",
      dateLabel: fmtIso(p.odooCreatedDate),
      detail: "listing + SKU live",
      color: "#8B7CFF",
    });
  }
  if (p.firstAdDate) {
    events.push({
      key: "first-ad",
      label: "First Meta campaign",
      dateLabel: fmtIso(p.firstAdDate),
      detail: `${money(p.adSpend)} lifetime spend`,
      color: "#45B7F5",
    });
  }
  if (p.firstOrderDate) {
    events.push({
      key: "first-order",
      label: "First order",
      dateLabel: fmtIso(p.firstOrderDate),
      detail: `${p.totalOrders.toLocaleString()} orders since`,
      color: "#3EE6D8",
    });
  }
  if (p.supplierStock.lastChecked != null) {
    events.push({
      key: "stock-check",
      label: "Supplier stock checked",
      dateLabel: fmtIso(p.supplierStock.lastChecked),
      detail: `${(p.supplierStock.qty ?? 0).toLocaleString()} units · ${p.supplierStock.source}`,
      color: "#FBBF24",
    });
  }
  events.push({
    key: "sync",
    label: "Odoo + Meta sync",
    dateLabel: "Today",
    detail: `${p.orderVelocity7d}/day velocity (7d)`,
    color: "#4ADE80",
  });
  return events;
}
