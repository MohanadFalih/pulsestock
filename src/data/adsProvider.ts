/**
 * Meta Ads live data provider — Stage 3.
 *
 * Fetches the serverless Meta Marketing API bridge
 * (`ADS_API_URL`, deployed separately by the ads-dashboard project) and
 * normalizes the payload into typed structures for the Ads page and the
 * per-product overlay.
 *
 * Currency convention: the endpoint reports raw metrics in USD and ALSO
 * pre-converts spend to IQD (`spentIQD` / `totalSpentIQD`) using the
 * response's own `usdToIqd` rate (the card rate). ALWAYS use those
 * pre-converted values — never hardcode an exchange rate here.
 *
 * Failure policy mirrors liveSync.ts with a 3-tier resilience chain:
 *   1. live fetch from ADS_API_URL (cross-origin serverless bridge)
 *   2. baked snapshot at `SNAPSHOT_URL` (same-origin static file, fixed window)
 *   3. null — callers degrade to Odoo-only data and the UI shows a quiet
 *      "ads offline" state instead of error spam.
 * The last Tier-1 error string is kept in module state for diagnostics.
 */

import type { Product } from "@/data/products";

/** Serverless Meta ads endpoint (stable alias tracking latest main deploy). */
export const ADS_API_URL =
  "https://ad-dashboard-git-main-deniz-cfb3.vercel.app/api/pulsestock";

/** Baked same-origin snapshot (one full endpoint response, fixed window). */
export const ADS_SNAPSHOT_URL = "/data/ads.json";

// Cold Vercel function + two paginated Meta queries can exceed 5s easily;
// 12s keeps slow-but-alive responses from falling back to a stale snapshot.
const FETCH_TIMEOUT_MS = 12000;

// ─── Types ───────────────────────────────────────────────────────────────────

export type AdsPreset =
  | "today"
  | "yesterday"
  | "last_3d"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "last_90d";

/** Presets offered on the Ads page (14d/90d exist only for window mapping). */
export const ADS_PRESETS: { key: AdsPreset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last_3d", label: "Last 3 days" },
  { key: "last_7d", label: "Last 7 days" },
  { key: "last_30d", label: "Last 30 days" },
];

/** Human label for any preset, e.g. "last 14d" (covers presets not in ADS_PRESETS). */
export function adsPresetLabel(preset: AdsPreset | string | undefined): string {
  if (!preset) return "unknown window";
  const SHORT: Record<string, string> = {
    today: "today",
    yesterday: "yesterday",
    last_3d: "last 3d",
    last_7d: "last 7d",
    last_14d: "last 14d",
    last_30d: "last 30d",
    last_90d: "last 90d",
  };
  return SHORT[preset] ?? preset;
}

/**
 * Map a portfolio window (7/14/30/90 days) to the matching Meta ads preset,
 * so spend and revenue windows align when the endpoint answers live.
 */
export function adsPresetForWindow(days: number): AdsPreset {
  if (days <= 7) return "last_7d";
  if (days <= 14) return "last_14d";
  if (days <= 30) return "last_30d";
  return "last_90d";
}

/** Health classification computed by the endpoint over `healthWindow`. */
export type AdsHealth =
  | "healthy"
  | "watch"
  | "refresh_creative"
  | "kill"
  | "in_review"
  | "gathering_data"
  | "traffic"
  | "paused"
  | "dead";

export const ADS_HEALTH_ORDER: AdsHealth[] = [
  "healthy",
  "watch",
  "refresh_creative",
  "kill",
  "in_review",
  "gathering_data",
  "traffic",
  "paused",
  "dead",
];

export const ADS_HEALTH_META: Record<AdsHealth, { label: string; color: string }> = {
  healthy: { label: "Healthy", color: "#4ADE80" },
  watch: { label: "Watch", color: "#FBBF24" },
  refresh_creative: { label: "Refresh Creative", color: "#FB923C" },
  kill: { label: "Kill", color: "#FB5D7A" },
  in_review: { label: "In Review", color: "#45B7F5" },
  gathering_data: { label: "Gathering Data", color: "#8B7CFF" },
  traffic: { label: "Traffic Obj", color: "#67E8F9" },
  paused: { label: "Paused", color: "#94A3B8" },
  dead: { label: "Dead", color: "#8A95A1" },
};

/**
 * Meta delivery states that mean "not delivering because someone paused it"
 * (ad toggle off, or a parent ad set / campaign paused). DELETED/ARCHIVED are
 * deliberately excluded — those keep the endpoint's verdict.
 */
const PAUSED_STATUSES = new Set(["PAUSED", "ADSET_PAUSED", "CAMPAIGN_PAUSED"]);

export function isAdPaused(a: { effectiveStatus: string }): boolean {
  return PAUSED_STATUSES.has(a.effectiveStatus);
}

/**
 * "Not delivering" — the ground truth for "is this ad working?":
 *  1. paused by status (ad / ad set / campaign off), OR
 *  2. it spent money in the selected range but delivered NOTHING in the
 *     health window — this catches "Completed" schedules, which Meta's API
 *     may still report as ACTIVE even though delivery has stopped.
 * A brand-new ad (spent 0, healthSpent 0) is deliberately NOT caught: it
 * keeps the endpoint's gathering_data verdict.
 */
export function isAdNotDelivering(a: {
  effectiveStatus: string;
  spent: number;
  healthSpent: number;
}): boolean {
  return (
    PAUSED_STATUSES.has(a.effectiveStatus) ||
    (a.spent > 0 && a.healthSpent === 0)
  );
}

/**
 * Traffic-objective ads (e.g. "DM_SHOP_Traffic" — landing-page-view
 * campaigns) burn budget with zero purchases BY DESIGN. The endpoint judges
 * every ad on purchase CPA, so traffic ads come back health='kill' and land
 * on the kill list — wrong recommendations. The bridge payload carries no
 * objective field, so we detect them by the "traffic" naming convention in
 * campaign/adset/ad name and reclassify them client-side.
 */
export function isTrafficAd(a: {
  name: string;
  campaign?: string;
  adset?: string;
}): boolean {
  return `${a.name} ${a.campaign ?? ""} ${a.adset ?? ""}`
    .toLowerCase()
    .includes("traffic");
}

/** One Meta ad (raw USD metrics; health metrics cover `healthWindow`). */
export interface MetaAd {
  id: string;
  name: string;
  /** Matched Odoo SKU; null = account-level funnel campaign. */
  sku: string | null;
  status: string;
  effectiveStatus: string;
  adset: string;
  campaign: string;
  spent: number;
  impressions: number;
  purchases: number;
  purchaseValue: number;
  cpa: number | null;
  roas: number | null;
  cpm: number | null;
  ctr: number | null;
  frequency: number | null;
  healthSpent: number;
  healthPurchases: number;
  healthRoas: number | null;
  healthCpa: number | null;
  healthFrequency: number | null;
  health: AdsHealth;
}

/** Ads aggregated per matched SKU (`products[]` in the payload). */
export interface AdsProduct {
  sku: string;
  /** USD spend in the selected date range. */
  spent: number;
  /** IQD spend, pre-converted by the endpoint at `usdToIqd`. */
  spentIQD: number;
  impressions: number;
  purchases: number;
  purchaseValue: number;
  cpa: number | null;
  roas: number | null;
  healthSpent: number;
  healthRoas: number | null;
  healthCpa: number | null;
  health: AdsHealth;
  adCount: number;
  ads: MetaAd[];
}

export interface AdsKillEntry {
  name: string;
  sku: string | null;
  spent: number;
}

export interface AdsConfig {
  /** Target cost per purchase, USD. */
  targetCPA: number;
  targetROAS: number;
  /** USD spend with zero purchases before an ad lands on the kill list. */
  minSpendKill: number;
}

export interface AdsSummary {
  totalAds: number;
  productAds: number;
  unattributedAds: number;
  matchedSkus: number;
  /** USD spend across all ads in the range. */
  totalSpent: number;
  /** IQD spend, pre-converted by the endpoint at `usdToIqd`. */
  totalSpentIQD: number;
  unattributedSpent: number;
  totalPurchases: number;
  totalRevenue: number;
  avgCPA: number | null;
  avgROAS: number | null;
  healthCounts: Record<AdsHealth, number>;
  killList: AdsKillEntry[];
}

export interface AdsData {
  source: string;
  currency: string;
  /** USD→IQD card rate used by the endpoint for its IQD fields. */
  usdToIqd: number;
  syncedAt: string;
  dateRange: AdsPreset;
  /** Human-readable health-evaluation window, e.g. "2026-08-16 → 2026-08-19". */
  healthWindow: string;
  config: AdsConfig;
  summary: AdsSummary;
  products: AdsProduct[];
  ads: MetaAd[];
}

// ─── Normalization (defensive — the endpoint may be mid-deploy) ──────────────

type Raw = Record<string, unknown>;

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function numOrNull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function skuOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function health(v: unknown): AdsHealth {
  return (ADS_HEALTH_ORDER as string[]).includes(v as string)
    ? (v as AdsHealth)
    : "gathering_data";
}

function normalizeAd(raw: Raw): MetaAd {
  const name = str(raw.name, "Untitled ad");
  const adset = str(raw.adset);
  const campaign = str(raw.campaign);
  const effectiveStatus = str(raw.effectiveStatus, str(raw.status, "UNKNOWN"));
  const spent = num(raw.spent);
  const healthSpent = num(raw.healthSpent);
  return {
    id: str(raw.id),
    name,
    sku: skuOrNull(raw.sku),
    status: str(raw.status, "UNKNOWN"),
    effectiveStatus,
    adset,
    campaign,
    spent,
    impressions: num(raw.impressions),
    purchases: num(raw.purchases),
    purchaseValue: num(raw.purchaseValue),
    cpa: numOrNull(raw.cpa),
    roas: numOrNull(raw.roas),
    cpm: numOrNull(raw.cpm),
    ctr: numOrNull(raw.ctr),
    frequency: numOrNull(raw.frequency),
    healthSpent,
    healthPurchases: num(raw.healthPurchases),
    healthRoas: numOrNull(raw.healthRoas),
    healthCpa: numOrNull(raw.healthCpa),
    healthFrequency: numOrNull(raw.healthFrequency),
    // Client-side overrides of the endpoint's purchase-CPA verdict:
    // - a non-delivering ad with a "healthy"/"gathering" badge is a wrong
    //   signal, and traffic-obj ads are judged on the wrong metric;
    // - "kill" means zero-sale bleeder: if the selected RANGE shows any
    //   purchase, the zero-purchase health-window verdict is a data-lag
    //   artifact (fresh purchases take minutes-hours to reach the insights
    //   API) — downgrade to "watch" rather than scream kill.
    health: isAdNotDelivering({ effectiveStatus, spent, healthSpent })
      ? "paused"
      : isTrafficAd({ name, campaign, adset })
        ? "traffic"
        : health(raw.health) === "kill" &&
            (num(raw.purchases) > 0 || num(raw.purchaseValue) > 0)
          ? "watch"
          : health(raw.health),
  };
}

function normalizeProduct(raw: Raw): AdsProduct {
  const ads = Array.isArray(raw.ads)
    ? raw.ads.map((a) => normalizeAd(a as Raw))
    : [];
  return {
    sku: str(raw.sku),
    spent: num(raw.spent),
    spentIQD: num(raw.spentIQD),
    impressions: num(raw.impressions),
    purchases: num(raw.purchases),
    purchaseValue: num(raw.purchaseValue),
    cpa: numOrNull(raw.cpa),
    roas: numOrNull(raw.roas),
    healthSpent: num(raw.healthSpent),
    healthRoas: numOrNull(raw.healthRoas),
    healthCpa: numOrNull(raw.healthCpa),
    // Whole-product overrides: if NOTHING is delivering, the endpoint's
    // purchase-CPA verdict is stale/meaningless — say so honestly.
    health:
      ads.length > 0 && ads.every((a) => isAdNotDelivering(a))
        ? "paused"
        : ads.length > 0 && ads.every((a) => isTrafficAd(a))
          ? "traffic"
          : health(raw.health),
    adCount: num(raw.adCount),
    ads,
  };
}

function normalizePayload(payload: Raw): AdsData | null {
  if (!Array.isArray(payload.products) || !Array.isArray(payload.ads)) return null;
  const summary = (payload.summary ?? {}) as Raw;
  const config = (payload.config ?? {}) as Raw;
  const ads = payload.ads.map((a) => normalizeAd(a as Raw));
  // Counts are computed client-side AFTER reclassification — the endpoint's
  // raw healthCounts would still count traffic/paused ads as "kill" etc.
  const healthCounts = Object.fromEntries(
    ADS_HEALTH_ORDER.map((h) => [h, 0])
  ) as Record<AdsHealth, number>;
  for (const a of ads) healthCounts[a.health] += 1;
  return {
    source: str(payload.source, "meta-marketing-api"),
    currency: str(payload.currency, "USD"),
    usdToIqd: num(payload.usdToIqd),
    syncedAt: str(payload.syncedAt),
    dateRange: str(payload.dateRange, "last_7d") as AdsPreset,
    healthWindow: str(payload.healthWindow),
    config: {
      targetCPA: num(config.targetCPA),
      targetROAS: num(config.targetROAS),
      minSpendKill: num(config.minSpendKill),
    },
    summary: {
      totalAds: num(summary.totalAds),
      productAds: num(summary.productAds),
      unattributedAds: num(summary.unattributedAds),
      matchedSkus: num(summary.matchedSkus),
      totalSpent: num(summary.totalSpent),
      totalSpentIQD: num(summary.totalSpentIQD),
      unattributedSpent: num(summary.unattributedSpent),
      totalPurchases: num(summary.totalPurchases),
      totalRevenue: num(summary.totalRevenue),
      avgCPA: numOrNull(summary.avgCPA),
      avgROAS: numOrNull(summary.avgROAS),
      healthCounts,
      killList: Array.isArray(summary.killList)
        ? summary.killList
            .map((k) => {
              const r = k as Raw;
              return { name: str(r.name, "Untitled ad"), sku: skuOrNull(r.sku), spent: num(r.spent) };
            })
            // Traffic-objective ads never belong on a kill list.
            .filter((k) => !k.name.toLowerCase().includes("traffic"))
            // Kill guards — cross-check the payload's own per-ad range data:
            // 1) ANY purchase in the selected range → not a zero-sale
            //    bleeder; the health-window zero was insights-API lag
            //    (the H-1890 case: Meta UI showed 2 purchases while the
            //    window still said zero).
            // 2) ad no longer delivering → already stopped, nothing to kill.
            .filter((k) => {
              const byName = ads.filter((a) => a.name === k.name);
              const pool =
                byName.length > 0
                  ? byName
                  : ads.filter((a) => k.sku != null && a.sku === k.sku);
              if (pool.length === 0) return true; // can't disprove — keep
              if (pool.some((a) => a.purchases > 0 || a.purchaseValue > 0))
                return false;
              if (pool.every((a) => isAdNotDelivering(a))) return false;
              return true;
            })
        : [],
    },
    products: payload.products.map((p) => normalizeProduct(p as Raw)),
    ads,
  };
}

// ─── Fetcher (3-tier chain: live → baked snapshot → offline) ────────────────

/** Where the current data came from. */
export type AdsDataSource = "live" | "snapshot";

export interface AdsFetchResult {
  data: AdsData;
  /** 'live' = Tier-1 endpoint; 'snapshot' = Tier-2 baked static file. */
  source: AdsDataSource;
  /** Client-side ISO timestamp of when this result was obtained. */
  fetchedAt: string;
}

/** Compact, screenshot-friendly description of a fetch failure. */
function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") {
    return `AbortError: timed out after ${FETCH_TIMEOUT_MS}ms`;
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

/** fetch + JSON parse; throws on timeout, network error, or non-OK status. */
async function fetchJson(url: string): Promise<Raw> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
  } finally {
    window.clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
  return (await res.json()) as Raw;
}

/**
 * Get Meta ads data for a date-range preset via the resilience chain:
 *   Tier 1 — live endpoint (`ADS_API_URL?preset=…`, 5s timeout).
 *   Tier 2 — baked snapshot (`ADS_SNAPSHOT_URL`, same-origin, fixed window;
 *            the preset argument is ignored — use `data.dateRange` for the
 *            snapshot's own window).
 *   Tier 3 — null (both tiers failed; callers degrade to Odoo-only data).
 * The Tier-1 failure reason is recorded for diagnostics (`getAdsLastError`).
 */
export async function getAdsData(preset: AdsPreset = "last_7d"): Promise<AdsFetchResult | null> {
  try {
    const data = normalizePayload(await fetchJson(`${ADS_API_URL}?preset=${preset}`));
    if (!data) throw new Error("invalid payload shape");
    lastError = null;
    return { data, source: "live", fetchedAt: new Date().toISOString() };
  } catch (err) {
    lastError = describeError(err);
  }
  try {
    const data = normalizePayload(await fetchJson(ADS_SNAPSHOT_URL));
    if (!data) throw new Error("invalid snapshot payload");
    return { data, source: "snapshot", fetchedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

// ─── Module-level sync state (for the quiet "ads offline" indicator) ─────────

let adsOffline = false;
let snapshot: AdsData | null = null;
let snapshotSource: AdsDataSource | null = null;
let lastError: string | null = null;

/** True when the last ads fetch failed (endpoint + snapshot both down). */
export function isAdsOffline(): boolean {
  return adsOffline;
}

/** Last successfully fetched default-preset snapshot, if any. */
export function getAdsSnapshot(): AdsData | null {
  return snapshot;
}

/** Whether the stored snapshot came from the live endpoint or the baked file. */
export function getAdsSnapshotSource(): AdsDataSource | null {
  return snapshotSource;
}

/** Last Tier-1 (live endpoint) failure reason, for diagnostics; null if OK. */
export function getAdsLastError(): string | null {
  return lastError;
}

/** Record a bootstrap-fetch outcome (used by liveSync). */
export function noteAdsResult(result: AdsFetchResult | null): void {
  adsOffline = result === null;
  if (result) {
    snapshot = result.data;
    snapshotSource = result.source;
  }
}

/** Human label for the ads sync pill: "synced 3m ago" / "just now". */
export function adsSyncLabel(syncedAt: string | null): string {
  if (!syncedAt) return "not synced";
  const mins = Math.max(0, Math.round((Date.now() - new Date(syncedAt).getTime()) / 60_000));
  if (mins < 1) return "synced just now";
  if (mins === 1) return "synced 1m ago";
  if (mins < 60) return `synced ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `synced ${hours}h ago`;
}

/** USD subtext for IQD-primary figures: "$33.84". */
export function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// ─── Product overlay ─────────────────────────────────────────────────────────

/**
 * Overlay the ads snapshot onto Odoo products (matched by SKU, case-insensitive).
 * Matched products get `adSpend` in IQD (the endpoint's pre-converted
 * `spentIQD` — same currency as `revenue` in live mode, so the recomputed
 * `roas` is consistent), plus `adsHealth` / `adsMeta` for display.
 * Unmatched products are returned untouched (same object reference).
 */
export function mergeAdsIntoProducts(list: Product[], data: AdsData): Product[] {
  const bySku = new Map(data.products.map((p) => [p.sku.toLowerCase(), p]));
  return list.map((p) => {
    const meta = bySku.get(p.sku.toLowerCase());
    if (!meta) return p;
    const adSpend = Math.round(meta.spentIQD);
    return {
      ...p,
      adSpend,
      roas: adSpend > 0 ? Math.round((p.revenue / adSpend) * 100) / 100 : null,
      adsHealth: meta.health,
      adsMeta: meta,
    };
  });
}

/** Per-SKU lookup helper for components that only have the snapshot. */
export function adsForSku(data: AdsData | null, sku: string): AdsProduct | null {
  if (!data) return null;
  const key = sku.toLowerCase();
  return data.products.find((p) => p.sku.toLowerCase() === key) ?? null;
}
