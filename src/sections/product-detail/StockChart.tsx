import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip, type ChartTooltipProps, type ChartTooltipRow } from "@/components/ChartTooltip";
import type { Product } from "@/data/products";
import { cn } from "@/lib/utils";
import { returnedStockCurve, type ReturnedStockPoint } from "./derived";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function StockTooltip(props: ChartTooltipProps) {
  const point = props.payload?.[0]?.payload as ReturnedStockPoint | undefined;
  const rows: ChartTooltipRow[] = [];
  if (point) {
    rows.push({ label: "Returned stock", value: `${point.stock} units`, color: "#3EE6D8" });
    if (point.proj != null) {
      rows.push({ label: "Projected", value: `${point.proj} units`, color: "#FB5D7A" });
    }
  }
  return (
    <ChartTooltip
      {...props}
      label={point ? `Day ${point.day} · ${point.label}` : props.label}
      rows={rows}
      footer={
        point
          ? { label: "Orders / returns that day", value: `${point.orders} / ${point.returns}`, color: "#93A1B0" }
          : undefined
      }
    />
  );
}

/** Section 3 — returned stock (the warehouse stock) over time, with sell-out projection. */
export function StockChart({ product }: { product: Product }) {
  const curve = useMemo(() => returnedStockCurve(product), [product]);
  const hasProjection = curve.sellOutInDays != null;
  const [showProjection, setShowProjection] = useState(true);
  const projectionOn = showProjection && hasProjection;

  const stale = product.daysSinceLastOrder != null && product.daysSinceLastOrder >= 7 && product.returnedStock > 0;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.35, delay: 0.08, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="font-display text-[15px] font-semibold text-text-primary">Returned Stock</h2>
          <p className="text-[11.5px] text-text-muted">
            Units on hand — warehouse stock is almost entirely returns · buy-on-demand
          </p>
        </div>

        {/* Actual | + Projection toggle */}
        <div className="flex rounded-lg border border-hairline bg-inset p-0.5" role="tablist" aria-label="Projection toggle">
          {(["Actual", "+ Projection"] as const).map((label, i) => {
            const active = i === 0 ? !projectionOn : projectionOn;
            const disabled = i === 1 && !hasProjection;
            return (
              <button
                key={label}
                role="tab"
                aria-selected={active}
                disabled={disabled}
                onClick={() => setShowProjection(i === 1)}
                title={disabled ? "No sell-out to project (0 units or no order velocity)" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                  active ? "bg-panel text-text-primary" : "text-text-muted hover:text-text-secondary",
                  disabled && "cursor-not-allowed opacity-40"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Stock status chip */}
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] font-semibold tnum",
            stale ? "border-amber/40 bg-amber/10 text-amber" : "border-hairline bg-inset text-text-secondary"
          )}
        >
          {product.returnedStock} units
          {curve.sellOutInDays != null && <> · sell-out in ~{curve.sellOutInDays}d</>}
          {stale && <> · stale</>}
        </span>
      </div>

      <div className="h-[220px] rounded-lg bg-inset p-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={curve.points} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="returnedStockFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3EE6D8" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#3EE6D8" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid horizontal vertical={false} stroke="#232E3B" strokeDasharray="3 4" />
            <XAxis
              dataKey="day"
              type="number"
              domain={["dataMin", "dataMax"]}
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
              width={40}
              tick={{ fill: "#5B6875", fontSize: 10, fontFamily: "JetBrains Mono" }}
              allowDecimals={false}
            />
            <Tooltip content={<StockTooltip />} cursor={{ stroke: "#33414F", strokeDasharray: "3 3" }} />

            {/* Projection zone: today → sell-out */}
            {projectionOn && (
              <ReferenceArea
                x1={curve.todayDay}
                x2={curve.points[curve.points.length - 1].day}
                fill="#FB5D7A"
                fillOpacity={0.07}
                stroke="#FB5D7A"
                strokeOpacity={0.25}
                strokeDasharray="4 3"
                label={{
                  value: "projected sell-out",
                  position: "insideTopRight",
                  fill: "#FB5D7A",
                  fontSize: 10,
                }}
              />
            )}

            <Area
              type="monotone"
              dataKey="stock"
              name="Returned stock"
              stroke="#3EE6D8"
              strokeWidth={2}
              fill="url(#returnedStockFill)"
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-out"
              dot={false}
              activeDot={{ r: 3 }}
            />
            {projectionOn && (
              <Area
                type="linear"
                dataKey="proj"
                name="Projected"
                stroke="#FB5D7A"
                strokeWidth={1.75}
                strokeDasharray="5 4"
                fill="none"
                isAnimationActive
                animationDuration={600}
                animationBegin={400}
                dot={false}
                activeDot={false}
                legendType="none"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 flex items-center gap-4 text-[11.5px] text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-cyan" /> Returned units on hand
        </span>
        {projectionOn && (
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4" style={{ backgroundImage: "repeating-linear-gradient(90deg,#FB5D7A 0 4px,transparent 4px 7px)" }} />
            Projected sell-off to zero
          </span>
        )}
      </div>
    </motion.section>
  );
}

export default StockChart;
