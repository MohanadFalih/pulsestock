import { motion } from "framer-motion";
import { X } from "lucide-react";
import { products, stageCounts } from "@/data/products";
import { STAGE_META, type Stage } from "@/data/decisionEngine";
import CountUp from "@/components/CountUp";
import { cn } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export interface StageFunnelProps {
  active: Stage | null;
  onSelect: (stage: Stage | null) => void;
}

/**
 * Stage funnel strip (products.md §1): one continuous 44px bar split into 8
 * stage segments, widths proportional to product count. Click to filter.
 */
export function StageFunnel({ active, onSelect }: StageFunnelProps) {
  const counts = stageCounts();
  return (
    <div>
      <div
        className="flex gap-0.5 overflow-hidden rounded-[10px]"
        role="group"
        aria-label="Filter by lifecycle stage"
      >
        {counts.map(({ stage, count }, i) => {
          const meta = STAGE_META[stage];
          const isActive = active === stage;
          return (
            <motion.button
              key={stage}
              type="button"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.1 + i * 0.06, duration: 0.5, ease: EASE }}
              onClick={() => onSelect(isActive ? null : stage)}
              aria-pressed={isActive}
              style={{
                flexGrow: Math.max(count, 1),
                flexBasis: 0,
                transformOrigin: "left center",
                backgroundColor: `${meta.color}${isActive ? "38" : "24"}`,
                borderColor: `${meta.color}66`,
              }}
              className={cn(
                "relative flex h-11 min-w-0 cursor-pointer items-center justify-center gap-2 overflow-hidden border px-2 whitespace-nowrap transition-[filter] duration-150 hover:brightness-125",
                isActive && "brightness-110"
              )}
            >
              <span
                className="truncate text-[10.5px] font-bold uppercase tracking-[0.8px]"
                style={{ color: meta.color }}
              >
                {meta.label}
              </span>
              <CountUp
                value={count}
                duration={0.9}
                className="font-mono text-[15px] font-semibold text-text-primary tnum"
              />
              {isActive && (
                <motion.span
                  layoutId="stage-funnel-active"
                  className="absolute inset-x-0 bottom-0 h-0.5"
                  style={{ backgroundColor: meta.color }}
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
            </motion.button>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-3 text-[11.5px] text-text-muted">
        <span>Click a stage to filter the table</span>
        {active && (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="flex items-center gap-1 rounded-full border border-hairline px-2 py-0.5 text-[11px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
          >
            <X className="h-3 w-3" />
            clear
          </button>
        )}
        <span className="ml-auto font-mono tnum">{products.length} total</span>
      </div>
    </div>
  );
}

export default StageFunnel;
