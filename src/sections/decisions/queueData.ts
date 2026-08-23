/**
 * Decisions page — queue model (v2 alert engine).
 *
 * Every metric shown on the page is derived here from the canonical dataset
 * (`@/data/products`) and the alert engine (`@/data/decisionEngine`). The page
 * groups each product's active alerts into five urgency groups:
 *
 *   CRITICAL  SUPPLIER_OUT
 *   ISSUES    HIGH_RETURNS above 35% (severity "issue")
 *   WATCH     HIGH_RETURNS 25–35% (severity "watch") + SUPPLIER_LOW
 *   SELL_OFF  STALE_RETURN_STOCK + SELL_RETURNS (dashed revival cards)
 *   INFO      READY_TO_JUDGE + COLLECTING_DATA
 *
 * One card is rendered per product per group, merging all of that product's
 * alerts inside the group. Nothing here is hardcoded: thresholds, messages and
 * recommended actions all come from the engine's `Alert` objects.
 */

import {
  getProduct,
  products,
  type Alert,
  type AlertType,
  type Product,
} from "@/data/products";
import {
  ALERT_THRESHOLDS,
  ALERT_URGENCY,
  HEALTH_COLOR,
  returnRateHealth,
  roasHealth,
  supplierCoverDays,
} from "@/data/decisionEngine";
import type { ChecklistItem } from "@/components/ActionChecklist";
import { fmtMoney } from "@/lib/money";

// ─── Formatting + derived helpers ────────────────────────────────────────────

/** Currency-aware money (USD mock / IQD live). Kept under the old name. */
export const fmtUsd = fmtMoney;
export const fmtCompactUsd = (n: number) => fmtMoney(n);

/** Metrics window of the canonical dataset (matches SERIES_DAYS). */
const DAYS_WINDOW = 30;

/** Average ad spend per day over the 30-day window. */
export const dailyAdSpend = (p: Product) => p.adSpend / DAYS_WINDOW;

/** Estimated retail value of the on-hand returned units (the warehouse stock). */
export const returnedStockValue = (p: Product) =>
  Math.round(p.returnedStock * (p.unitPrice ?? 0));

/**
 * Cash recovery estimate for liquidating returned stock at cost. Cost basis ≈
 * 60% of retail unit price (dataset has no COGS field; spec estimate).
 */
export const liquidationRecovery = (p: Product) =>
  Math.round((returnedStockValue(p) * 0.6) / 10) * 10;

// ─── Queue groups ────────────────────────────────────────────────────────────

/** Groups rendered on this page, in urgency order. */
export type QueueGroupKey = "CRITICAL" | "ISSUES" | "WATCH" | "SELL_OFF" | "INFO";

export const QUEUE_GROUPS: QueueGroupKey[] = [
  "CRITICAL",
  "ISSUES",
  "WATCH",
  "SELL_OFF",
  "INFO",
];

/** Section anchors — `dead-stock` is the stable hash used by Overview links. */
export const GROUP_ANCHOR: Record<QueueGroupKey, string> = {
  CRITICAL: "critical",
  ISSUES: "issues",
  WATCH: "watch",
  SELL_OFF: "dead-stock",
  INFO: "info",
};

/**
 * Which queue group an alert belongs to. HIGH_RETURNS splits by severity:
 * "issue" (> 35%) → ISSUES, "watch" (25–35%) → WATCH.
 */
export function groupForAlert(alert: Alert): QueueGroupKey {
  switch (alert.type) {
    case "SUPPLIER_OUT":
      return "CRITICAL";
    case "HIGH_RETURNS":
      return alert.severity === "issue" ? "ISSUES" : "WATCH";
    case "SUPPLIER_LOW":
      return "WATCH";
    case "STALE_RETURN_STOCK":
    case "SELL_RETURNS":
      return "SELL_OFF";
    case "READY_TO_JUDGE":
    case "COLLECTING_DATA":
      return "INFO";
    case "NEEDS_ADS":
      return "WATCH";
  }
}

/**
 * Resolve a `?alert=` deep-link value to a queue group. Accepts either a full
 * alert id (`pld-010:HIGH_RETURNS`) or a bare alert type (`HIGH_RETURNS`).
 * Returns null when no active alert matches.
 */
export function groupForAlertParam(param: string): QueueGroupKey | null {
  for (const p of products) {
    for (const a of p.alerts) {
      if (a.id === param || a.type === param) return groupForAlert(a);
    }
  }
  return null;
}

export interface GroupEntry {
  product: Product;
  /** The product's alerts inside this group, most urgent first. */
  alerts: Alert[];
}

/** One entry per product with alerts in the group, most urgent first. */
export function groupEntries(key: QueueGroupKey): GroupEntry[] {
  return products
    .map((product) => ({
      product,
      alerts: product.alerts.filter((a) => groupForAlert(a) === key),
    }))
    .filter((e) => e.alerts.length > 0)
    .sort(
      (a, b) =>
        ALERT_URGENCY[a.alerts[0].type] - ALERT_URGENCY[b.alerts[0].type] ||
        a.product.id.localeCompare(b.product.id)
    );
}

// ─── Per-card content ────────────────────────────────────────────────────────

export interface MiniStat {
  label: string;
  value: string;
  /** Hex color when the stat carries a threshold semantic. */
  color?: string;
}

export interface AlertCardContent {
  reasons: string[];
  stats: MiniStat[];
  checklist: ChecklistItem[];
  /** Cash recovery estimate chip (returned-stock sell-off cards only). */
  cashRecovery?: number;
}

/**
 * Return-rate stat with sample-size honesty: "36.4% · n=33" once measurable,
 * "collecting data" while the delivered count is under the early threshold.
 */
function returnRateStat(p: Product): MiniStat {
  if (p.returnConfidence === "insufficient" || p.returnRate == null) {
    return { label: "Return rate", value: "collecting data", color: "#45B7F5" };
  }
  return {
    label: "Return rate",
    value: `${p.returnRate.toFixed(1)}% · n=${p.deliveredCount}`,
    color: HEALTH_COLOR[returnRateHealth(p.returnRate)],
  };
}

function roasStat(p: Product): MiniStat {
  return {
    label: "ROAS",
    value: p.roas != null ? p.roas.toFixed(2) : "—",
    color: HEALTH_COLOR[roasHealth(p.roas)],
  };
}

function velocityStat(p: Product): MiniStat {
  return { label: "Orders/day · 7d", value: String(p.orderVelocity7d) };
}

function adSpendStat(p: Product): MiniStat {
  return { label: "Ad spend/day", value: fmtUsd(dailyAdSpend(p)) };
}

function supplierStockStat(p: Product): MiniStat {
  const qty = p.supplierStock.qty;
  if (qty == null) {
    return { label: "Supplier stock", value: "—", color: undefined };
  }
  return {
    label: "Supplier stock",
    value: qty.toLocaleString("en-US"),
    color:
      qty === 0
        ? HEALTH_COLOR.bad
        : supplierCoverDays(qty, p.orderVelocity7d) < ALERT_THRESHOLDS.SUPPLIER_LOW_DAYS
          ? HEALTH_COLOR.warn
          : undefined,
  };
}

/** Key numbers for a card, driven by the entry's most urgent alert. */
function statsFor(p: Product, primary: Alert): MiniStat[] {
  switch (primary.type) {
    case "SUPPLIER_OUT":
      return [
        supplierStockStat(p),
        velocityStat(p),
        adSpendStat(p),
        { label: "Returned units", value: String(p.returnedStock), color: "#3EE6D8" },
      ];
    case "HIGH_RETURNS":
      return [
        returnRateStat(p),
        { label: "Returned units", value: String(p.returned) },
        roasStat(p),
        adSpendStat(p),
      ];
    case "SUPPLIER_LOW": {
      const cover = supplierCoverDays(p.supplierStock.qty, p.orderVelocity7d);
      return [
        supplierStockStat(p),
        {
          label: "Cover at velocity",
          value: cover === Infinity ? "∞" : `${cover.toFixed(1)}d`,
          color: HEALTH_COLOR.warn,
        },
        velocityStat(p),
        adSpendStat(p),
      ];
    }
    case "STALE_RETURN_STOCK":
    case "SELL_RETURNS":
      return [
        { label: "Returned units", value: String(p.returnedStock), color: "#3EE6D8" },
        {
          label: "Days no orders",
          value: p.daysSinceLastOrder != null ? String(p.daysSinceLastOrder) : "—",
        },
        { label: "Stock value", value: fmtUsd(returnedStockValue(p)) },
        returnRateStat(p),
      ];
    case "READY_TO_JUDGE":
      return [
        { label: "Delivered", value: `n=${p.deliveredCount}`, color: HEALTH_COLOR.good },
        returnRateStat(p),
        velocityStat(p),
        roasStat(p),
      ];
    case "COLLECTING_DATA":
      return [
        {
          label: "Delivered",
          value: `${p.deliveredCount}/${ALERT_THRESHOLDS.DELIVERED_EARLY}`,
          color: "#45B7F5",
        },
        returnRateStat(p),
        velocityStat(p),
        adSpendStat(p),
      ];
    case "NEEDS_ADS":
      return [
        velocityStat(p),
        returnRateStat(p),
        { label: "Ad spend", value: "0 — no Meta delivery", color: "#C6F04D" },
        roasStat(p),
      ];
  }
}

/**
 * Recommended next steps straight from the engine: every action of every alert
 * in the card, in alert-urgency order. When a card merges several alert types,
 * each row gets the alert's headline as a hint so the source stays clear.
 */
function buildChecklist(entry: GroupEntry): ChecklistItem[] {
  const merged = new Set(entry.alerts.map((a) => a.type)).size > 1;
  return entry.alerts.flatMap((a) =>
    a.actions.map((label, i) => ({
      id: `${a.id}-a${i}`,
      label,
      hint: merged ? a.title : undefined,
    }))
  );
}

export function alertCardContent(entry: GroupEntry): AlertCardContent {
  const primary = entry.alerts[0];
  const group = groupForAlert(primary);
  return {
    // "Why" = the engine's alert messages, already filled with the numbers.
    reasons: entry.alerts.map((a) => a.message),
    stats: statsFor(entry.product, primary),
    checklist: buildChecklist(entry),
    cashRecovery:
      group === "SELL_OFF" ? liquidationRecovery(entry.product) : undefined,
  };
}

// ─── Summary strip + resolved history ───────────────────────────────────────

/**
 * ~$/day of Meta spend at risk from supplier problems — the live daily ad
 * spend on products with a SUPPLIER_OUT or SUPPLIER_LOW alert.
 */
export function supplierRiskDailySpend(): number {
  const riskTypes: AlertType[] = ["SUPPLIER_OUT", "SUPPLIER_LOW"];
  return products
    .filter((p) => p.alerts.some((a) => riskTypes.includes(a.type)))
    .reduce((a, p) => a + dailyAdSpend(p), 0);
}

/**
 * "Safe" auto-apply actions = pausing Meta campaigns on products the supplier
 * is out of (SUPPLIER_OUT) + reducing daily budgets where supplier cover is
 * under ~7 days (SUPPLIER_LOW). One action per affected product.
 */
export function safeActionCount(): number {
  const safeTypes: AlertType[] = ["SUPPLIER_OUT", "SUPPLIER_LOW"];
  return products.filter((p) => p.alerts.some((a) => safeTypes.includes(a.type))).length;
}

export interface ResolvedEntry {
  productName: string;
  note: string;
  when: string;
}

/** Recently resolved history. Names resolved from the canonical dataset. */
export const RESOLVED_HISTORY: ResolvedEntry[] = [
  {
    productName: getProduct("pld-005")?.name ?? "DreamWave Headband",
    note: "supplier-out handled — ads stopped, returned stock sold to zero",
    when: "2 days ago",
  },
  {
    productName: getProduct("pld-008")?.name ?? "AlignPro Corrector",
    note: "returned stock sell-off completed — lifecycle closed",
    when: "1 week ago",
  },
  {
    productName: getProduct("pld-012")?.name ?? "HydroGlow Bottle",
    note: "created in Odoo — ready for first campaign",
    when: "5 days ago",
  },
];
