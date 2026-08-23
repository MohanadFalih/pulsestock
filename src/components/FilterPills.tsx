import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface FilterPillOption {
  value: string;
  label: string;
  /** Optional count shown as a small chip. */
  count?: number;
}

export interface FilterPillsProps {
  options: FilterPillOption[];
  value: string;
  onChange: (value: string) => void;
  /** Stable id for the animated underline (use a unique one per instance). */
  layoutId?: string;
  className?: string;
}

/** Horizontally scrollable pill row with an animated active underline. */
export function FilterPills({ options, value, onChange, layoutId = "filter-pill", className }: FilterPillsProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative shrink-0 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors",
              active ? "text-text-primary" : "text-text-muted hover:text-text-secondary"
            )}
          >
            {opt.label}
            {opt.count != null && (
              <span
                className={cn(
                  "ml-1.5 rounded-full px-1.5 py-px font-mono text-[10px] tnum",
                  active ? "bg-lime-dim text-lime" : "bg-panel text-text-muted"
                )}
              >
                {opt.count}
              </span>
            )}
            {active && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-x-2 -bottom-0.5 h-0.5 rounded-full bg-lime"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default FilterPills;
