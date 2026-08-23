import { useMemo } from "react";
import { motion } from "framer-motion";
import type { Product } from "@/data/products";
import { syncLog } from "./derived";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Section 8 — event & sync log strip (full width, bottom). */
export function AuditTrail({ product }: { product: Product }) {
  const events = useMemo(() => syncLog(product), [product]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Event &amp; Sync Log
        </h2>
        <p className="text-[11.5px] text-text-muted">Odoo · Meta · butiksistem</p>
      </div>

      <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
        {events.map((e, i) => (
          <motion.div
            key={e.key}
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: i * 0.05, ease: EASE }}
            className="flex min-w-[190px] flex-col gap-1.5 rounded-lg border border-hairline bg-inset px-3.5 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-text-primary">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: e.color }} />
                {e.label}
              </span>
              <span className="font-mono text-[10.5px] text-text-muted tnum">{e.dateLabel}</span>
            </div>
            <p className="text-[11px] text-text-muted">{e.detail}</p>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}

export default AuditTrail;
