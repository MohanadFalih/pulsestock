/**
 * PulseStock alert engine — rev1 (buy-on-demand model).
 *
 * The business is BUY-ON-DEMAND: units are purchased from Turkish suppliers
 * (listed on butiksistem.com) only after orders exist in Odoo. The warehouse
 * holds almost exclusively RETURNED units. This module is therefore a
 * TRACKING-first alert engine, not a verdict engine: it watches return rates,
 * supplier stock cover, and returned-stock sell-through, and raises typed
 * alerts with recommended actions.
 *
 * All thresholds live in `ALERT_THRESHOLDS` so the rules are tunable in one
 * place. Page agents: import these helpers instead of hard-coding thresholds.
 *
 * Kept from v1 (unchanged API): `roasHealth`, `HEALTH_COLOR`, `ROAS_RULES`,
 * `STAGE_META`/`STAGE_ORDER` (re-keyed to the 8 new stages), `Health`.
 * Updated: `returnRateHealth` now uses the 25/35 bands.
 * Renamed: `DECISION_URGENCY` → `ALERT_URGENCY`.
 * Deprecated legacy exports kept only so shared components still compile:
 * `Decision`, `DECISION_META` (DecisionBadge), `SupplierState`, `SUPPLIER_META`
 * (SupplierPill), `RETURN_RULES` (ReturnRateMeter). Page agents should migrate
 * to the alert API and drop these.
 */

import type { Product } from "./products";

// ─── Lifecycle stages (buy-on-demand pipeline) ───────────────────────────────

/**
 * The 8 lifecycle stages, in order:
 * shared → created → ads-live → selling → supplier-low → organic-only →
 * selling-returns → completed.
 */
export type Stage =
  | "shared" // supplier shared the product on butiksistem, not yet in Odoo
  | "created" // created in Odoo, no ads yet
  | "ads-live" // first Meta campaign running, gathering data
  | "no-ads" // ads-live-aged (orders>0, <10 delivered) but Meta shows NO
  // delivery for this SKU in the selected window — verified by the frontend
  // against the live ads endpoint; selling on organic/shopify/chat pull
  | "selling" // healthy selling, buying on demand
  | "supplier-low" // butiksistem stock running out — prepare to stop ads
  | "organic-only" // ads stopped, organic orders only
  | "selling-returns" // only returned stock left, sell it off
  | "completed"; // stock = 0, product life over

export interface StageMeta {
  key: Stage;
  label: string;
  color: string;
}

/**
 * Ordered stage spectrum per design.md §2 (violet → … → gray).
 * `shared` gets the violet end (#A78BFA), `completed` the gray end (#8A95A1).
 */
export const STAGE_META: Record<Stage, StageMeta> = {
  shared: { key: "shared", label: "Shared", color: "#A78BFA" },
  created: { key: "created", label: "Created", color: "#8B7CFF" },
  "ads-live": { key: "ads-live", label: "Ads Live", color: "#45B7F5" },
  "no-ads": { key: "no-ads", label: "No Ads", color: "#C6F04D" },
  selling: { key: "selling", label: "Selling", color: "#4ADE80" },
  "supplier-low": { key: "supplier-low", label: "Supplier Low", color: "#FBBF24" },
  "organic-only": { key: "organic-only", label: "Organic Only", color: "#FB923C" },
  "selling-returns": { key: "selling-returns", label: "Selling Returns", color: "#FB5D7A" },
  completed: { key: "completed", label: "Completed", color: "#8A95A1" },
};

export const STAGE_ORDER: Stage[] = [
  "shared",
  "created",
  "ads-live",
  "no-ads",
  "selling",
  "supplier-low",
  "organic-only",
  "selling-returns",
  "completed",
];

// ─── Tunable thresholds ──────────────────────────────────────────────────────

export const ALERT_THRESHOLDS = {
  /** Return rate at or below this % is healthy. */
  RETURN_RATE_OK: 25,
  /** Return rate above this % signals a product issue (25–35 = watch). */
  RETURN_RATE_WATCH: 35,
  /** Delivered orders needed before the return rate is measurable at all. */
  DELIVERED_EARLY: 10,
  /** Delivered orders needed for a confident return-rate reading. */
  DELIVERED_CONFIDENT: 20,
  /** Supplier stock cover (days at current order velocity) below which ads
   *  should be wound down. */
  SUPPLIER_LOW_DAYS: 7,
  /** Days without orders before on-hand returned stock is considered stale. */
  STALE_ORDER_DAYS: 7,
  /** Supplier cover (days) at or above which scaling is stock-safe. */
  SCALE_COVER_SAFE_DAYS: 14,
  /** Supplier cover (days) below which scaling is blocked. */
  SCALE_COVER_MIN_DAYS: 7,
  /** ROAS at or above which scaling is economically safe. */
  SCALE_ROAS_MIN: 1.8,
  /** ROAS below which scaling is blocked (1.5–1.8 = caution). */
  SCALE_ROAS_CAUTION: 1.5,
} as const;

export const ROAS_RULES = {
  /** Below this the product loses money on ads. */
  breakeven: 1.8,
  /** Above this the product is a proven winner. */
  winner: 2.5,
} as const;

// ─── Health helpers ──────────────────────────────────────────────────────────

export type Health = "good" | "warn" | "bad";

/** ROAS → health: <1.8 red, 1.8–2.5 amber, >2.5 green. (Unchanged from v1.) */
export function roasHealth(roas: number | null): Health {
  if (roas == null) return "warn";
  if (roas < ROAS_RULES.breakeven) return "bad";
  if (roas <= ROAS_RULES.winner) return "warn";
  return "good";
}

/**
 * Return rate % → health, rev1 bands: ≤25 green, 25–35 amber, >35 red.
 * `null` (nothing delivered yet) → warn.
 */
export function returnRateHealth(pct: number | null): Health {
  if (pct == null) return "warn";
  if (pct <= ALERT_THRESHOLDS.RETURN_RATE_OK) return "good";
  if (pct <= ALERT_THRESHOLDS.RETURN_RATE_WATCH) return "warn";
  return "bad";
}

/** Hex color for a health value (matches data semantics in design.md). */
export const HEALTH_COLOR: Record<Health, string> = {
  good: "#4ADE80",
  warn: "#FBBF24",
  bad: "#FB5D7A",
};

// ─── Return-rate confidence ──────────────────────────────────────────────────

/**
 * How much we can trust a product's return rate, based on delivered volume:
 * 'insufficient' (<10 delivered — show "collecting data"),
 * 'early' (10–19), 'confident' (20+).
 */
export type ReturnConfidence = "insufficient" | "early" | "confident";

export function returnConfidenceFor(deliveredCount: number): ReturnConfidence {
  if (deliveredCount >= ALERT_THRESHOLDS.DELIVERED_CONFIDENT) return "confident";
  if (deliveredCount >= ALERT_THRESHOLDS.DELIVERED_EARLY) return "early";
  return "insufficient";
}

/** returnRate = returned / delivered * 100; null when nothing delivered. */
export function returnRateFor(delivered: number, returned: number): number | null {
  if (delivered <= 0) return null;
  return Math.round((returned / delivered) * 1000) / 10;
}

// ─── Supplier stock (butiksistem.com) ────────────────────────────────────────

export interface SupplierStock {
  /**
   * Units currently available at the supplier on butiksistem.com.
   * `null` = unknown (butiksistem not connected yet — live Odoo sync mode).
   */
  qty: number | null;
  /** ISO date the qty was last checked; `null` = never checked. */
  lastChecked: string | null;
  /** How the qty was obtained. */
  source: "manual" | "api";
}

/**
 * Days of cover at the current order velocity. `Infinity` when velocity is 0
 * or when the supplier qty is unknown (null — butiksistem not connected), so
 * unknown stock never triggers low/out rules.
 */
export function supplierCoverDays(qty: number | null, orderVelocity7d: number): number {
  if (qty == null) return Infinity;
  if (orderVelocity7d <= 0) return qty > 0 ? Infinity : 0;
  return Math.round((qty / orderVelocity7d) * 10) / 10;
}

// ─── Alert model ─────────────────────────────────────────────────────────────

export type AlertType =
  | "HIGH_RETURNS" // confident/early return rate > 25% (watch) or > 35% (issue)
  | "SUPPLIER_LOW" // supplier stock below ~7 days of order velocity
  | "SUPPLIER_OUT" // supplier stock = 0 while ads should be running
  | "SELL_RETURNS" // organic-only / selling-returns with returnedStock > 0
  | "STALE_RETURN_STOCK" // returnedStock > 0 and no orders in 7+ days
  | "READY_TO_JUDGE" // delivered count just crossed 10 during ads-live
  | "COLLECTING_DATA" // ads-live with <10 delivered (informational)
  | "NEEDS_ADS"; // selling with zero Meta delivery in the window — launch ads

export type AlertSeverity = "info" | "watch" | "issue" | "critical";

export interface Alert {
  /** Stable id: `${productId}:${type}`. */
  id: string;
  productId: string;
  type: AlertType;
  severity: AlertSeverity;
  /** Short headline. */
  title: string;
  /** Message template filled with the product's numbers. */
  message: string;
  /** Recommended actions, in order. */
  actions: string[];
}

export interface AlertMeta {
  key: AlertType;
  label: string;
  color: string;
  /** 25%-alpha border tint. */
  border: string;
  /** 8%-alpha background tint. */
  bg: string;
  description: string;
}

export const ALERT_META: Record<AlertType, AlertMeta> = {
  SUPPLIER_OUT: {
    key: "SUPPLIER_OUT",
    label: "Supplier Out",
    color: "#FB5D7A",
    border: "#FB5D7A40",
    bg: "#FB5D7A14",
    description: "Supplier stock is 0 — stop ads now, switch to organic",
  },
  HIGH_RETURNS: {
    key: "HIGH_RETURNS",
    label: "High Returns",
    color: "#FB923C",
    border: "#FB923C40",
    bg: "#FB923C14",
    description: "Return rate above the healthy 25% band",
  },
  SUPPLIER_LOW: {
    key: "SUPPLIER_LOW",
    label: "Supplier Low",
    color: "#FBBF24",
    border: "#FBBF2440",
    bg: "#FBBF2414",
    description: "Supplier stock below ~7 days of order velocity — prepare to stop ads",
  },
  STALE_RETURN_STOCK: {
    key: "STALE_RETURN_STOCK",
    label: "Stale Return Stock",
    color: "#B9C2CC",
    border: "#4A5560",
    bg: "#3A444F33",
    description: "Returned units sitting 7+ days with no orders — needs a revival play",
  },
  SELL_RETURNS: {
    key: "SELL_RETURNS",
    label: "Sell Returns",
    color: "#3EE6D8",
    border: "#3EE6D840",
    bg: "#3EE6D814",
    description: "Only returned stock left — sell it off",
  },
  READY_TO_JUDGE: {
    key: "READY_TO_JUDGE",
    label: "Ready to Judge",
    color: "#4ADE80",
    border: "#4ADE8040",
    bg: "#4ADE8014",
    description: "Delivered count crossed 10 — return rate is now measurable",
  },
  COLLECTING_DATA: {
    key: "COLLECTING_DATA",
    label: "Collecting Data",
    color: "#45B7F5",
    border: "#45B7F540",
    bg: "#45B7F514",
    description: "Ads live, fewer than 10 delivered orders — too early to judge",
  },
  NEEDS_ADS: {
    key: "NEEDS_ADS",
    label: "Needs Ads",
    color: "#C6F04D",
    border: "#C6F04D40",
    bg: "#C6F04D14",
    description: "Orders coming in with zero Meta ad delivery — proven pull, launch a campaign",
  },
};

export const SEVERITY_META: Record<
  AlertSeverity,
  { label: string; color: string }
> = {
  info: { label: "Info", color: "#45B7F5" },
  watch: { label: "Watch", color: "#FBBF24" },
  issue: { label: "Issue", color: "#FB923C" },
  critical: { label: "Critical", color: "#FB5D7A" },
};

/** Urgency rank for the alerts queue (lower = more urgent). */
export const ALERT_URGENCY: Record<AlertType, number> = {
  SUPPLIER_OUT: 0,
  HIGH_RETURNS: 1,
  SUPPLIER_LOW: 2,
  STALE_RETURN_STOCK: 3,
  SELL_RETURNS: 4,
  NEEDS_ADS: 5,
  READY_TO_JUDGE: 6,
  COLLECTING_DATA: 7,
};

// ─── Alert derivation ────────────────────────────────────────────────────────

export interface AlertInput {
  stage: Stage;
  /** returned / delivered * 100; null when nothing delivered. */
  returnRate: number | null;
  returnConfidence: ReturnConfidence;
  deliveredCount: number;
  /** butiksistem supplier units; null = unknown (not connected). */
  supplierQty: number | null;
  /** On-hand returned units (the warehouse stock). */
  returnedStock: number;
  /** Orders per day, trailing 7 days (chat + website). */
  orderVelocity7d: number;
  /** Days since the last order; null = never ordered. */
  daysSinceLastOrder: number | null;
  /**
   * Did Meta show ad delivery for this SKU in the selected window?
   * true/false when the ads endpoint answered; null/undefined = unknown
   * (ads offline) — the NEEDS_ADS rule only fires on a confident false.
   */
  metaAdsDetected?: boolean | null;
}

/** Stages where Meta ads are (or should be) running. */
const ADS_RUNNING_STAGES: Stage[] = ["ads-live", "selling", "supplier-low"];
/** Stages past the ads era, where only organic / returned stock sells. */
const POST_ADS_STAGES: Stage[] = ["organic-only", "selling-returns"];

function makeAlert(
  productId: string,
  type: AlertType,
  severity: AlertSeverity,
  title: string,
  message: string,
  actions: string[]
): Alert {
  return { id: `${productId}:${type}`, productId, type, severity, title, message, actions };
}

/**
 * Derive all active alerts for a product. Rules (priority = ALERT_URGENCY):
 *
 *  - SUPPLIER_OUT        qty = 0 while ads running → STOP ADS now, go organic.
 *  - HIGH_RETURNS        confidence ≠ insufficient AND rate > 25% (watch) / > 35% (issue).
 *  - SUPPLIER_LOW        qty < ~7 days of order velocity → prepare to stop ads.
 *  - STALE_RETURN_STOCK  returnedStock > 0 AND no orders in 7+ days → revival play.
 *  - SELL_RETURNS        organic-only / selling-returns with returnedStock > 0.
 *  - READY_TO_JUDGE      ads-live AND delivered ≥ 10 → return rate now measurable.
 *  - COLLECTING_DATA     ads-live AND delivered < 10 → informational.
 *
 * `shared`, `created` and `completed` products produce no alerts.
 */
export function deriveAlerts(input: AlertInput, productId: string): Alert[] {
  const alerts: Alert[] = [];
  const {
    stage, returnRate, returnConfidence, deliveredCount,
    supplierQty, returnedStock, orderVelocity7d, daysSinceLastOrder,
    metaAdsDetected,
  } = input;

  if (stage === "shared" || stage === "created" || stage === "completed") {
    return alerts;
  }

  // NEEDS_ADS — verified zero Meta delivery in the selected window while
  // orders keep coming (no-ads = young product, selling = established).
  // Only on a confident false: when the ads endpoint is offline we don't
  // know, so we stay quiet.
  if (
    metaAdsDetected === false &&
    orderVelocity7d > 0 &&
    (stage === "no-ads" || stage === "selling")
  ) {
    alerts.push(
      makeAlert(productId, "NEEDS_ADS", "watch", "Selling without ads",
        `${orderVelocity7d.toFixed(1)} orders/day (7d) with ZERO Meta ad delivery in the selected window — proven organic pull. This product is a candidate for a paid campaign.`,
        [
          "Launch a small test campaign (~$10–20/day)",
          "Put the SKU in the ad name so PulseStock tracks it",
          "Judge against the $14.08 target CPA after 10 delivered orders",
        ])
    );
  }

  const adsRunning = ADS_RUNNING_STAGES.includes(stage);
  const coverDays = supplierCoverDays(supplierQty, orderVelocity7d);

  // SUPPLIER_OUT — no supplier stock while ads are expected to run.
  if (adsRunning && supplierQty === 0) {
    alerts.push(
      makeAlert(productId, "SUPPLIER_OUT", "critical", "Supplier out of stock",
        "butiksistem stock is 0. STOP ADS now and switch to organic orders only.",
        [
          "Pause all Meta campaigns immediately",
          "Switch product to organic-only mode",
          "Check butiksistem for restock or an alternative supplier",
          "Sell remaining returned stock",
        ])
    );
  }

  // HIGH_RETURNS — only meaningful once the return rate is measurable.
  if (
    returnConfidence !== "insufficient" &&
    returnRate != null &&
    returnRate > ALERT_THRESHOLDS.RETURN_RATE_OK
  ) {
    const issue = returnRate > ALERT_THRESHOLDS.RETURN_RATE_WATCH;
    alerts.push(
      makeAlert(productId, "HIGH_RETURNS", issue ? "issue" : "watch",
        issue ? "Return rate above 35%" : "Return rate above 25%",
        `Return rate ${returnRate.toFixed(1)}% over ${deliveredCount} delivered orders (${returnConfidence} reading)${
          issue
            ? " — likely a product/expectation issue."
            : " — above the healthy 25% band, watch it."
        }`,
        issue
          ? [
              "Review product quality vs. ad promise",
              "Tighten ad creative and product-page claims",
              "Consider stopping ads and selling off returned stock",
            ]
          : [
              "Monitor daily while volume grows",
              "Check return reasons in Odoo chat orders",
              "Review sizing/expectation mismatch in ad copy",
            ])
    );
  }

  // SUPPLIER_LOW — fewer than ~7 days of cover at current velocity.
  if (
    adsRunning &&
    supplierQty != null &&
    supplierQty > 0 &&
    orderVelocity7d > 0 &&
    coverDays < ALERT_THRESHOLDS.SUPPLIER_LOW_DAYS
  ) {
    alerts.push(
      makeAlert(productId, "SUPPLIER_LOW", "watch", "Supplier stock running low",
        `${supplierQty} units left at supplier ≈ ${coverDays} days at current velocity (${orderVelocity7d}/day). Prepare to stop ads.`,
        [
          "Reduce daily ad budget",
          "Confirm restock timeline with the supplier on butiksistem",
          "Plan the switch to organic-only when stock hits 0",
        ])
    );
  }

  // STALE_RETURN_STOCK — returned units sitting with no orders for 7+ days.
  if (
    returnedStock > 0 &&
    daysSinceLastOrder != null &&
    daysSinceLastOrder >= ALERT_THRESHOLDS.STALE_ORDER_DAYS
  ) {
    alerts.push(
      makeAlert(productId, "STALE_RETURN_STOCK", "watch", "Returned stock going stale",
        `${returnedStock} returned units on hand and no orders in ${daysSinceLastOrder} days.`,
        [
          "Re-post the product organically (stories, groups)",
          "Try a new ad angle with a small budget",
          "Run a discount or bundle it with a seller",
        ])
    );
  }

  // SELL_RETURNS — post-ads stages with returned stock to clear.
  if (POST_ADS_STAGES.includes(stage) && returnedStock > 0) {
    alerts.push(
      makeAlert(productId, "SELL_RETURNS", "info", "Sell off returned stock",
        `${returnedStock} returned units on hand — the only stock left. Push organic sell-through to zero.`,
        [
          "Re-post organically 2–3× per week",
          "Offer a small discount or free shipping",
          "Message past chat-order leads in Odoo",
        ])
    );
  }

  // READY_TO_JUDGE / COLLECTING_DATA — ads-live measurement state.
  if (stage === "ads-live") {
    if (deliveredCount >= ALERT_THRESHOLDS.DELIVERED_EARLY) {
      alerts.push(
        makeAlert(productId, "READY_TO_JUDGE", "info", "Return rate now measurable",
          `${deliveredCount} orders delivered — the return rate (${
            returnRate != null ? `${returnRate.toFixed(1)}%` : "—"
          }) just crossed the 10-delivered threshold and can be judged.`,
          [
            "Check return rate against the 25% healthy band",
            "Decide: keep scaling, watch, or stop ads",
          ])
      );
    } else {
      alerts.push(
        makeAlert(productId, "COLLECTING_DATA", "info", "Collecting data",
          `${deliveredCount}/10 orders delivered — too early to judge the return rate.`,
          [
            "Keep the first campaign running",
            "Re-check once 10 orders are delivered",
          ])
      );
    }
  }

  return alerts.sort((a, b) => ALERT_URGENCY[a.type] - ALERT_URGENCY[b.type]);
}

/** Highest urgency rank among alerts; null when there are none. */
export function topAlertUrgency(alerts: Alert[]): number | null {
  if (alerts.length === 0) return null;
  return Math.min(...alerts.map((a) => ALERT_URGENCY[a.type]));
}

/** Worst severity among alerts; null when there are none. */
export function worstSeverity(alerts: Alert[]): AlertSeverity | null {
  const rank: Record<AlertSeverity, number> = { info: 0, watch: 1, issue: 2, critical: 3 };
  if (alerts.length === 0) return null;
  return alerts.reduce<AlertSeverity>(
    (worst, a) => (rank[a.severity] > rank[worst] ? a.severity : worst),
    "info"
  );
}

// ─── Deprecated legacy exports (v1) — kept so shared components compile ──────
// TODO(page-agents): migrate DecisionBadge → alert-based badge, SupplierPill →
// qty-based supplier pill, ReturnRateMeter → 25/35 bands; then delete this block.

/** @deprecated v1 verdicts — replaced by `AlertType` / `deriveAlerts`. */
export type Decision =
  | "SCALE"
  | "KEEP"
  | "KILL"
  | "STOP_ADS"
  | "DEAD_STOCK"
  | "ONBOARDING";

export interface DecisionMeta {
  key: Decision;
  label: string;
  color: string;
  border: string;
  bg: string;
  description: string;
}

/** @deprecated v1 verdict metadata — replaced by `ALERT_META`. */
export const DECISION_META: Record<Decision, DecisionMeta> = {
  SCALE: {
    key: "SCALE", label: "SCALE", color: "#4ADE80",
    border: "#4ADE8040", bg: "#4ADE8014",
    description: "Increase ad budget, reorder big",
  },
  KEEP: {
    key: "KEEP", label: "KEEP", color: "#45B7F5",
    border: "#45B7F540", bg: "#45B7F514",
    description: "Keep selling as-is, monitor",
  },
  KILL: {
    key: "KILL", label: "KILL", color: "#FB5D7A",
    border: "#FB5D7A40", bg: "#FB5D7A14",
    description: "Stop selling, liquidate",
  },
  STOP_ADS: {
    key: "STOP_ADS", label: "STOP ADS", color: "#FBBF24",
    border: "#FBBF2440", bg: "#FBBF2414",
    description: "Supplier can't fulfill — pause spend now",
  },
  DEAD_STOCK: {
    key: "DEAD_STOCK", label: "DEAD STOCK", color: "#B9C2CC",
    border: "#4A5560", bg: "#3A444F33",
    description: "Returned/unsold units, needs revival play",
  },
  ONBOARDING: {
    key: "ONBOARDING", label: "ONBOARDING", color: "#8B7CFF",
    border: "#8B7CFF40", bg: "#8B7CFF14",
    description: "New intake, no verdict yet",
  },
};

/** @deprecated v1 supplier status enum — replaced by `SupplierStock.qty`. */
export type SupplierState = "in-stock" | "low" | "delayed" | "out-of-stock";

/** @deprecated v1 supplier status metadata — kept for SupplierPill. */
export const SUPPLIER_META: Record<
  SupplierState,
  { label: string; color: string }
> = {
  "in-stock": { label: "In stock", color: "#4ADE80" },
  low: { label: "Low", color: "#FBBF24" },
  delayed: { label: "Delayed", color: "#FB923C" },
  "out-of-stock": { label: "Out of stock", color: "#FB5D7A" },
};

/**
 * @deprecated v1 return bands — replaced by ALERT_THRESHOLDS.RETURN_RATE_OK /
 * RETURN_RATE_WATCH. Kept with updated 25/35 values for ReturnRateMeter.
 */
export const RETURN_RULES = {
  good: ALERT_THRESHOLDS.RETURN_RATE_OK,
  danger: ALERT_THRESHOLDS.RETURN_RATE_WATCH,
} as const;

// ─── Safe-to-scale traffic light ─────────────────────────────────────────────
//
// Meta Ads Manager answers WHEN to scale; PulseStock only answers whether it
// is SAFE to scale — supplier stock depth, return-rate reality, and delivery
// economics that Meta cannot see. Signal only: no budget controls here.

export type ScaleReadiness = "safe" | "caution" | "blocked" | "not-applicable";

export interface ScaleCheck {
  label: string;
  /** true = pass, false = fail (drives blocked), null = not measurable / watch. */
  ok: boolean | null;
  detail: string;
}

export interface ScaleVerdict {
  readiness: ScaleReadiness;
  /** Human-readable drivers, most important first. */
  reasons: string[];
  /** Per-signal breakdown for tooltips / vitals rows. */
  checks: ScaleCheck[];
}

/** Stages with nothing to scale — ads stopped or never started. */
const SCALE_NOT_APPLICABLE_STAGES: Stage[] = [
  "shared",
  "created",
  "completed",
  "selling-returns",
  "organic-only",
];

function fmtDays(cover: number): string {
  return cover === Infinity ? "∞" : cover.toFixed(1);
}

/**
 * Traffic-light verdict: is it safe to push more budget in Meta?
 *
 *  - not-applicable  stage has no live ads (shared/created/completed/
 *                    selling-returns/organic-only).
 *  - blocked         supplier qty = 0, cover < 7d, measured return rate > 35%,
 *                    or ROAS < 1.5.
 *  - caution         cover 7–14d, return rate not measurable yet (insufficient
 *                    data), return rate 25–35%, ROAS 1.5–1.8, or no 7d sales
 *                    velocity (nothing to amplify).
 *  - safe            velocity > 0, cover ≥ 14d, returns healthy, ROAS ≥ 1.8.
 */
export function scaleReadiness(p: Product): ScaleVerdict {
  if (SCALE_NOT_APPLICABLE_STAGES.includes(p.stage)) {
    return {
      readiness: "not-applicable",
      reasons: ["Nothing to scale — ads stopped or not started"],
      checks: [],
    };
  }

  const cover = supplierCoverDays(p.supplierStock.qty, p.orderVelocity7d);
  const T = ALERT_THRESHOLDS;
  const n = p.deliveredCount;

  // ── Supplier cover check ──
  let coverCheck: ScaleCheck;
  if (p.supplierStock.qty == null) {
    coverCheck = {
      label: "Supplier cover",
      ok: null,
      detail: "Supplier stock unknown — butiksistem not connected yet",
    };
  } else if (p.supplierStock.qty === 0) {
    coverCheck = { label: "Supplier cover", ok: false, detail: "Supplier out of stock (0 units)" };
  } else if (cover < T.SCALE_COVER_MIN_DAYS) {
    coverCheck = {
      label: "Supplier cover",
      ok: false,
      detail: `Only ${fmtDays(cover)} days of supplier stock at current velocity`,
    };
  } else if (cover < T.SCALE_COVER_SAFE_DAYS) {
    coverCheck = {
      label: "Supplier cover",
      ok: null,
      detail: `${fmtDays(cover)} days of cover — below the ${T.SCALE_COVER_SAFE_DAYS}d safe band`,
    };
  } else {
    coverCheck = {
      label: "Supplier cover",
      ok: true,
      detail:
        cover === Infinity
          ? `${p.supplierStock.qty.toLocaleString()} units in stock, no 7d velocity`
          : `${fmtDays(cover)} days of cover at ${p.orderVelocity7d}/day`,
    };
  }

  // ── Return rate check ──
  let returnCheck: ScaleCheck;
  if (p.returnConfidence === "insufficient") {
    returnCheck = {
      label: "Return rate",
      ok: null,
      detail: `Collecting data — n=${n} delivered, not measurable yet`,
    };
  } else if (p.returnRate != null && p.returnRate > T.RETURN_RATE_WATCH) {
    returnCheck = {
      label: "Return rate",
      ok: false,
      detail: `${p.returnRate.toFixed(1)}% returns (n=${n}) — above ${T.RETURN_RATE_WATCH}%`,
    };
  } else if (p.returnRate != null && p.returnRate > T.RETURN_RATE_OK) {
    returnCheck = {
      label: "Return rate",
      ok: null,
      detail: `${p.returnRate.toFixed(1)}% returns (n=${n}) — ${T.RETURN_RATE_OK}–${T.RETURN_RATE_WATCH}% watch zone`,
    };
  } else {
    returnCheck = {
      label: "Return rate",
      ok: true,
      detail:
        p.returnRate != null
          ? `${p.returnRate.toFixed(1)}% returns (n=${n}) — healthy`
          : "No returns recorded yet",
    };
  }

  // ── ROAS check ──
  let roasCheck: ScaleCheck;
  if (p.roas == null) {
    roasCheck = { label: "ROAS", ok: null, detail: "No ad spend yet — ROAS not measurable" };
  } else if (p.roas < T.SCALE_ROAS_CAUTION) {
    roasCheck = {
      label: "ROAS",
      ok: false,
      detail: `ROAS ${p.roas.toFixed(2)} — below ${T.SCALE_ROAS_CAUTION} floor`,
    };
  } else if (p.roas < T.SCALE_ROAS_MIN) {
    roasCheck = {
      label: "ROAS",
      ok: null,
      detail: `ROAS ${p.roas.toFixed(2)} — below the ${T.SCALE_ROAS_MIN} target`,
    };
  } else {
    roasCheck = { label: "ROAS", ok: true, detail: `ROAS ${p.roas.toFixed(2)} — above ${T.SCALE_ROAS_MIN}` };
  }

  // ── Sales velocity check ──
  const velocityCheck: ScaleCheck =
    p.orderVelocity7d > 0
      ? {
          label: "Sales velocity",
          ok: true,
          detail: `${p.orderVelocity7d} orders/day over the last 7 days`,
        }
      : {
          label: "Sales velocity",
          ok: null,
          detail: "No orders in the last 7 days — nothing to amplify",
        };

  const checks: ScaleCheck[] = [coverCheck, returnCheck, roasCheck, velocityCheck];

  // ── Verdict: any hard fail blocks; any watch item cautions; else safe. ──
  const blockedReasons: string[] = [];
  const cautionReasons: string[] = [];

  if (p.supplierStock.qty == null) {
    cautionReasons.push("Supplier stock unknown — butiksistem not connected");
  } else if (p.supplierStock.qty === 0) {
    blockedReasons.push("Supplier out of stock (0 units)");
  } else if (cover < T.SCALE_COVER_MIN_DAYS) {
    blockedReasons.push(`Supplier cover only ${fmtDays(cover)} days`);
  }
  if (
    p.returnConfidence !== "insufficient" &&
    p.returnRate != null &&
    p.returnRate > T.RETURN_RATE_WATCH
  ) {
    blockedReasons.push(`Return rate ${p.returnRate.toFixed(1)}% above ${T.RETURN_RATE_WATCH}%`);
  }
  if (p.roas != null && p.roas < T.SCALE_ROAS_CAUTION) {
    blockedReasons.push(`ROAS ${p.roas.toFixed(2)} below ${T.SCALE_ROAS_CAUTION}`);
  }
  if (blockedReasons.length > 0) {
    return { readiness: "blocked", reasons: blockedReasons, checks };
  }

  if (p.supplierStock.qty != null && p.supplierStock.qty > 0 && cover < T.SCALE_COVER_SAFE_DAYS) {
    cautionReasons.push(`Supplier cover only ${fmtDays(cover)} days`);
  }
  if (p.returnConfidence === "insufficient") {
    cautionReasons.push("Return rate not measurable yet");
  } else if (p.returnRate != null && p.returnRate > T.RETURN_RATE_OK) {
    cautionReasons.push(`Return rate ${p.returnRate.toFixed(1)}% in the watch zone`);
  }
  if (p.roas != null && p.roas < T.SCALE_ROAS_MIN) {
    cautionReasons.push(`ROAS ${p.roas.toFixed(2)} below the ${T.SCALE_ROAS_MIN} target`);
  }
  if (p.orderVelocity7d <= 0) {
    cautionReasons.push("No sales velocity in the last 7 days");
  }
  if (cautionReasons.length > 0) {
    return { readiness: "caution", reasons: cautionReasons, checks };
  }

  return {
    readiness: "safe",
    reasons: ["All signals green — safe to push budget in Meta"],
    checks,
  };
}
