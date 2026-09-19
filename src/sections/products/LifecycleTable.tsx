import { useMemo, useRef, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useInView } from "framer-motion";
import { Eye, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  ANCHOR_DATE,
  getProductWindowTotals,
  hasLiveDaily,
  type Product,
} from "@/data/products";
import { useAdsVersion, useWindowDays } from "@/data/windowStore";
import {
  ALERT_URGENCY,
  SEVERITY_META,
  STAGE_ORDER,
  supplierCoverDays,
  topAlertUrgency,
  worstSeverity,
  type AlertSeverity,
} from "@/data/decisionEngine";
import DataTable, { type Column } from "@/components/DataTable";
import StageBadge from "@/components/StageBadge";
import SupplierPill from "@/components/SupplierPill";
import ReturnRateMeter from "@/components/ReturnRateMeter";
import RoasChip from "@/components/RoasChip";
import ProgressBar from "@/components/ProgressBar";
import EmptyState from "@/components/EmptyState";
import CountUp from "@/components/CountUp";
import { cn } from "@/lib/utils";
import { fmtMoney } from "@/lib/money";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

// ─── Column registry (drives the Columns visibility dropdown too) ────────────

export interface ProductColumnMeta {
  key: string;
  label: string;
}

/** All 13 lifecycle-table columns, in display order (buy-on-demand model). */
export const PRODUCT_COLUMNS: ProductColumnMeta[] = [
  { key: "product", label: "Product" },
  { key: "stage", label: "Stage" },
  { key: "days", label: "Days" },
  { key: "orders", label: "Orders" },
  { key: "delivered", label: "Delivered" },
  { key: "returned", label: "Returned" },
  { key: "returnPct", label: "Return %" },
  { key: "adSpend", label: "Ad Spend" },
  { key: "revenue", label: "Revenue" },
  { key: "roas", label: "ROAS" },
  { key: "returnedStock", label: "Returned Stock" },
  { key: "supplier", label: "Supplier Stock" },
  { key: "alerts", label: "Alerts" },
];

/** Currency-aware money (USD mock / IQD live), 0 decimals. */

/** Days since the product was created in Odoo ("days in market"). */
function daysInMarket(p: Product): number | null {
  if (!p.odooCreatedDate) return null;
  return Math.max(
    0,
    Math.round(
      (ANCHOR_DATE.getTime() - new Date(p.odooCreatedDate).getTime()) / 86_400_000
    )
  );
}

/** Worst-alert severity drives the pre-emphasis left-edge bar (watch and up). */
const EDGE_BAR: Partial<Record<AlertSeverity, string>> = {
  watch: SEVERITY_META.watch.color,
  issue: SEVERITY_META.issue.color,
  critical: SEVERITY_META.critical.color,
};

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 1,
  watch: 2,
  issue: 3,
  critical: 4,
};

/** Completed rows sleep at 70% opacity — everything except the alerts badge. */
function dim(p: Product, node: ReactNode): ReactNode {
  return p.stage === "completed" ? (
    <span className="block opacity-70">{node}</span>
  ) : (
    node
  );
}

function edgeBar(p: Product): ReactNode {
  const worst = worstSeverity(p.alerts);
  const color = worst ? EDGE_BAR[worst] : undefined;
  if (!color) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-y-2 -left-4 w-0.5"
      style={{ backgroundColor: color }}
    />
  );
}

/** Sell-off progress: share of returned units already cleared from the warehouse. */
function sellOffPct(p: Product): number {
  if (p.returned <= 0) return 0;
  return Math.max(0, Math.min(100, ((p.returned - p.returnedStock) / p.returned) * 100));
}

// ─── Totals footer ───────────────────────────────────────────────────────────

function TotalsFooter({
  rows,
  windowDays,
  live,
}: {
  rows: Product[];
  /** Selected window; orders/revenue totals are windowed in live mode. */
  windowDays: number;
  live: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.8 });
  const t = useMemo(() => {
    const win = (p: Product) =>
      live ? getProductWindowTotals(p.id, windowDays) : null;
    const orders = rows.reduce((a, p) => a + (win(p)?.orders ?? p.totalOrders), 0);
    const delivered = rows.reduce((a, p) => a + p.delivered, 0);
    const returned = rows.reduce((a, p) => a + p.returned, 0);
    const adSpend = rows.reduce((a, p) => a + p.adSpend, 0);
    const revenue = rows.reduce((a, p) => a + (win(p)?.revenue ?? p.revenue), 0);
    const returnedStock = rows.reduce((a, p) => a + p.returnedStock, 0);
    return {
      orders,
      delivered,
      returned,
      returnPct: delivered > 0 ? (returned / delivered) * 100 : null,
      adSpend,
      revenue,
      // Live: spend window ≠ revenue window in general — never divide them.
      roas: !live && adSpend > 0 ? revenue / adSpend : null,
      returnedStock,
    };
  }, [rows, windowDays, live]);

  const item = (label: string, node: ReactNode) => (
    <span className="flex items-baseline gap-1.5">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span className="font-mono text-[13px] font-semibold text-text-primary tnum">
        {node}
      </span>
    </span>
  );

  return (
    <div
      ref={ref}
      className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-1 border-t border-hairline px-4 py-2"
    >
      <span className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
        Totals (visible rows)
      </span>
      {inView ? (
        <>
          {item(
            "Orders",
            <CountUp
              value={t.orders}
              duration={0.5}
              format={(v) => Math.round(v).toLocaleString("en-US")}
            />
          )}
          {item(
            "Delivered",
            <CountUp
              value={t.delivered}
              duration={0.5}
              format={(v) => Math.round(v).toLocaleString("en-US")}
            />
          )}
          {item(
            "Returned",
            <CountUp
              value={t.returned}
              duration={0.5}
              format={(v) => Math.round(v).toLocaleString("en-US")}
            />
          )}
          {item(
            "Return",
            t.returnPct == null ? (
              "—"
            ) : (
              <CountUp
                value={t.returnPct}
                duration={0.5}
                format={(v) => `${v.toFixed(1)}%`}
              />
            )
          )}
          {item(
            "Ad spend",
            <CountUp value={t.adSpend} duration={0.5} format={fmtMoney} />
          )}
          {item(
            "Revenue",
            <CountUp value={t.revenue} duration={0.5} format={fmtMoney} />
          )}
          {item(
            "Blended ROAS",
            t.roas == null ? (
              "—"
            ) : (
              <CountUp
                value={t.roas}
                duration={0.5}
                format={(v) => v.toFixed(2)}
              />
            )
          )}
          {item(
            "Returned stock",
            <CountUp
              value={t.returnedStock}
              duration={0.5}
              format={(v) => `${Math.round(v)}u`}
            />
          )}
        </>
      ) : (
        <span className="font-mono text-[13px] text-text-muted tnum">…</span>
      )}
    </div>
  );
}

// ─── Alerts cell ─────────────────────────────────────────────────────────────

function AlertsCell({ p, onQuickView, onOpenOdoo }: {
  p: Product;
  onQuickView: (e: React.MouseEvent, p: Product) => void;
  onOpenOdoo: (e: React.MouseEvent) => void;
}) {
  const worst = worstSeverity(p.alerts);
  return (
    <div className="relative flex items-center justify-end">
      {worst == null ? (
        <span className="text-text-muted">—</span>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px]"
          style={{
            color: SEVERITY_META[worst].color,
            backgroundColor: `${SEVERITY_META[worst].color}14`,
          }}
          title={p.alerts.map((a) => a.title).join("\n")}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: SEVERITY_META[worst].color }}
          />
          {SEVERITY_META[worst].label}
          <span className="font-mono text-[10px] font-semibold opacity-80 tnum">
            ×{p.alerts.length}
          </span>
        </span>
      )}
      {/* Quick actions — fade+slide in on row hover */}
      <div className="row-qa absolute top-1/2 right-0 flex -translate-y-1/2 translate-x-1 items-center gap-1 bg-gradient-to-l from-panel-hover via-panel-hover to-transparent pl-4 opacity-0 transition-all duration-150">
        <button
          type="button"
          aria-label={`View ${p.name} detail`}
          onClick={(e) => onQuickView(e, p)}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-panel-hover text-text-secondary transition-colors hover:border-bright hover:text-lime"
        >
          <Eye className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Open ${p.name} in Odoo`}
          onClick={onOpenOdoo}
          className="flex h-7 w-7 items-center justify-center rounded-md border border-hairline bg-panel-hover text-text-secondary transition-colors hover:border-bright hover:text-lime"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Lifecycle table ─────────────────────────────────────────────────────────

export interface LifecycleTableProps {
  rows: Product[];
  visibleColumns: Record<string, boolean>;
  onResetFilters: () => void;
  /** Initial sort column (default "stage"); caller re-mounts via `key` to change. */
  sortKey?: string;
  /** Initial sort direction (default "asc"). */
  sortDir?: "asc" | "desc";
}

/** DataTable constrains rows to Record<string, unknown>; intersect locally. */
type TableRow = Product & Record<string, unknown>;

export function LifecycleTable({
  rows,
  visibleColumns,
  onResetFilters,
  sortKey = "stage",
  sortDir = "asc",
}: LifecycleTableProps) {
  const navigate = useNavigate();
  const windowDays = useWindowDays();
  // Re-derive when an async ads/live re-fetch lands (in-place, no reload).
  const adsVersion = useAdsVersion();
  // Live mode with daily buckets: Orders/Revenue reflect the selected window.
  const live = hasLiveDaily();

  const columns = useMemo<Column<TableRow>[]>(() => {
    void adsVersion; // re-derive after an in-place live/ads re-fetch
    /** Windowed per-product sums (null in mock mode). */
    const winOf = (p: Product) =>
      live ? getProductWindowTotals(p.id, windowDays) : null;
    /** Header label with a "lifetime" tooltip for state metrics in live mode. */
    const lifetimeHeader = (label: string) =>
      live ? (
        <span title="Lifetime total — not affected by the date window">{label}</span>
      ) : (
        label
      );
    const openOdoo = (e: React.MouseEvent) => {
      e.stopPropagation();
      toast.info("Opens in Odoo — MVP stub");
    };
    const viewDetail = (e: React.MouseEvent, p: Product) => {
      e.stopPropagation();
      navigate(`/products/${p.id}`);
    };

    const all: Column<TableRow>[] = [
      {
        key: "product",
        header: "Product",
        sortable: true,
        sortValue: (p) => p.name,
        cellClassName: "min-w-[240px]",
        render: (p) => (
          <div className="relative flex items-center gap-3">
            {edgeBar(p)}
            <img
              src={p.thumbnail}
              alt={p.name}
              loading="lazy"
              className="h-9 w-9 shrink-0 rounded-lg border border-hairline bg-inset object-cover"
            />
            <div
              className={cn("min-w-0", p.stage === "completed" && "opacity-70")}
            >
              <p className="truncate text-[13px] font-semibold text-text-primary">
                {p.name}
              </p>
              <p className="text-[11.5px] text-text-muted">
                <span className="font-mono tnum">{p.sku}</span> · {p.category}
              </p>
            </div>
          </div>
        ),
      },
      {
        key: "stage",
        header: "Stage",
        sortable: true,
        sortValue: (p) => STAGE_ORDER.indexOf(p.stage),
        headerClassName: "w-[132px]",
        render: (p) => dim(p, <StageBadge stage={p.stage} />),
      },
      {
        key: "days",
        header: "Days",
        numeric: true,
        sortable: true,
        sortValue: (p) => daysInMarket(p),
        headerClassName: "w-[64px]",
        render: (p) => {
          const days = daysInMarket(p);
          return dim(
            p,
            days == null ? (
              <span className="text-text-muted">—</span>
            ) : (
              <span
                className={cn(
                  "font-mono text-[13px] tnum",
                  days < 7 ? "text-stage-intake" : "text-text-primary"
                )}
                title="Days since created in Odoo"
              >
                {days}
                <span className="text-[10px] text-text-muted">d</span>
              </span>
            )
          );
        },
      },
      {
        key: "orders",
        header: live ? `Orders (${windowDays}d)` : "Orders",
        numeric: true,
        sortable: true,
        sortValue: (p) => winOf(p)?.orders ?? p.totalOrders,
        headerClassName: "w-[96px]",
        render: (p) => {
          const w = winOf(p);
          return dim(
            p,
            <span
              className="inline-flex flex-col items-end"
              title={w ? `Order documents in the last ${windowDays} days (Odoo daily buckets)` : undefined}
            >
              <span className="text-text-primary">
                {(w?.orders ?? p.totalOrders).toLocaleString("en-US")}
              </span>
              {w ? (
                <>
                  <span className="font-mono text-[10px] text-text-muted tnum">
                    {w.units.toLocaleString("en-US")} units ({windowDays}d)
                  </span>
                  <span className="font-mono text-[10px] text-text-muted tnum">
                    lifetime {p.totalOrders.toLocaleString("en-US")}
                  </span>
                </>
              ) : (
                p.totalOrders > 0 && (
                  <span className="font-mono text-[10px] text-text-muted tnum">
                    {p.chatOrders} chat · {p.websiteOrders} web
                  </span>
                )
              )}
            </span>
          );
        },
      },
      {
        key: "delivered",
        header: lifetimeHeader("Delivered"),
        numeric: true,
        sortable: true,
        sortValue: (p) => p.delivered,
        headerClassName: "w-[84px]",
        render: (p) =>
          dim(
            p,
            <span className="text-text-primary">
              {p.delivered.toLocaleString("en-US")}
            </span>
          ),
      },
      {
        key: "returned",
        header: lifetimeHeader("Returned"),
        numeric: true,
        sortable: true,
        sortValue: (p) => p.returned,
        headerClassName: "w-[84px]",
        render: (p) =>
          dim(
            p,
            <span className="text-text-primary">
              {p.returned.toLocaleString("en-US")}
            </span>
          ),
      },
      {
        key: "returnPct",
        header: lifetimeHeader("Return %"),
        numeric: true,
        sortable: true,
        sortValue: (p) => p.returnRate,
        headerClassName: "w-[120px]",
        render: (p) =>
          dim(
            p,
            <span className="inline-flex flex-col items-end gap-0.5">
              {p.returnConfidence === "insufficient" ? (
                <span className="text-[12px] font-medium text-cyan">
                  Collecting data
                </span>
              ) : (
                <ReturnRateMeter value={p.returnRate} />
              )}
              <span className="font-mono text-[10px] text-text-muted tnum">
                n={p.delivered} delivered
              </span>
            </span>
          ),
      },
      {
        key: "adSpend",
        header: live ? (
          <span title="Meta spend over the ads-fetch window (see the Overview AD SPEND card chip)">
            Ad Spend
          </span>
        ) : (
          "Ad Spend"
        ),
        numeric: true,
        sortable: true,
        sortValue: (p) => p.adSpend,
        headerClassName: "w-[92px]",
        render: (p) =>
          p.adSpend > 0 ? (
            dim(p, <span className="text-text-primary">{fmtMoney(p.adSpend)}</span>)
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
      {
        key: "revenue",
        header: live ? `Revenue (${windowDays}d)` : "Revenue",
        numeric: true,
        sortable: true,
        sortValue: (p) => winOf(p)?.revenue ?? p.revenue,
        headerClassName: "w-[96px]",
        render: (p) => {
          const w = winOf(p);
          const value = w?.revenue ?? p.revenue;
          return value > 0 ? (
            dim(
              p,
              <span
                className="inline-flex flex-col items-end"
                title={w ? `Revenue in the last ${windowDays} days (Odoo daily buckets)` : undefined}
              >
                <span className="text-text-primary">{fmtMoney(value)}</span>
                {w && (
                  <span className="font-mono text-[10px] text-text-muted tnum">
                    lifetime {fmtMoney(p.revenue)}
                  </span>
                )}
              </span>
            )
          ) : (
            <span className="text-text-muted">—</span>
          );
        },
      },
      {
        key: "roas",
        header: "ROAS",
        numeric: true,
        sortable: true,
        sortValue: (p) => p.roas,
        headerClassName: "w-[84px]",
        render: (p) => dim(p, <RoasChip value={p.roas} />),
      },
      {
        key: "returnedStock",
        header: lifetimeHeader("Returned Stock"),
        numeric: true,
        sortable: true,
        sortValue: (p) => p.returnedStock,
        headerClassName: "w-[120px]",
        render: (p) =>
          dim(
            p,
            p.returnedStock === 0 && p.returned === 0 ? (
              <span className="text-text-muted">—</span>
            ) : (
              <span className="inline-flex flex-col items-end gap-1">
                <span className="font-mono text-[13px] text-text-primary tnum">
                  {p.returnedStock}
                  <span className="text-[10px] text-text-muted">u</span>
                </span>
                {p.returned > 0 && (
                  <>
                    <ProgressBar
                      value={sellOffPct(p)}
                      color="#3EE6D8"
                      className="w-12"
                    />
                    <span className="font-mono text-[10px] text-text-muted tnum">
                      {p.returned - p.returnedStock}/{p.returned} cleared
                    </span>
                  </>
                )}
              </span>
            )
          ),
      },
      {
        key: "supplier",
        header: lifetimeHeader("Supplier Stock"),
        sortable: true,
        sortValue: (p) => {
          const cover = supplierCoverDays(p.supplierStock.qty, p.orderVelocity7d);
          return cover === Infinity ? Number.MAX_SAFE_INTEGER : cover;
        },
        headerClassName: "w-[170px]",
        render: (p) =>
          dim(
            p,
            <SupplierPill
              supplier={p.supplierStock}
              orderVelocity7d={p.orderVelocity7d}
            />
          ),
      },
      {
        key: "alerts",
        header: "Alerts",
        sortable: true,
        sortValue: (p) => {
          const worst = worstSeverity(p.alerts);
          // Rank by severity, then by urgency of the most urgent alert.
          return (
            (worst ? SEVERITY_RANK[worst] : 0) * 100 -
            (topAlertUrgency(p.alerts) ?? ALERT_URGENCY.COLLECTING_DATA)
          );
        },
        headerClassName: "w-[128px]",
        render: (p) => (
          <AlertsCell p={p} onQuickView={viewDetail} onOpenOdoo={openOdoo} />
        ),
      },
    ];
    return all.filter((c) => visibleColumns[c.key] !== false);
    // windowDays/live: windowed Orders/Revenue columns; adsVersion: in-place
    // re-derivation after an async ads re-fetch.
  }, [visibleColumns, navigate, windowDays, adsVersion, live]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.15, ease: EASE }}
      className="overflow-hidden rounded-xl border border-hairline bg-panel"
    >
      {/* Row entrance stagger (first 12 rows, 25ms each) — CSS so DataTable
          internals stay untouched; disabled by prefers-reduced-motion. */}
      <style>{`
        @keyframes ps-row-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .ps-rows tbody tr { animation: ps-row-in 0.3s ease-out both; }
        ${Array.from(
          { length: 12 },
          (_, i) =>
            `.ps-rows tbody tr:nth-child(${i + 1}) { animation-delay: ${i * 25}ms; }`
        ).join("\n")}
      `}</style>
      <DataTable<TableRow>
        columns={columns}
        rows={rows as TableRow[]}
        rowKey={(p) => p.id}
        defaultSortKey={sortKey}
        defaultSortDir={sortDir}
        onRowClick={(p) => navigate(`/products/${p.id}`)}
        className="ps-rows rounded-none border-0 [&_tbody_tr:hover_.row-qa]:translate-x-0 [&_tbody_tr:hover_.row-qa]:opacity-100"
        emptyState={
          <EmptyState
            className="border-0"
            message="No products match these filters"
            ctaLabel="Reset filters"
            onCta={onResetFilters}
          />
        }
      />
      <TotalsFooter rows={rows} windowDays={windowDays} live={live} />
    </motion.div>
  );
}

export default LifecycleTable;
