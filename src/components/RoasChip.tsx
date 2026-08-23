import { roasHealth, HEALTH_COLOR } from "@/data/decisionEngine";
import { cn } from "@/lib/utils";

export interface RoasChipProps {
  /** ROAS value; null when no ad spend yet. */
  value: number | null;
  className?: string;
}

/** Mono ROAS value colored by threshold; below breakeven gets a subtle pulse. */
export function RoasChip({ value, className }: RoasChipProps) {
  if (value == null) {
    return <span className={cn("font-mono text-[13px] text-text-muted", className)}>—</span>;
  }
  const health = roasHealth(value);
  const color = HEALTH_COLOR[health];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[13px] font-semibold tnum",
        health === "bad" && "animate-pulse",
        className
      )}
      style={{ color, backgroundColor: `${color}14` }}
    >
      {value.toFixed(2)}
    </span>
  );
}

export default RoasChip;
