import { returnRateHealth, HEALTH_COLOR, RETURN_RULES } from "@/data/decisionEngine";
import { cn } from "@/lib/utils";

export interface ReturnRateMeterProps {
  /** Return rate in percent; null when nothing sold yet. */
  value: number | null;
  /** Width of the bar in px (default 40). */
  barWidth?: number;
  className?: string;
}

const SCALE_MAX = 50; // bar maps 0–50%

/** Numeric % + inline bar showing the value against the 25% healthy threshold tick. */
export function ReturnRateMeter({ value, barWidth = 40, className }: ReturnRateMeterProps) {
  if (value == null) {
    return <span className={cn("font-mono text-[13px] text-text-muted", className)}>—</span>;
  }
  const health = returnRateHealth(value);
  const color = HEALTH_COLOR[health];
  const fillPct = Math.min(100, (value / SCALE_MAX) * 100);
  const tickPct = (RETURN_RULES.good / SCALE_MAX) * 100;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="font-mono text-[13px] font-semibold tnum" style={{ color }}>
        {value.toFixed(1)}%
      </span>
      <span
        className="relative h-1.5 rounded-full bg-inset"
        style={{ width: barWidth }}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${fillPct}%`, backgroundColor: color }}
        />
        <span
          className="absolute -inset-y-0.5 w-px bg-text-secondary"
          style={{ left: `${tickPct}%` }}
          title={`${RETURN_RULES.good}% healthy threshold`}
        />
      </span>
    </span>
  );
}

export default ReturnRateMeter;
