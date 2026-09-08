import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Camera, Megaphone, OctagonX, RefreshCw, WifiOff } from "lucide-react";
import { getProduct, type Product } from "@/data/products";
import {
  ADS_HEALTH_ORDER,
  ADS_HEALTH_META,
  ADS_PRESETS,
  adsSyncLabel,
  getAdsData,
  getAdsLastError,
  fmtUsd,
  type AdsData,
  type AdsDataSource,
  type AdsFetchResult,
  type AdsPreset,
  type AdsProduct,
  type MetaAd,
} from "@/data/adsProvider";
import AdsHealthBadge from "@/components/AdsHealthBadge";
import DataTable, { type Column } from "@/components/DataTable";
import EmptyState from "@/components/EmptyState";
import KpiCard, { type KpiDelta } from "@/components/KpiCard";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/money";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const riseChild = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

// ─── Data hook ───────────────────────────────────────────────────────────────

interface AdsState {
  data: AdsData | null;
  /** 'live' | 'snapshot' when data is present; null while loading/offline. */
  source: AdsDataSource | null;
  loading: boolean;
  /** True when the whole chain failed (live endpoint + baked snapshot). */
  offline: boolean;
  /** Tier-1 (live endpoint) failure reason, for the offline diagnostics line. */
  lastError: string | null;
}

interface AdsResult {
  /** `${preset}:${nonce}` of the request this result answers. */
  key: string;
  result: AdsFetchResult | null;
}

function useAdsData(preset: AdsPreset): AdsState & { reload: () => void } {
  const [result, setResult] = useState<AdsResult | null>(null);
  const [nonce, setNonce] = useState(0);
  const requestKey = `${preset}:${nonce}`;

  useEffect(() => {
    let cancelled = false;
    void getAdsData(preset).then((r) => {
      if (!cancelled) setResult({ key: requestKey, result: r });
    });
    return () => {
      cancelled = true;
    };
  }, [preset, nonce, requestKey]);

  // Derived (no synchronous setState in the effect): loading until the result
  // answers the current request; offline once the chain has definitively failed.
  const loading = result?.key !== requestKey;
  const settled = !loading && result !== null;
  return {
    data: result?.result?.data ?? null,
    source: result?.result?.source ?? null,
    loading,
    offline: settled && result.result === null,
    lastError: settled ? getAdsLastError() : null,
    reload: () => setNonce((n) => n + 1),
  };
}

// ─── Header ──────────────────────────────────────────────────────────────────

function PageHeader({
  preset,
  onPreset,
  state,
  onRetry,
}: {
  preset: AdsPreset;
  onPreset: (p: AdsPreset) => void;
  state: AdsState;
  onRetry: () => void;
}) {
  const { data, source, offline, loading, lastError } = state;
  const rangeLabel = data
    ? (ADS_PRESETS.find((p) => p.key === data.dateRange)?.label ?? data.dateRange)
    : null;
  const subline = offline
    ? "Meta ads endpoint unreachable — showing Odoo data only"
    : data
      ? `${data.summary.totalAds} ads · ${data.summary.matchedSkus} SKUs matched · ${adsSyncLabel(data.syncedAt)} · health window ${data.healthWindow}`
      : "Contacting Meta Marketing API…";

  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <motion.p
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25 }}
          className="text-[11px] font-semibold uppercase tracking-[1.2px] text-lime/80"
        >
          Meta Marketing API
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06, ease: EASE }}
          className="mt-1 font-display text-[28px] font-semibold tracking-[-0.5px] text-text-primary"
        >
          Ads
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.21 }}
          className="mt-1 flex items-center gap-1.5 text-[13.5px] text-text-secondary"
        >
          {source === "live" && data && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-pos"
              title="Live from the Meta Marketing API bridge"
            />
          )}
          {subline}
        </motion.p>
        {offline && lastError && (
          <p className="mt-1 font-mono text-[11px] text-text-muted tnum">
            live tier: {lastError}
          </p>
        )}
        {source === "snapshot" && lastError && (
          <p className="mt-1 font-mono text-[11px] text-text-muted tnum">
            live tier: {lastError}
          </p>
        )}
      </div>
      <motion.div
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="flex flex-wrap items-center gap-2"
      >
        {offline && !loading && (
          <span className="flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.8px] text-amber">
            <WifiOff className="h-3.5 w-3.5" />
            Ads offline
          </span>
        )}
        {source === "snapshot" && data && (
          <span
            className="flex items-center gap-1.5 rounded-full border border-amber/40 bg-amber/10 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.8px] text-amber"
            title="Live endpoint unreachable — showing the baked snapshot with its own fixed window"
          >
            <Camera className="h-3.5 w-3.5" />
            Snapshot · {rangeLabel} · {adsSyncLabel(data.syncedAt)}
          </span>
        )}
        <div
          className={cn(
            "flex rounded-lg border border-hairline bg-inset p-0.5",
            source === "snapshot" && "opacity-40"
          )}
          title={
            source === "snapshot"
              ? "Snapshot has a fixed window — retry live to change the date range"
              : undefined
          }
        >
          {ADS_PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => onPreset(p.key)}
              disabled={source === "snapshot"}
              className={cn(
                "relative rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                preset === p.key ? "text-abyss" : "text-text-muted hover:text-text-secondary",
                source === "snapshot" && "cursor-not-allowed"
              )}
            >
              {preset === p.key && (
                <motion.span
                  layoutId="ads-preset"
                  className="absolute inset-0 rounded-md bg-lime"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative">{p.label}</span>
            </button>
          ))}
        </div>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onRetry}
          disabled={loading}
          className="flex h-9 items-center gap-2 rounded-lg border border-hairline bg-panel px-3.5 text-[13px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          {source === "snapshot" ? "Retry live" : "Refresh"}
        </motion.button>
      </motion.div>
    </div>
  );
}

// ─── KPI chips ───────────────────────────────────────────────────────────────

function KpiRow({ data }: { data: AdsData }) {
  const s = data.summary;
  const { targetCPA, targetROAS } = data.config;
  // avgCPA is USD — convert at the response's own rate for the IQD-primary view.
  const avgCpaIqd = s.avgCPA != null ? Math.round(s.avgCPA * data.usdToIqd) : 0;
  const cpaTone: KpiDelta["tone"] =
    s.avgCPA == null ? "neutral" : s.avgCPA <= targetCPA ? "pos" : "neg";
  const roasTone: KpiDelta["tone"] =
    s.avgROAS == null ? "neutral" : s.avgROAS >= targetROAS ? "pos" : "neg";

  const cards: {
    label: string;
    value: number;
    decimals?: number;
    format?: (v: number) => string;
    delta: KpiDelta;
    sparkColor?: string;
  }[] = [
    {
      label: "Total Spend",
      value: s.totalSpentIQD,
      format: fmtMoney,
      delta: {
        text: `${fmtUsd(s.totalSpent)} · ${s.matchedSkus} SKUs matched`,
        direction: "flat",
        tone: "neutral",
      },
      sparkColor: "#3EE6D8",
    },
    {
      label: "Purchases",
      value: s.totalPurchases,
      delta: {
        text: `${fmtUsd(s.totalRevenue)} purchase value`,
        direction: "flat",
        tone: "neutral",
      },
    },
    {
      label: "Avg CPA",
      value: avgCpaIqd,
      format: fmtMoney,
      delta: {
        text: `${s.avgCPA != null ? fmtUsd(s.avgCPA) : "—"} · target ${fmtUsd(targetCPA)}`,
        direction: s.avgCPA != null && s.avgCPA <= targetCPA ? "down" : "up",
        tone: cpaTone,
      },
    },
    {
      label: "Avg ROAS",
      value: s.avgROAS ?? 0,
      decimals: 2,
      delta: {
        text: `target ${targetROAS.toFixed(1)}`,
        direction: s.avgROAS != null && s.avgROAS >= targetROAS ? "up" : "down",
        tone: roasTone,
      },
    },
  ];

  return (
    <div>
      <motion.div
        variants={staggerParent}
        initial="hidden"
        animate="show"
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4"
      >
        {cards.map((c) => (
          <motion.div key={c.label} variants={riseChild}>
            <KpiCard
              label={c.label}
              value={c.value}
              decimals={c.decimals}
              format={c.format}
              delta={c.delta}
              sparkColor={c.sparkColor}
            />
          </motion.div>
        ))}
      </motion.div>

      {/* Health counts strip */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.24, ease: EASE }}
        className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-hairline bg-panel px-5 py-3.5"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
          Ad health · {data.healthWindow}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {ADS_HEALTH_ORDER.filter((h) => data.summary.healthCounts[h] > 0).map((h) => {
            const meta = ADS_HEALTH_META[h];
            return (
              <span
                key={h}
                className="rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-bold tnum"
                style={{
                  color: meta.color,
                  borderColor: `${meta.color}40`,
                  backgroundColor: `${meta.color}14`,
                }}
              >
                {data.summary.healthCounts[h]} {meta.label.toLowerCase()}
              </span>
            );
          })}
          {ADS_HEALTH_ORDER.every((h) => data.summary.healthCounts[h] === 0) && (
            <span className="text-[12px] text-text-muted">No ads evaluated yet</span>
          )}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Kill list ───────────────────────────────────────────────────────────────

function KillList({ data }: { data: AdsData }) {
  const kill = data.summary.killList;
  if (kill.length === 0) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.28, ease: EASE }}
      className="mt-4 rounded-xl border border-rose/40 bg-rose/5 p-5"
    >
      <div className="flex items-center gap-3">
        <OctagonX className="h-5 w-5 shrink-0 text-rose" />
        <div>
          <h2 className="font-display text-[15px] font-semibold text-rose">
            Kill these ads now
          </h2>
          <p className="text-[11.5px] text-rose/70">
            Spent ≥ {fmtUsd(data.config.minSpendKill)} with zero purchases in the health window
          </p>
        </div>
        <span className="ml-auto rounded-full border border-rose/40 bg-rose/10 px-2.5 py-1 font-mono text-[10.5px] font-bold uppercase tracking-[0.8px] text-rose tnum">
          {kill.length} to kill
        </span>
      </div>
      <div className="mt-3 divide-y divide-rose/15">
        {kill.map((k) => (
          <div key={k.name} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-text-primary">
                {k.name}
              </span>
              <span className="block text-[11.5px] text-text-muted">
                {k.sku ?? "account-level campaign"}
              </span>
            </span>
            <span className="text-right">
              <span className="block font-mono text-[13px] font-semibold text-rose tnum">
                {fmtMoney(Math.round(k.spent * data.usdToIqd))}
              </span>
              <span className="block font-mono text-[10.5px] text-text-muted tnum">
                {fmtUsd(k.spent)} burned
              </span>
            </span>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

// ─── Product ads table ───────────────────────────────────────────────────────

interface ProductAdRow {
  meta: AdsProduct;
  /** Matched Odoo product (undefined when the SKU isn't in the sync). */
  odoo: Product | undefined;
  /** Impressions-weighted average frequency across the SKU's ads. */
  frequency: number | null;
  /** Effective CPM in USD (spend / impressions × 1000). */
  cpm: number | null;
}

/** DataTable constrains rows to Record<string, unknown>; intersect locally. */
type TableRow = ProductAdRow & Record<string, unknown>;

function weightedFrequency(meta: AdsProduct): number | null {
  let imp = 0;
  let acc = 0;
  for (const ad of meta.ads) {
    if (ad.frequency == null || ad.impressions <= 0) continue;
    imp += ad.impressions;
    acc += ad.frequency * ad.impressions;
  }
  return imp > 0 ? Math.round((acc / imp) * 100) / 100 : null;
}

function buildRows(data: AdsData): ProductAdRow[] {
  return data.products.map((meta) => ({
    meta,
    odoo: getProduct(meta.sku),
    frequency: weightedFrequency(meta),
    cpm: meta.impressions > 0 ? (meta.spent / meta.impressions) * 1000 : null,
  }));
}

function ProductAdsTable({ data }: { data: AdsData }) {
  const navigate = useNavigate();
  const rows = useMemo(() => buildRows(data), [data]);
  const { targetCPA, targetROAS } = data.config;

  const columns = useMemo<Column<TableRow>[]>(
    () => [
      {
        key: "product",
        header: "Product",
        sortable: true,
        sortValue: (r) => r.odoo?.name ?? r.meta.sku,
        render: (r) => (
          <span className="flex items-center gap-3">
            <img
              src={r.odoo?.thumbnail ?? "/empty-box.svg"}
              alt=""
              className="h-9 w-9 shrink-0 rounded-lg border border-hairline object-cover"
            />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-text-primary">
                {r.odoo?.name ?? r.meta.sku}
              </span>
              <span className="block truncate font-mono text-[10.5px] text-text-muted tnum">
                {r.meta.sku} · {r.meta.adCount} ad{r.meta.adCount === 1 ? "" : "s"}
                {!r.odoo && " · not in Odoo sync"}
              </span>
            </span>
          </span>
        ),
      },
      {
        key: "health",
        header: "Health",
        sortable: true,
        // Composite: health group first (ADS_HEALTH_ORDER puts delivering
        // ads before paused/dead), biggest spender first inside each group.
        sortValue: (r) =>
          ADS_HEALTH_ORDER.indexOf(r.meta.health) * 1e12 - r.meta.spentIQD,
        render: (r) => <AdsHealthBadge health={r.meta.health} />,
      },
      {
        key: "spend",
        header: "Spend",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.meta.spentIQD,
        render: (r) => (
          <span className="block">
            <span className="block font-semibold text-text-primary">
              {fmtMoney(r.meta.spentIQD)}
            </span>
            <span className="block text-[10.5px] text-text-muted">{fmtUsd(r.meta.spent)}</span>
          </span>
        ),
      },
      {
        key: "purchases",
        header: "Purchases",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.meta.purchases,
        render: (r) => <span className="text-text-primary">{r.meta.purchases}</span>,
      },
      {
        key: "cpa",
        header: "CPA vs target",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.meta.cpa,
        render: (r) => {
          if (r.meta.cpa == null)
            return <span className="text-text-muted">—</span>;
          const ok = r.meta.cpa <= targetCPA;
          return (
            <span className="block">
              <span
                className="block font-semibold"
                style={{ color: ok ? "#4ADE80" : "#FB5D7A" }}
              >
                {fmtMoney(Math.round(r.meta.cpa * data.usdToIqd))}
              </span>
              <span className="block text-[10.5px] text-text-muted">
                {fmtUsd(r.meta.cpa)} · target {fmtUsd(targetCPA)}
              </span>
            </span>
          );
        },
      },
      {
        key: "roas",
        header: "ROAS vs target",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.meta.roas,
        render: (r) => {
          if (r.meta.roas == null) return <span className="text-text-muted">—</span>;
          const ok = r.meta.roas >= targetROAS;
          const color = ok ? "#4ADE80" : "#FB5D7A";
          return (
            <span className="block">
              <span
                className="inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[13px] font-semibold tnum"
                style={{ color, backgroundColor: `${color}14` }}
              >
                {r.meta.roas.toFixed(2)}
              </span>
              <span className="block text-[10.5px] text-text-muted">
                target {targetROAS.toFixed(1)}
              </span>
            </span>
          );
        },
      },
      {
        key: "frequency",
        header: "Freq",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.frequency,
        render: (r) =>
          r.frequency != null ? (
            <span style={{ color: r.frequency >= 2 ? "#FBBF24" : undefined }}>
              {r.frequency.toFixed(2)}
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
      {
        key: "cpm",
        header: "CPM",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.cpm,
        render: (r) =>
          r.cpm != null ? fmtUsd(r.cpm) : <span className="text-text-muted">—</span>,
      },
    ],
    [targetCPA, targetROAS, data.usdToIqd]
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.32, ease: EASE }}
      className="mt-4"
    >
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Product Ads
        </h2>
        <p className="text-[11.5px] text-text-muted">
          {rows.length} SKUs with ad spend · click a row for the product deep dive
        </p>
      </div>
      <DataTable<TableRow>
        columns={columns}
        rows={rows as TableRow[]}
        rowKey={(r) => r.meta.sku}
        defaultSortKey="health"
        defaultSortDir="asc"
        onRowClick={(r) => navigate(`/products/${r.odoo?.id ?? r.meta.sku}`)}
        emptyState={
          <EmptyState
            className="border-0"
            title="No product ads in this range"
            message="No ad could be matched to an Odoo SKU for the selected date range."
          />
        }
      />
    </motion.section>
  );
}

// ─── Unattributed funnel ads ─────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const live = status === "ACTIVE";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.8px]",
        live ? "bg-pos/15 text-pos" : "bg-amber/15 text-amber"
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-pos" : "bg-amber")}
      />
      {status.toLowerCase().replace(/_/g, " ")}
    </span>
  );
}

function FunnelAdRow({ ad, usdToIqd, index }: { ad: MetaAd; usdToIqd: number; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: 0.42 + index * 0.04 }}
      className="flex items-center gap-3 py-2"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-text-primary">
          {ad.name}
        </span>
        <span className="block truncate text-[11.5px] text-text-muted">
          {ad.campaign}
          {ad.adset ? ` · ${ad.adset}` : ""}
        </span>
      </span>
      <StatusChip status={ad.effectiveStatus} />
      <AdsHealthBadge health={ad.health} />
      <span className="w-28 text-right">
        <span className="block font-mono text-[13px] font-semibold text-text-primary tnum">
          {fmtMoney(Math.round(ad.spent * usdToIqd))}
        </span>
        <span className="block font-mono text-[10.5px] text-text-muted tnum">
          {fmtUsd(ad.spent)} · {ad.purchases} purch
        </span>
      </span>
    </motion.div>
  );
}

function FunnelAds({ data }: { data: AdsData }) {
  const funnel = useMemo(() => data.ads.filter((a) => a.sku === null), [data]);
  if (funnel.length === 0) return null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.38, ease: EASE }}
      className="mt-4 rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="flex items-center gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            Account-level campaigns
          </h2>
          <p className="text-[11.5px] text-text-muted">
            Not tied to a product — funnel / shop-wide traffic
          </p>
        </div>
        <span className="ml-auto rounded-full border border-hairline px-2.5 py-1 font-mono text-[10.5px] font-bold text-text-muted tnum">
          {funnel.length} ads · {fmtUsd(data.summary.unattributedSpent)}
        </span>
      </div>
      <div className="mt-2 divide-y divide-hairline">
        {funnel.map((ad, i) => (
          <FunnelAdRow key={ad.id} ad={ad} usdToIqd={data.usdToIqd} index={i} />
        ))}
      </div>
    </motion.section>
  );
}

// ─── Loading / offline states ────────────────────────────────────────────────

function AdsSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading ads data">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[118px] w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-4 h-[52px] w-full rounded-xl" />
      <Skeleton className="mt-4 h-[340px] w-full rounded-xl" />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Ads() {
  const [preset, setPreset] = useState<AdsPreset>("last_7d");
  const state = useAdsData(preset);
  const { data, loading, offline, reload, source } = state;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <PageHeader preset={preset} onPreset={setPreset} state={state} onRetry={reload} />

      {source === "snapshot" && data && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-[13px] font-semibold text-amber">
          <Camera className="h-4 w-4 shrink-0" />
          <span>
            Cached ads snapshot from{" "}
            {new Date(data.syncedAt).toLocaleString("en-GB", {
              day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
            })}{" "}
            (window: {data.dateRange}) — the live Meta bridge didn't answer, so
            spend figures may be stale. Hit Retry to reload live.
          </span>
        </div>
      )}

      {loading && !data ? (
        <AdsSkeleton />
      ) : offline || !data ? (
        <>
          <EmptyState
            icon={WifiOff}
            title="Meta ads endpoint unreachable"
            message="The Meta Marketing API bridge isn't answering and no baked snapshot is available. Product data from Odoo is unaffected — retry in a moment."
            ctaLabel="Retry"
            onCta={reload}
          />
          {state.lastError && (
            <p className="mt-3 text-center font-mono text-[11px] text-text-muted tnum">
              live tier: {state.lastError} · snapshot tier: /data/ads.json unavailable
            </p>
          )}
        </>
      ) : (
        <>
          <KpiRow data={data} />
          <KillList data={data} />
          {data.products.length === 0 && data.ads.length === 0 ? (
            <EmptyState
              className="mt-4"
              icon={Megaphone}
              title="No ads running in this range"
              message="Meta reported zero spend for the selected window. Try a wider date range."
            />
          ) : (
            <>
              <ProductAdsTable data={data} />
              <FunnelAds data={data} />
            </>
          )}
        </>
      )}
    </motion.div>
  );
}
