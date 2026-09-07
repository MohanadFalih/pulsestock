/**
 * Inventory & clearance engine — pure functions over the ops blocks
 * (`stockDetail` / `ordersDetail`) from src/data/opsData.ts, plus a graceful
 * fallback built on the existing product records (`returnedStock`).
 *
 * Business rules (ground truth, last 4 months):
 *  - Warehouse stock ≈ customer returns + old-season stock (buy-on-demand
 *    model: units are only bought from Turkey against real orders).
 *  - Clearance discount ladder by age in stock: 30d → 20% off, 45d → 35% off,
 *    60d → 50% off (end of season).
 *  - "M"-prefixed models (Modaselvim legacy, Dec 2025) are bad quality →
 *    aggressive clearance: always one rung up the ladder (min 20%).
 *  - Returned units carry zero courier cost; they resell full-price while the
 *    model is active, discounted after.
 *
 * All functions are side-effect free. "Age" is always computed against an
 * explicit `asOf` date (the page passes the live.json sync time, so numbers
 * match the snapshot, not the wall clock).
 */

import type { OpsOrder, OpsStockItem } from "./opsData";
import type { Product } from "./products";

// ─── Policy constants ────────────────────────────────────────────────────────

/** Clearance goal: bring frozen capital below 30,000,000 IQD. */
export const CLEARANCE_TARGET_IQD = 30_000_000;

/**
 * Age-in-stock discount ladder (policy): the FIRST rung whose minAge the
 * unit has reached applies.
 */
export const DISCOUNT_LADDER = [
  { minAge: 60, discPct: 50 },
  { minAge: 45, discPct: 35 },
  { minAge: 30, discPct: 20 },
] as const;

/** Aging buckets used by the ladder visual, oldest last. */
export const AGE_BUCKETS = [
  { key: "0-14", label: "0–14 days", min: 0, max: 14 },
  { key: "15-29", label: "15–29 days", min: 15, max: 29 },
  { key: "30-44", label: "30–44 days", min: 30, max: 44 },
  { key: "45-59", label: "45–59 days", min: 45, max: 59 },
  { key: "60+", label: "60+ days", min: 60, max: null },
] as const;

export type AgeBucketKey = (typeof AGE_BUCKETS)[number]["key"];

/** Discount-tier performance bands over ordersDetail lines (discPct). */
export const DISCOUNT_BANDS = [
  { key: "full", label: "Full price", minPct: 0, maxPct: 0 },
  { key: "tier20", label: "~20% off", minPct: 1, maxPct: 25 },
  { key: "tier35", label: "~35% off", minPct: 26, maxPct: 40 },
  { key: "tier50", label: "~50% off", minPct: 41, maxPct: 60 },
] as const;

export type DiscountBandKey = (typeof DISCOUNT_BANDS)[number]["key"];

/** Heuristic cost ratio for fallback mode: est. cost = unitPrice × 0.55. */
export const FALLBACK_COST_RATIO = 0.55;

// ─── Age / ladder primitives ─────────────────────────────────────────────────

/** Whole days between an ISO "YYYY-MM-DD" date and `asOf` (never negative). */
export function ageInDays(created: string, asOf: Date): number {
  const t = Date.parse(`${created}T00:00:00Z`);
  if (!Number.isFinite(t)) return 0;
  const ms = asOf.getTime() - t;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Aging bucket for a unit age. */
export function bucketForAge(ageDays: number): AgeBucketKey {
  for (const b of AGE_BUCKETS) {
    if (ageDays >= b.min && (b.max == null || ageDays <= b.max)) return b.key;
  }
  return "60+";
}

/** Policy discount for a given age (0 when younger than 30 days). */
export function ladderDiscount(ageDays: number): number {
  for (const rung of DISCOUNT_LADDER) {
    if (ageDays >= rung.minAge) return rung.discPct;
  }
  return 0;
}

/**
 * True for "M"-prefixed legacy models (Modaselvim, Dec 2025 batch) —
 * e.g. "M-2314". Requires a dash or digit after the M so plain words don't
 * false-positive.
 */
export function isMFamilyModel(model: string): boolean {
  return /^M(?=[-\d])/i.test(model.trim());
}

/**
 * Suggested discount tier for a model. M-family clears aggressively: always
 * at least 20%, and always one rung above the age-based ladder.
 */
export function suggestedDiscount(ageDays: number, mFamily: boolean): number {
  const base = ladderDiscount(ageDays);
  if (!mFamily) return base;
  if (base >= 50) return 50;
  if (base >= 35) return 50;
  if (base >= 20) return 35;
  return 20;
}

// ─── Stock analysis (stockDetail) ────────────────────────────────────────────

export interface StockBucket {
  key: AgeBucketKey;
  label: string;
  min: number;
  max: number | null;
  /** Policy discount that applies inside this bucket (0 for fresh stock). */
  discPct: number;
  units: number;
  /** Frozen capital in the bucket (qty × cost), IQD. */
  value: number;
}

export interface ModelRollup {
  model: string;
  units: number;
  /** Frozen capital (qty × cost), IQD. */
  value: number;
  /** Qty-weighted average unit cost, IQD. */
  avgCost: number;
  /** Oldest unit age in days. */
  oldestAgeDays: number;
  /** Qty-weighted average age in days (drives the suggested tier). */
  avgAgeDays: number;
  mFamily: boolean;
  /** Suggested clearance tier (ladder + M-family bump). */
  suggestedDiscPct: number;
  /** True when the model has crossed a ladder threshold (avg age ≥ 30d). */
  needsAction: boolean;
  /**
   * Conservative recovery estimate: cost value × (1 − suggested discount).
   * Cost-basis because the list price isn't in stockDetail.
   */
  estRecovery: number;
}

export interface StockAnalysis {
  asOfIso: string;
  totalUnits: number;
  /** Frozen capital across all stock (qty × cost), IQD. */
  totalValue: number;
  /** Qty-weighted average age of all units, days. */
  avgAgeDays: number;
  buckets: StockBucket[];
  /** Per-model rollup, frozen capital desc. */
  models: ModelRollup[];
  /** Models past the 30d ladder threshold, frozen capital desc. */
  actionNeeded: ModelRollup[];
  /** M-family (Modaselvim legacy) totals. */
  mFamily: { units: number; value: number; models: number };
  /** Clearance target, IQD. */
  target: number;
  /** frozen − target (negative when the target is already met). */
  overTarget: number;
  /** target / frozen × 100, clamped 0–100 (100 = target met). */
  targetProgressPct: number;
}

/** Model code = sku before " (" (same rule as odoo_sync.py). */
export function modelOfSku(sku: string): string {
  const i = sku.indexOf(" (");
  return i === -1 ? sku.trim() : sku.slice(0, i).trim();
}

/** Aggregate stockDetail into buckets, per-model rollups, and target math. */
export function analyzeStock(stock: OpsStockItem[], asOf: Date): StockAnalysis {
  const buckets: StockBucket[] = AGE_BUCKETS.map((b) => ({
    ...b,
    discPct: ladderDiscount(b.min),
    units: 0,
    value: 0,
  }));
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  interface Acc {
    units: number;
    value: number;
    ageQty: number; // Σ age × qty
    oldest: number;
  }
  const perModel = new Map<string, Acc>();

  let totalUnits = 0;
  let totalValue = 0;
  let totalAgeQty = 0;

  for (const item of stock) {
    const qty = Number.isFinite(item.qty) ? item.qty : 0;
    if (qty <= 0) continue;
    const cost = Number.isFinite(item.cost) ? item.cost : 0;
    const age = ageInDays(item.created, asOf);
    const value = qty * cost;

    const bucket = byKey.get(bucketForAge(age));
    if (bucket) {
      bucket.units += qty;
      bucket.value += value;
    }

    totalUnits += qty;
    totalValue += value;
    totalAgeQty += age * qty;

    const model = item.model?.trim() || modelOfSku(item.sku);
    const acc = perModel.get(model) ?? { units: 0, value: 0, ageQty: 0, oldest: 0 };
    acc.units += qty;
    acc.value += value;
    acc.ageQty += age * qty;
    acc.oldest = Math.max(acc.oldest, age);
    perModel.set(model, acc);
  }

  const models: ModelRollup[] = [...perModel.entries()].map(([model, a]) => {
    const avgAgeDays = a.units > 0 ? Math.round(a.ageQty / a.units) : 0;
    const mFamily = isMFamilyModel(model);
    const disc = suggestedDiscount(avgAgeDays, mFamily);
    return {
      model,
      units: a.units,
      value: a.value,
      avgCost: a.units > 0 ? a.value / a.units : 0,
      oldestAgeDays: a.oldest,
      avgAgeDays,
      mFamily,
      suggestedDiscPct: disc,
      needsAction: avgAgeDays >= 30 || mFamily,
      estRecovery: Math.round(a.value * (1 - disc / 100)),
    };
  });
  models.sort((a, b) => b.value - a.value);

  const actionNeeded = models
    .filter((m) => m.needsAction)
    .sort((a, b) => b.value - a.value);

  const mModels = models.filter((m) => m.mFamily);
  const mFamily = {
    units: mModels.reduce((s, m) => s + m.units, 0),
    value: mModels.reduce((s, m) => s + m.value, 0),
    models: mModels.length,
  };

  const overTarget = totalValue - CLEARANCE_TARGET_IQD;
  return {
    asOfIso: asOf.toISOString(),
    totalUnits,
    totalValue,
    avgAgeDays: totalUnits > 0 ? Math.round(totalAgeQty / totalUnits) : 0,
    buckets,
    models,
    actionNeeded,
    mFamily,
    target: CLEARANCE_TARGET_IQD,
    overTarget,
    targetProgressPct:
      totalValue <= 0
        ? 100
        : Math.max(0, Math.min(100, (CLEARANCE_TARGET_IQD / totalValue) * 100)),
  };
}

// ─── Orders analysis (ordersDetail) ──────────────────────────────────────────

export interface RouteMix {
  /** Units sold from warehouse stock (line.route omitted). */
  stockUnits: number;
  stockCash: number;
  /** Units bought from the supplier on demand (line.route === "turkey"). */
  supplierUnits: number;
  supplierCash: number;
  /** stockUnits / total × 100. */
  stockSharePct: number;
  totalUnits: number;
}

export interface DiscountBand {
  key: DiscountBandKey;
  label: string;
  minPct: number;
  maxPct: number;
  units: number;
  /** Cash collected in the band (qty × price), IQD. */
  revenue: number;
  /**
   * Estimated cost of the band's units (qty × stockDetail cost), IQD. Only
   * covers lines whose sku/model is found in stockDetail.
   */
  cost: number;
  /** revenue − cost; null when no line in the band has a known cost. */
  margin: number | null;
  /** Share of band units with a known cost, 0–100. */
  costCoveragePct: number;
}

export interface ClearancePoint {
  iso: string;
  /** e.g. "Aug 12". */
  label: string;
  /** Cash collected on discounted lines that day, IQD. */
  cash: number;
  units: number;
}

export interface OrdersAnalysis {
  mix: RouteMix;
  bands: DiscountBand[];
  clearance: {
    days: ClearancePoint[];
    /** Discounted-line cash over the trailing 30 days, IQD. */
    cash30d: number;
    units30d: number;
  };
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function shiftIso(iso: string, delta: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Sales analysis from ordersDetail: warehouse-vs-supplier mix, discount-tier
 * performance (margin estimated against stockDetail costs when available),
 * and clearance cash recovered per day over the trailing 30 days.
 *
 * Units are gross sold qty (line.qty); cash is qty × price (the actual
 * per-unit cash charged, already net of line discount).
 */
export function analyzeOrders(
  orders: OpsOrder[],
  stock: OpsStockItem[] | null,
  asOf: Date
): OrdersAnalysis {
  // Cost lookups: exact sku first, then qty-weighted model average.
  const costBySku = new Map<string, number>();
  const modelCost = new Map<string, { qty: number; value: number }>();
  for (const s of stock ?? []) {
    if (Number.isFinite(s.cost) && s.cost > 0) costBySku.set(s.sku, s.cost);
    const m = s.model?.trim() || modelOfSku(s.sku);
    const acc = modelCost.get(m) ?? { qty: 0, value: 0 };
    acc.qty += s.qty;
    acc.value += s.qty * (Number.isFinite(s.cost) ? s.cost : 0);
    modelCost.set(m, acc);
  }
  const unitCostFor = (sku: string): number | null => {
    const exact = costBySku.get(sku);
    if (exact != null) return exact;
    const acc = modelCost.get(modelOfSku(sku));
    return acc && acc.qty > 0 ? acc.value / acc.qty : null;
  };

  const mix: RouteMix = {
    stockUnits: 0,
    stockCash: 0,
    supplierUnits: 0,
    supplierCash: 0,
    stockSharePct: 0,
    totalUnits: 0,
  };

  const bands: DiscountBand[] = DISCOUNT_BANDS.map((b) => ({
    ...b,
    units: 0,
    revenue: 0,
    cost: 0,
    margin: null,
    costCoveragePct: 0,
  }));
  const bandCostKnownUnits = bands.map(() => 0);

  const toIso = asOf.toISOString().slice(0, 10);
  const fromIso = shiftIso(toIso, -29);
  const clearanceByDay = new Map<string, { cash: number; units: number }>();

  for (const order of orders) {
    const inWindow = order.d >= fromIso && order.d <= toIso;
    for (const line of order.lines) {
      const qty = Number.isFinite(line.qty) ? line.qty : 0;
      if (qty <= 0) continue;
      const cash = qty * (Number.isFinite(line.price) ? line.price : 0);

      if (line.route === "turkey") {
        mix.supplierUnits += qty;
        mix.supplierCash += cash;
      } else {
        mix.stockUnits += qty;
        mix.stockCash += cash;
      }

      const pct = Number.isFinite(line.discPct) ? Math.abs(line.discPct) : 0;
      const bandIdx = DISCOUNT_BANDS.findIndex(
        (b) => pct >= b.minPct && pct <= b.maxPct
      );
      const band = bands[bandIdx === -1 ? 0 : bandIdx];
      const bi = bandIdx === -1 ? 0 : bandIdx;
      band.units += qty;
      band.revenue += cash;
      const unitCost = unitCostFor(line.sku);
      if (unitCost != null) {
        band.cost += qty * unitCost;
        bandCostKnownUnits[bi] += qty;
      }

      if (pct > 0 && inWindow) {
        const acc = clearanceByDay.get(order.d) ?? { cash: 0, units: 0 };
        acc.cash += cash;
        acc.units += qty;
        clearanceByDay.set(order.d, acc);
      }
    }
  }

  mix.totalUnits = mix.stockUnits + mix.supplierUnits;
  mix.stockSharePct =
    mix.totalUnits > 0 ? (mix.stockUnits / mix.totalUnits) * 100 : 0;

  bands.forEach((b, i) => {
    const known = bandCostKnownUnits[i];
    b.margin = known > 0 ? Math.round(b.revenue - b.cost) : null;
    b.costCoveragePct = b.units > 0 ? Math.round((known / b.units) * 100) : 0;
    b.revenue = Math.round(b.revenue);
    b.cost = Math.round(b.cost);
  });

  const days: ClearancePoint[] = [];
  let cash30d = 0;
  let units30d = 0;
  for (let i = 29; i >= 0; i--) {
    const iso = shiftIso(toIso, -i);
    const acc = clearanceByDay.get(iso);
    const cash = Math.round(acc?.cash ?? 0);
    const units = acc?.units ?? 0;
    days.push({ iso, label: dayLabel(iso), cash, units });
    cash30d += cash;
    units30d += units;
  }

  return { mix, bands, clearance: { days, cash30d, units30d } };
}

// ─── Fallback mode (no stockDetail yet) ──────────────────────────────────────

export interface FallbackRow {
  id: string;
  sku: string;
  name: string;
  stage: string;
  /** On-hand (returned) units. */
  units: number;
  /** Last known unit price; null before any order. */
  unitPrice: number | null;
  /** unitPrice × FALLBACK_COST_RATIO × units — estimate until sync. */
  estValue: number | null;
  mFamily: boolean;
}

export interface FallbackInventory {
  rows: FallbackRow[];
  totalUnits: number;
  /** Σ estValue over rows with a known price — estimate until sync. */
  totalEstValue: number;
  /** target / totalEstValue × 100, clamped 0–100. */
  targetProgressPct: number;
  overTarget: number;
}

/**
 * Per-product returned-stock rollup from the existing product records, used
 * when live.json has no stockDetail block yet. Frozen capital is estimated
 * with the unitPrice × 0.55 cost heuristic (label it "estimate until sync").
 */
export function fallbackFromProducts(list: Product[]): FallbackInventory {
  const rows: FallbackRow[] = list
    .filter((p) => p.returnedStock > 0)
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      stage: p.stage,
      units: p.returnedStock,
      unitPrice: p.unitPrice,
      estValue:
        p.unitPrice != null
          ? Math.round(p.unitPrice * FALLBACK_COST_RATIO * p.returnedStock)
          : null,
      mFamily: isMFamilyModel(p.sku),
    }))
    .sort((a, b) => (b.estValue ?? 0) - (a.estValue ?? 0));

  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const totalEstValue = rows.reduce((s, r) => s + (r.estValue ?? 0), 0);
  return {
    rows,
    totalUnits,
    totalEstValue,
    targetProgressPct:
      totalEstValue <= 0
        ? 100
        : Math.max(
            0,
            Math.min(100, (CLEARANCE_TARGET_IQD / totalEstValue) * 100)
          ),
    overTarget: totalEstValue - CLEARANCE_TARGET_IQD,
  };
}
