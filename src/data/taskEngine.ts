/**
 * PulseStock daily task engine — the owner's "war room" rule set.
 *
 * Pure functions only: rules read the canonical product list (already overlaid
 * with Meta ads data by liveSync when available) plus the optional ops blocks
 * (`ordersDetail` / `stockDetail` from live.json via opsData.ts) and emit a
 * flat list of typed daily tasks. No fetching, no React, no localStorage —
 * persistence lives in taskStore.ts, rendering in pages/Tasks.tsx.
 *
 * Sections map to roles in the shop:
 *   ads        — the owner runs Meta ads (kill losers, test organic winners,
 *                scale proven ones)
 *   publishing — new models must go live every day
 *   direct     — clearance / direct-sales employee moves stale stock
 *   followup   — product-quality and supplier-stock follow-ups
 *   confirm    — order confirmation desk (needs ordersDetail)
 *
 * Every rule degrades honestly: when a data source is missing the rule stays
 * quiet and reports via `TaskEngineResult.missing` so the page can show a
 * "sync pending" empty state instead of fabricated tasks.
 */

import { ALERT_THRESHOLDS } from "./decisionEngine";
import { isTrafficAd } from "./adsProvider";
import type { Product } from "./products";
import type { OpsPayload, OpsStockItem } from "./opsData";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TaskSection = "ads" | "publishing" | "direct" | "followup" | "confirm";

export type TaskPriority = "critical" | "high" | "normal" | "low";

/** Rule identifier — drives the display grouping on the Tasks page. */
export type TaskRule =
  | "kill"
  | "stopped"
  | "scale"
  | "test"
  | "publish"
  | "publish-quota"
  | "discount"
  | "direct-quota"
  | "review"
  | "supplier-check"
  | "confirm-order";

export interface TaskProgress {
  done: number;
  target: number;
}

export interface Task {
  /** Stable per day: `${rule}:${key}` — completion is stored per task+date. */
  id: string;
  rule: TaskRule;
  section: TaskSection;
  priority: TaskPriority;
  /** Short headline, e.g. "Stop ad PLD-013 — $320 spent, no sale". */
  title: string;
  /** One-line supporting detail with the numbers behind the rule. */
  detail: string;
  sku?: string;
  /** In-app route when the task has an obvious place to act. */
  link?: string;
  /** USD (mock) / IQD (live) amount at stake — kill rules carry spend. */
  moneyAtStake?: number;
  /** Quota tasks only: today's progress toward the target. */
  progress?: TaskProgress;
}

/** Tunable thresholds — one place, mirroring ALERT_THRESHOLDS conventions. */
export interface TaskEngineConfig {
  /** Active-ad USD spend with zero purchases before the kill rule fires. */
  killSpendThreshold: number;
  /** Cost-per-purchase below which a product is a scale candidate. */
  scaleCppTarget: number;
  /** Purchases needed (snapshot mode) before scaling is proposed. */
  scaleMinPurchases: number;
  /** Orders in the trailing 7d that mark an organic winner worth testing. */
  testMinOrders7d: number;
  /** New models the publishing role should push live per day. */
  publishTargetPerDay: number;
  /** Stale units the direct-sales role should list per day. */
  directListTargetPerDay: number;
  /** Stock age ladder in days → discount tier. */
  discountLadder: { ageDays: number; pct: number }[];
  /** Return rate % (with enough orders) that triggers a listing review. */
  reviewReturnRate: number;
  reviewMinOrders: number;
  /** Days since the last supplier-stock check before it counts as unknown. */
  supplierStaleDays: number;
}

export const DEFAULT_TASK_CONFIG: TaskEngineConfig = {
  killSpendThreshold: 35,
  scaleCppTarget: 12,
  scaleMinPurchases: 3,
  testMinOrders7d: 2,
  publishTargetPerDay: 2,
  directListTargetPerDay: 10,
  discountLadder: [
    { ageDays: 60, pct: 50 },
    { ageDays: 45, pct: 35 },
    { ageDays: 30, pct: 20 },
  ],
  reviewReturnRate: ALERT_THRESHOLDS.RETURN_RATE_WATCH, // 35%
  reviewMinOrders: 10,
  supplierStaleDays: 3,
};

export interface TaskEngineInput {
  products: Product[];
  /** Ops blocks from live.json; null when the snapshot predates them. */
  ops: OpsPayload | null;
  /**
   * "Today" for all age math. Mock mode passes ANCHOR_DATE so the rules are
   * consistent with the rest of the dashboard; live mode passes new Date().
   */
  now: Date;
  config?: Partial<TaskEngineConfig>;
  /**
   * True when Meta ads data (live or snapshot) was loaded this session.
   * When false the ads rules stay quiet and the page shows "sync pending".
   */
  adsAvailable: boolean;
}

export interface TaskEngineResult {
  tasks: Task[];
  /** Sections whose data source is missing (page shows a sync-pending state). */
  missing: Record<TaskSection, boolean>;
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function daysBetween(iso: string, now: Date): number {
  const t = Date.parse(`${iso}T00:00:00`);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

function sameDay(iso: string, now: Date): boolean {
  const d = new Date(`${iso}T00:00:00`);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Pick the discount tier for an age; null when below the lowest rung. */
function discountForAge(
  ageDays: number,
  ladder: TaskEngineConfig["discountLadder"]
): number | null {
  const sorted = [...ladder].sort((a, b) => b.ageDays - a.ageDays);
  for (const rung of sorted) {
    if (ageDays >= rung.ageDays) return rung.pct;
  }
  return null;
}

// ─── Section rules ───────────────────────────────────────────────────────────

/**
 * ADS — kill / scale / test. Needs Meta ads data on the products (`adsMeta`,
 * overlaid by liveSync). Without it, only the TEST rule can still fire — using
 * lifecycle stage as a degraded proxy for "no live ad" (organic-only / no-ads
 * stages are by definition selling without Meta delivery).
 */
/**
 * Traffic-objective ads (e.g. "DM_SHOP_Traffic" — landing-page-view campaigns)
 * must never trigger kill/scale rules: purchases are not their goal, so CPA
 * math is meaningless for them. Detection lives in adsProvider.isTrafficAd
 * (shared with the Ads page) — the bridge payload carries no objective field,
 * so we match the "traffic" naming convention. A product is traffic-exempt
 * only when ALL its live ads are traffic ads; mixed products are judged on
 * their non-traffic spend/purchases only.
 */

function adsRules(
  products: Product[],
  adsAvailable: boolean,
  cfg: TaskEngineConfig
): Task[] {
  const tasks: Task[] = [];

  for (const p of products) {
    const meta = p.adsMeta;

    // Traffic-only products: exempt from kill/scale (see isTrafficAd note).
    const conversionAds = meta ? meta.ads.filter((ad) => !isTrafficAd(ad)) : [];
    const convSpent = conversionAds.reduce((a, ad) => a + ad.spent, 0);
    const convPurchases = conversionAds.reduce((a, ad) => a + ad.purchases, 0);
    const trafficOnly =
      meta != null && meta.adCount > 0 && conversionAds.length === 0;

    // Delivery state — an ad only "delivers" when effectiveStatus is ACTIVE
    // (Meta reports ADSET_PAUSED/CAMPAIGN_PAUSED for ads whose toggle is on
    // but a parent is off, which is exactly how ads quietly stop).
    const liveConvAds = conversionAds.filter(
      (ad) => ad.effectiveStatus === "ACTIVE"
    );

    // STOPPED — conversion ads exist but none are delivering. Kill/scale are
    // meaningless while nothing runs: a stopped bleeder is already handled,
    // and scaling a paused ad is a wrong recommendation. If the health window
    // still shows purchases, the ad was working when it stopped — flag a
    // restart so a winner never sits paused unnoticed.
    if (meta && conversionAds.length > 0 && liveConvAds.length === 0) {
      const stoppedPurchases = conversionAds.reduce(
        (a, ad) => a + ad.healthPurchases,
        0
      );
      const stoppedSpent = conversionAds.reduce((a, ad) => a + ad.healthSpent, 0);
      if (stoppedPurchases > 0) {
        const cpp = stoppedSpent > 0 ? stoppedSpent / stoppedPurchases : null;
        tasks.push({
          id: `stopped:${p.sku}`,
          rule: "stopped",
          section: "ads",
          priority: "high",
          title: `${p.sku} ads are OFF — was selling${
            cpp != null ? ` at $${cpp.toFixed(2)}/purchase` : ""
          }`,
          detail: `${stoppedPurchases} purchase${
            stoppedPurchases === 1 ? "" : "s"
          } in the health window, then delivery stopped (ad or ad set paused in Meta). Restart it if the stop wasn't intentional — winners pay for the tests.`,
          sku: p.sku,
          link: "/ads",
        });
      }
      continue;
    }

    // KILL — real conversion-ad spend, zero purchases. Traffic spend excluded.
    if (
      meta &&
      !trafficOnly &&
      convSpent > cfg.killSpendThreshold &&
      convPurchases === 0
    ) {
      tasks.push({
        id: `kill:${p.sku}`,
        rule: "kill",
        section: "ads",
        priority: "critical",
        title: `Stop ad ${p.sku} — $${convSpent.toFixed(0)} spent, no sale`,
        detail: `${conversionAds.length} conversion ad${
          conversionAds.length === 1 ? "" : "s"
        } · 0 purchases (traffic-obj spend excluded). Pause in Meta before more budget burns.`,
        sku: p.sku,
        link: "/ads",
        moneyAtStake: convSpent,
      });
      continue; // a dead ad is not a scale/test candidate
    }

    // SCALE — CPP under target, judged on conversion ads only (traffic-obj
    // spend/purchases excluded, same as KILL). Prefer the health window
    // (≈ last 3 days of delivery); fall back to the selected-range snapshot.
    if (meta && !trafficOnly && convPurchases > 0) {
      // Per-SKU rollup has no healthPurchases — sum the per-ad health window.
      const healthPurchases = conversionAds.reduce(
        (a, ad) => a + ad.healthPurchases,
        0
      );
      const healthSpent = conversionAds.reduce((a, ad) => a + ad.healthSpent, 0);
      const healthCpa =
        healthSpent > 0 && healthPurchases > 0
          ? healthSpent / healthPurchases
          : null;
      const convCpa = convSpent > 0 ? convSpent / convPurchases : null;
      const healthOk =
        healthCpa != null &&
        healthCpa < cfg.scaleCppTarget &&
        healthPurchases >= cfg.scaleMinPurchases;
      const snapshotOk =
        convCpa != null &&
        convCpa < cfg.scaleCppTarget &&
        convPurchases >= cfg.scaleMinPurchases;
      if (healthOk || snapshotOk) {
        const cpp = healthOk ? healthCpa : convCpa;
        tasks.push({
          id: `scale:${p.sku}`,
          rule: "scale",
          section: "ads",
          priority: "high",
          title: `Scale ${p.sku} +20-30%`,
          detail: `CPP $${(cpp ?? 0).toFixed(2)} is under the $${
            cfg.scaleCppTarget
          } target with ${
            healthOk ? healthPurchases : convPurchases
          } purchases (traffic-obj excluded) — raise the budget gradually, watch return rate.`,
          sku: p.sku,
          link: "/ads",
        });
      }
    }

    // TEST — organic winner with no live ad.
    const orders7d = p.orderVelocity7d * 7;
    if (orders7d >= cfg.testMinOrders7d) {
      // "No live ad" must be honest in both modes:
      //  - stages past/without the ads era (no-ads, organic-only) are by
      //    definition selling without Meta delivery — always candidates;
      //  - "selling" products are only candidates when Meta data is in and
      //    verifies zero delivery for the SKU (no matched adsMeta).
      const stageProvesNoAds = p.stage === "organic-only" || p.stage === "no-ads";
      const verifiedNoAds =
        p.stage === "selling" && adsAvailable && (!meta || meta.adCount === 0);
      const noLiveAd = stageProvesNoAds || verifiedNoAds;
      if (noLiveAd && p.stage !== "completed" && p.stage !== "selling-returns") {
        tasks.push({
          id: `test:${p.sku}`,
          rule: "test",
          section: "ads",
          priority: "normal",
          title: `Launch ad test for ${p.sku} (organic winner)`,
          detail: `${p.orderVelocity7d.toFixed(
            1
          )} orders/day over 7d with no live Meta ad — proven pull. Small test budget (~$10-20/day), SKU in the ad name.`,
          sku: p.sku,
          link: `/products/${p.id}`,
        });
      }
    }
  }
  return tasks;
}

/** PUBLISHING — publish created models older than 24h + the daily quota. */
function publishingRules(
  products: Product[],
  now: Date,
  cfg: TaskEngineConfig
): Task[] {
  const tasks: Task[] = [];

  for (const p of products) {
    // stage 'created' = in Odoo but never advertised/ordered — the
    // unpublished state (no separate unpublished flag exists in the data).
    if (p.stage !== "created" || !p.odooCreatedDate) continue;
    const ageDays = daysBetween(p.odooCreatedDate, now);
    if (ageDays >= 1 && p.totalOrders === 0) {
      tasks.push({
        id: `publish:${p.sku}`,
        rule: "publish",
        section: "publishing",
        priority: "high",
        title: `Publish ${p.sku} today`,
        detail: `Created in Odoo ${ageDays} day${ageDays === 1 ? "" : "s"} ago, zero orders, never advertised — get photos, price and sizes live.`,
        sku: p.sku,
        link: `/products/${p.id}`,
      });
    }
  }

  // Quota tracker — models created today count toward the target.
  const createdToday = products.filter(
    (p) => p.odooCreatedDate && sameDay(p.odooCreatedDate, now)
  ).length;
  tasks.push({
    id: "publish-quota",
    rule: "publish-quota",
    section: "publishing",
    priority: "normal",
    title: `Publish ${cfg.publishTargetPerDay} new models today`,
    detail: `Daily intake quota keeps the winter pipeline full — pick from the supplier's new shares and push them through creation → publish.`,
    progress: { done: createdToday, target: cfg.publishTargetPerDay },
    link: "/products",
  });
  return tasks;
}

/** DIRECT — aging-stock discount ladder + the daily list quota. */
function directRules(
  products: Product[],
  ops: OpsPayload | null,
  now: Date,
  cfg: TaskEngineConfig
): { tasks: Task[]; missing: boolean } {
  const tasks: Task[] = [];
  let staleUnits = 0;

  if (ops && ops.stockDetail.length > 0) {
    // Real per-variant stock with create dates → honest ages. Group variants
    // of the same model into one task at the model's oldest tier.
    const byModel = new Map<
      string,
      { qty: number; maxAge: number; items: OpsStockItem[] }
    >();
    for (const item of ops.stockDetail) {
      if (item.qty <= 0) continue;
      const age = daysBetween(item.created, now);
      if (age < cfg.discountLadder[cfg.discountLadder.length - 1].ageDays) continue;
      staleUnits += item.qty;
      const entry = byModel.get(item.model) ?? { qty: 0, maxAge: 0, items: [] };
      entry.qty += item.qty;
      entry.maxAge = Math.max(entry.maxAge, age);
      entry.items.push(item);
      byModel.set(item.model, entry);
    }
    for (const [model, entry] of byModel) {
      const pct = discountForAge(entry.maxAge, cfg.discountLadder);
      if (pct == null) continue;
      const product = products.find((p) => p.sku === model || p.name === model);
      tasks.push({
        id: `discount:${model}`,
        rule: "discount",
        section: "direct",
        priority: entry.maxAge >= 60 ? "high" : "normal",
        title: `Discount ${model} to ${pct}% off`,
        detail: `${entry.qty} unit${entry.qty === 1 ? "" : "s"} on hand, oldest ${entry.maxAge} days — ladder tier ${pct}%. Post to direct-sale channels today.`,
        sku: product?.sku,
        link: product ? `/products/${product.id}` : undefined,
      });
    }
  } else {
    // Degraded: no stockDetail — fall back to per-product returned-stock
    // aggregates. Real ages are unknown, so only flag stock that is plausibly
    // stale: no orders for 7+ days, or a post-ads stage whose returned units
    // are the only stock left. daysSinceLastOrder drives the ladder tier.
    for (const p of products) {
      if (p.returnedStock <= 0) continue;
      const idleDays = p.daysSinceLastOrder ?? 0;
      const postAds = p.stage === "organic-only" || p.stage === "selling-returns";
      const stale = idleDays >= ALERT_THRESHOLDS.STALE_ORDER_DAYS;
      if (!stale && !postAds) continue;
      staleUnits += p.returnedStock;
      const pct = discountForAge(idleDays, cfg.discountLadder) ?? 20;
      tasks.push({
        id: `discount:${p.sku}`,
        rule: "discount",
        section: "direct",
        priority: pct >= 50 ? "high" : "normal",
        title: `Discount ${p.sku} to ${pct}% off`,
        detail: `${p.returnedStock} returned unit${p.returnedStock === 1 ? "" : "s"} on hand${
          p.daysSinceLastOrder != null && p.daysSinceLastOrder > 0
            ? `, no orders in ${p.daysSinceLastOrder} day${p.daysSinceLastOrder === 1 ? "" : "s"}`
            : ""
        } — estimated ${pct}% tier (per-variant ages pending stock sync).`,
        sku: p.sku,
        link: `/products/${p.id}`,
      });
    }
  }

  tasks.push({
    id: "direct-quota",
    rule: "direct-quota",
    section: "direct",
    priority: "normal",
    title: `List ${cfg.directListTargetPerDay} stale units for direct sale`,
    detail: `${staleUnits} stale unit${staleUnits === 1 ? "" : "s"} in the pool — photograph, price at the ladder discount, and post in the direct-sale groups.`,
    progress: { done: 0, target: cfg.directListTargetPerDay },
  });

  return { tasks, missing: ops == null };
}

/** FOLLOWUP — return-rate reviews + stale manual supplier checks. */
function followupRules(
  products: Product[],
  now: Date,
  cfg: TaskEngineConfig
): Task[] {
  const tasks: Task[] = [];
  for (const p of products) {
    // Review listing when returns run hot on real volume. Completed products
    // are excluded — the listing no longer matters once the life cycle is over.
    if (
      p.stage !== "completed" &&
      p.returnRate != null &&
      p.returnRate > cfg.reviewReturnRate &&
      p.totalOrders >= cfg.reviewMinOrders
    ) {
      tasks.push({
        id: `review:${p.sku}`,
        rule: "review",
        section: "followup",
        priority: "high",
        title: `Review ${p.sku}: sizing/photos/description`,
        detail: `Return rate ${p.returnRate.toFixed(1)}% over ${p.totalOrders} orders — fix the expectation gap (size chart, real photos, honest description) before scaling further.`,
        sku: p.sku,
        link: `/products/${p.id}`,
      });
    }

    // Supplier stock unknown or a manual check gone stale while still selling.
    if (p.orderVelocity7d > 0 && p.stage !== "completed") {
      const lastChecked = p.supplierStock.lastChecked;
      const staleDays = lastChecked != null ? daysBetween(lastChecked, now) : Infinity;
      const unknown = p.supplierStock.qty == null || staleDays > cfg.supplierStaleDays;
      if (unknown) {
        const ageLabel =
          staleDays === Infinity
            ? "never checked"
            : `last checked ${staleDays} days ago`;
        tasks.push({
          id: `supplier-check:${p.sku}`,
          rule: "supplier-check",
          section: "followup",
          priority: "normal",
          title: `Check supplier stock for ${p.sku} (manual)`,
          detail: `Selling ${p.orderVelocity7d.toFixed(1)}/day but supplier stock is ${
            p.supplierStock.qty == null ? "unknown" : "stale"
          } (${ageLabel}) — open butiksistem and confirm availability.`,
          sku: p.sku,
          link: `/products/${p.id}`,
        });
      }
    }
  }
  return tasks;
}

/** CONFIRM — orders with no delivery activity for >24h (needs ordersDetail). */
function confirmRules(ops: OpsPayload | null, now: Date): Task[] {
  if (!ops) return [];
  const tasks: Task[] = [];
  for (const order of ops.ordersDetail) {
    // "sale" = confirmed but not locked/done; skip orders already completed.
    if (order.st !== "sale") continue;
    const ageDays = daysBetween(order.d, now);
    if (ageDays < 1) continue;
    // Delivery activity: any line with delivered qty.
    const deliveredQty = order.lines.reduce((a, l) => a + l.del, 0);
    if (deliveredQty > 0) continue;
    const units = order.lines.reduce((a, l) => a + l.qty, 0);
    tasks.push({
      id: `confirm-order:${order.id}`,
      rule: "confirm-order",
      section: "confirm",
      priority: ageDays >= 3 ? "high" : "normal",
      title: `Confirm order #${order.id}`,
      detail: `${units} unit${units === 1 ? "" : "s"} · placed ${ageDays} day${
        ageDays === 1 ? "" : "s"
      } ago, no delivery activity in 24h — call the customer to reconfirm.`,
    });
  }
  // Oldest first — stale confirmations are the riskiest.
  return tasks.sort((a, b) => a.title.localeCompare(b.title));
}

// ─── Engine entry point ──────────────────────────────────────────────────────

/**
 * Run every rule and return the flat task list plus per-section data
 * availability. Pure: same input → same output.
 */
export function generateTasks(input: TaskEngineInput): TaskEngineResult {
  const cfg: TaskEngineConfig = { ...DEFAULT_TASK_CONFIG, ...input.config };
  const { products, ops, now, adsAvailable } = input;

  const direct = directRules(products, ops, now, cfg);

  return {
    tasks: [
      ...adsRules(products, adsAvailable, cfg),
      ...publishingRules(products, now, cfg),
      ...direct.tasks,
      ...followupRules(products, now, cfg),
      ...confirmRules(ops, now),
    ],
    missing: {
      ads: !adsAvailable,
      publishing: false, // product list is always available
      direct: direct.missing,
      followup: false,
      confirm: ops == null,
    },
  };
}
