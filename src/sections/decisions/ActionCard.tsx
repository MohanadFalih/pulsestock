import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import type { Product } from "@/data/products";
import ActionChecklist, { type ChecklistItem } from "@/components/ActionChecklist";
import StageBadge from "@/components/StageBadge";
import { cn } from "@/lib/utils";
import { fmtUsd, type MiniStat } from "./queueData";

export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export type CardTone = "amber" | "rose" | "gray" | "orange" | "blue";

const TONE_COLOR: Record<CardTone, string> = {
  amber: "#FBBF24",
  rose: "#FB5D7A",
  gray: "#8A95A1",
  orange: "#FB923C",
  blue: "#45B7F5",
};

export interface ActionCardProps {
  product: Product;
  tone: CardTone;
  reasons: string[];
  stats: MiniStat[];
  checklist: ChecklistItem[];
  /** Alert badge chip(s) rendered next to the stage badge. */
  badge?: ReactNode;
  /** Stamp caption after "Mark handled" (e.g. "Handled · just now", "Revival started"). */
  stampLabel: string;
  /** Optional cash recovery estimate chip. */
  cashRecovery?: number;
  /** Returned-stock cards: dashed border instead of glow. */
  dashed?: boolean;
  /** Rendered full-width under the grid (dead-stock composition bar + tracker). */
  extras?: (doneCount: number) => ReactNode;
  onHandled: (productId: string) => void;
}

/**
 * Wide action card (decisions.md §2–§4): 12-col grid — product block | why |
 * key numbers | recommended next steps — with a colored left bar, urgency glow,
 * and a handled-stamp → collapse flow.
 */
export function ActionCard({
  product,
  tone,
  reasons,
  stats,
  checklist,
  badge,
  stampLabel,
  cashRecovery,
  dashed,
  extras,
  onHandled,
}: ActionCardProps) {
  const color = TONE_COLOR[tone];
  const [phase, setPhase] = useState<"open" | "stamped" | "collapsed">("open");
  const [doneCount, setDoneCount] = useState(0);

  const markHandled = () => {
    if (phase !== "open") return;
    setPhase("stamped");
    window.setTimeout(() => {
      setPhase("collapsed");
      onHandled(product.id);
    }, 800);
  };

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
      }}
      layout="position"
    >
      <motion.div
        initial={false}
        animate={{ height: phase === "collapsed" ? 64 : "auto" }}
        transition={{ duration: 0.45, ease: EASE }}
        className={cn(
          "relative overflow-hidden rounded-xl border border-hairline bg-panel",
          dashed && "border-dashed"
        )}
        style={
          !dashed && phase === "open"
            ? { boxShadow: `0 0 0 1px ${color}40, 0 0 24px ${color}14` }
            : undefined
        }
      >
        {/* Colored left bar */}
        <span
          className="absolute inset-y-0 left-0 w-0.5"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        {/* 3% tone tint */}
        {!dashed && (
          <span
            className="pointer-events-none absolute inset-0"
            style={{ backgroundColor: `${color}08` }}
            aria-hidden
          />
        )}

        {phase === "collapsed" ? (
          /* 64px summary row after collapse */
          <div className="relative flex h-16 items-center gap-3 px-5">
            <img
              src={product.thumbnail}
              alt=""
              className="h-8 w-8 rounded-md border border-hairline object-cover"
            />
            <span className="truncate text-[13.5px] font-semibold text-text-primary">
              {product.name}
            </span>
            <span className="hidden font-mono text-[11px] text-text-muted sm:inline">
              {product.sku}
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold text-pos">
              <CheckCircle2 className="h-4 w-4" />
              {stampLabel}
            </span>
          </div>
        ) : (
          <div className="relative p-5">
            <motion.div
              animate={{ opacity: phase === "stamped" ? 0.4 : 1 }}
              transition={{ duration: 0.25 }}
            >
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                {/* Col 1–3: product block */}
                <div className="xl:col-span-3">
                  <div className="flex items-start gap-3">
                    <img
                      src={product.thumbnail}
                      alt={product.name}
                      className="h-12 w-12 shrink-0 rounded-lg border border-hairline object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-display text-[15px] font-semibold text-text-primary">
                        {product.name}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-text-muted">
                        <span className="font-mono tnum">{product.sku}</span> · {product.category}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <StageBadge stage={product.stage} />
                        {badge}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Col 4–6: why */}
                <div className="xl:col-span-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
                    Why
                  </p>
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {reasons.map((r) => (
                      <li key={r} className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" style={{ color }} />
                        <span className="text-[12.5px] leading-snug text-text-secondary">{r}</span>
                      </li>
                    ))}
                  </ul>
                  {cashRecovery != null && (
                    <span
                      className="mt-3 inline-flex items-center rounded-md border px-2 py-1 text-[11.5px] font-semibold"
                      style={{ color, borderColor: `${color}66`, backgroundColor: `${color}0D` }}
                    >
                      Recover ~{fmtUsd(cashRecovery)} by liquidating at cost
                    </span>
                  )}
                </div>

                {/* Col 7–9: key numbers */}
                <div className="xl:col-span-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
                    Key numbers
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {stats.map((s) => (
                      <div key={s.label} className="rounded-lg border border-hairline bg-inset px-3 py-2">
                        <p
                          className="font-mono text-[16px] font-semibold tnum"
                          style={{ color: s.color ?? "#E9EFF5" }}
                        >
                          {s.value}
                        </p>
                        <p className="mt-0.5 text-[10.5px] uppercase tracking-wide text-text-muted">
                          {s.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Col 10–12: next steps */}
                <div className="xl:col-span-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
                    Recommended next steps
                  </p>
                  <motion.div
                    variants={{
                      hidden: {},
                      show: { transition: { staggerChildren: 0.05 } },
                    }}
                    initial="hidden"
                    animate="show"
                    className="mt-1 -ml-2"
                  >
                    <ActionChecklist
                      items={checklist}
                      onToggle={(_id, done) => setDoneCount((c) => c + (done ? 1 : -1))}
                    />
                  </motion.div>
                  <div className="mt-3 flex items-center gap-2">
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={markHandled}
                      className="inline-flex h-8 items-center rounded-lg px-3 text-[13px] font-semibold transition-colors"
                      style={{
                        color,
                        backgroundColor: `${color}1A`,
                        border: `1px solid ${color}40`,
                      }}
                    >
                      Mark handled
                    </motion.button>
                    <Link
                      to={`/products/${product.id}`}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-hairline px-3 text-[13px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
                    >
                      Open product
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </div>

              {/* Full-width extras (returned-stock revival tracker) */}
              {extras && <div className="mt-5">{extras(doneCount)}</div>}
            </motion.div>

            {/* Handled stamp */}
            <AnimatePresence>
              {phase === "stamped" && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.6, rotate: -14 }}
                  animate={{ opacity: 1, scale: 1, rotate: -6 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18 }}
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <div className="flex items-center gap-2 rounded-xl border border-pos/50 bg-abyss/80 px-4 py-2.5 shadow-glow-lime backdrop-blur-sm">
                    <CheckCircle2 className="h-5 w-5 text-pos" />
                    <span className="text-[13.5px] font-semibold text-pos">{stampLabel}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

export default ActionCard;
