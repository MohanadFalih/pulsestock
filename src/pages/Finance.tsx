/**
 * Cash P&L page — the honest money view (finance branch).
 *
 * Cash revenue counts DELIVERED quantities only; the paper (ordered) number
 * is kept alongside so its inflation stays visible. Delivery economics add
 * +1,000 IQD per delivered order (customer pays 5,000, courier costs 4,000),
 * ads spend comes from the Meta bridge, and the expense panel covers daily
 * cash-outs (شحن تركيا / other) plus prorated monthly overhead.
 *
 * Degrades gracefully: with no ops payload the data sections show a
 * "Sync pending" empty state while the expenses panel stays fully usable.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { CloudOff, Plus, Trash2, WifiOff } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useOpsData } from "@/data/opsData";
import { computeFinance, type FinanceResult, type PnLTotals } from "@/data/financeEngine";
import {
  DAILY_KIND_META,
  addDailyExpense,
  monthlyExpenseFor,
  removeDailyExpense,
  upsertMonthlyExpense,
  useExpenses,
  type DailyExpenseKind,
} from "@/data/expenseStore";
import {
  adsPresetForWindow,
  adsSyncLabel,
  getAdsData,
  type AdsData,
} from "@/data/adsProvider";
import { useWindowDays } from "@/data/windowStore";
import ChartTooltip from "@/components/ChartTooltip";
import DataTable, { type Column } from "@/components/DataTable";
import EmptyState from "@/components/EmptyState";
import FilterPills from "@/components/FilterPills";
import KpiCard, { type KpiDelta } from "@/components/KpiCard";
import { cn } from "@/lib/utils";
import { compact, fmtMoney, setCurrency } from "@/lib/money";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};
const riseChild = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
};

const POS = "#4ADE80";
const NEG = "#FB5D7A";

/** Sum a set of day rows into totals (used for the P&L table columns). */
function sumDays(days: FinanceResult["days"]): PnLTotals {
  const t: PnLTotals = {
    cashRev: 0,
    paperRev: 0,
    cogs: 0,
    ads: 0,
    deliveryNet: 0,
    dailyExpenses: 0,
    proratedFixed: 0,
    netCash: 0,
    ordersPlaced: 0,
    deliveredOrders: 0,
    uncostedValue: 0,
    uncostedPct: 0,
    paperInflationPct: 0,
  };
  for (const d of days) {
    t.cashRev += d.cashRev;
    t.paperRev += d.paperRev;
    t.cogs += d.cogs;
    t.ads += d.ads;
    t.deliveryNet += d.deliveryNet;
    t.dailyExpenses += d.dailyExpenses;
    t.proratedFixed += d.proratedFixed;
    t.netCash += d.netCash;
    t.ordersPlaced += d.ordersPlaced;
    t.deliveredOrders += d.deliveredOrders;
    t.uncostedValue += d.uncostedValue;
  }
  t.uncostedPct = t.cashRev > 0 ? t.uncostedValue / t.cashRev : 0;
  t.paperInflationPct = t.paperRev > 0 ? (t.paperRev - t.cashRev) / t.paperRev : 0;
  return t;
}

// ─── Ads data (window-matched preset) ───────────────────────────────────────

interface AdsState {
  data: AdsData | null;
  loading: boolean;
  offline: boolean;
}

function useAdsForWindow(windowDays: number): AdsState {
  const [state, setState] = useState<{ key: number; data: AdsData | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getAdsData(adsPresetForWindow(windowDays)).then((r) => {
      if (!cancelled) setState({ key: windowDays, data: r?.data ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [windowDays]);
  const loading = state?.key !== windowDays;
  return { data: state?.data ?? null, loading, offline: !loading && state?.data === null };
}

// ─── Header ──────────────────────────────────────────────────────────────────

function PageHeader({ syncedAt, pending }: { syncedAt: string | null; pending: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <motion.p
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.25 }}
          className="text-[11px] font-semibold uppercase tracking-[1.2px] text-lime/80"
        >
          Cash · not paper
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.06, ease: EASE }}
          className="mt-1 font-display text-[28px] font-semibold tracking-[-0.5px] text-text-primary"
        >
          Cash P&amp;L
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.21 }}
          className="mt-1 flex items-center gap-1.5 text-[13.5px] text-text-secondary"
        >
          {!pending && (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-pos"
              title="Live from the Odoo ops sync"
            />
          )}
          {pending
            ? "Waiting for the Odoo ops sync — expenses still work below"
            : `Delivered orders only · ${syncedAt ? adsSyncLabel(syncedAt) : ""}`}
        </motion.p>
      </div>
    </div>
  );
}

// ─── KPI row ─────────────────────────────────────────────────────────────────

interface KpiSpec {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  format?: (v: number) => string;
  valueText?: string;
  delta: KpiDelta;
  sparkColor?: string;
  sparkline?: number[];
}

function KpiRow({ fin, today, last7 }: { fin: FinanceResult | null; today: PnLTotals | null; last7: PnLTotals | null }) {
  const inflationPct = fin ? Math.round(fin.totals.paperInflationPct * 100) : 0;
  const uncostedPct = fin ? Math.round(fin.totals.uncostedPct * 1000) / 10 : 0;

  const cards: KpiSpec[] = [
    {
      label: "Cash Revenue",
      value: fin?.totals.cashRev ?? 0,
      format: fmtMoney,
      valueText: fin ? undefined : "—",
      delta: {
        text: fin ? `${fin.totals.deliveredOrders} delivered orders` : "Sync pending",
        direction: "flat" as const,
        tone: "neutral" as const,
      },
      sparkColor: "#C6F04D",
      sparkline: fin?.days.map((d) => d.cashRev),
    },
    {
      label: "Paper Revenue",
      value: fin?.totals.paperRev ?? 0,
      format: fmtMoney,
      valueText: fin ? undefined : "—",
      delta: {
        text: fin ? `paper is ~${inflationPct}% inflated` : "Sync pending",
        direction: "up" as const,
        tone: "neutral" as const,
      },
      sparkColor: "#3EE6D8",
      sparkline: fin?.days.map((d) => d.paperRev),
    },
    {
      label: "Net Cash · Today / 7d",
      value: today?.netCash ?? 0,
      format: fmtMoney,
      valueText: today ? undefined : "—",
      delta: {
        text: last7 ? `${fmtMoney(last7.netCash)} last 7d` : "Sync pending",
        direction: last7 && last7.netCash < 0 ? ("down" as const) : ("up" as const),
        tone: last7 ? (last7.netCash >= 0 ? ("pos" as const) : ("neg" as const)) : ("neutral" as const),
      },
      sparkColor: "#8B7CFF",
      sparkline: fin?.days.map((d) => d.netCash),
    },
    {
      label: "Uncosted Revenue",
      value: uncostedPct,
      suffix: "%",
      decimals: 1,
      valueText: fin ? undefined : "—",
      delta: {
        text: fin
          ? uncostedPct > 0
            ? `${fmtMoney(fin.totals.uncostedValue)} has no cost match`
            : "every delivered line costed"
          : "Sync pending",
        direction: "flat" as const,
        tone: uncostedPct > 5 ? ("neg" as const) : ("neutral" as const),
      },
    },
  ];

  return (
    <motion.div
      variants={staggerParent}
      initial="hidden"
      animate="show"
      className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4"
    >
      {cards.map((c) => (
        <motion.div key={c.label} variants={riseChild}>
          <KpiCard
            label={c.label}
            value={c.value}
            decimals={c.decimals}
            suffix={c.suffix}
            format={c.format}
            valueText={c.valueText}
            delta={c.delta}
            sparkline={c.sparkline}
            sparkColor={c.sparkColor}
          />
        </motion.div>
      ))}
    </motion.div>
  );
}

// ─── Cash vs Paper chart ─────────────────────────────────────────────────────

function CashPaperChart({ fin, range, onRange }: { fin: FinanceResult; range: "30" | "90"; onRange: (r: "30" | "90") => void }) {
  const data = fin.days.map((d) => ({
    label: d.label,
    cash: Math.round(d.cashRev),
    paper: Math.round(d.paperRev),
  }));
  const interval = Math.max(1, Math.ceil(data.length / 10) - 1);
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.18, ease: EASE }}
      className="mt-4 rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            Cash vs Paper
          </h2>
          <p className="text-[11.5px] text-text-muted">
            Daily delivered revenue against the ordered value — the gap is returns + undelivered
          </p>
        </div>
        <div className="ml-auto">
          <FilterPills
            layoutId="cash-paper-range"
            options={[
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
            ]}
            value={range}
            onChange={(v) => onRange(v === "90" ? "90" : "30")}
          />
        </div>
      </div>
      <div className="mt-3 h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id="gradCash" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C6F04D" stopOpacity={0.14} />
                <stop offset="100%" stopColor="#C6F04D" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradPaper" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3EE6D8" stopOpacity={0.1} />
                <stop offset="100%" stopColor="#3EE6D8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid horizontal vertical={false} stroke="#232E3B" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              interval={interval}
              tick={{ fill: "#5B6875", fontSize: 10.5, fontFamily: "Inter" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, "auto"]}
              tick={{ fill: "#5B6875", fontSize: 10.5, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => compact(v)}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "#33414F", strokeDasharray: "3 3" }}
            />
            <Area
              type="monotone"
              dataKey="paper"
              name="Paper (ordered)"
              stroke="#3EE6D8"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              fill="url(#gradPaper)"
            />
            <Area
              type="monotone"
              dataKey="cash"
              name="Cash (delivered)"
              stroke="#C6F04D"
              strokeWidth={2}
              fill="url(#gradCash)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
}

// ─── P&L table (day / week / month columns) ──────────────────────────────────

interface PnLRow {
  key: string;
  label: string;
  hint?: string;
  value: (t: PnLTotals) => number;
  /** Render as a subtraction (shows a leading minus). */
  cost?: boolean;
  strong?: boolean;
}

const PNL_ROWS: PnLRow[] = [
  { key: "cashRev", label: "Cash revenue", hint: "delivered only", value: (t) => t.cashRev },
  { key: "paperRev", label: "Paper revenue", hint: "ordered value", value: (t) => t.paperRev },
  { key: "cogs", label: "COGS", hint: "known-cost lines", value: (t) => t.cogs, cost: true },
  { key: "ads", label: "Ads spend", hint: "Meta, spread daily", value: (t) => t.ads, cost: true },
  { key: "deliveryNet", label: "Delivery net", hint: "+1,000 per delivered order", value: (t) => t.deliveryNet },
  { key: "dailyExpenses", label: "Daily expenses", hint: "شحن تركيا + other", value: (t) => t.dailyExpenses, cost: true },
  { key: "proratedFixed", label: "Fixed overhead", hint: "monthly ÷ 30", value: (t) => t.proratedFixed, cost: true },
  { key: "netCash", label: "NET CASH", value: (t) => t.netCash, strong: true },
];

function PnLTable({ fin }: { fin: FinanceResult }) {
  const n7 = Math.min(7, fin.days.length);
  const n30 = Math.min(30, fin.days.length);
  const cols = [
    { label: "Today", totals: sumDays(fin.days.slice(-1)) },
    { label: `Last ${n7} days`, totals: sumDays(fin.days.slice(-n7)) },
    { label: `Last ${n30} days`, totals: sumDays(fin.days.slice(-n30)) },
  ];
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.24, ease: EASE }}
      className="mt-4"
    >
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">P&amp;L</h2>
        <p className="text-[11.5px] text-text-muted">
          revenue → COGS → ads → delivery → expenses → net
        </p>
      </div>
      <div className="overflow-auto rounded-xl border border-hairline bg-panel">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">
                Line
              </th>
              {cols.map((c) => (
                <th
                  key={c.label}
                  className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PNL_ROWS.map((row) => (
              <tr
                key={row.key}
                className={cn(
                  "h-12 border-t border-hairline",
                  row.strong && "bg-inset/60"
                )}
              >
                <td className="px-4 py-2">
                  <span
                    className={cn(
                      "block text-[13px]",
                      row.strong
                        ? "font-display font-semibold text-text-primary"
                        : "font-medium text-text-secondary"
                    )}
                  >
                    {row.label}
                  </span>
                  {row.hint && (
                    <span className="block text-[10.5px] text-text-muted">{row.hint}</span>
                  )}
                </td>
                {cols.map((c) => {
                  const v = row.value(c.totals);
                  const color = row.strong ? (v >= 0 ? POS : NEG) : undefined;
                  const prefix =
                    v < 0 || (row.cost && v > 0)
                      ? "−"
                      : row.key === "deliveryNet" && v > 0
                        ? "+"
                        : "";
                  return (
                    <td
                      key={c.label}
                      className={cn(
                        "px-4 py-2 text-right font-mono text-[13px] tnum",
                        row.strong ? "font-semibold" : "font-medium",
                        row.key === "paperRev" && "opacity-60"
                      )}
                      style={color ? { color } : undefined}
                    >
                      {prefix}
                      {fmtMoney(Math.abs(v))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
}

// ─── Per-channel breakdown ───────────────────────────────────────────────────

type ChannelRow = FinanceResult["channels"][number] & Record<string, unknown>;

function ChannelTable({ fin }: { fin: FinanceResult }) {
  const columns = useMemo<Column<ChannelRow>[]>(
    () => [
      {
        key: "channel",
        header: "Channel",
        sortable: true,
        sortValue: (r) => r.channel,
        render: (r) => (
          <span className="text-[13px] font-semibold text-text-primary">{r.channel}</span>
        ),
      },
      {
        key: "orders",
        header: "Orders",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.ordersPlaced,
        render: (r) => (
          <span className="block">
            <span className="block font-semibold text-text-primary">{r.deliveredOrders}</span>
            <span className="block text-[10.5px] text-text-muted">
              {r.ordersPlaced} placed
            </span>
          </span>
        ),
      },
      {
        key: "cashRev",
        header: "Cash rev",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.cashRev,
        render: (r) => (
          <span className="block">
            <span className="block font-semibold text-text-primary">{fmtMoney(r.cashRev)}</span>
            <span className="block text-[10.5px] text-text-muted">
              paper {fmtMoney(r.paperRev)}
            </span>
          </span>
        ),
      },
      {
        key: "cogs",
        header: "COGS",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.cogs,
        render: (r) => <span className="text-text-secondary">{fmtMoney(r.cogs)}</span>,
      },
      {
        key: "ads",
        header: "Ads (allocated)",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.ads,
        render: (r) =>
          r.ads > 0 ? (
            <span className="text-text-secondary" title="Pro-rata by cash revenue share">
              {fmtMoney(Math.round(r.ads))}
            </span>
          ) : (
            <span className="text-text-muted">—</span>
          ),
      },
      {
        key: "deliveryNet",
        header: "Delivery net",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.deliveryNet,
        render: (r) => <span className="text-pos">{fmtMoney(r.deliveryNet)}</span>,
      },
      {
        key: "netCash",
        header: "Net",
        numeric: true,
        sortable: true,
        sortValue: (r) => r.netCash,
        render: (r) => (
          <span className="font-semibold" style={{ color: r.netCash >= 0 ? POS : NEG }}>
            {fmtMoney(r.netCash)}
          </span>
        ),
      },
    ],
    []
  );
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3, ease: EASE }}
      className="mt-4"
    >
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Per-channel P&amp;L
        </h2>
        <p className="text-[11.5px] text-text-muted">
          ads attributed pro-rata by cash revenue · fixed/daily expenses excluded
        </p>
      </div>
      <DataTable<ChannelRow>
        columns={columns}
        rows={fin.channels as ChannelRow[]}
        rowKey={(r) => r.channel}
        defaultSortKey="cashRev"
        defaultSortDir="desc"
        emptyState={
          <EmptyState
            className="border-0"
            title="No channel data"
            message="Orders in this window carry no source labels yet."
          />
        }
      />
    </motion.section>
  );
}

// ─── Expenses panel ──────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-hairline bg-inset px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:border-bright focus:outline-none";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted";

function todayKey(): string {
  const d = new Date();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function currentMonth(): string {
  return todayKey().slice(0, 7);
}

function parseAmount(raw: string): number {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function DailyExpenseForm() {
  const [date, setDate] = useState(todayKey());
  const [kind, setKind] = useState<DailyExpenseKind>("turkey_shipping");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const submit = () => {
    const amountIQD = parseAmount(amount);
    if (!amountIQD || !date) return;
    addDailyExpense({ date, kind, amountIQD, note: note.trim() });
    setAmount("");
    setNote("");
  };

  return (
    <div className="rounded-xl border border-hairline bg-panel p-5">
      <h3 className="font-display text-[14px] font-semibold text-text-primary">
        Add daily expense
      </h3>
      <p className="mt-0.5 text-[11.5px] text-text-muted">
        Cash out the door today — شحن تركيا cargo, or anything else
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls} htmlFor="exp-date">Date</label>
          <input
            id="exp-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={cn(inputCls, "tnum")}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="exp-kind">Kind</label>
          <select
            id="exp-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as DailyExpenseKind)}
            className={inputCls}
          >
            {(Object.keys(DAILY_KIND_META) as DailyExpenseKind[]).map((k) => (
              <option key={k} value={k}>
                {DAILY_KIND_META[k].label}
                {DAILY_KIND_META[k].arabic ? ` (${DAILY_KIND_META[k].arabic})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="exp-amount">Amount (IQD)</label>
          <input
            id="exp-amount"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="e.g. 250000"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cn(inputCls, "font-mono tnum")}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="exp-note">Note</label>
          <input
            id="exp-note"
            type="text"
            placeholder="optional"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={submit}
        disabled={!parseAmount(amount)}
        className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-lime px-3.5 text-[13px] font-semibold text-abyss transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus className="h-4 w-4" />
        Add entry
      </motion.button>
    </div>
  );
}

function MonthlyExpenseForm() {
  const [month, setMonth] = useState(currentMonth());
  const [salaries, setSalaries] = useState("");
  const [rent, setRent] = useState("");
  const [other, setOther] = useState("");
  const [saved, setSaved] = useState(false);
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null);

  // Adjust state during render when the month changes (React-sanctioned
  // alternative to setState-in-effect).
  if (loadedMonth !== month) {
    const m = monthlyExpenseFor(month);
    setLoadedMonth(month);
    setSalaries(m.salariesIQD ? String(m.salariesIQD) : "");
    setRent(m.rentIQD ? String(m.rentIQD) : "");
    setOther(m.otherMonthlyIQD ? String(m.otherMonthlyIQD) : "");
    setSaved(false);
  }

  const submit = () => {
    upsertMonthlyExpense({
      month,
      salariesIQD: parseAmount(salaries),
      rentIQD: parseAmount(rent),
      otherMonthlyIQD: parseAmount(other),
    });
    setSaved(true);
  };

  return (
    <div className="rounded-xl border border-hairline bg-panel p-5">
      <h3 className="font-display text-[14px] font-semibold text-text-primary">
        Monthly overhead
      </h3>
      <p className="mt-0.5 text-[11.5px] text-text-muted">
        Salaries + rent + other — prorated at total ÷ 30 per day
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelCls} htmlFor="exp-month">Month</label>
          <input
            id="exp-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value || currentMonth())}
            className={cn(inputCls, "tnum")}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="exp-salaries">Salaries (IQD)</label>
          <input
            id="exp-salaries"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="0"
            value={salaries}
            onChange={(e) => setSalaries(e.target.value)}
            className={cn(inputCls, "font-mono tnum")}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="exp-rent">Rent (IQD)</label>
          <input
            id="exp-rent"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="1380000"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            className={cn(inputCls, "font-mono tnum")}
          />
          <p className="mt-1 text-[10.5px] text-text-muted">
            default: 1,000 USD × 1,380 = 1,380,000 IQD
          </p>
        </div>
        <div className="col-span-2">
          <label className={labelCls} htmlFor="exp-otherm">Other monthly (IQD)</label>
          <input
            id="exp-otherm"
            type="number"
            min={0}
            inputMode="numeric"
            placeholder="0"
            value={other}
            onChange={(e) => setOther(e.target.value)}
            className={cn(inputCls, "font-mono tnum")}
          />
        </div>
      </div>
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={submit}
        className="mt-4 flex h-9 items-center gap-2 rounded-lg border border-hairline bg-panel px-3.5 text-[13px] font-semibold text-text-secondary transition-colors hover:border-bright hover:text-text-primary"
      >
        {saved ? "Saved ✓" : "Save month"}
      </motion.button>
    </div>
  );
}

function RecentExpenses() {
  const expenses = useExpenses();
  const recent = useMemo(
    () =>
      [...expenses.daily]
        .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)))
        .slice(0, 8),
    [expenses.daily]
  );
  return (
    <div className="rounded-xl border border-hairline bg-panel p-5">
      <h3 className="font-display text-[14px] font-semibold text-text-primary">
        Recent daily entries
      </h3>
      {recent.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-text-muted">
          No entries yet — add a شحن تركيا payment or other cash-out above.
        </p>
      ) : (
        <div className="mt-2 divide-y divide-hairline">
          {recent.map((e) => (
            <div key={e.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-text-primary">
                  {DAILY_KIND_META[e.kind].label}
                  {DAILY_KIND_META[e.kind].arabic && (
                    <span className="ml-1.5 text-[11px] font-medium text-text-muted">
                      {DAILY_KIND_META[e.kind].arabic}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11.5px] text-text-muted">
                  {e.date}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
              </span>
              <span className="font-mono text-[13px] font-semibold text-rose tnum">
                −{fmtMoney(e.amountIQD)}
              </span>
              <button
                onClick={() => removeDailyExpense(e.id)}
                className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-panel-hover hover:text-rose"
                title="Delete entry"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExpensesPanel() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.36, ease: EASE }}
      className="mt-4"
    >
      <div className="mb-2 flex items-baseline gap-2 px-1">
        <h2 className="font-display text-[15px] font-semibold text-text-primary">Expenses</h2>
        <p className="text-[11.5px] text-text-muted">
          stored locally in this browser · feeds the daily P&amp;L above
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DailyExpenseForm />
        <MonthlyExpenseForm />
        <RecentExpenses />
      </div>
    </motion.section>
  );
}

// ─── Unit economics ──────────────────────────────────────────────────────────

function UnitEconomicsCard({ fin }: { fin: FinanceResult }) {
  const u = fin.unitEconomics;
  const rows = [
    { label: "Avg order price", value: u.revenuePerOrder, color: "#E9EFF5" },
    { label: "Product cost", value: -u.cogsPerOrder, color: NEG },
    { label: "Ads per order", value: -u.adsPerOrder, color: NEG },
    { label: "Delivery margin", value: u.deliveryPerOrder, color: POS },
    { label: "Expenses share", value: -u.expensesPerOrder, color: NEG },
  ];
  const max = Math.max(u.revenuePerOrder, 1);
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.42, ease: EASE }}
      className="mt-4 rounded-xl border border-hairline bg-panel p-5"
    >
      <div className="flex items-center gap-3">
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            Per delivered order
          </h2>
          <p className="text-[11.5px] text-text-muted">
            {u.deliveredOrders} delivered orders in window · reference net ≈ 25,000 IQD
          </p>
        </div>
        <span
          className="ml-auto rounded-full border px-2.5 py-1 font-mono text-[12px] font-bold tnum"
          style={{
            color: u.netPerOrder >= 0 ? POS : NEG,
            borderColor: `${u.netPerOrder >= 0 ? POS : NEG}40`,
            backgroundColor: `${u.netPerOrder >= 0 ? POS : NEG}14`,
          }}
        >
          {fmtMoney(Math.round(u.netPerOrder))} net / order
        </span>
      </div>
      <div className="mt-4 flex flex-col gap-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-32 shrink-0 text-[12px] text-text-secondary">{r.label}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-inset">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (Math.abs(r.value) / max) * 100)}%`,
                  backgroundColor: r.color,
                  opacity: 0.8,
                }}
              />
            </div>
            <span
              className="w-24 shrink-0 text-right font-mono text-[12.5px] font-semibold tnum"
              style={{ color: r.color }}
            >
              {r.value < 0 ? "−" : "+"}
              {fmtMoney(Math.abs(Math.round(r.value)))}
            </span>
          </div>
        ))}
        <div className="mt-1 flex items-center gap-3 border-t border-hairline pt-2.5">
          <span className="w-32 shrink-0 font-display text-[13px] font-semibold text-text-primary">
            Net per order
          </span>
          <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-inset">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (Math.abs(u.netPerOrder) / max) * 100)}%`,
                backgroundColor: u.netPerOrder >= 0 ? "#C6F04D" : NEG,
              }}
            />
          </div>
          <span
            className="w-24 shrink-0 text-right font-mono text-[13px] font-bold tnum"
            style={{ color: u.netPerOrder >= 0 ? "#C6F04D" : NEG }}
          >
            {u.netPerOrder < 0 ? "−" : "+"}
            {fmtMoney(Math.abs(Math.round(u.netPerOrder)))}
          </span>
        </div>
      </div>
    </motion.section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Finance() {
  const ops = useOpsData();
  const windowDays = useWindowDays();
  const expenses = useExpenses();
  const ads = useAdsForWindow(windowDays);
  const [chartRange, setChartRange] = useState<"30" | "90">("30");

  // This page is IQD-denominated even when the rest of the app is in mock USD.
  useEffect(() => {
    setCurrency(ops?.currency ?? "IQD");
  }, [ops]);

  const adsIQD = ads.data?.summary.totalSpentIQD ?? 0;

  const fin = useMemo(
    () =>
      ops
        ? computeFinance(
            ops.ordersDetail,
            ops.stockDetail,
            expenses.daily,
            expenses.monthly,
            adsIQD,
            windowDays
          )
        : null,
    [ops, expenses, adsIQD, windowDays]
  );

  const chartFin = useMemo(
    () =>
      ops
        ? computeFinance(
            ops.ordersDetail,
            ops.stockDetail,
            expenses.daily,
            expenses.monthly,
            0,
            chartRange === "90" ? 90 : 30
          )
        : null,
    [ops, expenses, chartRange]
  );

  const today = fin ? sumDays(fin.days.slice(-1)) : null;
  const last7 = fin ? sumDays(fin.days.slice(-Math.min(7, fin.days.length))) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <PageHeader syncedAt={ops?.syncedAt ?? null} pending={!ops} />

      {ads.offline && ops && (
        <div className="mb-6 flex items-center gap-2.5 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3 text-[13px] font-semibold text-amber">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>Meta ads offline — ad spend is excluded from the figures below.</span>
        </div>
      )}

      <KpiRow fin={fin} today={today} last7={last7} />

      {fin && chartFin ? (
        <>
          <CashPaperChart fin={chartFin} range={chartRange} onRange={setChartRange} />
          <PnLTable fin={fin} />
          <ChannelTable fin={fin} />
          <UnitEconomicsCard fin={fin} />
        </>
      ) : (
        <EmptyState
          className="mt-4"
          icon={CloudOff}
          title="Sync pending"
          message="The Odoo ops sync hasn't landed yet (no ordersDetail / stockDetail in live.json). Cash, COGS and channel figures appear once it does — expenses below already work."
        />
      )}

      <ExpensesPanel />
    </motion.div>
  );
}
