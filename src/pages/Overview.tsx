import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Download,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  attentionReason,
  getPortfolioSeries,
  getPortfolioWindowTotals,
  getProductSeries,
  getReturnTrend,
  getShopStock,
  getSparklines,
  globalKpis,
  hasLiveDaily,
  debugHeroSeries,
  needsAttentionList,
  products,
  stageCounts,
  topMovers,
  type DailyPoint,
} from "@/data/products";
import {
  ALERT_META,
  ALERT_URGENCY,
  ALERT_THRESHOLDS,
  HEALTH_COLOR,
  SEVERITY_META,
  STAGE_META,
  roasHealth,
  scaleReadiness,
  supplierCoverDays,
  worstSeverity,
  type AlertSeverity,
  type AlertType,
  type ScaleReadiness,
} from "@/data/decisionEngine";
import KpiCard, { type KpiDelta } from "@/components/KpiCard";
import ChartTooltip from "@/components/ChartTooltip";
import RoasChip from "@/components/RoasChip";
import ScaleLight, { SCALE_LIGHT_META } from "@/components/ScaleLight";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/money";
import { isLiveMode, liveSyncLabel, loadLiveData } from "@/data/liveSync";
import { useAdsVersion, useWindowDays } from "@/data/windowStore";
import {
  adsPresetForWindow,
  adsPresetLabel,
  getAdsSnapshot,
  getAdsSnapshotSource,
} from "@/data/adsProvider";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const riseChild = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

// ─── Derived portfolio numbers (new buy-on-demand model) ─────────────────────

/** Return rate over confident products only (20+ delivered). */
function useMatureReturnRate(version = 0) {
  return useMemo(() => {
    void version; // re-derive after an in-place live/ads re-fetch
    const mature = products.filter((p) => p.returnConfidence === "confident");
    const delivered = mature.reduce((a, p) => a + p.delivered, 0);
    const returned = mature.reduce((a, p) => a + p.returned, 0);
    return {
      rate: delivered > 0 ? (returned / delivered) * 100 : 0,
      delivered,
      products: mature.length,
    };
  }, [version]);
}

/** Active alerts grouped by severity. */
function useAlertSeverityCounts(version = 0) {
  return useMemo(() => {
    void version; // re-derive after an in-place live/ads re-fetch
    const counts: Record<AlertSeverity, number> = {
      info: 0,
      watch: 0,
      issue: 0,
      critical: 0,
    };
    for (const p of products) for (const a of p.alerts) counts[a.severity] += 1;
    return counts;
    // `version` re-derives after an in-place live/ads re-fetch.
  }, [version]);
}

// ─── Section 1: Page header ──────────────────────────────────────────────────

function PageHeader() {
  const [syncing, setSyncing] = useState(false);
  const windowDays = useWindowDays();
  const sync = () => {
    if (syncing) return;
    setSyncing(true);
    // Live mode: re-fetch live.json; if it changed, reload so every module
    // re-derives from the new dataset. Mock mode keeps the demo toast.
    if (!isLiveMode()) {
      window.setTimeout(() => {
        setSyncing(false);
        toast.success(`Synced ${globalKpis.totalProducts} products from Odoo`);
      }, 700);
      return;
    }
    void loadLiveData().then(() => {
      toast.success("Re-fetched Odoo snapshot — reloading");
      window.location.reload();
    });
  };
  const syncLine = isLiveMode()
    ? `Live from Odoo · ${liveSyncLabel()}`
    : "Mock data · demo snapshot";
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <motion.p
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25 }}
          className="text-[11px] font-semibold uppercase tracking-[1.2px] text-lime/80"
        >
          Command Deck
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06, ease: EASE }}
          className="mt-1 font-display text-[28px] font-semibold tracking-[-0.5px] text-text-primary"
        >
          Product Portfolio Overview
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.21 }}
          className="mt-1 text-[13.5px] text-text-secondary"
        >
          {globalKpis.totalProducts} products tracked · {globalKpis.activeProducts} live ·
          Buy-on-demand via butiksistem + Odoo · {syncLine} · Window: Last {windowDays} days
        </motion.p>
      </div>
      <motion.div
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="flex items-center gap-2"
      >
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() => toast.info("Export queued — MVP stub")}
          className="flex h-9 items-center gap-2 rounded-lg border border-hairline bg-panel px-3.5 text-[13px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={sync}
          className="flex h-9 items-center gap-2 rounded-lg bg-lime px-3.5 text-[13px] font-semibold text-abyss transition-colors hover:brightness-110"
        >
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
          Sync Odoo
        </motion.button>
      </motion.div>
    </div>
  );
}

// ─── Section 2: KPI cards ────────────────────────────────────────────────────

function KpiRow() {
  const navigate = useNavigate();
  const windowDays = useWindowDays();
  // Re-render in place when an async ads re-fetch (window change) lands.
  useAdsVersion();
  const k = globalKpis;
  const mature = useMatureReturnRate();
  const severity = useAlertSeverityCounts();

  const liveModeOn = isLiveMode();
  const liveDailyOn = liveModeOn && hasLiveDaily();
  const sparks = getSparklines(windowDays);
  // Real windowed sums (null in mock mode or without daily buckets).
  const wt = liveDailyOn ? getPortfolioWindowTotals(windowDays) : null;

  // What window/source does the Meta spend number actually cover?
  const adsSnap = getAdsSnapshot();
  const adsSource = getAdsSnapshotSource();
  const adsChip = adsSnap
    ? adsSource === "snapshot"
      ? `Meta · CACHED ${adsPresetLabel(adsSnap.dateRange)} from ${new Date(adsSnap.syncedAt).toLocaleString("en-GB", { day: "numeric", month: "short" })} — may be stale`
      : `Meta · ${adsSource} · ${adsPresetLabel(adsSnap.dateRange)}`
    : "Meta · ads offline";
  // ROAS is only honest when spend and revenue cover the SAME window.
  const adsMatchesWindow =
    liveDailyOn &&
    adsSource === "live" &&
    adsSnap != null &&
    adsSnap.dateRange === adsPresetForWindow(windowDays);
  // Account-level authoritative spend from the endpoint (matches Ads Manager).
  // k.adSpend is only the SKU-matched subset — right for per-product views,
  // wrong for the portfolio card.
  const adsTotalSpendIQD = adsSnap ? Math.round(adsSnap.summary.totalSpentIQD) : 0;

  /** % delta vs the previous equal-length window; hidden when no coverage. */
  const windowDelta = (cur: number, prev: number | null): KpiDelta => {
    if (prev == null)
      return { text: `last ${windowDays} days`, direction: "flat", tone: "neutral" };
    if (prev <= 0)
      return {
        text: `prior ${windowDays}d had no data`,
        direction: "flat",
        tone: "neutral",
      };
    const pct = ((cur - prev) / prev) * 100;
    return {
      text: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs prior ${windowDays}d`,
      direction: pct > 0.05 ? "up" : pct < -0.05 ? "down" : "flat",
      tone: pct > 0.05 ? "pos" : pct < -0.05 ? "neg" : "neutral",
    };
  };

  // Live orders subline: windowed UNITS sold (Odoo doesn't split chat/web —
  // the mock "N chat · N website" line would be a fabrication here).
  const ordersDelta = (w: NonNullable<typeof wt>): KpiDelta => {
    const base = windowDelta(w.orders, w.prevOrders);
    return { ...base, text: `${base.text} · ${w.units.toLocaleString()} units` };
  };
  // Live revenue subline: revenue of orders CONFIRMED in the window (not
  // collected cash, returns not yet subtracted), product prices only —
  // delivery/discount lines are excluded from the dataset.
  const revenueDelta = (cur: number, prev: number | null): KpiDelta => {
    const base = windowDelta(cur, prev);
    return liveModeOn
      ? { ...base, text: `${base.text} · confirmed orders, before returns · excl. delivery` }
      : base;
  };

  // Never show a fabricated sparkline over a live money metric.
  const ordersSpark = !liveModeOn || liveDailyOn ? sparks.orders : undefined;
  const revenueSpark = !liveModeOn || liveDailyOn ? sparks.revenue : undefined;
  const returnRateSpark = !liveModeOn || liveDailyOn ? sparks.returnRate : undefined;
  const blendedRoas =
    adsMatchesWindow && wt != null && k.adSpend > 0
      ? Math.round((wt.revenue / k.adSpend) * 100) / 100
      : null;

  const alertSummary = (["critical", "issue", "watch", "info"] as AlertSeverity[])
    .filter((s) => severity[s] > 0)
    .map((s) => `${severity[s]} ${s}`)
    .join(" · ");

  const cards: {
    label: string;
    value: number;
    valueText?: string;
    prefix?: string;
    suffix?: string;
    decimals?: number;
    format?: (v: number) => string;
    delta: KpiDelta;
    spark?: number[];
    sparkColor?: string;
    threshold?: number;
    size?: "default" | "small";
    onClick?: () => void;
  }[] = [
    {
      label: "Live Products", value: k.activeProducts,
      delta: { text: `${k.totalProducts} tracked · current state`, direction: "flat", tone: "neutral" },
      spark: sparks.activeProducts, sparkColor: "#C6F04D",
    },
    wt
      ? {
          // Windowed shop-wide order DOCUMENTS — matches the Odoo orders list.
          label: "Total Orders", value: wt.orders,
          delta: ordersDelta(wt),
          spark: ordersSpark, sparkColor: "#C6F04D",
        }
      : {
          label: "Total Orders", value: k.totalOrders,
          delta: {
            text: liveModeOn
              ? "lifetime orders · Odoo"
              : `${k.chatOrders.toLocaleString()} chat · ${k.websiteOrders.toLocaleString()} website`,
            direction: "flat", tone: "neutral",
          },
          spark: ordersSpark, sparkColor: "#C6F04D",
        },
    wt
      ? {
          label: "Revenue", value: wt.revenue, format: fmtMoney,
          delta: revenueDelta(wt.revenue, wt.prevRevenue),
          spark: revenueSpark, sparkColor: "#C6F04D",
        }
      : {
          label: "Revenue", value: k.revenue, format: fmtMoney,
          delta: liveModeOn
            ? { text: "lifetime · Odoo · product revenue, excl. delivery", direction: "flat", tone: "neutral" }
            : { text: "12.4%", direction: "up", tone: "pos" },
          spark: revenueSpark, sparkColor: "#C6F04D",
        },
    liveModeOn
      ? {
          label: "Ad Spend", value: adsTotalSpendIQD, format: fmtMoney,
          // Honest label: the spend window is whatever Meta answered with,
          // NOT necessarily the selected portfolio window.
          delta: { text: adsChip, direction: "flat", tone: "neutral" },
        }
      : {
          label: "Ad Spend", value: k.adSpend, format: fmtMoney,
          delta: { text: "9.8%", direction: "up", tone: "neutral" },
          spark: sparks.adSpend, sparkColor: "#3EE6D8",
        },
    liveModeOn
      ? blendedRoas != null
        ? {
            label: "Blended ROAS", value: blendedRoas, decimals: 2,
            delta: {
              text: `revenue ${windowDays}d ÷ ${adsChip}`,
              direction: "flat", tone: "neutral",
            },
            threshold: 1.8,
          }
        : {
            // Never divide numbers from two different windows.
            label: "Blended ROAS", value: 0, valueText: "—",
            delta: {
              text: adsSnap
                ? `spend window ≠ revenue window (${adsChip})`
                : "Meta · ads offline",
              direction: "flat", tone: "neutral",
            },
          }
      : {
          label: "Blended ROAS", value: k.blendedRoas, decimals: 2,
          delta: { text: "0.3", direction: "down", tone: "neutral" },
          spark: sparks.roas, sparkColor: "#C6F04D", threshold: 1.8,
        },
    {
      label: "Mature Return Rate", value: mature.rate, suffix: "%", decimals: 1,
      delta: {
        text: `lifetime · n=${mature.delivered.toLocaleString()} delivered`,
        direction: "flat", tone: "neutral",
      },
      spark: returnRateSpark, sparkColor: "#3EE6D8",
      threshold: ALERT_THRESHOLDS.RETURN_RATE_OK,
    },
    (() => {
      // Live + shop-wide stock available: show the WHOLE warehouse. Semantics
      // match Odoo's Inventory → Stock report ("Available Products"):
      // qty_available > 0 variants, valued at cost (standard_price).
      const shop = getShopStock();
      if (liveModeOn && shop) {
        return {
          label: "Warehouse Stock", value: shop.stockUnits, suffix: "units", size: "small" as const,
          delta: {
            text: `all products on hand · ≈ ${fmtMoney(shop.stockValue)} at cost`,
            direction: "flat" as const, tone: "neutral" as const,
          },
          spark: sparks.returnedStock, sparkColor: "#FBBF24",
        };
      }
      return {
        label: "Returned Stock", value: k.returnedStockUnits, suffix: "units", size: "small" as const,
        delta: {
          text: `≈ ${fmtMoney(k.returnedStockValue)} on hand${liveModeOn ? " · tracked products only" : ""}`,
          direction: "flat" as const, tone: "neutral" as const,
        },
        spark: sparks.returnedStock, sparkColor: "#FBBF24",
      };
    })(),
    {
      label: "Active Alerts", value: k.activeAlerts, size: "small",
      delta: {
        text: alertSummary ? `${alertSummary} · now` : "all clear",
        direction: "flat",
        tone: severity.critical + severity.issue > 0 ? "neg" : "neutral",
      },
      onClick: () => navigate("/decisions"),
    },
  ];

  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4"
    >
      {cards.map((c) => (
        <motion.div key={c.label} variants={riseChild}>
          <KpiCard
            label={c.label}
            value={c.value}
            valueText={c.valueText}
            prefix={c.prefix}
            suffix={c.suffix}
            decimals={c.decimals}
            format={c.format}
            delta={c.delta}
            sparkline={c.spark}
            sparkColor={c.sparkColor}
            threshold={c.threshold}
            size={c.size}
            onClick={c.onClick}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}

// ─── Section 3: Hero chart — Orders & Revenue vs Ad Spend ────────────────────

type HeroMode = "revenue" | "orders";

function HeroTooltip({ mode, live, ...props }: Parameters<typeof ChartTooltip>[0] & { mode: HeroMode; live: boolean }) {
  const point = props.payload?.[0]?.payload as DailyPoint | undefined;
  return (
    <ChartTooltip
      {...props}
      formatValue={(v, name) =>
        mode === "orders" && name !== "Ad spend"
          ? `${Math.round(v).toLocaleString()} orders`
          : fmtMoney(v)
      }
      footer={
        // Live mode has no daily ad spend — never fabricate a daily ROAS.
        !live && point
          ? {
              label: "ROAS that day",
              value: point.roas.toFixed(1),
              color: HEALTH_COLOR[roasHealth(point.roas)],
            }
          : live && point
            ? {
                label: "That day",
                value: `${Math.round(point.orders)} orders · ${fmtMoney(point.returnsValue)} est. returns`,
                color: "#93A1B0",
              }
            : undefined
      }
    />
  );
}

function HeroChart() {
  const [mode, setMode] = useState<HeroMode>("revenue");
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const windowDays = useWindowDays();
  const adsVersion = useAdsVersion();
  // Live mode (with daily buckets): REAL Odoo daily series. Mock: seeded.
  const live = hasLiveDaily();
  const series = useMemo(
    () => getPortfolioSeries(windowDays),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- adsVersion: a refetch may swap the underlying buckets
    [windowDays, adsVersion]
  );

  // Weekend shading: pair up Saturday→Sunday reference areas.
  const weekends = useMemo(() => {
    const pairs: { x1: string; x2: string }[] = [];
    for (let i = 0; i < series.length - 1; i++) {
      if (series[i].date.getDay() === 6) {
        pairs.push({ x1: series[i].label, x2: series[i + 1].label });
        i++;
      }
    }
    return pairs;
  }, [series]);

  const legend: { key: string; label: string; color: string }[] =
    mode === "revenue"
      ? live
        ? [
            // No daily ad spend in live mode — the series is hidden.
            { key: "revenue", label: "Revenue", color: "#C6F04D" },
            { key: "returnsValue", label: "Returns (est. value)", color: "#FB5D7A" },
          ]
        : [
            { key: "revenue", label: "Revenue", color: "#C6F04D" },
            { key: "adSpend", label: "Ad spend", color: "#3EE6D8" },
            { key: "returnsValue", label: "Returns", color: "#FB5D7A" },
          ]
      : live
        ? [{ key: "orders", label: "Orders", color: "#C6F04D" }]
        : [
            { key: "orders", label: "Orders", color: "#C6F04D" },
            { key: "chatOrders", label: "Chat orders", color: "#3EE6D8" },
            { key: "websiteOrders", label: "Website orders", color: "#8B7CFF" },
          ];

  const show = (key: string) => hidden[key] !== true;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: EASE }}
      className="col-span-12 flex h-[340px] flex-col rounded-xl border border-hairline bg-panel p-5 lg:col-span-8"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            {mode === "revenue" ? "Revenue vs Ad Spend" : "Orders by Channel"}
          </h2>
          <p className="text-[11.5px] text-text-muted">Daily · last 30 days · from Odoo</p>
          {/* TEMP diagnostic — remove after hero chart fix is confirmed */}
          <p className="font-mono text-[10px] text-amber-400">
            {debugHeroSeries(windowDays)}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            {legend.map((l) => (
              <button
                key={l.key}
                onClick={() => setHidden((h) => ({ ...h, [l.key]: !h[l.key] }))}
                className={cn(
                  "flex items-center gap-1.5 text-[11.5px] text-text-secondary transition-opacity",
                  !show(l.key) && "opacity-35"
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: l.color }} />
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-hairline bg-inset p-0.5">
            {(["revenue", "orders"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "relative rounded-md px-2.5 py-1 text-[11.5px] font-semibold capitalize transition-colors",
                  mode === m ? "text-abyss" : "text-text-muted hover:text-text-secondary"
                )}
              >
                {mode === m && (
                  <motion.span
                    layoutId="hero-tab"
                    className="absolute inset-0 rounded-md bg-lime"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <span className="relative">{m}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id="gradLime" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C6F04D" stopOpacity={0.14} />
                <stop offset="100%" stopColor="#C6F04D" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradCyan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3EE6D8" stopOpacity={0.1} />
                <stop offset="100%" stopColor="#3EE6D8" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradViolet" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8B7CFF" stopOpacity={0.1} />
                <stop offset="100%" stopColor="#8B7CFF" stopOpacity={0} />
              </linearGradient>
            </defs>
            {weekends.map((w) => (
              <ReferenceArea
                key={w.x1}
                x1={w.x1}
                x2={w.x2}
                fill="#151D27"
                fillOpacity={0.2}
                strokeOpacity={0}
              />
            ))}
            <CartesianGrid horizontal vertical={false} stroke="#232E3B" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              interval={Math.max(1, Math.ceil(windowDays / 8) - 1)}
              tick={{ fill: "#5B6875", fontSize: 10.5, fontFamily: "Inter" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#5B6875", fontSize: 10.5, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) =>
                mode === "revenue" ? fmtMoney(v) : `${v}`
              }
            />
            <Tooltip
              content={<HeroTooltip mode={mode} live={live} />}
              cursor={{ stroke: "#33414F", strokeWidth: 1 }}
            />
            {mode === "revenue" ? (
              <>
                <Bar
                  dataKey="returnsValue"
                  name={live ? "Returns (est. value)" : "Returns"}
                  fill="#FB5D7A"
                  fillOpacity={0.5}
                  barSize={6}
                  radius={[2, 2, 0, 0]}
                  hide={!show("returnsValue")}
                  isAnimationActive
                  animationDuration={700}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  name="Revenue"
                  stroke="#C6F04D"
                  strokeWidth={2.5}
                  fill="url(#gradLime)"
                  hide={!show("revenue")}
                  isAnimationActive
                  animationDuration={900}
                  animationEasing="ease-out"
                />
                {/* No daily ad spend in live mode — hide the series entirely
                    rather than plotting zeros. */}
                {!live && (
                  <Area
                    type="monotone"
                    dataKey="adSpend"
                    name="Ad spend"
                    stroke="#3EE6D8"
                    strokeWidth={2}
                    fill="url(#gradCyan)"
                    hide={!show("adSpend")}
                    isAnimationActive
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                )}
              </>
            ) : (
              <>
                {/* Channel split exists only in mock data; Odoo doesn't tag it. */}
                {!live && (
                  <Area
                    type="monotone"
                    dataKey="websiteOrders"
                    name="Website orders"
                    stroke="#8B7CFF"
                    strokeWidth={2}
                    fill="url(#gradViolet)"
                    hide={!show("websiteOrders")}
                    isAnimationActive
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                )}
                {!live && (
                  <Area
                    type="monotone"
                    dataKey="chatOrders"
                    name="Chat orders"
                    stroke="#3EE6D8"
                    strokeWidth={2}
                    fill="url(#gradCyan)"
                    hide={!show("chatOrders")}
                    isAnimationActive
                    animationDuration={900}
                    animationEasing="ease-out"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="orders"
                  name="Orders"
                  stroke="#C6F04D"
                  strokeWidth={2.5}
                  fill="url(#gradLime)"
                  hide={!show("orders")}
                  isAnimationActive
                  animationDuration={900}
                  animationEasing="ease-out"
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
}

// ─── Section 4: Lifecycle pipeline ──────────────────────────────────────────

function LifecyclePipeline() {
  const navigate = useNavigate();
  const stages = stageCounts();
  const alertMix = (Object.entries(globalKpis.alertCounts) as [AlertType, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => ALERT_URGENCY[a[0]] - ALERT_URGENCY[b[0]]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.16, ease: EASE }}
      className="col-span-12 flex h-[340px] flex-col rounded-xl border border-hairline bg-panel p-5 lg:col-span-4"
    >
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Lifecycle Pipeline</h2>
      <p className="text-[11.5px] text-text-muted">Products by stage · shared → completed</p>
      <div className="mt-4 flex flex-1 flex-col justify-between gap-1">
        {stages.map(({ stage, count }, i) => {
          const meta = STAGE_META[stage];
          return (
            <motion.button
              key={stage}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.2 + i * 0.05 }}
              onClick={() => navigate(`/products?stage=${stage}`)}
              className="group rounded-md px-2 py-1.5 text-left transition-colors hover:bg-panel-hover"
            >
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
                <span className="text-[13px] font-medium text-text-secondary group-hover:text-text-primary">
                  {meta.label}
                </span>
                <span className="ml-auto font-mono text-[13px] font-semibold text-text-primary tnum">
                  {count}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-inset">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(count / globalKpis.totalProducts) * 100}%` }}
                  transition={{ duration: 0.8, delay: 0.25 + i * 0.05, ease: "easeOut" }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
              </div>
            </motion.button>
          );
        })}
      </div>
      <div className="mt-3 border-t border-hairline pt-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
          Alert mix · {globalKpis.activeAlerts} active
        </p>
        <div className="flex h-2 w-full gap-px overflow-hidden rounded-full">
          {alertMix.map(([type, count], i) => (
            <motion.div
              key={type}
              title={`${ALERT_META[type].label} · ${count} alerts`}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.5, delay: 0.4 + i * 0.06, ease: "easeOut" }}
              className="h-full origin-left"
              style={{
                width: `${(count / globalKpis.activeAlerts) * 100}%`,
                backgroundColor: ALERT_META[type].color,
              }}
            />
          ))}
        </div>
      </div>
    </motion.section>
  );
}

// ─── Section 5a: Supplier stock watchlist ────────────────────────────────────

const ADS_RUNNING: readonly string[] = ["ads-live", "selling", "supplier-low"];

function SupplierWatchlist() {
  const navigate = useNavigate();
  const adsVersion = useAdsVersion();
  const rows = useMemo(
    () => {
      void adsVersion; // re-derive after an in-place live/ads re-fetch
      return products
        .filter((p) => ADS_RUNNING.includes(p.stage))
        .map((p) => ({
          product: p,
          cover: supplierCoverDays(p.supplierStock.qty, p.orderVelocity7d),
        }))
        .filter((r) => r.cover !== Infinity)
        .sort((a, b) => a.cover - b.cover)
        .slice(0, 5);
    },
    [adsVersion]
  );

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.24, ease: EASE }}
      className="col-span-12 flex h-[300px] flex-col rounded-xl border border-hairline bg-panel p-5 lg:col-span-5"
    >
      <div className="flex items-center gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            Supplier Stock Watchlist
          </h2>
          <p className="text-[11.5px] text-text-muted">
            Ads-running products · days of cover at 7d velocity
          </p>
        </div>
        <span className="ml-auto rounded-full border border-amber/40 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.8px] text-amber">
          Wind down &lt; {ALERT_THRESHOLDS.SUPPLIER_LOW_DAYS}d
        </span>
      </div>
      <div className="mt-2 min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
        {rows.map(({ product: p, cover }, i) => {
          const color = cover < ALERT_THRESHOLDS.SUPPLIER_LOW_DAYS ? "#FBBF24" : "#4ADE80";
          return (
            <motion.button
              key={p.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25, delay: 0.35 + i * 0.04 }}
              onClick={() => navigate(`/products/${p.id}`)}
              className="group flex w-full items-center gap-3 px-1.5 py-2 text-left transition-colors hover:bg-panel-hover"
            >
              <img
                src={p.thumbnail}
                alt=""
                className="h-8 w-8 rounded-lg border border-hairline object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-text-primary transition-colors group-hover:text-lime">
                  {p.name}
                </span>
                <span className="block truncate text-[11.5px] text-text-muted">
                  {p.supplier} · {p.supplierStock.qty != null
                    ? `${p.supplierStock.qty.toLocaleString()}u on butiksistem`
                    : "supplier stock unknown"} ·{" "}
                  {p.orderVelocity7d}/day
                </span>
              </span>
              <span className="text-right">
                <span
                  className="block font-mono text-[15px] font-semibold tnum"
                  style={{ color }}
                >
                  {cover.toFixed(1)}d
                </span>
                <span className="block text-[10px] uppercase tracking-[0.8px] text-text-muted">
                  cover
                </span>
              </span>
            </motion.button>
          );
        })}
      </div>
    </motion.section>
  );
}

// ─── Section 5b: Return rate trend ───────────────────────────────────────────

function ReturnTrendTooltip(props: Parameters<typeof ChartTooltip>[0]) {
  const point = props.payload?.[0]?.payload as
    | { returnPct: number; returns: number; driver?: string }
    | undefined;
  return (
    <ChartTooltip
      {...props}
      formatValue={(v) => `${v.toFixed(1)}%`}
      footer={
        point?.driver
          ? { label: "Spike driver", value: point.driver, color: "#FB5D7A" }
          : undefined
      }
    />
  );
}

function ReturnTrend() {
  const navigate = useNavigate();
  const windowDays = useWindowDays();
  // Live mode: honest daily returned/delivered units from Odoo stock moves.
  const live = hasLiveDaily();
  const trend = useMemo(() => getReturnTrend(windowDays), [windowDays]);
  // The day-21 DreamWave spike exists only in the seeded mock series.
  const spike = live ? undefined : trend.find((p) => p.day === 21);
  const ok = ALERT_THRESHOLDS.RETURN_RATE_OK; // 25
  // Mock keeps the fixed readable 5..30 domain; live adapts to real data
  // while always showing the 25% watch band.
  const Y_MIN = live ? 0 : 5;
  const Y_MAX = live
    ? Math.max(30, Math.ceil(Math.max(...trend.map((t) => t.returnPct), 0) * 1.15))
    : 30;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3, ease: EASE }}
      className="col-span-12 flex h-[300px] flex-col rounded-xl border border-hairline bg-panel p-5 lg:col-span-7"
    >
      <div className="flex items-center gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            Return Rate Trend
          </h2>
          <p className="text-[11.5px] text-text-muted">
            Daily · portfolio · last {windowDays} days
            {live ? " · from Odoo stock moves" : " · volume-based"}
          </p>
        </div>
        <span className="ml-auto rounded-full border border-pos/40 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.8px] text-pos">
          Healthy ≤ {ok}%
        </span>
      </div>
      <div className="mt-3 min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
            <CartesianGrid horizontal vertical={false} stroke="#232E3B" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              interval={Math.max(1, Math.ceil(windowDays / 8) - 1)}
              tick={{ fill: "#5B6875", fontSize: 10.5, fontFamily: "Inter" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[Y_MIN, Y_MAX]}
              tick={{ fill: "#5B6875", fontSize: 10.5, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              content={<ReturnTrendTooltip />}
              cursor={{ stroke: "#33414F", strokeWidth: 1 }}
            />
            {/* Watch band above the 25% healthy limit */}
            <ReferenceArea
              y1={ok}
              y2={ALERT_THRESHOLDS.RETURN_RATE_WATCH}
              fill="#FBBF24"
              fillOpacity={0.07}
              strokeOpacity={0}
            />
            <ReferenceLine
              y={ok}
              stroke="#FBBF24"
              strokeDasharray="6 4"
              label={{
                value: `watch zone > ${ok}%`,
                position: "insideTopRight",
                fill: "#FBBF24",
                fontSize: 10,
              }}
            />
            <Line
              type="monotone"
              dataKey="returnPct"
              name="Return rate"
              stroke="#3EE6D8"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive
              animationDuration={1000}
              activeDot={{
                r: 4,
                fill: "#3EE6D8",
                stroke: "#0C1118",
                strokeWidth: 2,
              }}
            />
            {/* Spike marker at day 21 → DreamWave */}
            {spike && (
              <ReferenceLine
                x={spike.label}
                stroke="transparent"
                label={({ viewBox }: { viewBox?: { x: number; y: number; height: number } }) => {
                  const x = viewBox?.x ?? 0;
                  const cy =
                    (viewBox?.y ?? 0) +
                    ((viewBox?.height ?? 0) * (Y_MAX - spike.returnPct)) / (Y_MAX - Y_MIN);
                  return (
                    <g
                      onClick={() => navigate("/products/pld-005")}
                      style={{ cursor: "pointer" }}
                    >
                      <circle cx={x} cy={cy} r={5} fill="#FB5D7A" />
                      <circle cx={x} cy={cy} r={5} fill="none" stroke="#FB5D7A" strokeWidth={1.5} opacity={0.6}>
                        <animate attributeName="r" values="5;9" dur="2.4s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.6;0" dur="2.4s" repeatCount="indefinite" />
                      </circle>
                    </g>
                  );
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
}

// ─── Section 5c: Scale readiness strip ───────────────────────────────────────

const SCALE_GROUPS: {
  readiness: Exclude<ScaleReadiness, "not-applicable">;
  title: string;
  hint: string;
}[] = [
  { readiness: "safe", title: "Safe", hint: "go push budget in Meta" },
  { readiness: "caution", title: "Caution", hint: "fix the weak signal first" },
  { readiness: "blocked", title: "Blocked", hint: "do not scale" },
];

/** Compact strip: is it SAFE to scale each ads-running product? */
function ScaleReadinessStrip() {
  const navigate = useNavigate();
  const adsVersion = useAdsVersion();
  const groups = useMemo(() => {
    void adsVersion; // re-derive after an in-place live/ads re-fetch
    const rows = products
      .map((p) => ({ product: p, verdict: scaleReadiness(p) }))
      .filter((r) => r.verdict.readiness !== "not-applicable");
    return SCALE_GROUPS.map((g) => ({
      ...g,
      rows: rows.filter((r) => r.verdict.readiness === g.readiness),
    }));
  }, [adsVersion]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.33, ease: EASE }}
      className="col-span-12 rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            Scale Readiness
          </h2>
          <p className="text-[11.5px] text-text-muted">
            Ads-running products · supplier cover, returns & ROAS Meta can't see
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {groups.map((g) => (
            <span
              key={g.readiness}
              className="rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-bold tnum"
              style={{
                color: SCALE_LIGHT_META[g.readiness].color,
                borderColor: `${SCALE_LIGHT_META[g.readiness].color}40`,
                backgroundColor: `${SCALE_LIGHT_META[g.readiness].color}14`,
              }}
            >
              {g.rows.length} {g.title.toLowerCase()}
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
        {groups.map((g, gi) => (
          <div key={g.readiness} className="min-w-0">
            <div className="mb-1.5 flex items-baseline gap-2 px-1.5">
              <span
                className="h-2 w-2 shrink-0 translate-y-[-1px] rounded-full"
                style={{ backgroundColor: SCALE_LIGHT_META[g.readiness].color }}
              />
              <span className="text-[12px] font-bold uppercase tracking-[0.8px] text-text-primary">
                {g.title}
              </span>
              <span className="truncate text-[11px] text-text-muted">{g.hint}</span>
            </div>
            <div className="divide-y divide-hairline">
              {g.rows.length === 0 && (
                <p className="px-1.5 py-2 text-[12px] text-text-muted">None right now</p>
              )}
              {g.rows.map(({ product: p, verdict }, i) => (
                <motion.button
                  key={p.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: 0.4 + gi * 0.06 + i * 0.04 }}
                  onClick={() => navigate(`/products/${p.id}`)}
                  className="group flex w-full items-center gap-2.5 px-1.5 py-2 text-left transition-colors hover:bg-panel-hover"
                >
                  <img
                    src={p.thumbnail}
                    alt=""
                    className="h-7 w-7 shrink-0 rounded-lg border border-hairline object-cover"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-text-primary transition-colors group-hover:text-lime">
                      {p.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-text-muted">
                      {verdict.reasons[0]}
                    </span>
                  </span>
                  <ScaleLight product={p} size="sm" className="shrink-0" />
                </motion.button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

// ─── Section 6a: Top movers ──────────────────────────────────────────────────

function MiniSpark({ data, color }: { data: number[]; color: string }) {
  const w = 48;
  const h = 16;
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * (w - 2) + 1},${h - 1.5 - ((v - min) / range) * (h - 3)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TopMovers() {
  const navigate = useNavigate();
  const adsVersion = useAdsVersion();
  const movers = useMemo(() => {
    void adsVersion; // re-derive after an in-place live/ads re-fetch
    return topMovers(5);
  }, [adsVersion]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.36, ease: EASE }}
      className="col-span-12 rounded-xl border border-hairline bg-panel p-5 lg:col-span-6"
    >
      <div className="flex items-center gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">Top Movers</h2>
          <p className="text-[11.5px] text-text-muted">
            Best ROAS · lifetime revenue ÷ Meta spend
          </p>
        </div>
        <button
          onClick={() => navigate("/products")}
          className="group ml-auto text-[12.5px] font-semibold text-lime"
        >
          View all products
          <span className="ml-0.5 inline-block transition-transform group-hover:translate-x-0.5">→</span>
        </button>
      </div>
      <div className="mt-2 divide-y divide-hairline">
        {movers.map((p, i) => {
          const supplierRisk = p.alerts.some(
            (a) => a.type === "SUPPLIER_OUT" || a.type === "SUPPLIER_LOW"
          );
          const series = getProductSeries(p.id).map((d) => d.revenue);
          const recent = series.slice(-3).reduce((a, b) => a + b, 0);
          const prior = series.slice(-6, -3).reduce((a, b) => a + b, 0);
          const up = recent >= prior;
          return (
            <motion.button
              key={p.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.42 + i * 0.04 }}
              onClick={() => navigate(`/products/${p.id}`)}
              className={cn(
                "group relative flex h-[52px] w-full items-center gap-3 px-2 text-left transition-colors hover:bg-panel-hover",
                supplierRisk && "border-l-2 border-l-amber"
              )}
            >
              <img
                src={p.thumbnail}
                alt=""
                className="h-8 w-8 rounded-lg border border-hairline object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-text-primary transition-colors group-hover:text-lime">
                  {p.name}
                  {supplierRisk && <AlertTriangle className="h-3 w-3 text-amber" />}
                </span>
                <span className="block font-mono text-[11px] text-text-muted tnum">{p.sku}</span>
              </span>
              {supplierRisk && (
                <span className="hidden text-[11px] text-amber md:block">supplier stock low</span>
              )}
              <MiniSpark data={series} color={up ? "#4ADE80" : "#FBBF24"} />
              <RoasChip value={p.roas} />
              {up ? (
                <ArrowUpRight className="h-3.5 w-3.5 text-pos" />
              ) : (
                <ArrowDownRight className="h-3.5 w-3.5 text-amber" />
              )}
            </motion.button>
          );
        })}
      </div>
    </motion.section>
  );
}

// ─── Section 6b: Needs attention (alert-driven) ──────────────────────────────

function NeedsAttention() {
  const navigate = useNavigate();
  const adsVersion = useAdsVersion();
  const items = useMemo(() => {
    void adsVersion; // re-derive after an in-place live/ads re-fetch
    return needsAttentionList().slice(0, 7);
  }, [adsVersion]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4, ease: EASE }}
      className="col-span-12 rounded-xl border border-hairline bg-panel p-5 lg:col-span-6"
    >
      <div className="flex items-center gap-3">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Needs Attention
        </h2>
        <span className="rounded-full bg-amber/15 px-2 py-0.5 font-mono text-[11px] font-bold text-amber tnum">
          {globalKpis.needsAttention}
        </span>
        <button
          onClick={() => navigate("/decisions")}
          className="group ml-auto text-[12.5px] font-semibold text-lime"
        >
          Open decision queue
          <span className="ml-0.5 inline-block transition-transform group-hover:translate-x-0.5">→</span>
        </button>
      </div>
      <div className="mt-2 divide-y divide-hairline">
        {items.map((p, i) => {
          const top = p.alerts[0];
          const worst = worstSeverity(p.alerts);
          if (!top || !worst) return null;
          const meta = ALERT_META[top.type];
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: 0.46 + i * 0.04 }}
              onClick={() => navigate(`/products/${p.id}`)}
              className="group flex w-full cursor-pointer items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-panel-hover"
            >
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: [0, 1.4, 1] }}
                transition={{ duration: 0.4, delay: 0.46 + i * 0.04 }}
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: SEVERITY_META[worst].color }}
              />
              <img
                src={p.thumbnail}
                alt=""
                className="h-7 w-7 rounded-lg border border-hairline object-cover"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-text-primary transition-colors group-hover:text-lime">
                  {p.name}
                </span>
                <span className="block truncate text-[12.5px] text-text-secondary">
                  {attentionReason(p)}
                </span>
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/products?alert=${top.type}`);
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px] transition-opacity hover:opacity-80"
                style={{ color: meta.color, backgroundColor: meta.bg, borderColor: meta.border }}
                title={top.message}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                {meta.label}
                {p.alerts.length > 1 && (
                  <span className="font-mono text-[10px] opacity-80 tnum">
                    +{p.alerts.length - 1}
                  </span>
                )}
              </button>
            </motion.div>
          );
        })}
      </div>
    </motion.section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ChartSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-xl border border-hairline bg-panel", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-panel-hover/60 to-transparent" />
    </div>
  );
}

export default function Overview() {
  // Brief skeleton shimmer on first load, then charts draw in.
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 600);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div>
      <PageHeader />
      <KpiRow />
      {loading ? (
        <div className="mt-4 grid grid-cols-12 gap-4">
          <ChartSkeleton className="col-span-12 h-[340px] lg:col-span-8" />
          <ChartSkeleton className="col-span-12 h-[340px] lg:col-span-4" />
          <ChartSkeleton className="col-span-12 h-[300px] lg:col-span-5" />
          <ChartSkeleton className="col-span-12 h-[300px] lg:col-span-7" />
          <ChartSkeleton className="col-span-12 h-[380px] lg:col-span-6" />
          <ChartSkeleton className="col-span-12 h-[380px] lg:col-span-6" />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-12 gap-4">
          <HeroChart />
          <LifecyclePipeline />
          <SupplierWatchlist />
          <ReturnTrend />
          <ScaleReadinessStrip />
          <TopMovers />
          <NeedsAttention />
        </div>
      )}
    </div>
  );
}
