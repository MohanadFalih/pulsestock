import { motion } from "framer-motion";
import { ExternalLink, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ScaleLight } from "@/components/ScaleLight";
import { StageBadge } from "@/components/StageBadge";
import { SupplierPill } from "@/components/SupplierPill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ALERT_META, SEVERITY_META } from "@/data/decisionEngine";
import type { Product } from "@/data/products";
import { cn } from "@/lib/utils";
import { daysSinceIso, fmtIso, money } from "./derived";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Most-urgent-alert chip (replaces the old verdict badge). */
function TopAlertChip({ product }: { product: Product }) {
  const top = product.alerts[0];
  if (!top) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-pos/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px] text-pos">
        <span className="h-1.5 w-1.5 rounded-full bg-pos" />
        Healthy
      </span>
    );
  }
  const meta = ALERT_META[top.type];
  const sev = SEVERITY_META[top.severity];
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex cursor-default items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px]"
            style={{ color: meta.color, backgroundColor: meta.bg, border: `1px solid ${meta.border}` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sev.color }} />
            {meta.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{top.message}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Section 1 — full-width product header card. */
export function ProductHeader({ product }: { product: Product }) {
  const daysLive = daysSinceIso(product.sharedDate);

  return (
    <motion.header
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="flex flex-wrap items-center gap-5 rounded-xl border border-hairline bg-panel p-6"
    >
      {/* Thumbnail */}
      <motion.img
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
        src={product.thumbnail}
        alt={product.name}
        className="h-[88px] w-[88px] shrink-0 rounded-xl border border-hairline object-cover"
        style={{ boxShadow: "0 0 32px #3EE6D822" }}
      />

      {/* Identity */}
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, delay: 0.08, ease: EASE }}
        className="min-w-0 flex-1 basis-64"
      >
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted tnum">
          {product.sku} · {product.category}
        </p>
        <h1 className="mt-1 font-display text-[26px] font-semibold tracking-[-0.5px] text-text-primary">
          {product.name}
        </h1>
        <p className="mt-1 text-[12.5px] text-text-secondary">
          {product.category} · Supplier: {product.supplier}
          {product.unitPrice != null && <> · Unit price {money(product.unitPrice)}</>} · Shared{" "}
          {fmtIso(product.sharedDate)} (day {daysLive})
        </p>
      </motion.div>

      {/* Badge cluster */}
      <div className="flex flex-wrap items-center gap-2">
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.25, delay: 0.2 + i * 0.06, ease: EASE }}
            className="inline-flex"
          >
            {i === 0 && <StageBadge stage={product.stage} />}
            {i === 1 && <TopAlertChip product={product} />}
            {i === 2 && <ScaleLight product={product} />}
            {i === 3 && (
              <span className="inline-flex items-center rounded-md border border-hairline bg-inset px-2 py-0.5">
                <SupplierPill
                  supplier={product.supplierStock}
                  orderVelocity7d={product.orderVelocity7d}
                  className={cn("text-[11px]")}
                />
              </span>
            )}
          </motion.span>
        ))}
      </div>

      {/* Ghost icon buttons */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.42 }}
        className="flex items-center gap-1"
      >
        <button
          onClick={() => toast.info("Open in Odoo — MVP stub")}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-inset text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
          aria-label="Open in Odoo"
          title="Open in Odoo"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-inset text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[160px]">
            <DropdownMenuItem onClick={() => toast.info("View duplicated — MVP stub")}>
              Duplicate view
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toast.info("Archive queued — MVP stub")}>
              Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </motion.div>
    </motion.header>
  );
}

export default ProductHeader;
