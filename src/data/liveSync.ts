/**
 * Live data loader — Stage 2.
 *
 * Fetches `public/data/live.json` (written by scripts/odoo_sync.py from the
 * real Odoo 18 JSON-RPC API), maps each raw per-product record into the
 * canonical `Product` type via the SAME `defineProduct` factory the mock
 * dataset uses (so returnRate / returnConfidence / roas / unitPrice / alerts
 * all come from the shared decision engine), then swaps the dataset in place
 * via `applyLiveDataset`.
 *
 * On ANY failure (missing file, timeout, bad payload) it returns false and
 * the app silently keeps the mock data.
 *
 * Ownership split: the connector ships raw Odoo metrics + the inferred stage;
 * this module (via the decision engine) owns rates, confidence and alerts.
 */

import {
  applyLiveDataset,
  defineProduct,
  rederiveAlerts,
  setLiveDailyData,
  setShopStock,
  type LiveDailyData,
  type Product,
  type ShopStock,
  type Stage,
} from "@/data/products";
import {
  adsPresetForWindow,
  getAdsData,
  mergeAdsIntoProducts,
  noteAdsResult,
  type AdsPreset,
} from "@/data/adsProvider";
import {
  bumpAdsVersion,
  getWindowDays,
  subscribeWindowChange,
} from "@/data/windowStore";
import { setCurrency } from "@/lib/money";

const LIVE_URL = "/data/live.json";
const FETCH_TIMEOUT_MS = 8000;

/** Raw per-product record shape produced by scripts/odoo_sync.py. */
interface RawLiveProduct {
  odooId: number;
  name: string;
  sku: string;
  category: string;
  supplier: string | null;
  stage: Stage;
  odooCreatedDate: string;
  firstOrderDate: string | null;
  lastOrderDate: string | null;
  /** Distinct confirmed sale.order documents containing the product. */
  orders: number;
  /** Units sold (sum of product_uom_qty on confirmed lines). */
  units: number;
  revenue: number;
  delivered: number;
  returned: number;
  unitsBoughtFromSupplier: number;
  returnedStock: number;
  unitPrice: number | null;
  orderVelocity7d: number;
  daysSinceLastOrder: number | null;
  supplierStock: { qty: number | null; lastChecked: string | null; source: "manual" | "api" };
}

interface LivePayload {
  syncedAt: string;
  currency: string;
  source: string;
  /** Source timezone ("Asia/Baghdad"); all `daily` days are already local. */
  tz?: string;
  products: RawLiveProduct[];
  /**
   * Real per-day buckets (odooId → ISO day → [orderDocs, units, revenueIQD],
   * plus shop-wide `orders` docs/day and portfolio-level stock moves).
   * Optional — older snapshots lack it; the frontend then falls back to
   * honest lifetime-only labels.
   */
  daily?: LiveDailyData;
  /** Shop-wide warehouse stock (all products, from stock.quant). Optional. */
  shop?: ShopStock;
}

/**
 * Shape check so a half-written or OLD-FORMAT sync can't poison the series.
 * byProduct cells MUST be 3-element [docs, units, revenue] — a 2-element
 * [orders, revenue] cell means the snapshot predates the semantics change,
 * so the whole `daily` block is rejected (no-daily fallback) rather than
 * silently misreading revenue as units. `orders` (day → shop-wide docs) is
 * optional but must be a numeric map when present.
 */
function validDaily(d: LiveDailyData | undefined): d is LiveDailyData {
  if (
    !d ||
    typeof d.from !== "string" ||
    typeof d.to !== "string" ||
    !d.byProduct ||
    typeof d.byProduct !== "object" ||
    !d.moves ||
    typeof d.moves !== "object"
  ) {
    return false;
  }
  for (const perDay of Object.values(d.byProduct)) {
    if (!perDay || typeof perDay !== "object") return false;
    for (const cell of Object.values(perDay)) {
      if (
        !Array.isArray(cell) ||
        cell.length !== 3 ||
        cell.some((n) => typeof n !== "number" || !Number.isFinite(n))
      ) {
        return false;
      }
    }
  }
  // moves cells feed returnsValue/returnPct — one bad cell (NaN, string,
  // wrong length) poisons the shared Y domain and blanks the whole hero
  // chart. Sanitize instead of rejecting the whole daily block: a bad
  // moves cell just means "no delivery data that day" → [0, 0].
  for (const [iso, cell] of Object.entries(d.moves)) {
    if (
      !Array.isArray(cell) ||
      cell.length !== 2 ||
      cell.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      d.moves[iso] = [0, 0];
    }
  }
  if (d.orders != null) {
    if (typeof d.orders !== "object") return false;
    for (const v of Object.values(d.orders)) {
      if (typeof v !== "number" || !Number.isFinite(v)) return false;
    }
  }
  return true;
}

let liveMode = false;
let syncedAt: string | null = null;

/** True once live Odoo data has replaced the mock dataset. */
export function isLiveMode(): boolean {
  return liveMode;
}

/** ISO timestamp of the live sync (from live.json), null in mock mode. */
export function liveSyncedAt(): string | null {
  return syncedAt;
}

/** Human label for the sync pill: "synced 3m ago" / "just now". */
export function liveSyncLabel(): string {
  if (!syncedAt) return "mock data";
  const mins = Math.max(0, Math.round((Date.now() - new Date(syncedAt).getTime()) / 60_000));
  if (mins < 1) return "synced just now";
  if (mins === 1) return "synced 1m ago";
  if (mins < 60) return `synced ${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `synced ${hours}h ago`;
}

function mapLiveProduct(raw: RawLiveProduct): Product {
  // `orders` = distinct confirmed order DOCUMENTS containing the product.
  const orders = Math.round(raw.orders);
  const units = Math.round(raw.units ?? orders);
  return defineProduct({
    id: `odoo-${raw.odooId}`,
    name: raw.name,
    sku: raw.sku,
    category: raw.category || "All",
    supplier: raw.supplier ?? "butiksistem supplier",
    stage: raw.stage,
    // Live products have no images — deterministic fallback tile.
    thumbnail: "/empty-box.svg",
    // butiksistem not connected: the share date precedes Odoo creation by
    // ~2 days in this business; approximate with the Odoo create date.
    sharedDate: raw.odooCreatedDate,
    odooCreatedDate: raw.odooCreatedDate,
    // Ads are not in Odoo; once orders exist a campaign must have been live.
    firstAdDate: raw.orders > 0 ? raw.firstOrderDate : null,
    firstOrderDate: raw.firstOrderDate,
    // Odoo doesn't tag chat vs website here — count everything as chat.
    chatOrders: orders,
    websiteOrders: 0,
    units,
    unitsBoughtFromSupplier: Math.round(raw.unitsBoughtFromSupplier),
    delivered: Math.round(raw.delivered),
    returned: Math.round(raw.returned),
    // Overlaid with real Meta spend (IQD) when the ads endpoint answers;
    // stays 0 when the ads sync is offline.
    adSpend: 0,
    revenue: Math.round(raw.revenue),
    supplierStock: raw.supplierStock,
    returnedStock: Math.round(raw.returnedStock),
    orderVelocity7d: raw.orderVelocity7d,
    daysSinceLastOrder: raw.daysSinceLastOrder,
  });
}

/**
 * Try to swap the mock dataset for live Odoo data.
 * Returns true on success; false (mock data kept) on any failure.
 *
 * `preset` selects the Meta ads date range; defaults to the preset matching
 * the currently selected portfolio window so spend and revenue windows align.
 */
export async function loadLiveData(preset?: AdsPreset): Promise<boolean> {
  // Kick off the Meta ads fetch in parallel with the Odoo snapshot; the merge
  // happens after mapping. Records the outcome for the "ads offline" indicator.
  // getAdsData runs the live → baked-snapshot chain and returns null only when
  // both tiers fail.
  const adsPromise = getAdsData(preset ?? adsPresetForWindow(getWindowDays())).then((r) => {
    noteAdsResult(r);
    return r;
  });
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${LIVE_URL}?t=${Date.now()}`, {
        signal: ctrl.signal,
        cache: "no-store",
      });
    } finally {
      window.clearTimeout(timer);
    }
    if (!res.ok) return false;
    const payload = (await res.json()) as LivePayload;
    if (
      !payload ||
      payload.source !== "odoo-live" ||
      !Array.isArray(payload.products) ||
      payload.products.length === 0
    ) {
      return false;
    }
    const mapped = payload.products.map(mapLiveProduct);
    // Overlay Meta ads (IQD spend + health) before the dataset is applied so
    // globalKpis (total ad spend, blended ROAS) include the ad numbers.
    const adsResult = await adsPromise;
    const merged = adsResult ? mergeAdsIntoProducts(mapped, adsResult.data) : mapped;
    // Meta-verified stage honesty: a product the connector labeled "ads-live"
    // (orders>0, <10 delivered — an assumption) only keeps that label when Meta
    // actually shows delivery for its SKU in the fetched window; otherwise it
    // is selling on organic/Shopify/chat pull → stage "no-ads". Alerts are
    // re-derived with the verification flag so NEEDS_ADS can fire (and so the
    // label never lies when the endpoint is offline: no flip, no alert).
    const finalList = adsResult
      ? merged.map((p) => {
          const detected = p.adsMeta != null;
          const stage = p.stage === "ads-live" && !detected ? "no-ads" : p.stage;
          return rederiveAlerts({ ...p, stage }, detected);
        })
      : merged;
    setCurrency(payload.currency || "USD");
    applyLiveDataset(finalList, new Date());
    setLiveDailyData(
      validDaily(payload.daily)
        ? { ...payload.daily, tz: payload.daily.tz ?? payload.tz }
        : null
    );
    setShopStock(
      payload.shop && typeof payload.shop.stockUnits === "number"
        ? payload.shop
        : null
    );
    liveMode = true;
    syncedAt = payload.syncedAt;
    // Notify ads-dependent components (AD SPEND card, ROAS, sidebar pill,
    // AdPerformance) so they re-render in place after an async re-fetch.
    bumpAdsVersion();
    return true;
  } catch {
    return false;
  }
}

// ─── Window-change ads re-fetch ──────────────────────────────────────────────
// When the Topbar window changes in live mode, re-fetch live.json (cheap,
// same-origin) + Meta ads with the matching preset and re-merge in place —
// no page reload. Guarded against overlapping calls; on failure the previous
// dataset stays and components keep showing the previous (labeled) numbers.
let windowRefetching = false;
subscribeWindowChange((days) => {
  if (!isLiveMode() || windowRefetching) return;
  windowRefetching = true;
  void loadLiveData(adsPresetForWindow(days)).finally(() => {
    windowRefetching = false;
  });
});
