import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ReturnRateMeter } from "@/components/ReturnRateMeter";
import { RoasChip } from "@/components/RoasChip";
import { ScaleCheckIcon, ScaleLight } from "@/components/ScaleLight";
import { scaleReadiness } from "@/data/decisionEngine";
import { isLiveMode } from "@/data/liveSync";
import type { Product } from "@/data/products";
import { cn } from "@/lib/utils";
import { adEstimates, money, money2 } from "./derived";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const rowVariant = {
  hidden: { opacity: 0, x: 8 },
  show: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE } },
};

function Row({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <motion.div
      variants={rowVariant}
      className={cn(
        "flex items-center justify-between gap-3 py-2.5",
        !last && "border-b border-hairline"
      )}
    >
      <span className="text-[12px] text-text-secondary">{label}</span>
      <span className="flex items-center gap-2 text-right font-mono text-[13px] font-semibold text-text-primary tnum">
        {children}
      </span>
    </motion.div>
  );
}

/** Return-rate cell: % + meter, always with sample size; "collecting data" below n=10. */
function ReturnRateCell({ product }: { product: Product }) {
  const n = product.delivered;
  if (product.returnConfidence === "insufficient") {
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className="rounded-md border border-hairline bg-inset px-1.5 py-0.5 font-sans text-[10.5px] font-semibold text-text-muted">
          collecting data
        </span>
        <span className="font-mono text-[10.5px] font-normal text-text-muted tnum">
          n={n} delivered
        </span>
      </span>
    );
  }
  return (
    <span className="flex flex-col items-end gap-0.5">
      <ReturnRateMeter value={product.returnRate} barWidth={36} />
      <span className="font-mono text-[10.5px] font-normal text-text-muted tnum">
        n={n} delivered · {product.returnConfidence}
      </span>
    </span>
  );
}

/** "Scale readiness" block — the 4 safe-to-scale checks with ✓/✗/– markers. */
function ScaleReadinessBlock({ product }: { product: Product }) {
  const verdict = scaleReadiness(product);
  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
          Scale readiness
        </span>
        <ScaleLight product={product} size="sm" />
      </div>
      {verdict.checks.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {verdict.checks.map((c) => (
            <li key={c.label} className="flex items-start gap-2">
              <ScaleCheckIcon ok={c.ok} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-text-primary">{c.label}</span>
                <span className="block text-[11px] leading-snug text-text-muted">{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[11.5px] text-text-muted">{verdict.reasons[0]}</p>
      )}
    </div>
  );
}

/** Section 5 — right-rail vitals card (lifetime + trailing-7-day stats). */
export function VitalsCard({ product }: { product: Product }) {
  const ad = adEstimates(product);

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <h2 className="font-display text-[15px] font-semibold text-text-primary">
        Vitals <span className="text-[11.5px] font-normal text-text-muted">· lifetime, from Odoo</span>
      </h2>
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
        className="mt-2"
      >
        <Row label={isLiveMode() ? "Lifetime orders" : "Orders"}>
          {product.totalOrders.toLocaleString()}
          <span className="font-mono text-[10.5px] font-normal text-text-muted tnum">
            {isLiveMode()
              ? // Odoo doesn't tag channel; units = product_uom_qty sum.
                `${product.units.toLocaleString()} units sold`
              : `${product.chatOrders} chat · ${product.websiteOrders} web`}
          </span>
        </Row>
        <Row label="Delivered">{product.delivered.toLocaleString()}</Row>
        <Row label="Returned">
          {product.returned > 0 ? product.returned.toLocaleString() : <span className="text-text-muted">0</span>}
        </Row>
        <Row label="Return rate">
          <ReturnRateCell product={product} />
        </Row>
        <Row label="Revenue">{money(product.revenue)}</Row>
        <Row label="Ad spend">{money(product.adSpend)}</Row>
        <Row label="ROAS">
          <RoasChip value={product.roas} />
        </Row>
        <Row label="Bought from supplier">
          {product.unitsBoughtFromSupplier.toLocaleString()}
          <span className="font-mono text-[10.5px] font-normal text-text-muted tnum">units · on demand</span>
        </Row>
        <Row label="Returned stock on hand">
          {product.returnedStock}
          <span className="font-mono text-[10.5px] font-normal text-text-muted tnum">units</span>
        </Row>
        <Row label="Order velocity (7d)">
          {product.orderVelocity7d > 0 ? `${product.orderVelocity7d}/day` : <span className="text-text-muted">—</span>}
        </Row>
        <Row label="Days since last order">
          {product.daysSinceLastOrder != null ? (
            <span style={{ color: product.daysSinceLastOrder >= 7 ? "#FBBF24" : undefined }}>
              {product.daysSinceLastOrder === 0 ? "today" : product.daysSinceLastOrder}
            </span>
          ) : (
            <span className="text-text-muted">never ordered</span>
          )}
        </Row>
        <Row label="CAC" last>
          {ad.cac != null ? money2(ad.cac) : <span className="text-text-muted">—</span>}
        </Row>
      </motion.div>
      <ScaleReadinessBlock product={product} />
    </motion.section>
  );
}

export default VitalsCard;
