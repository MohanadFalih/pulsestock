/**
 * PulseStock canonical mock dataset — rev1 (buy-on-demand model).
 *
 * Business model: products come from Turkish suppliers listed on
 * butiksistem.com. Staff create them in Odoo, run Meta ads, and buy from the
 * supplier ONLY when orders exist (chat orders + Shopify website orders, both
 * entered in Odoo — the single source of truth). Warehouse stock is mostly
 * RETURNED units. When supplier stock runs out, ads stop → organic only →
 * returned-stock sell-off → completed.
 *
 * Same 14 products as v1 (ids pld-001…pld-014, names, thumbnails, suppliers,
 * categories), distributed across all 8 stages:
 *   1 shared · 1 created · 2 ads-live · 3 selling · 2 supplier-low ·
 *   1 organic-only · 2 selling-returns · 2 completed.
 *
 * Conventions:
 *  - Every order triggers exactly one supplier purchase, so
 *    unitsBoughtFromSupplier = delivered + returned for every product.
 *  - `delivered` = orders delivered and kept; `returned` = refusals +
 *    post-delivery returns; returnRate = returned / delivered * 100.
 *  - Dates are ISO strings ("2025-…"); null = hasn't happened yet.
 *  - Currency USD. All time series are deterministic (seeded PRNG).
 *
 * Exports:
 *  - `products`           — the 14-product canonical dataset
 *  - `getProduct(id)`     — lookup helper
 *  - `globalKpis`         — derived portfolio KPIs for the Overview page
 *  - `dailySeries`        — deterministic 30-day orders/revenue/ad/returns series
 *  - `returnTrendSeries`  — 30-day portfolio return-rate series (spike on day 21)
 *  - `sparklines`         — small series for KPI cards
 *  - `getProductSeries()` — seeded per-product daily series (stable across reloads)
 *  - `revenueByCategory()` / `stageCounts()` / `topMovers()` /
 *    `needsAttentionList()` / `attentionReason()` / `getAllAlerts()`
 */

import {
  deriveAlerts,
  returnConfidenceFor,
  returnRateFor,
  topAlertUrgency,
  worstSeverity,
  ALERT_URGENCY,
  STAGE_ORDER,
  type Alert,
  type AlertSeverity,
  type AlertType,
  type ReturnConfidence,
  type Stage,
  type SupplierStock,
} from "./decisionEngine";
import type { AdsHealth, AdsProduct } from "./adsProvider";

export type { Alert, AlertSeverity, AlertType, ReturnConfidence, Stage, SupplierStock };

/**
 * Known mock categories. Live Odoo data can carry any category name
 * (this shop uses "All" for everything), so the type is open-ended.
 */
export type Category =
  | "Phone Accessories"
  | "LED Lighting"
  | "Kitchen Gadgets"
  | "Fitness Gear"
  | "Wellness Tech"
  | "Pet Accessories"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: Category;
  supplier: string;
  stage: Stage;
  /** Public path to the product thumbnail. */
  thumbnail: string;

  // ── Lifecycle dates (ISO strings; null = hasn't happened yet) ──
  /** Supplier shared the product on butiksistem. */
  sharedDate: string;
  /** Staff created the product in Odoo. */
  odooCreatedDate: string | null;
  /** First Meta campaign went live. */
  firstAdDate: string | null;
  /** First order recorded in Odoo. */
  firstOrderDate: string | null;

  // ── Orders (Odoo = single source of truth; channel tag preserved) ──
  chatOrders: number;
  websiteOrders: number;
  /** chatOrders + websiteOrders. Live: distinct confirmed order documents. */
  totalOrders: number;
  /**
   * Units sold (sum of product_uom_qty on confirmed lines). Live: from Odoo;
   * mock: derived as totalOrders (1 unit per order).
   */
  units: number;

  // ── Fulfillment (buy-on-demand) ──
  /** Units bought from the supplier — only ever bought against real orders. */
  unitsBoughtFromSupplier: number;
  /** Orders delivered and kept by the customer. */
  delivered: number;
  /** Units that came back (refusals + post-delivery returns combined). */
  returned: number;

  // ── Returns ──
  /** returned / delivered * 100; null when nothing delivered yet. */
  returnRate: number | null;
  /** Alias of `delivered`, named for the returns domain. */
  deliveredCount: number;
  /** 'insufficient' (<10 delivered) | 'early' (10–19) | 'confident' (20+). */
  returnConfidence: ReturnConfidence;

  // ── Ads ──
  /** Meta ad spend (USD mock / IQD live, overlaid from the Meta ads sync). */
  adSpend: number;
  /** Lifetime revenue (USD mock / IQD live). */
  revenue: number;
  /** revenue / adSpend; null before ads run. */
  roas: number | null;
  /**
   * Health classification from the live Meta ads sync (see
   * src/data/adsProvider.ts); undefined when ads data is offline/unmatched.
   */
  adsHealth?: AdsHealth;
  /** Raw Meta ads metrics for this SKU (USD + health window); undefined when
   *  the ads endpoint is offline or no ad is matched to this SKU. */
  adsMeta?: AdsProduct;

  // ── Supplier + warehouse ──
  supplierStock: SupplierStock;
  /** On-hand units — almost entirely returned units. This IS the warehouse stock. */
  returnedStock: number;

  // ── Velocity / freshness ──
  /** Orders per day, trailing 7 days (chat + website). */
  orderVelocity7d: number;
  /** Days since the last order; null = never ordered. */
  daysSinceLastOrder: number | null;

  // ── Derived ──
  /** Unit price ≈ revenue / totalOrders; null before any order. */
  unitPrice: number | null;
  /** Active alerts from the alert engine, most urgent first. */
  alerts: Alert[];
}

// ─── Product factory (computes all derived fields) ───────────────────────────

type ProductSeed = Omit<
  Product,
  | "totalOrders"
  | "units"
  | "returnRate"
  | "deliveredCount"
  | "returnConfidence"
  | "roas"
  | "unitPrice"
  | "alerts"
> & {
  /** Units sold; defaults to totalOrders (mock: 1 unit per order). */
  units?: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Raw seed shape accepted by `defineProduct` (derived fields computed). */
export type { ProductSeed };

/**
 * Product factory: computes totalOrders / returnRate / returnConfidence /
 * roas / unitPrice and runs the alert engine. Exported for the live-data
 * loader (src/data/liveSync.ts) so live records get identical derivation.
 */
export function defineProduct(seed: ProductSeed): Product {
  const totalOrders = seed.chatOrders + seed.websiteOrders;
  const returnRate = returnRateFor(seed.delivered, seed.returned);
  const returnConfidence = returnConfidenceFor(seed.delivered);
  const roas = seed.adSpend > 0 ? round2(seed.revenue / seed.adSpend) : null;
  const unitPrice = totalOrders > 0 ? round2(seed.revenue / totalOrders) : null;
  const base: Omit<Product, "alerts"> = {
    ...seed,
    totalOrders,
    units: seed.units ?? totalOrders,
    returnRate,
    deliveredCount: seed.delivered,
    returnConfidence,
    roas,
    unitPrice,
  };
  const alerts = deriveAlerts(
    {
      stage: base.stage,
      returnRate: base.returnRate,
      returnConfidence: base.returnConfidence,
      deliveredCount: base.deliveredCount,
      supplierQty: base.supplierStock.qty,
      returnedStock: base.returnedStock,
      orderVelocity7d: base.orderVelocity7d,
      daysSinceLastOrder: base.daysSinceLastOrder,
    },
    base.id
  );
  return { ...base, alerts };
}

/**
 * Re-run the alert engine on an existing product after a post-merge change
 * (liveSync uses this once Meta data lands: stage may flip ads-live → no-ads
 * and the NEEDS_ADS rule needs the Meta verification flag).
 */
export function rederiveAlerts(
  p: Product,
  metaAdsDetected: boolean | null
): Product {
  const alerts = deriveAlerts(
    {
      stage: p.stage,
      returnRate: p.returnRate,
      returnConfidence: p.returnConfidence,
      deliveredCount: p.deliveredCount,
      supplierQty: p.supplierStock.qty,
      returnedStock: p.returnedStock,
      orderVelocity7d: p.orderVelocity7d,
      daysSinceLastOrder: p.daysSinceLastOrder,
      metaAdsDetected,
    },
    p.id
  );
  return { ...p, alerts };
}

// ─── Canonical dataset (rev1) ────────────────────────────────────────────────

export const products: Product[] = [
  defineProduct({
    id: "pld-001", name: "Aero Mag Case", sku: "PLD-001", category: "Phone Accessories",
    supplier: "Shenzhen TechSource", stage: "selling", thumbnail: "/p-aero-mag-case.png",
    sharedDate: "2025-10-20", odooCreatedDate: "2025-10-22",
    firstAdDate: "2025-10-24", firstOrderDate: "2025-10-25",
    chatOrders: 248, websiteOrders: 164,
    unitsBoughtFromSupplier: 412, delivered: 393, returned: 19,
    adSpend: 1240, revenue: 6180,
    supplierStock: { qty: 2400, lastChecked: "2025-12-04", source: "api" },
    returnedStock: 11, orderVelocity7d: 16.5, daysSinceLastOrder: 0,
  }),
  defineProduct({
    id: "pld-002", name: "LumaStrip Pro", sku: "PLD-002", category: "LED Lighting",
    supplier: "BrightLine Co.", stage: "selling", thumbnail: "/p-lumastrip.png",
    sharedDate: "2025-10-08", odooCreatedDate: "2025-10-10",
    firstAdDate: "2025-10-12", firstOrderDate: "2025-10-13",
    chatOrders: 233, websiteOrders: 155,
    unitsBoughtFromSupplier: 388, delivered: 354, returned: 34,
    adSpend: 1980, revenue: 7760,
    supplierStock: { qty: 1100, lastChecked: "2025-12-04", source: "api" },
    returnedStock: 9, orderVelocity7d: 14, daysSinceLastOrder: 0,
  }),
  defineProduct({
    id: "pld-003", name: "SwiftChop Mini", sku: "PLD-003", category: "Kitchen Gadgets",
    supplier: "KitchenPro Supply", stage: "supplier-low", thumbnail: "/p-swiftchop.png",
    sharedDate: "2025-10-01", odooCreatedDate: "2025-10-03",
    firstAdDate: "2025-10-05", firstOrderDate: "2025-10-06",
    chatOrders: 99, websiteOrders: 66,
    unitsBoughtFromSupplier: 165, delivered: 126, returned: 39,
    adSpend: 900, revenue: 2970,
    supplierStock: { qty: 26, lastChecked: "2025-12-05", source: "api" },
    returnedStock: 12, orderVelocity7d: 4, daysSinceLastOrder: 0,
  }),
  defineProduct({
    id: "pld-004", name: "FlexFit Bands", sku: "PLD-004", category: "Fitness Gear",
    supplier: "FitFactory", stage: "selling", thumbnail: "/p-flexfit-bands.png",
    sharedDate: "2025-09-25", odooCreatedDate: "2025-09-27",
    firstAdDate: "2025-09-29", firstOrderDate: "2025-09-30",
    chatOrders: 45, websiteOrders: 75,
    unitsBoughtFromSupplier: 120, delivered: 114, returned: 6,
    adSpend: 150, revenue: 1800,
    supplierStock: { qty: 1500, lastChecked: "2025-12-02", source: "manual" },
    returnedStock: 4, orderVelocity7d: 3.5, daysSinceLastOrder: 0,
  }),
  defineProduct({
    id: "pld-005", name: "DreamWave Headband", sku: "PLD-005", category: "Wellness Tech",
    supplier: "AudioNest", stage: "completed", thumbnail: "/p-dreamwave.png",
    sharedDate: "2025-09-28", odooCreatedDate: "2025-09-30",
    firstAdDate: "2025-10-02", firstOrderDate: "2025-10-03",
    chatOrders: 55, websiteOrders: 40,
    unitsBoughtFromSupplier: 95, delivered: 68, returned: 27,
    adSpend: 1100, revenue: 1900,
    supplierStock: { qty: 0, lastChecked: "2025-11-20", source: "manual" },
    returnedStock: 0, orderVelocity7d: 0, daysSinceLastOrder: 22,
  }),
  defineProduct({
    id: "pld-006", name: "OrbitGalaxy Projector", sku: "PLD-006", category: "LED Lighting",
    supplier: "BrightLine Co.", stage: "ads-live", thumbnail: "/p-orbitgalaxy.png",
    sharedDate: "2025-11-10", odooCreatedDate: "2025-11-12",
    firstAdDate: "2025-11-17", firstOrderDate: "2025-11-18",
    chatOrders: 9, websiteOrders: 8,
    unitsBoughtFromSupplier: 17, delivered: 12, returned: 2,
    adSpend: 480, revenue: 760,
    supplierStock: { qty: 900, lastChecked: "2025-12-05", source: "api" },
    returnedStock: 2, orderVelocity7d: 1.8, daysSinceLastOrder: 0,
  }),
  defineProduct({
    id: "pld-007", name: "TriCharge Pad", sku: "PLD-007", category: "Phone Accessories",
    supplier: "Shenzhen TechSource", stage: "organic-only", thumbnail: "/p-tricharge.png",
    sharedDate: "2025-09-15", odooCreatedDate: "2025-09-17",
    firstAdDate: "2025-09-19", firstOrderDate: "2025-09-20",
    chatOrders: 200, websiteOrders: 60,
    unitsBoughtFromSupplier: 260, delivered: 242, returned: 18,
    adSpend: 1500, revenue: 5200,
    supplierStock: { qty: 0, lastChecked: "2025-12-03", source: "api" },
    returnedStock: 6, orderVelocity7d: 1.5, daysSinceLastOrder: 1,
  }),
  defineProduct({
    id: "pld-008", name: "AlignPro Corrector", sku: "PLD-008", category: "Fitness Gear",
    supplier: "BodyBalance Ltd.", stage: "completed", thumbnail: "/p-alignpro.png",
    sharedDate: "2025-08-20", odooCreatedDate: "2025-08-22",
    firstAdDate: "2025-08-25", firstOrderDate: "2025-08-26",
    chatOrders: 60, websiteOrders: 28,
    unitsBoughtFromSupplier: 88, delivered: 74, returned: 14,
    adSpend: 800, revenue: 1760,
    supplierStock: { qty: 0, lastChecked: "2025-11-15", source: "manual" },
    returnedStock: 0, orderVelocity7d: 0, daysSinceLastOrder: 30,
  }),
  defineProduct({
    id: "pld-009", name: "AvoSlice 3-in-1", sku: "PLD-009", category: "Kitchen Gadgets",
    supplier: "KitchenPro Supply", stage: "selling-returns", thumbnail: "/p-avoslice.png",
    sharedDate: "2025-09-10", odooCreatedDate: "2025-09-12",
    firstAdDate: "2025-09-14", firstOrderDate: "2025-09-15",
    chatOrders: 40, websiteOrders: 20,
    unitsBoughtFromSupplier: 60, delivered: 49, returned: 11,
    adSpend: 620, revenue: 1080,
    supplierStock: { qty: 400, lastChecked: "2025-11-28", source: "manual" },
    returnedStock: 9, orderVelocity7d: 0.3, daysSinceLastOrder: 3,
  }),
  defineProduct({
    id: "pld-010", name: "GlowPup Collar", sku: "PLD-010", category: "Pet Accessories",
    supplier: "BrightLine Co.", stage: "selling-returns", thumbnail: "/p-glowpup.png",
    sharedDate: "2025-08-28", odooCreatedDate: "2025-08-30",
    firstAdDate: "2025-09-02", firstOrderDate: "2025-09-03",
    chatOrders: 30, websiteOrders: 15,
    unitsBoughtFromSupplier: 45, delivered: 33, returned: 12,
    adSpend: 540, revenue: 810,
    supplierStock: { qty: 350, lastChecked: "2025-11-25", source: "manual" },
    returnedStock: 8, orderVelocity7d: 0, daysSinceLastOrder: 11,
  }),
  defineProduct({
    id: "pld-011", name: "SnapLens Kit", sku: "PLD-011", category: "Phone Accessories",
    supplier: "OptiGadget", stage: "shared", thumbnail: "/p-snaplens.png",
    sharedDate: "2025-12-02", odooCreatedDate: null,
    firstAdDate: null, firstOrderDate: null,
    chatOrders: 0, websiteOrders: 0,
    unitsBoughtFromSupplier: 0, delivered: 0, returned: 0,
    adSpend: 0, revenue: 0,
    supplierStock: { qty: 700, lastChecked: "2025-12-02", source: "api" },
    returnedStock: 0, orderVelocity7d: 0, daysSinceLastOrder: null,
  }),
  defineProduct({
    id: "pld-012", name: "HydroGlow Bottle", sku: "PLD-012", category: "Fitness Gear",
    supplier: "AquaTech", stage: "created", thumbnail: "/p-hydroglow.png",
    sharedDate: "2025-11-28", odooCreatedDate: "2025-11-30",
    firstAdDate: null, firstOrderDate: null,
    chatOrders: 0, websiteOrders: 0,
    unitsBoughtFromSupplier: 0, delivered: 0, returned: 0,
    adSpend: 0, revenue: 0,
    supplierStock: { qty: 950, lastChecked: "2025-12-04", source: "api" },
    returnedStock: 0, orderVelocity7d: 0, daysSinceLastOrder: null,
  }),
  defineProduct({
    id: "pld-013", name: "ZenMat Pro", sku: "PLD-013", category: "Wellness Tech",
    supplier: "BodyBalance Ltd.", stage: "ads-live", thumbnail: "/p-zenmat.png",
    sharedDate: "2025-11-18", odooCreatedDate: "2025-11-20",
    firstAdDate: "2025-11-26", firstOrderDate: "2025-11-27",
    chatOrders: 5, websiteOrders: 4,
    unitsBoughtFromSupplier: 9, delivered: 7, returned: 1,
    adSpend: 320, revenue: 270,
    supplierStock: { qty: 500, lastChecked: "2025-12-05", source: "api" },
    returnedStock: 1, orderVelocity7d: 1.2, daysSinceLastOrder: 0,
  }),
  defineProduct({
    id: "pld-014", name: "BlendGo", sku: "PLD-014", category: "Kitchen Gadgets",
    supplier: "KitchenPro Supply", stage: "supplier-low", thumbnail: "/p-blendgo.png",
    sharedDate: "2025-08-05", odooCreatedDate: "2025-08-07",
    firstAdDate: "2025-08-09", firstOrderDate: "2025-08-10",
    chatOrders: 290, websiteOrders: 120,
    unitsBoughtFromSupplier: 410, delivered: 348, returned: 62,
    adSpend: 3900, revenue: 8610,
    supplierStock: { qty: 52, lastChecked: "2025-12-04", source: "manual" },
    returnedStock: 15, orderVelocity7d: 8, daysSinceLastOrder: 0,
  }),
];

export function getProduct(id: string): Product | undefined {
  const key = id.toLowerCase();
  const exact = products.find(
    (p) => p.id === key || p.sku.toLowerCase() === key
  );
  if (exact) return exact;
  // Meta ads are sometimes named with the bare model code ("7073") without
  // the series prefix — resolve to the uniquely matching catalog SKU.
  if (/^\d{3,4}$/.test(key)) {
    const suffix = products.filter((p) =>
      p.sku.toLowerCase().endsWith(`-${key}`)
    );
    if (suffix.length === 1) return suffix[0];
  }
  return undefined;
}

// ─── Derived global KPIs ─────────────────────────────────────────────────────

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export interface GlobalKpis {
  totalProducts: number;
  /** Products whose lifecycle is not over (stage ≠ completed). */
  activeProducts: number;
  totalOrders: number;
  chatOrders: number;
  websiteOrders: number;
  unitsBoughtFromSupplier: number;
  delivered: number;
  returned: number;
  /** Portfolio return rate: returned / delivered * 100. */
  returnRate: number;
  revenue: number;
  adSpend: number;
  blendedRoas: number;
  /** Returned units on hand across all products (the warehouse stock). */
  returnedStockUnits: number;
  /** Estimated value of on-hand returned stock (unit price × units). */
  returnedStockValue: number;
  /** Total active alerts across the portfolio. */
  activeAlerts: number;
  alertCounts: Record<AlertType, number>;
  /** Products with at least one watch/issue/critical alert. */
  needsAttention: number;
}

/** All active alerts across the current dataset (recomputed on live sync). */
let allAlerts: Alert[] = products.flatMap((p) => p.alerts);

/** Compute portfolio KPIs from a product list. */
function computeGlobalKpis(list: Product[]): GlobalKpis {
  const totalDelivered = sum(list.map((p) => p.delivered));
  const totalReturned = sum(list.map((p) => p.returned));
  const totalRevenue = sum(list.map((p) => p.revenue));
  const totalAdSpend = sum(list.map((p) => p.adSpend));
  const alerts = list.flatMap((p) => p.alerts);
  return {
    totalProducts: list.length,
    activeProducts: list.filter((p) => p.stage !== "completed").length,
    totalOrders: sum(list.map((p) => p.totalOrders)),
    chatOrders: sum(list.map((p) => p.chatOrders)),
    websiteOrders: sum(list.map((p) => p.websiteOrders)),
    unitsBoughtFromSupplier: sum(list.map((p) => p.unitsBoughtFromSupplier)),
    delivered: totalDelivered,
    returned: totalReturned,
    returnRate: totalDelivered > 0 ? round2((totalReturned / totalDelivered) * 100) : 0,
    revenue: totalRevenue,
    adSpend: totalAdSpend,
    blendedRoas: totalAdSpend > 0 ? round2(totalRevenue / totalAdSpend) : 0,
    returnedStockUnits: sum(list.map((p) => p.returnedStock)),
    returnedStockValue: sum(
      list.map((p) => (p.unitPrice ?? 0) * p.returnedStock)
    ),
    activeAlerts: alerts.length,
    alertCounts: {
      HIGH_RETURNS: alerts.filter((a) => a.type === "HIGH_RETURNS").length,
      SUPPLIER_LOW: alerts.filter((a) => a.type === "SUPPLIER_LOW").length,
      SUPPLIER_OUT: alerts.filter((a) => a.type === "SUPPLIER_OUT").length,
      SELL_RETURNS: alerts.filter((a) => a.type === "SELL_RETURNS").length,
      STALE_RETURN_STOCK: alerts.filter((a) => a.type === "STALE_RETURN_STOCK").length,
      READY_TO_JUDGE: alerts.filter((a) => a.type === "READY_TO_JUDGE").length,
      COLLECTING_DATA: alerts.filter((a) => a.type === "COLLECTING_DATA").length,
      NEEDS_ADS: alerts.filter((a) => a.type === "NEEDS_ADS").length,
    },
    needsAttention: list.filter((p) =>
      p.alerts.some((a) => a.severity !== "info")
    ).length,
  };
}

/**
 * Portfolio KPIs for the current dataset. Reassigned in place by
 * `applyLiveDataset` when live Odoo data loads (ES module live binding).
 */
export let globalKpis: GlobalKpis = computeGlobalKpis(products);

/**
 * Swap the mock dataset for live products. Mutates the exported `products`
 * array in place (existing importers stay valid), re-anchors "today", clears
 * the per-product series cache, and recomputes all module-level aggregates.
 * Used by src/data/liveSync.ts only.
 */
export function applyLiveDataset(next: Product[], anchor?: Date): void {
  products.length = 0;
  products.push(...next);
  if (anchor) ANCHOR_DATE = anchor;
  productSeriesCache.clear();
  allAlerts = products.flatMap((p) => p.alerts);
  globalKpis = computeGlobalKpis(products);
}

// ─── Deterministic time series ───────────────────────────────────────────────

/**
 * Anchor "today" for the series window: Dec 5, 2025 in mock mode; reassigned
 * to the real sync time by `applyLiveDataset` in live mode (live binding).
 */
export let ANCHOR_DATE = new Date(2025, 11, 5);
export const SERIES_DAYS = 30;

/** mulberry32 — tiny seeded PRNG so charts are stable between reloads. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DailyPoint {
  /** Day index within the window: 1..30. */
  day: number;
  date: Date;
  /** e.g. "Nov 6". */
  label: string;
  revenue: number;
  adSpend: number;
  /** Orders that day (chat + website). */
  orders: number;
  chatOrders: number;
  websiteOrders: number;
  /** Returns value in USD (for the hero chart bars). */
  returnsValue: number;
  /** Portfolio return rate in % for that day. */
  returnPct: number;
  /** revenue / adSpend for that day. */
  roas: number;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function dateForDay(day: number): Date {
  const d = new Date(ANCHOR_DATE);
  d.setDate(d.getDate() - (SERIES_DAYS - day));
  return d;
}

function dateLabel(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function buildDailySeries(): DailyPoint[] {
  const rand = seededRandom(20251205);
  const points: DailyPoint[] = [];
  for (let day = 1; day <= SERIES_DAYS; day++) {
    const date = dateForDay(day);
    const dow = date.getDay();
    const weekend = dow === 0 || dow === 6;
    // Revenue $800–$2,400/day with weekend bumps; today (day 30) partial.
    let revenue = 800 + rand() * 1600;
    if (weekend) revenue *= 1.25;
    if (day === SERIES_DAYS) revenue *= 0.55;
    revenue = Math.round(revenue);
    // Ad spend 30–40% of revenue.
    const adSpend = Math.round(revenue * (0.3 + rand() * 0.1));
    // Return rate 8–16%, spike to ~18% on day 21 (DreamWave cluster).
    let returnPct = 8 + rand() * 8;
    if (day === 21) returnPct = 18;
    if (day === 20 || day === 22) returnPct = Math.max(returnPct, 14.5);
    returnPct = round2(returnPct);
    // Orders ≈ revenue / avg order value ($19); split chat vs website ~55–70/30–45.
    const orders = Math.round(revenue / 19);
    const chatOrders = Math.round(orders * (0.55 + rand() * 0.15));
    const websiteOrders = orders - chatOrders;
    const returnsValue = Math.round(orders * (returnPct / 100) * 19);
    points.push({
      day, date, label: dateLabel(date),
      revenue, adSpend, orders, chatOrders, websiteOrders,
      returnsValue, returnPct,
      roas: round2(revenue / adSpend),
    });
  }
  return points;
}

/** 30-day daily portfolio series (orders, revenue, ad spend, returns $, return %). */
export const dailySeries: DailyPoint[] = buildDailySeries();

/** 30-day portfolio return-rate series (%), spike at day 21. */
export const returnTrendSeries = dailySeries.map((p) => ({
  day: p.day,
  date: p.date,
  label: p.label,
  returnPct: p.returnPct,
  returns: Math.round(p.orders * (p.returnPct / 100)),
  driver: p.day === 21 ? "DreamWave Headband" : undefined,
}));

// ─── Live daily buckets (from live.json `daily`, written by odoo_sync.py) ────

/**
 * Real per-day data from Odoo (all days are LOCAL Asia/Baghdad days — never
 * convert timezones here):
 *  - `byProduct`: odooId (string) → sparse ISO-day →
 *    [orderDocs, units, revenueIQD] (confirmed sale.order docs containing the
 *    product / sum of product_uom_qty / product revenue; only nonzero days).
 *  - `orders`: ISO-day → distinct confirmed sale.order documents across the
 *    WHOLE shop that day (matches the Odoo orders list exactly). Optional —
 *    older snapshots lack it; portfolio orders then fall back to the sum of
 *    per-product docs (over-counts multi-product orders).
 *  - `moves`: ISO-day → [deliveredUnits, returnedUnits] (portfolio level,
 *    from done stock.move).
 */
export interface LiveDailyData {
  days: number;
  /** First covered day, ISO ("2026-05-22"). */
  from: string;
  /** Last covered day, ISO ("2026-08-20"). */
  to: string;
  byProduct: Record<string, Record<string, [number, number, number]>>;
  orders?: Record<string, number>;
  moves: Record<string, [number, number]>;
  /** Source timezone label ("Asia/Baghdad"); days are already local. */
  tz?: string;
}

/** Live daily buckets; null in mock mode or when live.json has no `daily`. */
let liveDaily: LiveDailyData | null = null;

/** Shop-wide warehouse stock (all products, from stock.quant). */
export interface ShopStock {
  stockUnits: number;
  stockValue: number;
  stockVariants: number;
}
let shopStock: ShopStock | null = null;

/** Hand the parsed `shop` block to the data layer (null when absent/mock). */
export function setShopStock(shop: ShopStock | null): void {
  shopStock = shop;
}

/** Shop-wide on-hand stock, or null when not available. */
export function getShopStock(): ShopStock | null {
  return shopStock;
}

/**
 * Hand the parsed `daily` block to the data layer. Called by
 * src/data/liveSync.ts right after `applyLiveDataset`.
 */
export function setLiveDailyData(daily: LiveDailyData | null): void {
  liveDaily = daily;
  productSeriesCache.clear();
}

/** True when real per-day Odoo buckets are available (live mode + daily). */
export function hasLiveDaily(): boolean {
  return liveDaily != null;
}

/** `count` ISO day strings (oldest → newest) ending at `toIso` (UTC days). */
function isoDaysEndingAt(toIso: string, count: number): string[] {
  const end = Date.parse(`${toIso}T00:00:00Z`);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Shift an ISO day by `delta` days. */
function shiftIso(iso: string, delta: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Portfolio sums for one ISO day. `orders` = shop-wide distinct order docs
 * from `daily.orders` when present (matches Odoo exactly), else the sum of
 * per-product docs (an over-count, labeled as a fallback); `units`/`revenue`
 * are summed over byProduct cells ([1] and [2]).
 */
/** Coerce to a finite number; anything else (NaN, string, null) → 0. */
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function portfolioDay(iso: string): { orders: number; units: number; revenue: number } {
  let docs = 0;
  let units = 0;
  let revenue = 0;
  if (liveDaily) {
    for (const perDay of Object.values(liveDaily.byProduct)) {
      const b = perDay[iso];
      if (b) {
        docs += num(b[0]);
        units += num(b[1]);
        revenue += num(b[2]);
      }
    }
    return { orders: num(liveDaily.orders?.[iso] ?? docs), units, revenue };
  }
  return { orders: 0, units: 0, revenue: 0 };
}

/**
 * Portfolio daily series for the last `windowDays` days.
 *
 * Live mode (with `daily`): REAL Odoo numbers ending at `daily.to` — `orders`
 * is the shop-wide distinct order-doc count (`daily.orders`), revenue/units
 * are summed over `byProduct` cells, delivered/returned units come from
 * `moves`, zero-filled missing days. `returnsValue` is an honest estimate
 * (returned units × portfolio average unit price) — label it as such in
 * tooltips. `adSpend` is 0 (no daily spend data); charts must hide that
 * series. Odoo doesn't tag channel: chatOrders = orders, websiteOrders = 0.
 *
 * Mock mode (or live.json without `daily`): the seeded `dailySeries` sliced
 * to the window — mock behavior unchanged.
 */
export function getPortfolioSeries(windowDays: number = SERIES_DAYS): DailyPoint[] {
  const ld = liveDaily;
  if (!ld) {
    return dailySeries
      .slice(-Math.min(windowDays, SERIES_DAYS))
      .map((p, i) => ({ ...p, day: i + 1 }));
  }
  const days = isoDaysEndingAt(ld.to, windowDays);
  // Average IQD per UNIT (not per order doc) for the returns-value estimate.
  const totalUnits = sum(products.map((p) => num(p.units)));
  const totalRevenue = sum(products.map((p) => num(p.revenue)));
  const avgUnit = totalUnits > 0 ? totalRevenue / totalUnits : 0;
  return days.map((iso, i) => {
    const { orders, revenue } = portfolioDay(iso);
    const mv = ld.moves[iso];
    const delivered = num(mv?.[0]);
    const returnedUnits = num(mv?.[1]);
    const date = new Date(`${iso}T00:00:00`);
    return {
      day: i + 1,
      date,
      label: dateLabel(date),
      revenue,
      adSpend: 0,
      orders,
      chatOrders: orders,
      websiteOrders: 0,
      returnsValue: Math.round(returnedUnits * avgUnit),
      returnPct: delivered > 0 ? round2((returnedUnits / delivered) * 100) : 0,
      roas: 0,
    };
  });
}

export interface ReturnTrendPoint {
  day: number;
  date: Date;
  label: string;
  /** Portfolio return rate in % for that day (returned/delivered units). */
  returnPct: number;
  /** Units returned that day. */
  returns: number;
  driver?: string;
}

/**
 * Portfolio return trend for the window. Live mode: honest daily returned/
 * delivered units from `moves`. Mock mode: the seeded series (unchanged).
 */
export function getReturnTrend(windowDays: number = SERIES_DAYS): ReturnTrendPoint[] {
  const ld = liveDaily;
  if (!ld) {
    return returnTrendSeries
      .slice(-Math.min(windowDays, SERIES_DAYS))
      .map((p, i) => ({ ...p, day: i + 1 }));
  }
  return isoDaysEndingAt(ld.to, windowDays).map((iso, i) => {
    const mv = ld.moves[iso];
    const delivered = num(mv?.[0]);
    const returned = num(mv?.[1]);
    const date = new Date(`${iso}T00:00:00`);
    return {
      day: i + 1,
      date,
      label: dateLabel(date),
      returnPct: delivered > 0 ? round2((returned / delivered) * 100) : 0,
      returns: returned,
    };
  });
}

export interface PortfolioWindowTotals {
  /** Shop-wide distinct confirmed order documents in the window. */
  orders: number;
  /** Units sold in the window (sum over byProduct cells). */
  units: number;
  /** Product revenue in the window (IQD; excludes delivery/discount lines). */
  revenue: number;
  /** Previous equal-length window; null when it has no coverage. */
  prevOrders: number | null;
  prevUnits: number | null;
  prevRevenue: number | null;
}

/**
 * Real windowed portfolio sums (live mode only). `orders` sums `daily.orders`
 * (shop-wide docs — matches Odoo exactly; falls back to summed per-product
 * docs when the snapshot lacks the map). Delta basis: the immediately
 * previous equal-length window; null when that window falls outside coverage.
 * Returns null in mock mode / without daily data.
 */
export function getPortfolioWindowTotals(
  windowDays: number
): PortfolioWindowTotals | null {
  const ld = liveDaily;
  if (!ld) return null;
  const sumRange = (days: string[]): { orders: number; units: number; revenue: number } => {
    let orders = 0;
    let units = 0;
    let revenue = 0;
    for (const iso of days) {
      if (iso < ld.from || iso > ld.to) continue;
      const d = portfolioDay(iso);
      orders += d.orders;
      units += d.units;
      revenue += d.revenue;
    }
    return { orders, units, revenue };
  };
  const cur = sumRange(isoDaysEndingAt(ld.to, windowDays));
  // Previous equal-length window — only when it is FULLY inside coverage,
  // otherwise the % delta would compare against a partial window.
  const prevStart = shiftIso(ld.to, -(2 * windowDays - 1));
  const prev =
    prevStart >= ld.from
      ? sumRange(isoDaysEndingAt(shiftIso(ld.to, -windowDays), windowDays))
      : null;
  return {
    orders: cur.orders,
    units: cur.units,
    revenue: cur.revenue,
    prevOrders: prev?.orders ?? null,
    prevUnits: prev?.units ?? null,
    prevRevenue: prev?.revenue ?? null,
  };
}

/**
 * Real windowed sums for one product (live mode only; id is `odoo-<odooId>`
 * or a SKU). Returns null in mock mode / without daily data.
 */
export function getProductWindowTotals(
  productId: string,
  windowDays: number
): { orders: number; units: number; revenue: number } | null {
  if (!liveDaily) return null;
  const product = getProduct(productId);
  const m = product ? /^odoo-(\d+)$/.exec(product.id) : /^odoo-(\d+)$/.exec(productId);
  if (!m) return { orders: 0, units: 0, revenue: 0 };
  const bucket = liveDaily.byProduct[m[1]];
  if (!bucket) return { orders: 0, units: 0, revenue: 0 };
  const from = shiftIso(liveDaily.to, -(windowDays - 1));
  let orders = 0; // distinct order documents containing the product
  let units = 0;
  let revenue = 0;
  for (const [iso, b] of Object.entries(bucket)) {
    if (iso >= from && iso <= liveDaily.to) {
      orders += b[0];
      units += b[1];
      revenue += b[2];
    }
  }
  return { orders, units, revenue };
}

// ─── Per-product seeded series ───────────────────────────────────────────────

export interface ProductSeriesPoint {
  day: number;
  date: Date;
  label: string;
  revenue: number;
  adSpend: number;
  /** Orders that day (chat + website, from Odoo). */
  orders: number;
  /** Units returned that day. */
  returns: number;
  /** End-of-day on-hand returned stock (the warehouse stock). */
  returnedStock: number;
}

const productSeriesCache = new Map<string, ProductSeriesPoint[]>();

/**
 * Deterministic daily series for a product, generated from its lifetime totals
 * with seeded noise. Stable between reloads. `days` defaults to 30; the window
 * ends on ANCHOR_DATE. Products before ads (shared/created) return zeroed days.
 */
export function getProductSeries(productId: string, days = SERIES_DAYS): ProductSeriesPoint[] {
  const cacheKey = `${productId}:${days}`;
  const cached = productSeriesCache.get(cacheKey);
  if (cached) return cached;

  const product = getProduct(productId);
  if (!product) return [];

  // Live mode with daily buckets: REAL per-product daily order docs (cell[0])
  // and revenue (cell[2]) from Odoo, zero-filled across the window ending at
  // `daily.to`. Per-product daily returns/spend aren't tracked (moves are
  // portfolio-level, spend has no daily breakdown) — those fields are 0/flat
  // so charts can hide them.
  if (liveDaily) {
    const m = /^odoo-(\d+)$/.exec(product.id);
    const bucket = m ? liveDaily.byProduct[m[1]] : undefined;
    const points: ProductSeriesPoint[] = isoDaysEndingAt(liveDaily.to, days).map(
      (iso, i) => {
        const b = bucket?.[iso];
        const date = new Date(`${iso}T00:00:00`);
        return {
          day: i + 1,
          date,
          label: dateLabel(date),
          revenue: b?.[2] ?? 0,
          adSpend: 0,
          orders: b?.[0] ?? 0,
          returns: 0,
          // Only today's on-hand count is known — keep the history flat at the
          // real current value rather than inventing a curve.
          returnedStock: product.returnedStock,
        };
      }
    );
    productSeriesCache.set(cacheKey, points);
    return points;
  }

  // Seed from the SKU characters so each product gets a unique but stable shape.
  const seed = product.sku.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  const rand = seededRandom(seed);

  // Random weights normalized to the product's totals.
  const decay =
    product.stage === "organic-only" ||
    product.stage === "selling-returns" ||
    product.stage === "completed";
  const weights = Array.from({ length: days }, (_, i) => {
    const d = dateForDay(SERIES_DAYS - days + 1 + i);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    // Ramp up early in the lifecycle, decay once ads are over.
    const lifecycle = decay ? 1 - (i / days) * 0.7 : 0.6 + (i / days) * 0.6;
    return (0.35 + rand()) * (weekend ? 1.25 : 1) * lifecycle;
  });
  const wSum = sum(weights);
  const norm = weights.map((w) => w / wSum);

  // If the series window is longer than the 30-day metrics window, scale totals
  // so earlier days (pre-window) are lower.
  const scale = days > SERIES_DAYS ? SERIES_DAYS / days : 1;

  const points: ProductSeriesPoint[] = [];
  const ordersPerDay = norm.map((n) =>
    Math.round(product.totalOrders * n * scale * (days > SERIES_DAYS ? 1.6 : 1))
  );
  const returnsPerDay = norm.map((n) => Math.round(product.returned * n));

  // Returned-stock curve: starts below the current on-hand value, gains the
  // day's returns, and bleeds off through organic/return sell-through, ending
  // exactly at product.returnedStock on the last day.
  const startStock = Math.max(0, product.returnedStock - product.returned);
  const totalReturns = sum(returnsPerDay);
  const totalSellOff = Math.max(0, startStock + totalReturns - product.returnedStock);
  let stock = startStock;
  for (let i = 0; i < days; i++) {
    const date = dateForDay(SERIES_DAYS - days + 1 + i);
    const revenue = Math.round(product.revenue * norm[i]);
    const adSpend = Math.round(product.adSpend * norm[i]);
    const returns = returnsPerDay[i];
    const sellOff = i === days - 1
      ? Math.max(0, stock + returns - product.returnedStock)
      : Math.round(totalSellOff * norm[i]);
    stock = Math.max(0, stock + returns - sellOff);
    points.push({
      day: i + 1, date, label: dateLabel(date),
      revenue, adSpend, orders: ordersPerDay[i], returns, returnedStock: stock,
    });
  }
  productSeriesCache.set(cacheKey, points);
  return points;
}

// ─── KPI sparklines (Overview cards) ─────────────────────────────────────────

export interface Sparklines {
  activeProducts: number[];
  orders: number[];
  revenue: number[];
  returnRate: number[];
  adSpend: number[];
  roas: number[];
  returnedStock: number[];
}

function buildSparklines(): Sparklines {
  const rand = seededRandom(424242);
  let active = 9;
  const activeProducts = dailySeries.map((_, i) => {
    if (i % 6 === 5 && active < 12) active += 1; // steps up to 12
    return active;
  });
  let returned = 92;
  const returnedStock = dailySeries.map((_, i) => {
    returned -= Math.round(rand() * 3) + (i > 20 ? 2 : 0);
    return Math.max(48, returned);
  });
  return {
    activeProducts,
    orders: dailySeries.map((p) => p.orders),
    revenue: dailySeries.map((p) => p.revenue),
    returnRate: dailySeries.map((p) => p.returnPct),
    adSpend: dailySeries.map((p) => p.adSpend),
    roas: dailySeries.map((p) => p.roas),
    returnedStock,
  };
}

/** Small daily series for the KPI-card sparklines. */
export const sparklines: Sparklines = buildSparklines();

/**
 * Window-aware KPI sparklines.
 * Live mode: revenue/orders/return-rate come from the REAL portfolio series
 * (never the fake USD mock line over an IQD KPI); adSpend/roas are empty
 * (no daily spend data — callers omit those sparklines); unit-count
 * sparklines (activeProducts, returnedStock) are currency-neutral and stay.
 * Mock mode: the seeded sparklines sliced to the window.
 */
export function getSparklines(windowDays: number = SERIES_DAYS): Sparklines {
  const cut = (xs: number[]) => xs.slice(-Math.min(windowDays, xs.length));
  if (!liveDaily) {
    return {
      activeProducts: cut(sparklines.activeProducts),
      orders: cut(sparklines.orders),
      revenue: cut(sparklines.revenue),
      returnRate: cut(sparklines.returnRate),
      adSpend: cut(sparklines.adSpend),
      roas: cut(sparklines.roas),
      returnedStock: cut(sparklines.returnedStock),
    };
  }
  const series = getPortfolioSeries(windowDays);
  return {
    activeProducts: cut(sparklines.activeProducts),
    orders: series.map((p) => p.orders),
    revenue: series.map((p) => p.revenue),
    returnRate: series.map((p) => p.returnPct),
    adSpend: [],
    roas: [],
    returnedStock: cut(sparklines.returnedStock),
  };
}

// ─── Aggregations used by multiple pages ─────────────────────────────────────

export interface CategorySlice {
  category: Category;
  revenue: number;
  pct: number;
}

export function revenueByCategory(): CategorySlice[] {
  const map = new Map<Category, number>();
  for (const p of products) {
    map.set(p.category, (map.get(p.category) ?? 0) + p.revenue);
  }
  return Array.from(map.entries())
    .map(([category, revenue]) => ({
      category,
      revenue,
      pct: globalKpis.revenue > 0 ? round2((revenue / globalKpis.revenue) * 100) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

export function stageCounts(): { stage: Stage; count: number }[] {
  return STAGE_ORDER.map((stage) => ({
    stage,
    count: products.filter((p) => p.stage === stage).length,
  }));
}

// ─── CREATED intake (recently created products, regardless of stage) ────────

/** A product counts as "recently created" intake for this many days. */
export const CREATED_INTAKE_DAYS = 30;

/**
 * True when the product belongs in the CREATED intake view: either still at
 * the `created` stage, or created in Odoo within the last
 * `CREATED_INTAKE_DAYS` days (age measured against ANCHOR_DATE, like
 * `daysInMarket` in LifecycleTable) even if it has since moved on
 * (ads-live, selling, …).
 */
export function isCreatedIntake(p: Product): boolean {
  if (p.stage === "created") return true;
  if (!p.odooCreatedDate) return false;
  const ageDays =
    (ANCHOR_DATE.getTime() - new Date(p.odooCreatedDate).getTime()) /
    86_400_000;
  return ageDays <= CREATED_INTAKE_DAYS;
}

/** Products sorted by ROAS desc (top movers list). */
export function topMovers(limit = 5): Product[] {
  return [...products]
    .filter((p) => p.roas != null)
    .sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))
    .slice(0, limit);
}

/** All alerts across the portfolio, most urgent first. */
export function getAllAlerts(): Alert[] {
  return [...allAlerts].sort(
    (a, b) =>
      ALERT_URGENCY[a.type] - ALERT_URGENCY[b.type] ||
      a.productId.localeCompare(b.productId)
  );
}

/** Products with at least one non-info alert, most urgent first. */
export function needsAttentionList(): Product[] {
  return products
    .filter((p) => p.alerts.some((a) => a.severity !== "info"))
    .sort((a, b) => (topAlertUrgency(a.alerts) ?? 99) - (topAlertUrgency(b.alerts) ?? 99));
}

/** One-line reason a product needs attention (its most urgent alert message). */
export function attentionReason(p: Product): string {
  const top = p.alerts[0];
  if (!top) return "Healthy — no active alerts";
  return top.message;
}

/**
 * Re-run the alert engine over the dataset and report each product's worst
 * severity. Useful for tuning thresholds in one place (ALERT_THRESHOLDS).
 */
export function auditAlerts(): { product: Product; worst: AlertSeverity | null }[] {
  return products.map((product) => ({
    product,
    worst: worstSeverity(product.alerts),
  }));
}
