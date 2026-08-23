import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  /** Unique key; also used as the default sort accessor. */
  key: string;
  header: ReactNode;
  /** Cell renderer. */
  render: (row: T, index: number) => ReactNode;
  /** Numeric columns right-align and use JetBrains Mono. */
  numeric?: boolean;
  sortable?: boolean;
  /** Value used for sorting (defaults to row[key]). */
  sortValue?: (row: T) => string | number | null;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Stable row key. */
  rowKey: (row: T) => string;
  /** Initial sort. */
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  onRowClick?: (row: T) => void;
  /** Max height enables a scrollable body with sticky header. */
  maxHeight?: number | string;
  emptyState?: ReactNode;
  className?: string;
}

/**
 * Dense data table: sticky header, 56px rows, hairline dividers, hover
 * highlight, sortable headers (chevron rotates 180°).
 */
export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  defaultSortKey,
  defaultSortDir = "desc",
  onRowClick,
  maxHeight,
  emptyState,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const accessor =
      col.sortValue ?? ((row: T) => row[sortKey] as string | number | null);
    return [...rows].sort((a, b) => {
      const av = accessor(a);
      const bv = accessor(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div
      className={cn("overflow-auto rounded-xl border border-hairline bg-panel", className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-panel shadow-[0_1px_0_0_#232E3B]">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted",
                  col.numeric && "text-right",
                  col.sortable && "cursor-pointer select-none hover:text-text-secondary",
                  col.headerClassName
                )}
                onClick={col.sortable ? () => toggleSort(col.key) : undefined}
              >
                <span className={cn("inline-flex items-center gap-1", col.numeric && "flex-row-reverse")}>
                  {col.header}
                  {col.sortable && (
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform duration-150",
                        sortKey === col.key ? "text-lime opacity-100" : "opacity-30",
                        sortKey === col.key && sortDir === "asc" && "rotate-180"
                      )}
                    />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "h-14 border-t border-hairline transition-colors",
                onRowClick && "cursor-pointer hover:bg-panel-hover"
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-4 py-2 text-[13px] font-medium text-text-secondary",
                    col.numeric && "text-right font-mono tnum",
                    col.cellClassName
                  )}
                >
                  {col.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="p-6">
                {emptyState ?? (
                  <p className="text-center text-[13px] text-text-muted">No results.</p>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default DataTable;
