import type { TooltipProps } from "recharts";
import { fmtMoney } from "@/lib/money";

export interface ChartTooltipRow {
  label: string;
  value: string;
  color: string;
}

export interface ChartTooltipProps extends TooltipProps<number, string> {
  /** Override the auto-built rows from the recharts payload. */
  rows?: ChartTooltipRow[];
  /** Optional computed footer row (e.g. "ROAS that day: 2.6"). */
  footer?: { label: string; value: string; color: string };
  /** Format payload values (default: currency-aware compact money). */
  formatValue?: (value: number, name: string) => string;
}

const DEFAULT_COLORS = ["#C6F04D", "#3EE6D8", "#45B7F5", "#8B7CFF", "#FBBF24", "#FB5D7A", "#A3D65C"];

const defaultFormat = fmtMoney;

/** Custom dark tooltip for Recharts: bg #0C1118F2, bright border, 8px radius. */
export function ChartTooltip({
  active,
  payload,
  label,
  rows,
  footer,
  formatValue,
}: ChartTooltipProps) {
  if (!active) return null;
  const autoRows: ChartTooltipRow[] =
    rows ??
    (payload ?? [])
      .filter((entry) => !entry.payload?.__ignore && entry.value != null)
      .map((entry, i) => ({
        label: String(entry.name ?? entry.dataKey ?? ""),
        value:
          typeof entry.value === "number"
            ? (formatValue ?? ((v) => defaultFormat(v)))(entry.value, String(entry.name ?? ""))
            : String(entry.value),
        color: entry.color ?? entry.stroke ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      }));

  return (
    <div
      className="min-w-[150px] rounded-lg border border-bright px-3 py-2 shadow-xl"
      style={{ background: "#0C1118F2" }}
    >
      {label != null && (
        <p className="mb-1.5 text-[11.5px] text-text-muted">{String(label)}</p>
      )}
      <div className="flex flex-col gap-1">
        {autoRows.map((row) => (
          <div key={row.label} className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="text-[11.5px] text-text-secondary">{row.label}</span>
            <span className="ml-auto pl-3 font-mono text-[12px] font-semibold text-text-primary tnum">
              {row.value}
            </span>
          </div>
        ))}
        {footer && (
          <div className="mt-1 flex items-center gap-2 border-t border-hairline pt-1.5">
            <span className="text-[11.5px] text-text-secondary">{footer.label}</span>
            <span
              className="ml-auto pl-3 font-mono text-[12px] font-semibold tnum"
              style={{ color: footer.color }}
            >
              {footer.value}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChartTooltip;
