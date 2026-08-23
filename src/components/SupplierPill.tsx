import {
  supplierCoverDays,
  type SupplierStock,
} from "@/data/decisionEngine";
import { cn } from "@/lib/utils";

export interface SupplierPillProps {
  supplier: SupplierStock;
  /** Orders per day (7-day velocity) — used to show days of cover. Optional. */
  orderVelocity7d?: number;
  className?: string;
}

function daysAgoLabel(iso: string): string {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  );
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

/**
 * Dot + supplier stock from butiksistem.com.
 * qty 0 → "Out of stock" (red) · <7d cover → "Low · n · Xd left" (amber)
 * · otherwise "In stock · n" (green). Appends a muted last-checked hint.
 */
export function SupplierPill({
  supplier,
  orderVelocity7d,
  className,
}: SupplierPillProps) {
  // Unknown supplier stock (butiksistem not connected — live sync mode).
  if (supplier.qty == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-[12px] font-medium text-text-muted",
          className
        )}
        title="butiksistem not connected — supplier stock unknown"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
        Unknown · not connected
      </span>
    );
  }

  const cover =
    orderVelocity7d != null
      ? supplierCoverDays(supplier.qty, orderVelocity7d)
      : Infinity;

  const color =
    supplier.qty <= 0 ? "#FB5D7A" : cover < 7 ? "#FBBF24" : "#4ADE80";

  const text =
    supplier.qty <= 0
      ? "Out of stock"
      : cover < 7
        ? `Low · ${supplier.qty.toLocaleString()} · ${Math.max(0, Math.floor(cover))}d left`
        : `In stock · ${supplier.qty.toLocaleString()}`;

  const checkedHint = supplier.lastChecked
    ? ` · ${daysAgoLabel(supplier.lastChecked)}`
    : "";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px] font-medium",
        className
      )}
      style={{ color }}
      title={supplier.lastChecked
        ? `Checked ${daysAgoLabel(supplier.lastChecked)} · source: ${supplier.source}`
        : `source: ${supplier.source}`}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {text}
      <span className="text-[10.5px] font-normal text-text-muted">
        {checkedHint}
      </span>
    </span>
  );
}

export default SupplierPill;
