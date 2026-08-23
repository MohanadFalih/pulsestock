import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE } from "./ActionCard";
import { RESOLVED_HISTORY } from "./queueData";

/** Collapsible "Recently resolved" footer section (decisions.md §6). */
export function ResolvedAccordion() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-10 border-t border-hairline pt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-panel-hover"
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            "h-4 w-4 text-text-muted transition-transform duration-200",
            open && "rotate-180"
          )}
        />
        <span className="text-[13px] font-semibold text-text-secondary">
          Recently resolved
        </span>
        <span className="rounded-full bg-panel px-1.5 py-px font-mono text-[10px] font-semibold text-text-muted tnum">
          {RESOLVED_HISTORY.length}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="overflow-hidden"
          >
            <motion.ul
              initial="hidden"
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
              className="flex flex-col gap-1 px-2 pb-3 pt-1"
            >
              {RESOLVED_HISTORY.map((r) => (
                <motion.li
                  key={r.productName}
                  variants={{
                    hidden: { opacity: 0, y: 8 },
                    show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE } },
                  }}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] text-text-muted"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-pos" />
                  <span className="text-text-secondary">{r.productName}</span>
                  <span>— {r.note}</span>
                  <span className="ml-auto font-mono text-[11px] tnum">{r.when}</span>
                </motion.li>
              ))}
            </motion.ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ResolvedAccordion;
