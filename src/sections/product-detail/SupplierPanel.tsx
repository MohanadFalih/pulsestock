import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Pencil, Truck, X } from "lucide-react";
import { toast } from "sonner";
import { supplierCoverDays } from "@/data/decisionEngine";
import type { Product } from "@/data/products";
import { cn } from "@/lib/utils";
import { fmtIso } from "./derived";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Supplier panel — butiksistem.com stock for the buy-on-demand source.
 * Includes the manual-entry workflow: staff check butiksistem and type the
 * current quantity here (local state + toast, no backend).
 */
export function SupplierPanel({ product }: { product: Product }) {
  const [qty, setQty] = useState<number | null>(product.supplierStock.qty);
  const [lastChecked, setLastChecked] = useState<string | null>(product.supplierStock.lastChecked);
  const [source, setSource] = useState(product.supplierStock.source);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(product.supplierStock.qty ?? ""));

  const unknown = qty == null;
  const cover = supplierCoverDays(qty, product.orderVelocity7d);
  const coverLabel = unknown
    ? "—"
    : qty <= 0
      ? "0 days"
      : !Number.isFinite(cover)
        ? "∞ (no orders)"
        : product.orderVelocity7d <= 0
          ? "—"
          : `~${cover} days`;
  const qtyColor = unknown
    ? "#93A1B0"
    : qty <= 0 ? "#FB5D7A" : Number.isFinite(cover) && cover < 7 ? "#FBBF24" : "#4ADE80";

  const todayIso = new Date().toISOString().slice(0, 10);

  const save = () => {
    const parsed = Math.max(0, Math.floor(Number(draft)));
    if (!Number.isFinite(parsed)) {
      toast.error("Enter a valid unit count");
      return;
    }
    setQty(parsed);
    setLastChecked(todayIso);
    setSource("manual");
    setEditing(false);
    toast.success(`Supplier stock updated to ${parsed.toLocaleString()} units`, {
      description: `${product.supplier} · manual entry · recorded ${fmtIso(todayIso)}`,
    });
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.14, ease: EASE }}
      className="rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-text-primary">
          <Truck className="h-4 w-4 text-amber" />
          Supplier Stock
        </h2>
        <span
          className={cn(
            "rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.8px]",
            source === "api"
              ? "border-cyan/40 bg-cyan/10 text-cyan"
              : "border-hairline bg-inset text-text-muted"
          )}
        >
          {source === "api" ? "api" : "manual"}
        </span>
      </div>
      <p className="mt-0.5 text-[11.5px] text-text-muted">
        {product.supplier} · butiksistem.com
      </p>

      {/* Qty + cover */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-inset px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[1px] text-text-muted">
            Units available
          </p>
          <p className="mt-0.5 font-mono text-[15px] font-semibold tnum" style={{ color: qtyColor }}>
            {unknown ? "—" : qty.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg bg-inset px-2.5 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-[1px] text-text-muted">
            Cover @ {product.orderVelocity7d}/day
          </p>
          <p className="mt-0.5 font-mono text-[15px] font-semibold tnum" style={{ color: qtyColor }}>
            {coverLabel}
          </p>
        </div>
      </div>

      <p className="mt-2 font-mono text-[11px] text-text-muted tnum">
        {lastChecked
          ? `Last checked ${fmtIso(lastChecked)} · ${source === "api" ? "butiksistem api" : "manual entry"}`
          : "Not connected — check butiksistem and enter stock manually"}
      </p>

      {/* Inline edit — the manual-entry workflow */}
      {editing ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            autoFocus
            type="number"
            min={0}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="h-8 w-full rounded-lg border border-bright bg-inset px-2.5 font-mono text-[13px] font-semibold text-text-primary outline-none tnum focus:border-lime"
            aria-label="Supplier stock quantity"
          />
          <button
            onClick={save}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lime text-abyss transition-transform active:scale-95 hover:brightness-110"
            aria-label="Save supplier stock"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={() => setEditing(false)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
            aria-label="Cancel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setDraft(qty == null ? "" : String(qty));
            setEditing(true);
          }}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-hairline px-3 py-2 text-[12.5px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
        >
          <Pencil className="h-3.5 w-3.5" />
          Update supplier stock
        </button>
      )}
    </motion.section>
  );
}

export default SupplierPanel;
