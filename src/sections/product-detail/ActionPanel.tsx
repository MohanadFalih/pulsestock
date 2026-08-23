import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ActionChecklist } from "@/components/ActionChecklist";
import { ALERT_META, SEVERITY_META } from "@/data/decisionEngine";
import type { Product } from "@/data/products";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const URGENT = new Set(["critical", "issue"]);

/** 44px progress ring, fills with a spring. */
function ProgressRing({ pct, color }: { pct: number; color: string }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-11 w-11" role="img" aria-label={`${Math.round(pct * 100)}% complete`}>
      <svg width={44} height={44} viewBox="0 0 44 44" className="-rotate-90">
        <circle cx={22} cy={22} r={r} fill="none" stroke="#232E3B" strokeWidth={3.5} />
        <motion.circle
          cx={22}
          cy={22}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold text-text-primary tnum">
        {Math.round(pct * 100)}%
      </span>
    </div>
  );
}

/** Section 7 — alert-driven action panel: one playbook block per active alert. */
export function ActionPanel({ product }: { product: Product }) {
  const alerts = product.alerts;
  const top = alerts[0];
  const gradient: [string, string] = top
    ? [ALERT_META[top.type].color, alerts[1] ? ALERT_META[alerts[1].type].color : "#3EE6D8"]
    : ["#4ADE80", "#3EE6D8"];
  const [from, to] = gradient;

  const totalActions = useMemo(() => alerts.reduce((a, al) => a + al.actions.length, 0), [alerts]);
  const [doneMap, setDoneMap] = useState<Record<string, boolean>>({});
  const doneCount = Object.values(doneMap).filter(Boolean).length;
  const pct = totalActions === 0 ? 0 : doneCount / totalActions;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.26, ease: EASE }}
      className="rounded-xl p-[2px]"
      style={{
        background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`,
        boxShadow: top && URGENT.has(top.severity)
          ? `0 0 0 1px ${from}40, 0 0 24px ${from}14`
          : undefined,
      }}
      aria-label="Recommended actions"
    >
      <div
        className="relative overflow-hidden rounded-[10px] bg-panel p-5"
        style={{ backgroundImage: `linear-gradient(${from}0A, ${from}0A)` }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-text-primary">
              <Sparkles className="h-4 w-4 text-lime" />
              Recommended Actions
            </h2>
            <p className="mt-0.5 text-[11.5px] text-text-muted">
              {alerts.length > 0
                ? `${alerts.length} active alert${alerts.length === 1 ? "" : "s"} · from the tracking engine`
                : "No active alerts — product is healthy"}
            </p>
          </div>
          <ProgressRing pct={pct} color={from} />
        </div>

        {alerts.length === 0 ? (
          <div className="mt-4 rounded-lg border border-hairline bg-inset px-4 py-3">
            <p className="text-[14px] font-semibold leading-snug text-text-primary">
              Nothing to act on right now.
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
              Return rate, supplier cover and returned-stock sell-through are all inside their
              healthy bands. The engine re-checks on every Odoo + butiksistem sync.
            </p>
          </div>
        ) : (
          alerts.map((alert, idx) => {
            const meta = ALERT_META[alert.type];
            const sev = SEVERITY_META[alert.severity];
            const items = alert.actions.map((label, i) => ({
              id: `${alert.id}-a${i}`,
              label,
            }));
            return (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.3 + idx * 0.12 }}
                className="mt-4 rounded-lg border px-4 py-3"
                style={{ borderColor: meta.border, backgroundColor: meta.bg }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.8px]"
                    style={{ color: sev.color, backgroundColor: `${sev.color}1A` }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sev.color }} />
                    {sev.label}
                  </span>
                  <span className="text-[13px] font-semibold" style={{ color: meta.color }}>
                    {alert.title}
                  </span>
                </div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">
                  {alert.message}
                </p>
                <motion.div
                  initial="hidden"
                  animate="show"
                  variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.4 } } }}
                  className="mt-1 -ml-2"
                >
                  {items.map((item) => (
                    <motion.div
                      key={item.id}
                      variants={{
                        hidden: { opacity: 0, x: -10 },
                        show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE } },
                      }}
                    >
                      <ActionChecklist
                        items={[item]}
                        onToggle={(id, done) => setDoneMap((m) => ({ ...m, [id]: done }))}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              </motion.div>
            );
          })
        )}

        {/* Footer buttons */}
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => toast.success("Actions logged (MVP stub)")}
            className="flex-1 rounded-lg bg-lime px-3 py-2 text-[13px] font-semibold text-abyss transition-transform active:scale-[0.98] hover:brightness-110"
          >
            Apply &amp; log actions
          </button>
          <button
            onClick={() => toast.info("Dismissed — alerts resurface on the next sync")}
            className="rounded-lg border border-hairline px-3 py-2 text-[13px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
          >
            Dismiss
          </button>
        </div>
      </div>
    </motion.section>
  );
}

export default ActionPanel;
