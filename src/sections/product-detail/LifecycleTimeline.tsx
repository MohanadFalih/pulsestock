import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ClipboardCheck,
  Flag,
  Gauge,
  Megaphone,
  PackagePlus,
  PauseCircle,
  ShoppingBag,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { Product } from "@/data/products";
import { cn } from "@/lib/utils";
import { daysSinceIso, lifecycleNodes, type LifecycleNode, type LifecycleNodeKey } from "./derived";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const NODE_ICONS: Record<LifecycleNodeKey, LucideIcon> = {
  shared: PackagePlus,
  created: ClipboardCheck,
  "first-ad": Megaphone,
  "first-order": ShoppingBag,
  measurable: Gauge,
  "supplier-risk": Truck,
  "ads-stopped": PauseCircle,
  today: TrendingUp,
  "sell-out": Flag,
};

const LABEL_W = 96;
const LABEL_GAP = 8;
const NODE_TOP = 0;
const LABEL_ROW_1 = 36;
const LABEL_ROW_2 = 72;

/** Measure the rail container so node x-positions and labels can be laid out in px. */
function useContainerWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(entries[0].contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

interface PlacedNode {
  node: LifecycleNode;
  x: number;
  row: 0 | 1;
  labelShift: number;
}

/** Section 2 — horizontal lifecycle timeline with proportional day positions. */
export function LifecycleTimeline({ product }: { product: Product }) {
  const nodes = useMemo(() => lifecycleNodes(product), [product]);
  const todayDay = daysSinceIso(product.sharedDate);
  const span = Math.max(...nodes.map((n) => n.day), 7);

  const [selectedKey, setSelectedKey] = useState<string>("today");
  const selected = nodes.find((n) => n.key === selectedKey) ?? nodes[nodes.length - 1];

  const [railRef, width] = useContainerWidth();
  const pad = 24;

  const placed: PlacedNode[] = useMemo(() => {
    const base = nodes.map((node, i) => {
      const frac = Math.min(1, node.day / span);
      const x = pad + frac * Math.max(0, width - pad * 2);
      return { node, x, row: (i % 2) as 0 | 1, labelShift: 0 };
    });
    // Collision-avoid labels per row: shift right when overlapping the previous label.
    for (const row of [0, 1] as const) {
      let prevRight = -Infinity;
      for (const p of base.filter((b) => b.row === row).sort((a, b) => a.x - b.x)) {
        const idealLeft = p.x - LABEL_W / 2;
        if (idealLeft < prevRight + LABEL_GAP) {
          p.labelShift = prevRight + LABEL_GAP - idealLeft;
        }
        prevRight = idealLeft + p.labelShift + LABEL_W;
      }
    }
    return base;
  }, [nodes, span, width, pad]);

  const todayX = pad + Math.min(1, todayDay / span) * Math.max(0, width - pad * 2);
  const firstX = placed[0]?.x ?? pad;
  const lastX = placed[placed.length - 1]?.x ?? width - pad;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Lifecycle Timeline
        </h2>
        <p className="text-[11.5px] text-text-muted">
          Shared → today (day {todayDay}) · buy-on-demand
        </p>
      </div>

      <TooltipProvider delayDuration={120}>
        <div ref={railRef} className="relative mt-2" style={{ height: 118 }}>
          {width > 0 && (
            <>
              {/* Base track */}
              <div
                className="absolute h-0.5 rounded-full bg-hairline"
                style={{ left: firstX, width: Math.max(0, lastX - firstX), top: NODE_TOP + 13 }}
              />
              {/* Completed portion: stage-spectrum gradient, draws left→right */}
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: Math.max(0, todayX - firstX) }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                className="absolute h-0.5 rounded-full"
                style={{
                  left: firstX,
                  top: NODE_TOP + 13,
                  background: "linear-gradient(90deg, #A78BFA 0%, #45B7F5 40%, #3EE6D8 70%, #4ADE80 100%)",
                }}
              />

              {placed.map((p, i) => {
                const Icon = NODE_ICONS[p.node.key];
                const isCurrent = p.node.state === "current";
                const isFuture = p.node.state === "future";
                const isSelected = selected.key === p.node.key;
                return (
                  <div key={p.node.key}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <motion.button
                          initial={{ scale: 0, opacity: 0 }}
                          whileInView={{ scale: 1, opacity: 1 }}
                          viewport={{ once: true, amount: 0.4 }}
                          transition={{ type: "spring", stiffness: 380, damping: 22, delay: 0.15 + i * 0.12 }}
                          onClick={() => setSelectedKey(p.node.key)}
                          className={cn(
                            "absolute flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-panel transition-colors",
                            isFuture ? "border-2 border-dashed" : "border-2"
                          )}
                          style={{
                            left: p.x,
                            top: NODE_TOP,
                            borderColor: isFuture ? "#4A5560" : p.node.color,
                            boxShadow: isSelected ? `0 0 0 3px ${p.node.color}33` : undefined,
                            opacity: isFuture ? 0.75 : 1,
                          }}
                          aria-label={`${p.node.name} — day ${p.node.day}`}
                        >
                          {isCurrent && (
                            <motion.span
                              className="absolute inset-0 rounded-full border-2 border-lime"
                              animate={{ scale: [1, 1.9], opacity: [0.7, 0] }}
                              transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
                            />
                          )}
                          <Icon
                            className="h-3.5 w-3.5"
                            style={{ color: isFuture ? "#8A95A1" : p.node.color }}
                          />
                        </motion.button>
                      </TooltipTrigger>
                      <TooltipContent side="top">{p.node.oneLiner}</TooltipContent>
                    </Tooltip>

                    {/* Label: day caption + name, collision-shifted */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true, amount: 0.4 }}
                      transition={{ duration: 0.3, delay: 0.25 + i * 0.12 }}
                      className="absolute -translate-x-1/2 text-center"
                      style={{
                        left: p.x + p.labelShift,
                        top: p.row === 0 ? LABEL_ROW_1 : LABEL_ROW_2,
                        width: LABEL_W,
                      }}
                    >
                      <span className="block font-mono text-[10px] text-text-muted tnum">
                        Day {p.node.day}
                      </span>
                      <span
                        className={cn(
                          "block truncate text-[12px] font-semibold",
                          isFuture ? "text-text-muted" : isSelected ? "text-text-primary" : "text-text-secondary"
                        )}
                      >
                        {p.node.name}
                      </span>
                    </motion.div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </TooltipProvider>

      {/* Expandable detail strip */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={selected.key}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          className="overflow-hidden"
        >
          <div className="rounded-lg border border-hairline bg-inset px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                className="font-mono text-[11px] font-semibold uppercase tracking-[1px] tnum"
                style={{ color: selected.color }}
              >
                Day {selected.day} · {selected.name}
              </span>
              {selected.chips.map((chip) => (
                <span
                  key={chip}
                  className="rounded border border-hairline bg-panel px-1.5 py-px font-mono text-[10.5px] font-semibold text-text-secondary tnum"
                >
                  {chip}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">{selected.detail}</p>
          </div>
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}

export default LifecycleTimeline;
