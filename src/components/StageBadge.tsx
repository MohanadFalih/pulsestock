import { STAGE_META, type Stage } from "@/data/decisionEngine";
import { cn } from "@/lib/utils";

export interface StageBadgeProps {
  stage: Stage;
  className?: string;
}

/** 6px-radius chip: colored dot + stage name (10.5px/700 uppercase, tinted bg). */
export function StageBadge({ stage, className }: StageBadgeProps) {
  const meta = STAGE_META[stage];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px]",
        className
      )}
      style={{ color: meta.color, backgroundColor: `${meta.color}14` }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: meta.color }}
      />
      {meta.label}
    </span>
  );
}

export default StageBadge;
