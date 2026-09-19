import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Lightbulb, Plus, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { ANCHOR_DATE, products, type Category } from "@/data/products";
import {
  ALERT_META,
  STAGE_ORDER,
  type AlertType,
  type Stage,
} from "@/data/decisionEngine";
import StageFunnel from "@/sections/products/StageFunnel";
import FilterToolbar from "@/sections/products/FilterToolbar";
import LifecycleTable, {
  PRODUCT_COLUMNS,
} from "@/sections/products/LifecycleTable";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";


/** CREATED intake view: product still in "created" stage OR created in Odoo
 *  within the last 30 days (matches the dashboard's intake definition). */
const CREATED_INTAKE_DAYS = 30;
function isCreatedIntake(p: { stage: string; odooCreatedDate: string | null }): boolean {
  if (p.stage === "created") return true;
  if (!p.odooCreatedDate) return false;
  const ageDays =
    (ANCHOR_DATE.getTime() - new Date(p.odooCreatedDate).getTime()) / 86_400_000;
  return ageDays <= CREATED_INTAKE_DAYS;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function parseStage(v: string | null): Stage | null {
  return v && (STAGE_ORDER as string[]).includes(v) ? (v as Stage) : null;
}

function parseAlert(v: string | null): AlertType | null {
  return v && v in ALERT_META ? (v as AlertType) : null;
}

// ─── Header ──────────────────────────────────────────────────────────────────

function PageHeader({
  visibleColumns,
  onToggleColumn,
}: {
  visibleColumns: Record<string, boolean>;
  onToggleColumn: (key: string, visible: boolean) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <motion.p
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25 }}
          className="text-[11px] font-semibold uppercase tracking-[1.2px] text-lime/80"
        >
          Product Lifecycle
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06, ease: EASE }}
          className="mt-1 font-display text-[28px] font-semibold tracking-[-0.5px] text-text-primary"
        >
          Products
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.21 }}
          className="mt-1 text-[13.5px] text-text-secondary"
        >
          {products.length} products · buy-on-demand from butiksistem suppliers ·
          tracked from shared to sell-off · data from Odoo, synced 2m ago
        </motion.p>
      </div>
      <motion.div
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="flex items-center gap-2"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <motion.button
              whileTap={{ scale: 0.97 }}
              className="flex h-9 items-center gap-2 rounded-lg border border-hairline bg-panel px-3.5 text-[13px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Columns
            </motion.button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48 border-hairline bg-surface"
          >
            <DropdownMenuLabel className="text-[11px] uppercase tracking-[1.2px] text-text-muted">
              Toggle columns
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-hairline" />
            {PRODUCT_COLUMNS.map((col) => (
              <DropdownMenuCheckboxItem
                key={col.key}
                checked={visibleColumns[col.key] !== false}
                onCheckedChange={(checked) =>
                  onToggleColumn(col.key, checked === true)
                }
                onSelect={(e) => e.preventDefault()}
              >
                {col.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={() =>
            toast.info("Products are shared via butiksistem and created in Odoo — sync to import")
          }
          className="flex h-9 items-center gap-2 rounded-lg bg-lime px-3.5 text-[13px] font-semibold text-abyss transition-colors hover:brightness-110"
        >
          <Plus className="h-4 w-4" />
          Add Product
        </motion.button>
      </motion.div>
    </div>
  );
}

// ─── Loading skeleton ────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-panel">
      <div className="border-b border-hairline px-4 py-3">
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="flex h-14 items-center gap-4 border-b border-hairline px-4 last:border-b-0"
        >
          <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-5 w-16 rounded-md" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-20 rounded-md" />
        </div>
      ))}
    </div>
  );
}

// ─── Insight callout ─────────────────────────────────────────────────────────

function InsightCallout() {
  // Products still running Meta ads while butiksistem stock is low or gone —
  // every order they generate may not be fulfillable.
  const exposed = products.filter((p) =>
    p.alerts.some((a) => a.type === "SUPPLIER_OUT" || a.type === "SUPPLIER_LOW")
  );
  const dailySpend = exposed.reduce((a, p) => a + p.adSpend, 0) / 30;
  if (exposed.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.6 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="mt-4 flex items-center gap-3 rounded-xl border border-hairline border-l-[3px] border-l-lime bg-panel px-5 py-4"
    >
      <Lightbulb className="h-5 w-5 shrink-0 text-lime" />
      <p className="text-[13.5px] text-text-secondary">
        <span className="font-semibold text-text-primary">
          {exposed.length} products
        </span>{" "}
        are running ads against low or empty supplier stock on butiksistem.
        Winding those campaigns down frees{" "}
        <span className="font-mono font-semibold text-text-primary tnum">
          ~${Math.round(dailySpend)}/day
        </span>{" "}
        until restock.{" "}
        <Link
          to="/decisions"
          className="group relative font-semibold whitespace-nowrap text-lime"
        >
          Review in Decision Queue →
          <span className="absolute bottom-0 left-0 h-px w-0 bg-lime transition-all duration-200 group-hover:w-full" />
        </Link>
      </p>
    </motion.div>
  );
}

// ─── Products page ───────────────────────────────────────────────────────────

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const stage = parseStage(searchParams.get("stage"));
  const alert = parseAlert(searchParams.get("alert"));
  const query = searchParams.get("q") ?? "";

  const [queryInput, setQueryInput] = useState(query);
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(
    () => Object.fromEntries(PRODUCT_COLUMNS.map((c) => [c.key, true]))
  );

  // First-load skeleton (600ms).
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 600);
    return () => window.clearTimeout(t);
  }, []);

  // Keep the search box in sync when ?q= changes from outside (other pages).
  useEffect(() => {
    setQueryInput(query);
  }, [query]);

  // Debounced (200ms) search → ?q= param.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (queryInput) next.set("q", queryInput);
          else next.delete("q");
          return next;
        },
        { replace: true }
      );
    }, 200);
    return () => window.clearTimeout(t);
  }, [queryInput, setSearchParams]);

  const setParam = (key: string, value: string | null) =>
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );

  const resetFilters = () => {
    setCategory(null);
    setQueryInput("");
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = products.filter((p) => {
      // CREATED is an intake view: every recently created product, even if it
      // has already moved on to ads-live/selling/etc.
      if (stage === "created" ? !isCreatedIntake(p) : stage && p.stage !== stage)
        return false;
      if (alert && !p.alerts.some((a) => a.type === alert)) return false;
      if (category && p.category !== category) return false;
      if (
        needle &&
        !p.name.toLowerCase().includes(needle) &&
        !p.sku.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
    if (stage === "created") {
      // Newest created first.
      list.sort(
        (a, b) =>
          (b.odooCreatedDate ?? "").localeCompare(a.odooCreatedDate ?? "")
      );
    }
    return list;
  }, [stage, alert, category, query]);

  const isFiltered = Boolean(stage || alert || category || query);

  return (
    <div>
      <PageHeader
        visibleColumns={visibleColumns}
        onToggleColumn={(key, visible) =>
          setVisibleColumns((prev) => ({ ...prev, [key]: visible }))
        }
      />

      <StageFunnel
        active={stage}
        onSelect={(s) => setParam("stage", s)}
      />

      <div className="mt-4">
        <FilterToolbar
          query={queryInput}
          onQueryChange={setQueryInput}
          alert={alert}
          onAlertChange={(a) => setParam("alert", a)}
          category={category}
          onCategoryChange={setCategory}
          shown={filtered.length}
          total={products.length}
          isFiltered={isFiltered}
          onReset={resetFilters}
        />
      </div>

      <div className="mt-4">
        {loading ? (
          <TableSkeleton />
        ) : (
          <LifecycleTable
            key={stage ?? "all"}
            rows={filtered}
            visibleColumns={visibleColumns}
            onResetFilters={resetFilters}
            sortKey={stage === "created" ? "days" : "stage"}
            sortDir="asc"
          />
        )}
      </div>

      <InsightCallout />
    </div>
  );
}
