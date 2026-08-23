import { useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { CountUp } from "./CountUp";
import { cn } from "@/lib/utils";

export interface KpiDelta {
  /** Display text, e.g. "18.2%" or "2 vs last month". */
  text: string;
  direction: "up" | "down" | "flat";
  /** Color tone — note rising return rate is bad, so pass tone explicitly. */
  tone: "pos" | "neg" | "neutral";
}

export interface KpiCardProps {
  label: string;
  value: number;
  /** Formatting for the CountUp value. */
  prefix?: string;
  suffix?: string;
  decimals?: number;
  format?: (v: number) => string;
  /**
   * Render this string instead of the animated number (e.g. "—" when the
   * metric can't be computed honestly for the selected window).
   */
  valueText?: string;
  delta?: KpiDelta;
  /** Small daily series rendered as a 60×24 sparkline. */
  sparkline?: number[];
  /** Sparkline stroke color (default lime). */
  sparkColor?: string;
  /** Draw a dashed threshold tick across the sparkline at this value. */
  threshold?: number;
  /** Smaller numeral (28px) with the suffix rendered as a muted 14px unit. */
  size?: "default" | "small";
  onClick?: () => void;
  className?: string;
}

const TONE_COLOR: Record<KpiDelta["tone"], string> = {
  pos: "#4ADE80",
  neg: "#FB5D7A",
  neutral: "#93A1B0",
};

function Sparkline({
  data,
  color,
  threshold,
}: {
  data: number[];
  color: string;
  threshold?: number;
}) {
  const w = 60;
  const h = 24;
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const px = (i: number) => (i / (data.length - 1)) * (w - 2) + 1;
  const py = (v: number) => h - 2 - ((v - min) / range) * (h - 4);
  const line = data.map((v, i) => `${px(i)},${py(v)}`).join(" ");
  const area = `1,${h - 1} ${line} ${w - 1},${h - 1}`;
  const ty = threshold != null && threshold >= min && threshold <= max ? py(threshold) : null;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0 opacity-80 transition-opacity duration-150 group-hover:opacity-100">
      <polygon points={area} fill={color} opacity={0.1} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {ty != null && (
        <line x1={1} x2={w - 1} y1={ty} y2={ty} stroke="#FB5D7A" strokeWidth={1} strokeDasharray="3 2" opacity={0.7} />
      )}
    </svg>
  );
}

/**
 * KPI card: eyebrow label, CountUp value (JetBrains Mono 34), delta chip,
 * 60×24 sparkline with optional threshold marker. Hover: lift + lime sheen.
 */
export function KpiCard({
  label,
  value,
  prefix,
  suffix,
  decimals,
  format,
  valueText,
  delta,
  sparkline,
  sparkColor = "#C6F04D",
  threshold,
  size = "default",
  onClick,
  className,
}: KpiCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [sheen, setSheen] = useState<{ x: number; y: number } | null>(null);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setSheen({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const DeltaIcon = delta?.direction === "up" ? ArrowUp : delta?.direction === "down" ? ArrowDown : Minus;

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMouseMove}
      onMouseLeave={() => setSheen(null)}
      onClick={onClick}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "group relative overflow-hidden rounded-xl border border-hairline bg-panel p-5 transition-colors hover:border-bright",
        onClick && "cursor-pointer",
        className
      )}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {sheen && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(120px at ${sheen.x}px ${sheen.y}px, rgba(198,240,77,0.06), transparent)`,
          }}
        />
      )}
      <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p
          className={cn(
            "font-mono font-semibold tracking-[-1px] text-text-primary tnum",
            size === "default" ? "text-[34px] leading-none" : "text-[28px] leading-none"
          )}
        >
          {valueText != null ? (
            valueText
          ) : (
            <CountUp value={value} prefix={prefix} decimals={decimals} format={format} />
          )}
          {valueText == null && suffix && (
            <span className="ml-1 text-[14px] font-medium tracking-normal text-text-muted">
              {suffix}
            </span>
          )}
        </p>
        {sparkline && <Sparkline data={sparkline} color={sparkColor} threshold={threshold} />}
      </div>
      {delta && (
        <div className="mt-2.5 flex items-center gap-1">
          <DeltaIcon className="h-3 w-3" style={{ color: TONE_COLOR[delta.tone] }} />
          <span
            className="font-mono text-[12px] font-semibold tnum"
            style={{ color: TONE_COLOR[delta.tone] }}
          >
            {delta.text}
          </span>
        </div>
      )}
    </motion.div>
  );
}

export default KpiCard;
