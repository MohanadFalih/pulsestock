import { useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChecklistItem {
  id: string;
  label: string;
  /** Optional caption under the label. */
  hint?: string;
  done?: boolean;
}

export interface ActionChecklistProps {
  items: ChecklistItem[];
  /** Called with (itemId, done) whenever a row is toggled. */
  onToggle?: (id: string, done: boolean) => void;
  className?: string;
}

/** Checkbox rows with strike-through animation on check (detail + decisions). */
export function ActionChecklist({ items, onToggle, className }: ActionChecklistProps) {
  const [doneMap, setDoneMap] = useState<Record<string, boolean>>(
    () => Object.fromEntries(items.map((i) => [i.id, i.done ?? false]))
  );

  const toggle = (id: string) => {
    const next = !doneMap[id];
    setDoneMap((m) => ({ ...m, [id]: next }));
    onToggle?.(id, next);
  };

  return (
    <ul className={cn("flex flex-col gap-1", className)}>
      {items.map((item) => {
        const done = !!doneMap[item.id];
        return (
          <li key={item.id}>
            <button
              onClick={() => toggle(item.id)}
              className="group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-panel-hover"
              aria-pressed={done}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                  done
                    ? "border-lime bg-lime text-abyss"
                    : "border-bright bg-inset group-hover:border-text-muted"
                )}
              >
                {done && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="relative min-w-0">
                <span
                  className={cn(
                    "block text-[13px] font-medium transition-colors",
                    done ? "text-text-muted" : "text-text-primary"
                  )}
                >
                  {item.label}
                </span>
                <motion.span
                  className="absolute left-0 top-1/2 h-px w-full origin-left bg-text-muted"
                  initial={false}
                  animate={{ scaleX: done ? 1 : 0 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                />
                {item.hint && (
                  <span className="block text-[11.5px] text-text-muted">{item.hint}</span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export default ActionChecklist;
