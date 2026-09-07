/**
 * Inventory & Clearance — warehouse stock (mostly customer returns + old
 * season stock), aging ladder, discount policy, and clearance performance.
 *
 * Data: the `stockDetail` / `ordersDetail` blocks in live.json via
 * src/data/opsData.ts. When those blocks are absent (sync pending) the page
 * degrades to a fallback built on the existing product records
 * (`returnedStock` + unitPrice × 0.55 cost heuristic), clearly labeled
 * "estimate until sync". Pure math lives in src/data/inventoryEngine.ts.
 */

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CloudOff, TriangleAlert } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useOpsData } from "@/data/opsData";
import { products } from "@/data/products";
import { isLiveMode, liveSyncLabel } from "@/data/liveSync";
import {
  analyzeOrders,
  analyzeStock,
  fallbackFromProducts,
  CLEARANCE_TARGET_IQD,
  type DiscountBand,
  type FallbackInventory,
  type FallbackRow,
  type OrdersAnalysis,
  type StockAnalysis,
} from "@/data/inventoryEngine";
import KpiCard from "@/components/KpiCard";
import { CountUp } from "@/components/CountUp";
import ProgressBar from "@/components/ProgressBar";
import DataTable, { type Column } from "@/components/DataTable";
import EmptyState from "@/components/EmptyState";
import StageBadge from "@/components/StageBadge";
import ChartTooltip, {
  type ChartTooltipProps,
  type ChartTooltipRow,
} from "@/components/ChartTooltip";
import { compact, fmtMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { Stage } from "@/data/decisionEngine";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const riseChild = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

/** Bucket bar colors: fresh lime → amber → rose as stock ages. */
const BUCKET_COLORS = ["#C6F04D", "#A3D65C", "#FBBF24", "#FB923C", "#FB5D7A"];

function SyncPending({ message }: { message: string }) {
  return (
    <EmptyState
      icon={CloudOff}
      title="Sync pending"
      message={message}
      className="bg-panel"
    />
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function PageHeader({ syncedAt, full }: { syncedAt: string | null; full: boolean }) {
  const syncLine = syncedAt
    ? `Snapshot ${new Date(syncedAt).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : isLiveMode()
      ? liveSyncLabel()
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
          Warehouse · Returns & Old Season Stock
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06, ease: EASE }}
          className="mt-1 font-display text-[28px] font-semibold tracking-[-0.5px] text-text-primary"
        >
          Inventory & Clearance
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.21 }}
          className="mt-1 text-[13.5px] text-text-secondary"
        >
          Buy-on-demand from Turkey · stock is mostly customer returns · discount
          ladder 30d→20% · 45d→35% · 60d→50% · {syncLine}
          {!full && " · detailed stock sync pending"}
        </motion.p>
      </div>
    </div>
  );
}

// ─── KPI row ─────────────────────────────────────────────────────────────────

function FrozenCapitalCard({
  value,
  progressPct,
  overTarget,
  estimate,
}: {
  value: number;
  progressPct: number;
  overTarget: number;
  estimate: boolean;
}) {
  const met = overTarget <= 0;
  return (
    <motion.div
      variants={riseChild}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className="rounded-xl border border-hairline bg-panel p-5 transition-colors hover:border-bright"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
        Frozen capital{estimate ? " · estimate" : ""}
      </p>
      <p className="mt-2 font-mono text-[34px] font-semibold leading-none tracking-[-1px] text-text-primary tnum">
        <CountUp value={value} format={fmtMoney} />
      </p>
      <div className="mt-3.5">
        <ProgressBar
          value={progressPct}
          gradient={
            met
              ? undefined
              : "linear-gradient(90deg, #FBBF24 0%, #FB923C 100%)"
          }
        />
      </div>
      <p className="mt-2 text-[12px] text-text-secondary">
        {met ? (
          <span className="font-semibold text-pos">
            Target met — below {fmtMoney(CLEARANCE_TARGET_IQD)}
          </span>
        ) : (
          <>
            <span className="font-mono font-semibold text-amber tnum">
              {fmtMoney(overTarget)}
            </span>{" "}
            above the {fmtMoney(CLEARANCE_TARGET_IQD)} clearance target
          </>
        )}
      </p>
    </motion.div>
  );
}

function KpiRow({
  stock,
  orders,
  fb,
}: {
  stock: StockAnalysis | null;
  orders: OrdersAnalysis | null;
  fb: FallbackInventory | null;
}) {
  const frozenValue = stock?.totalValue ?? fb?.totalEstValue ?? 0;
  const progress = stock?.targetProgressPct ?? fb?.targetProgressPct ?? 100;
  const overTarget = stock?.overTarget ?? fb?.overTarget ?? 0;
  const units = stock?.totalUnits ?? fb?.totalUnits ?? 0;
  const clearanceSpark = orders?.clearance.days.map((d) => d.cash);

  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <FrozenCapitalCard
        value={frozenValue}
        progressPct={progress}
        overTarget={overTarget}
        estimate={!stock}
      />
      <motion.div variants={riseChild}>
        <KpiCard
          label="Units in stock"
          value={units}
          format={(v) => compact(v)}
          delta={
            stock && stock.mFamily.units > 0
              ? {
                  text: `${compact(stock.mFamily.units)} M-family legacy units`,
                  direction: "flat",
                  tone: "neg",
                }
              : undefined
          }
        />
      </motion.div>
      <motion.div variants={riseChild}>
        {stock ? (
          <KpiCard
            label="Avg age in stock"
            value={stock.avgAgeDays}
            suffix="days"
            delta={{
              text:
                stock.avgAgeDays >= 45
                  ? "Deep in the discount ladder"
                  : stock.avgAgeDays >= 30
                    ? "Past the 30d → 20% rung"
                    : "Within the fresh window",
              direction: "flat",
              tone: stock.avgAgeDays >= 45 ? "neg" : stock.avgAgeDays >= 30 ? "neutral" : "pos",
            }}
          />
        ) : (
          <KpiCard
            label="Avg age in stock"
            value={0}
            valueText="—"
            delta={{ text: "Needs stockDetail sync", direction: "flat", tone: "neutral" }}
          />
        )}
      </motion.div>
      <motion.div variants={riseChild}>
        {orders ? (
          <KpiCard
            label="Clearance cash recovered · 30d"
            value={orders.clearance.cash30d}
            format={fmtMoney}
            sparkline={clearanceSpark}
            delta={{
              text: `${compact(orders.clearance.units30d)} discounted units`,
              direction: "flat",
              tone: "neutral",
            }}
          />
        ) : (
          <KpiCard
            label="Clearance cash recovered · 30d"
            value={0}
            valueText="—"
            delta={{ text: "Needs ordersDetail sync", direction: "flat", tone: "neutral" }}
          />
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Aging ladder visual ─────────────────────────────────────────────────────

function AgingLadder({ stock }: { stock: StockAnalysis }) {
  const maxValue = Math.max(1, ...stock.buckets.map((b) => b.value));
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            Aging ladder
          </h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            Frozen capital by age in stock · policy markers at 30d / 45d / 60d
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {stock.buckets.map((b, i) => (
          <div
            key={b.key}
            className="rounded-lg border border-hairline bg-inset p-3.5"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[1px] text-text-muted">
                {b.label}
              </p>
              {b.discPct > 0 && (
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                  style={{ color: BUCKET_COLORS[i], backgroundColor: `${BUCKET_COLORS[i]}1A` }}
                >
                  −{b.discPct}%
                </span>
              )}
            </div>
            <p className="mt-2 font-mono text-[18px] font-semibold text-text-primary tnum">
              {fmtMoney(b.value)}
            </p>
            <p className="text-[11.5px] text-text-secondary tnum">
              {compact(b.units)} units
            </p>
            <div className="mt-2.5">
              <ProgressBar
                value={(b.value / maxValue) * 100}
                color={BUCKET_COLORS[i]}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11.5px] text-text-muted">
        Policy: at 30 days take 20% off · 45 days 35% · 60 days 50% (end of
        season). M-family (Modaselvim legacy) clears one rung earlier.
      </p>
    </motion.section>
  );
}

// ─── Action needed table ─────────────────────────────────────────────────────

function TierChip({ pct, mFamily }: { pct: number; mFamily?: boolean }) {
  if (pct <= 0)
    return (
      <span className="rounded-md bg-hairline/40 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px] text-text-muted">
        Hold
      </span>
    );
  const color = pct >= 50 ? "#FB5D7A" : pct >= 35 ? "#FB923C" : "#FBBF24";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px]"
      style={{ color, backgroundColor: `${color}1A` }}
    >
      {mFamily && <TriangleAlert className="h-3 w-3" />}
      −{pct}%
    </span>
  );
}

/**
 * Models that crossed a ladder threshold. Custom table markup (DataTable
 * classes) so M-family rows can carry an amber warning tint.
 */
function ActionNeeded({ stock }: { stock: StockAnalysis }) {
  const rows = stock.actionNeeded;
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      <div className="mb-3">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Action needed
        </h2>
        <p className="mt-0.5 text-[12px] text-text-muted">
          Models past a ladder threshold (avg age ≥ 30d) or M-family legacy ·
          recovery estimated at cost × (1 − discount)
        </p>
      </div>
      <div className="max-h-[420px] overflow-auto rounded-xl border border-hairline bg-panel">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-panel shadow-[0_1px_0_0_#232E3B]">
            <tr>
              {["Model", "Units", "Avg age", "Oldest", "Frozen value", "Suggested tier", "Est. recovery"].map(
                (h, i) => (
                  <th
                    key={h}
                    className={cn(
                      "px-4 py-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted",
                      i > 0 && "text-right"
                    )}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr
                key={m.model}
                className={cn(
                  "h-14 border-t border-hairline transition-colors hover:bg-panel-hover",
                  m.mFamily && "bg-amber/[0.07] hover:bg-amber/[0.12]"
                )}
              >
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-text-primary">
                      {m.model}
                    </span>
                    {m.mFamily && (
                      <span className="rounded-md bg-amber/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.8px] text-amber">
                        M-family
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2 text-right font-mono text-[13px] font-medium text-text-secondary tnum">
                  {compact(m.units)}
                </td>
                <td className="px-4 py-2 text-right font-mono text-[13px] font-medium text-text-secondary tnum">
                  {m.avgAgeDays}d
                </td>
                <td className="px-4 py-2 text-right font-mono text-[13px] font-medium text-text-secondary tnum">
                  {m.oldestAgeDays}d
                </td>
                <td className="px-4 py-2 text-right font-mono text-[13px] font-medium text-text-secondary tnum">
                  {fmtMoney(m.value)}
                </td>
                <td className="px-4 py-2 text-right">
                  <TierChip pct={m.suggestedDiscPct} mFamily={m.mFamily} />
                </td>
                <td className="px-4 py-2 text-right font-mono text-[13px] font-semibold text-lime tnum">
                  {fmtMoney(m.estRecovery)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-6">
                  <p className="text-center text-[13px] text-text-muted">
                    No models past a discount threshold — stock is still fresh.
                  </p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
}

// ─── Discount-tier performance ───────────────────────────────────────────────

type BandRow = DiscountBand & Record<string, unknown>;

function DiscountTiers({ orders }: { orders: OrdersAnalysis }) {
  const columns = useMemo<Column<BandRow>[]>(
    () => [
      {
        key: "label",
        header: "Tier",
        render: (r) => (
          <span className="font-semibold text-text-primary">{r.label}</span>
        ),
      },
      { key: "units", header: "Units", numeric: true, sortable: true, render: (r) => compact(r.units) },
      { key: "revenue", header: "Revenue", numeric: true, sortable: true, render: (r) => fmtMoney(r.revenue) },
      {
        key: "margin",
        header: "Est. margin",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.margin,
        render: (r) =>
          r.margin == null ? (
            <span className="text-text-muted">—</span>
          ) : (
            <span className={r.margin >= 0 ? "text-pos" : "text-neg"}>
              {fmtMoney(r.margin)}
            </span>
          ),
      },
      {
        key: "costCoveragePct",
        header: "Cost coverage",
        numeric: true,
        render: (r) => (
          <span className="text-text-muted">{r.costCoveragePct}%</span>
        ),
      },
    ],
    []
  );
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      <div className="mb-3">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Discount-tier performance
        </h2>
        <p className="mt-0.5 text-[12px] text-text-muted">
          All confirmed order lines by discount band · margin estimated against
          stockDetail unit costs
        </p>
      </div>
      <DataTable<BandRow>
        columns={columns}
        rows={orders.bands as BandRow[]}
        rowKey={(r) => r.key}
      />
    </motion.section>
  );
}

// ─── Stock-vs-supplier donut + clearance trend ───────────────────────────────

const MIX_COLORS = { stock: "#C6F04D", supplier: "#45B7F5" };

function MixTooltip(props: ChartTooltipProps) {
  const p = props.payload?.[0]?.payload as
    | { name: string; value: number; cash: number }
    | undefined;
  const rows: ChartTooltipRow[] = p
    ? [
        { label: "Units", value: compact(p.value), color: String(props.payload?.[0]?.color ?? "#C6F04D") },
        { label: "Cash", value: fmtMoney(p.cash), color: String(props.payload?.[0]?.color ?? "#C6F04D") },
      ]
    : [];
  return <ChartTooltip {...props} label={p?.name ?? props.label} rows={rows} />;
}

function StockVsSupplier({ orders }: { orders: OrdersAnalysis }) {
  const { mix } = orders;
  const data = [
    { name: "From warehouse stock", value: mix.stockUnits, cash: mix.stockCash, fill: MIX_COLORS.stock },
    { name: "Bought on demand (Turkey)", value: mix.supplierUnits, cash: mix.supplierCash, fill: MIX_COLORS.supplier },
  ].filter((d) => d.value > 0);
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <h2 className="font-display text-[15px] font-semibold text-text-primary">
        Stock vs supplier mix
      </h2>
      <p className="mt-0.5 text-[12px] text-text-muted">
        Units fulfilled from warehouse returns vs bought on demand from Turkey
      </p>
      <div className="relative mx-auto mt-2 h-[210px] w-full max-w-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={62}
              outerRadius={88}
              paddingAngle={3}
              stroke="#0A0E13"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Pie>
            <Tooltip content={<MixTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <p className="font-mono text-[22px] font-semibold text-text-primary tnum">
            {Math.round(mix.stockSharePct)}%
          </p>
          <p className="text-[10.5px] uppercase tracking-[1px] text-text-muted">
            from stock
          </p>
        </div>
      </div>
      <div className="mt-2 space-y-1.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-2 text-[12.5px]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: d.fill }} />
            <span className="text-text-secondary">{d.name}</span>
            <span className="ml-auto font-mono font-semibold text-text-primary tnum">
              {compact(d.value)} units
            </span>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

function ClearanceTrend({ orders }: { orders: OrdersAnalysis }) {
  const days = orders.clearance.days;
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            Clearance cash recovered
          </h2>
          <p className="mt-0.5 text-[12px] text-text-muted">
            Daily cash from discounted lines, trailing 30 days
          </p>
        </div>
        <p className="font-mono text-[16px] font-semibold text-lime tnum">
          {fmtMoney(orders.clearance.cash30d)}
        </p>
      </div>
      <div className="h-[210px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={days} margin={{ top: 12, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#232E3B" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "#5B6875", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={6}
            />
            <YAxis
              tick={{ fill: "#5B6875", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => compact(v)}
              width={48}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ fill: "rgba(198,240,77,0.06)" }}
            />
            <Bar
              dataKey="cash"
              name="Cash recovered"
              fill="#C6F04D"
              radius={[3, 3, 0, 0]}
              maxBarSize={18}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
}

// ─── Fallback mode ───────────────────────────────────────────────────────────

type FbRow = FallbackRow & Record<string, unknown>;

function FallbackBanner() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="mt-4 flex items-center gap-3 rounded-xl border border-hairline border-l-[3px] border-l-amber bg-panel px-5 py-4"
    >
      <TriangleAlert className="h-5 w-5 shrink-0 text-amber" />
      <p className="text-[13.5px] text-text-secondary">
        <span className="font-semibold text-text-primary">Estimate until sync.</span>{" "}
        live.json has no stockDetail/ordersDetail blocks yet, so frozen capital
        below uses returned-stock counts × unit price × 0.55 cost heuristic.
        Aging, the discount ladder, and clearance performance unlock with the
        next Odoo sync.
      </p>
    </motion.div>
  );
}

function FallbackTable({ rows }: { rows: FallbackRow[] }) {
  const columns = useMemo<Column<FbRow>[]>(
    () => [
      {
        key: "name",
        header: "Product",
        sortable: true,
        render: (r) => (
          <div className="flex items-center gap-2">
            <div>
              <p className="font-semibold text-text-primary">{r.name}</p>
              <p className="text-[11px] text-text-muted">{r.sku}</p>
            </div>
            {r.mFamily && (
              <span className="rounded-md bg-amber/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.8px] text-amber">
                M-family
              </span>
            )}
          </div>
        ),
      },
      {
        key: "stage",
        header: "Stage",
        render: (r) => <StageBadge stage={r.stage as Stage} />,
      },
      { key: "units", header: "Units on hand", numeric: true, sortable: true, render: (r) => compact(r.units) },
      {
        key: "unitPrice",
        header: "Unit price",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.unitPrice,
        render: (r) =>
          r.unitPrice == null ? (
            <span className="text-text-muted">—</span>
          ) : (
            fmtMoney(r.unitPrice)
          ),
      },
      {
        key: "estValue",
        header: "Est. frozen value",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.estValue,
        render: (r) =>
          r.estValue == null ? (
            <span className="text-text-muted">—</span>
          ) : (
            <span className="font-semibold text-lime">{fmtMoney(r.estValue)}</span>
          ),
      },
    ],
    []
  );
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      <div className="mb-3">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Returned stock on hand
        </h2>
        <p className="mt-0.5 text-[12px] text-text-muted">
          Per-product warehouse stock from product records · value = unit price
          × 0.55 cost heuristic (estimate until sync)
        </p>
      </div>
      <DataTable<FbRow>
        columns={columns}
        rows={rows as FbRow[]}
        rowKey={(r) => r.id}
        defaultSortKey="estValue"
        emptyState={
          <p className="text-center text-[13px] text-text-muted">
            No returned stock on hand.
          </p>
        }
      />
    </motion.section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Inventory() {
  const ops = useOpsData();

  const hasStock = !!ops && ops.stockDetail.length > 0;
  const hasOrders = !!ops && ops.ordersDetail.length > 0;

  // Age math is anchored to the snapshot time, not the wall clock.
  const asOf = useMemo(
    () => (ops ? new Date(ops.syncedAt) : new Date()),
    [ops]
  );

  const stock = useMemo(
    () => (hasStock && ops ? analyzeStock(ops.stockDetail, asOf) : null),
    [hasStock, ops, asOf]
  );
  const orders = useMemo(
    () =>
      hasOrders && ops
        ? analyzeOrders(ops.ordersDetail, hasStock ? ops.stockDetail : null, asOf)
        : null,
    [hasOrders, hasStock, ops, asOf]
  );
  const fallback = useMemo<FallbackInventory | null>(
    () => (hasStock ? null : fallbackFromProducts(products)),
    [hasStock]
  );

  return (
    <div>
      <PageHeader syncedAt={ops?.syncedAt ?? null} full={hasStock} />

      <KpiRow stock={stock} orders={orders} fb={fallback} />

      {!hasStock && <FallbackBanner />}

      <div className="mt-4">
        {stock ? (
          <AgingLadder stock={stock} />
        ) : (
          <SyncPending message="Aging buckets need per-variant create dates from the stockDetail block. The next Odoo sync adds them." />
        )}
      </div>

      <div className="mt-4">
        {stock ? (
          <ActionNeeded stock={stock} />
        ) : fallback ? (
          <FallbackTable rows={fallback.rows} />
        ) : null}
      </div>

      <div className="mt-4">
        {orders ? (
          <DiscountTiers orders={orders} />
        ) : (
          <SyncPending message="Discount-tier performance needs the ordersDetail block (per-line discount percents). Sync pending." />
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {orders ? (
          <StockVsSupplier orders={orders} />
        ) : (
          <SyncPending message="The stock-vs-supplier split needs order line routes from the ordersDetail block. Sync pending." />
        )}
        {orders ? (
          <ClearanceTrend orders={orders} />
        ) : (
          <SyncPending message="Clearance cash over time needs discounted order lines from the ordersDetail block. Sync pending." />
        )}
      </div>
    </div>
  );
}
