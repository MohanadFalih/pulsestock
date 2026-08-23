import type { ComponentType, CSSProperties } from "react";
import {
  Archive,
  CheckCircle2,
  PauseCircle,
  Sparkles,
  TrendingUp,
  XOctagon,
} from "lucide-react";
import { DECISION_META, type Decision } from "@/data/decisionEngine";
import { cn } from "@/lib/utils";

const DECISION_ICONS: Record<Decision, ComponentType<{ className?: string; style?: CSSProperties }>> = {
  SCALE: TrendingUp,
  KEEP: CheckCircle2,
  KILL: XOctagon,
  STOP_ADS: PauseCircle,
  DEAD_STOCK: Archive,
  ONBOARDING: Sparkles,
};

export interface DecisionBadgeProps {
  decision: Decision;
  /** Hide the leading 12px icon. */
  hideIcon?: boolean;
  className?: string;
  onClick?: () => void;
}

/** Decision chip per the semantic table in design.md §2. */
export function DecisionBadge({ decision, hideIcon, className, onClick }: DecisionBadgeProps) {
  const meta = DECISION_META[decision];
  const Icon = DECISION_ICONS[decision];
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px]",
        onClick && "transition-colors hover:brightness-125",
        className
      )}
      style={{
        color: meta.color,
        borderColor: meta.border,
        backgroundColor: meta.bg,
      }}
    >
      {!hideIcon && <Icon className="h-3 w-3" />}
      {meta.label}
    </Tag>
  );
}

export default DecisionBadge;
