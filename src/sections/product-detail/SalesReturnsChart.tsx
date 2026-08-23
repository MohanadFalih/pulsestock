import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip, type ChartTooltipProps, type ChartTooltipRow } from "@/components/ChartTooltip";
import { hasLiveDaily, type Product } from "@/data/products";
import { useWindowDays } from "@/data/windowStore";
import { cn } from "@/lib/utils";
import { ordersDistribution, type OrdersDay } from "./derived";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Rose triangle marker rendered above an anomalous returns day. */
function AnomalyMarker(props: { cx?: number; cy?: number }) {
  const { cx = 0, cy = 0 } = props;
  return (
    <g transform={`translate(${cx - 7}, ${cy - 26})`}>
      <path
        d="M7 1.5 L13 12 H1 Z"
        fill="#FB5D7A"
        stroke="#0A0E13"
        strokeWidth={1}
        strokeLinejoin="round"
      />
      <rect x={6.25} y={5} width={1.5} height={4} fill="#0A0E13" />
      <rect x={6.25} y={10} width={1.5} height={1.5} fill="#0A0E13" />
    </g>
  );
}

function OrdersTooltip(props: ChartTooltipProps & { anomalyDay: number | null; live: boolean }) {
  const { anomalyDay, live, ...rest } = props;
  const point = rest.payload?.[0]?.payload as OrdersDay | undefined;
  const rows: ChartTooltipRow[] = [];
  if (point) {
    if (live) {
      // Live: real Odoo orders only (no channel tag, no per-product returns).
      rows.push({ label: "Orders", value: `${point.chat}`, color: "#C6F04D" });
    } else {
      rows.push({ label: "Chat orders", value: `${point.chat}`, color: "#C6F04D" });
      rows.push({ label: "Website orders", value: `${point.website}`, color: "#45B7F5" });
      rows.push({ label: "Units returned", value: `${point.returns}`, color: "#FB5D7A" });
    }
  }
  return (
    <ChartTooltip
      {...rest}
      label={point ? `Day ${point.day} · ${point.label}` : rest.label}
      rows={rows}
      footer={
        point && anomalyDay != null && point.day === anomalyDay
          ? { label: "Return spike cluster — check Odoo return reasons", value: "!", color: "#FB5D7A" }
          : undefined
      }
    />
  );
}

/** Section 4 — daily orders by channel (stacked bars) vs units returned (line). */
export function SalesReturnsChart({ product }: { product: Product }) {
  const windowDays = useWindowDays();
  // Live mode: real per-day Odoo orders; per-product daily returns and the
  // chat/website split don't exist — those series are hidden, not faked.
  const live = hasLiveDaily();
  const days = useMemo(
    () => ordersDistribution(product, windowDays),
    [product, windowDays]
  );
  const [showOrders, setShowOrders] = useState(true);
  const [showReturns, setShowReturns] = useState(true);

  // Anomaly: strongest return day, only when it clearly breaks the pattern.
  // Mock-only — live per-product daily returns are not tracked.
  const anomalyDay = useMemo(() => {
    if (live) return null;
    const max = Math.max(...days.map((d) => d.returns));
    const mean = days.reduce((a, d) => a + d.returns, 0) / Math.max(1, days.length);
    if (max < 3 || max < Math.max(3, mean * 2)) return null;
    return days.find((d) => d.returns === max)?.day ?? null;
  }, [days, live]);

  const anomalyPoint = anomalyDay != null ? days.find((d) => d.day === anomalyDay) : undefined;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.35, delay: 0.16, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            {live ? "Daily Orders" : "Orders vs Returns"}
          </h2>
          <p className="text-[11.5px] text-text-muted">
            {live
              ? `Real Odoo orders · last ${windowDays} days · returns tracked at portfolio level only`
              : "Daily orders from Odoo · chat + website split"}
          </p>
        </div>
        {/* Legend toggles */}
        <button
          onClick={() => setShowOrders((s) => !s)}
          aria-pressed={showOrders}
          className={cn(
            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-semibold transition-colors",
            showOrders ? "border-hairline bg-inset text-text-secondary" : "border-hairline bg-inset text-text-muted opacity-50"
          )}
        >
          <span className="h-2 w-2 rounded-sm bg-lime" /> Orders
        </button>
        {!live && (
          <button
            onClick={() => setShowReturns((s) => !s)}
            aria-pressed={showReturns}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-semibold transition-colors",
              showReturns ? "border-hairline bg-inset text-text-secondary" : "border-hairline bg-inset text-text-muted opacity-50"
            )}
          >
            <span className="h-2 w-2 rounded-full bg-rose" /> Units returned
          </button>
        )}
      </div>

      <div className="h-[220px] rounded-lg bg-inset p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={days} margin={{ top: 20, right: 12, bottom: 0, left: 0 }} barCategoryGap="28%">
            <CartesianGrid horizontal vertical={false} stroke="#232E3B" strokeDasharray="3 4" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#5B6875", fontSize: 10, fontFamily: "JetBrains Mono" }}
              tickMargin={6}
              minTickGap={40}
              tickFormatter={(d: number) => `D${d}`}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={32}
              tick={{ fill: "#5B6875", fontSize: 10, fontFamily: "JetBrains Mono" }}
              allowDecimals={false}
            />
            <Tooltip
              content={<OrdersTooltip anomalyDay={anomalyDay} live={live} />}
              cursor={{ fill: "#1A2430", opacity: 0.5 }}
            />

            {showOrders && (
              <>
                <Bar
                  dataKey="chat"
                  name={live ? "Orders" : "Chat orders"}
                  stackId="orders"
                  fill="#C6F04D"
                  fillOpacity={0.85}
                  radius={live ? [8, 8, 0, 0] : 0}
                  isAnimationActive
                  animationDuration={700}
                />
                {!live && (
                  <Bar
                    dataKey="website"
                    name="Website orders"
                    stackId="orders"
                    fill="#45B7F5"
                    fillOpacity={0.85}
                    radius={[8, 8, 0, 0]}
                    isAnimationActive
                    animationDuration={700}
                  />
                )}
              </>
            )}
            {!live && showReturns && (
              <Line
                type="monotone"
                dataKey="returns"
                name="Units returned"
                stroke="#FB5D7A"
                strokeWidth={2}
                dot={{ r: 3, fill: "#FB5D7A", strokeWidth: 0 }}
                activeDot={{ r: 4 }}
                isAnimationActive
                animationDuration={800}
                animationBegin={300}
              />
            )}

            {/* Anomaly callout above the return spike */}
            {anomalyPoint && showReturns && (
              <ReferenceDot
                x={anomalyPoint.day}
                y={anomalyPoint.returns}
                shape={<AnomalyMarker />}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-[11.5px] text-text-muted">
        {live ? (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-lime" /> Orders (lifetime {product.totalOrders.toLocaleString()})
          </span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-lime" /> Chat orders ({product.chatOrders.toLocaleString()})
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: "#45B7F5" }} /> Website orders ({product.websiteOrders.toLocaleString()})
            </span>
          </>
        )}
        {anomalyPoint && (
          <span className="flex items-center gap-1.5 text-rose">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-rose" />
            Return spike on day {anomalyPoint.day} ({anomalyPoint.returns} returns) — investigate the listing.
          </span>
        )}
      </div>
    </motion.section>
  );
}

export default SalesReturnsChart;
