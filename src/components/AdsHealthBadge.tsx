import { ADS_HEALTH_META, type AdsHealth } from "@/data/adsProvider";
import { cn } from "@/lib/utils";

export interface AdsHealthBadgeProps {
  health: AdsHealth;
  /** Hide the colored dot (dense table cells). */
  dotless?: boolean;
  className?: string;
}

/**
 * Meta ads health chip — same visual language as StageBadge: 6px-radius chip,
 * colored dot + label (10.5px/700 uppercase, tinted bg).
 */
export function AdsHealthBadge({ health, dotless, className }: AdsHealthBadgeProps) {
  const meta = ADS_HEALTH_META[health];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px]",
        health === "kill" && "animate-pulse",
        className
      )}
      style={{ color: meta.color, backgroundColor: `${meta.color}14` }}
    >
      {!dotless && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: meta.color }}
        />
      )}
      {meta.label}
    </span>
  );
}

export default AdsHealthBadge;
