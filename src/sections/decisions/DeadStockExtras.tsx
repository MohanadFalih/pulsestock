import { motion } from "framer-motion";
import { FlaskConical } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { EASE } from "./ActionCard";

const TRACKER_DAYS = 14;

export interface RevivalTrackerProps {
  /** Number of completed checklist actions — each one advances the experiment a day. */
  daysFilled: number;
}

/**
 * 14-day returned-stock sell-off experiment tracker: dots fill lime as
 * checklist actions are completed; empty until the first action is checked.
 */
export function RevivalTracker({ daysFilled }: RevivalTrackerProps) {
  const filled = Math.min(TRACKER_DAYS, Math.max(0, daysFilled));
  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-inset px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
          <FlaskConical className="h-3.5 w-3.5" />
          14-day sell-off experiment
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5" aria-label={`${filled} of ${TRACKER_DAYS} experiment days active`}>
              {Array.from({ length: TRACKER_DAYS }, (_, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.25, delay: 0.3 + i * 0.02, ease: EASE }}
                  className={cn(
                    "h-2 w-2 rounded-full transition-colors duration-300",
                    i < filled ? "bg-lime" : "bg-hairline"
                  )}
                />
              ))}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            {filled === 0
              ? "Experiment starts when you check the first action"
              : `Day ${filled} of ${TRACKER_DAYS} — keep going`}
          </TooltipContent>
        </Tooltip>
        <span className="ml-auto font-mono text-[11px] text-text-muted tnum">
          {filled}/{TRACKER_DAYS} days
        </span>
      </div>
    </TooltipProvider>
  );
}
