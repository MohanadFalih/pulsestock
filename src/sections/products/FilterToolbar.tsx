import { motion } from "framer-motion";
import { Search } from "lucide-react";
import { products, globalKpis, type Category } from "@/data/products";
import {
  ALERT_META,
  ALERT_URGENCY,
  type AlertType,
} from "@/data/decisionEngine";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Alert pills in the toolbar, ordered by urgency (most urgent first). */
const ALERT_PILL_ORDER: AlertType[] = (
  Object.keys(ALERT_META) as AlertType[]
).sort((a, b) => ALERT_URGENCY[a] - ALERT_URGENCY[b]);

const ALL_CATEGORIES = () => Array.from(new Set(products.map((p) => p.category)));

export interface FilterToolbarProps {
  query: string;
  onQueryChange: (q: string) => void;
  alert: AlertType | null;
  onAlertChange: (a: AlertType | null) => void;
  category: Category | null;
  onCategoryChange: (c: Category | null) => void;
  shown: number;
  total: number;
  isFiltered: boolean;
  onReset: () => void;
}

/** Alert-type pills: color dot + count, active pill tinted with layoutId glide. */
function AlertPills({
  value,
  onChange,
}: {
  value: AlertType | null;
  onChange: (a: AlertType | null) => void;
}) {
  const options = [
    { value: null as AlertType | null, label: "All", color: "#93A1B0", count: products.length },
    ...ALERT_PILL_ORDER.map((t) => ({
      value: t as AlertType | null,
      label: ALERT_META[t].label,
      color: ALERT_META[t].color,
      count: globalKpis.alertCounts[t],
    })),
  ];
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Filter by alert type"
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <motion.button
            key={opt.label}
            type="button"
            role="tab"
            aria-selected={active}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.03, duration: 0.2 }}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold transition-colors",
              active
                ? "text-text-primary"
                : "border-transparent text-text-muted hover:text-text-secondary"
            )}
          >
            {active && (
              <motion.span
                layoutId="alert-pill-bg"
                className="absolute inset-0 rounded-md border"
                style={{
                  backgroundColor: `${opt.color}14`,
                  borderColor: `${opt.color}66`,
                }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span
              className="relative h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: opt.color }}
            />
            <span className="relative">{opt.label}</span>
            <span className="relative font-mono text-[10px] text-text-muted tnum">
              {opt.count}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}

/**
 * Sticky filter toolbar: search, alert-type pills, category dropdown, result
 * count + reset. All filters combine (AND).
 */
export function FilterToolbar({
  query,
  onQueryChange,
  alert,
  onAlertChange,
  category,
  onCategoryChange,
  shown,
  total,
  isFiltered,
  onReset,
}: FilterToolbarProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, delay: 0.25 }}
      className="sticky top-14 z-20 -mx-6 border-b border-hairline bg-abyss/90 px-6 py-3 backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative w-[260px] shrink-0">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Filter by name or SKU…"
            aria-label="Filter by name or SKU"
            className="h-9 w-full rounded-lg border border-hairline bg-inset pr-3 pl-8 text-[13px] text-text-primary placeholder:text-text-muted focus:border-bright focus:outline-none"
          />
        </div>

        <AlertPills value={alert} onChange={onAlertChange} />

        {/* Category dropdown */}
        <Select
          value={category ?? "all"}
          onValueChange={(v) =>
            onCategoryChange(v === "all" ? null : (v as Category))
          }
        >
          <SelectTrigger
            className="h-9 w-[170px] shrink-0 border-hairline bg-inset text-[13px] text-text-secondary"
            aria-label="Filter by category"
          >
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent className="border-hairline bg-surface">
            <SelectItem value="all">All categories</SelectItem>
            {ALL_CATEGORIES().map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Result count + reset */}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11.5px] text-text-muted">
            Showing <span className="font-mono text-text-secondary tnum">{shown}</span> of{" "}
            <span className="font-mono text-text-secondary tnum">{total}</span>
          </span>
          {isFiltered && (
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
              onClick={onReset}
              className="text-[12.5px] font-semibold text-lime transition-opacity hover:opacity-80"
            >
              Reset filters
            </motion.button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default FilterToolbar;
