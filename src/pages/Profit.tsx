/**
 * Real Profit — net profit after every cost, from the sources that are
 * reliable for each line (see src/data/profitEngine.ts for the rules).
 *
 * Projected mode values orders that are still out for delivery at the keep
 * rate of finished orders; Realized mode counts delivered goods only.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Info } from "lucide-react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useOpsData } from "@/data/opsData";
import { useProfitData } from "@/data/profitData";
import { computeExperiment } from "@/data/experimentEngine";
import BudgetExperiment from "@/sections/profit/BudgetExperiment";
import ModelScout from "@/sections/profit/ModelScout";
import { computeScout } from "@/data/modelScout";
import {
  RULES,
  buildProfitModel,
  dayTotals,
  monthRows,
  periodDays,
  sumDays,
  type FixedGroup,
  type Mode,
  type MonthRow,
  type PeriodKey,
  type ProfitModel,
  type Totals,
} from "@/data/profitEngine";
import FilterPills from "@/components/FilterPills";
import EmptyState from "@/components/EmptyState";
import { compact } from "@/lib/money";
import { cn } from "@/lib/utils";

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const FIXED_LABEL: Record<FixedGroup, string> = {
  salaries: "Salaries",
  turkey: "Turkey expenses (agent)",
  shipping: "Cargo / shipping",
  rent: "Rent",
  other: "Other expenses",
};

/** Signed compact IQD: 12,400,000 → "12.4M", −850,000 → "−850,000". */
function iqd(n: number): string {
  const s = compact(Math.abs(n));
  return n < 0 ? `−${s}` : s;
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function monthLabel(m: string): string {
  const d = new Date(`${m}-01T12:00:00`);
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function shortDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header({
  mode,
  onMode,
  period,
  onPeriod,
}: {
  mode: Mode;
  onMode: (m: Mode) => void;
  period: PeriodKey;
  onPeriod: (p: PeriodKey) => void;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-lime/80">
          After every cost · IQD
        </p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="mt-1 font-display text-[28px] font-semibold tracking-[-0.5px] text-text-primary"
        >
          Real Profit
        </motion.h1>
        <p className="mt-1 text-[13.5px] text-text-secondary">
          Delivered goods, Meta spend at the card rate, Odoo salaries &amp; expenses, rent
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <FilterPills
          layoutId="profit-mode"
          options={[
            { value: "projected", label: "Projected" },
            { value: "realized", label: "Shipped so far" },
          ]}
          value={mode}
          onChange={(v) => onMode(v === "realized" ? "realized" : "projected")}
        />
        <FilterPills
          layoutId="profit-period"
          options={[
            { value: "this-month", label: "This month" },
            { value: "last-month", label: "Last month" },
            { value: "30d", label: "30 days" },
            { value: "90d", label: "90 days" },
          ]}
          value={period}
          onChange={(v) => onPeriod(v as PeriodKey)}
        />
      </div>
    </div>
  );
}

// ─── KPI row ─────────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "pos" | "neg" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-hairline bg-panel p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">{label}</p>
      <p
        className={cn(
          "mt-2 font-mono text-[30px] font-semibold tracking-[-0.5px] tnum",
          tone === "pos" && "text-pos",
          tone === "neg" && "text-neg",
          tone === "neutral" && "text-text-primary"
        )}
      >
        {value}
      </p>
      <p className="mt-1 text-[12px] text-text-secondary">{sub}</p>
    </div>
  );
}

function KpiRow({ t }: { t: Totals }) {
  const perDay = (n: number) => `${iqd(n / Math.max(1, t.days))} / day`;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
      <Kpi
        label="Net profit"
        value={iqd(t.net)}
        sub={`${perDay(t.net)} · after fixed costs`}
        tone={t.net >= 0 ? "pos" : "neg"}
      />
      <Kpi
        label="Before fixed costs"
        value={iqd(t.contribution)}
        sub={`gross margin + delivery − ads · ${perDay(t.contribution)}`}
        tone={t.contribution >= 0 ? "pos" : "neg"}
      />
      <Kpi label="Fixed costs" value={iqd(t.fixedTotal)} sub={perDay(t.fixedTotal)} />
      <Kpi
        label="Meta ads"
        value={iqd(t.ads)}
        sub={`${usd(t.adsUSD)} · ${usd(t.adsUSD / Math.max(1, t.days))} / day`}
      />
    </div>
  );
}

// ─── P&L ladder ──────────────────────────────────────────────────────────────

function Ladder({ t, model }: { t: Totals; model: ProfitModel }) {
  const rows: { label: string; value: number; note?: string; strong?: boolean }[] = [
    { label: "Revenue — Turkey orders", value: t.trRev },
    { label: "Revenue — stock clearance", value: t.stRev },
    { label: "Goods cost", value: -t.cogs },
    {
      label: "Gross margin — Turkey",
      value: t.trGross,
      note: t.trRev > 0 ? `${Math.round((t.trGross / t.trRev) * 100)}% of revenue` : undefined,
    },
    {
      label: "Gross margin — stock",
      value: t.stGross,
      note: t.stRev > 0 ? `${Math.round((t.stGross / t.stRev) * 100)}% of revenue` : undefined,
    },
    { label: "Delivery (+1,000 / delivered order)", value: t.delivery },
    { label: "Meta ads", value: -t.ads },
    { label: "= Before fixed costs", value: t.contribution, strong: true },
    ...(["salaries", "turkey", "shipping", "rent", "other"] as FixedGroup[]).map((g) => ({
      label: FIXED_LABEL[g],
      value: -t.fixed[g],
    })),
    { label: "= Net profit", value: t.net, strong: true },
  ];
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  const otherAccounts = Object.entries(model.otherByAccount).filter(([, v]) => Math.abs(v) > 0);

  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Where the money goes</h2>
      <p className="text-[11.5px] text-text-muted">
        {t.deliveredOrders.toFixed(0)} orders kept (est.) of {t.ordersPlaced} placed
        {t.projectedRev > 0 && ` · ${iqd(t.projectedRev)} of revenue projected from orders not yet shipped`}
        {t.expectedReturnsRev > 0 && ` · ${iqd(t.expectedReturnsRev)} of shipped revenue still expected to come back as returns`}
      </p>
      <div className="mt-4 space-y-1.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className={cn(
              "grid grid-cols-[minmax(150px,1.2fr)_2fr_auto] items-center gap-3 rounded-md px-2 py-1.5",
              r.strong && "bg-inset"
            )}
          >
            <span
              className={cn(
                "truncate text-[13px]",
                r.strong ? "font-semibold text-text-primary" : "text-text-secondary"
              )}
            >
              {r.label}
              {r.note && <span className="ml-2 text-[11px] text-text-muted">{r.note}</span>}
            </span>
            <div className="h-2 overflow-hidden rounded-full bg-inset">
              <div
                className={cn("h-full rounded-full", r.value >= 0 ? "bg-pos/70" : "bg-neg/70")}
                style={{ width: `${(Math.abs(r.value) / max) * 100}%` }}
              />
            </div>
            <span
              className={cn(
                "min-w-[88px] text-right font-mono text-[13px] tnum",
                r.value < 0 ? "text-neg" : r.strong ? "text-pos" : "text-text-primary"
              )}
            >
              {iqd(r.value)}
            </span>
          </div>
        ))}
      </div>
      {otherAccounts.length > 0 && (
        <p className="mt-3 text-[11px] text-text-muted">
          Other expenses since {RULES.since}:{" "}
          {otherAccounts
            .slice(0, 5)
            .map(([k, v]) => `${k} ${iqd(v)}`)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}

// ─── Daily chart ─────────────────────────────────────────────────────────────

function DailyChart({ model, mode }: { model: ProfitModel; mode: Mode }) {
  const data = model.days.slice(-60).map((d) => {
    const t = dayTotals(d, model.keep, mode);
    return {
      date: d.date,
      label: shortDay(d.date),
      net: Math.round(t.net),
      contribution: Math.round(t.contribution),
      fixed: Math.round(t.fixedTotal),
      mature: d.mature,
    };
  });
  const firstYoung = data.find((d) => !d.mature)?.label;
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Daily net profit · last 60 days</h2>
      <p className="text-[11.5px] text-text-muted">
        Bars = net after fixed costs (by order date) · line = before fixed costs. Faded bars are orders still
        being delivered{mode === "realized" ? " — Shipped mode counts parcels handed to the courier; refusals that haven't come back yet are still inside" : ""}.
      </p>
      <div className="mt-3 h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid horizontal vertical={false} stroke="#232E3B" strokeDasharray="4 4" />
            <XAxis
              dataKey="label"
              interval={Math.max(1, Math.ceil(data.length / 10) - 1)}
              tick={{ fill: "#5B6875", fontSize: 10.5 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => iqd(v)}
              tick={{ fill: "#5B6875", fontSize: 10.5, fontFamily: "JetBrains Mono" }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <ReferenceLine y={0} stroke="#33414F" />
            {firstYoung && <ReferenceLine x={firstYoung} stroke="#FBBF24" strokeDasharray="3 3" />}
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
              contentStyle={{ background: "#10161E", border: "1px solid #33414F", borderRadius: 8 }}
              labelStyle={{ color: "#E9EFF5" }}
              formatter={(v: number, name: string) => [
                `${iqd(v)} IQD`,
                name === "net" ? "Net" : name === "contribution" ? "Before fixed" : name,
              ]}
            />
            <Bar dataKey="net" radius={[3, 3, 0, 0]}>
              {data.map((d) => (
                <Cell
                  key={d.date}
                  fill={d.net >= 0 ? "#4ADE80" : "#FB5D7A"}
                  fillOpacity={d.mature ? 0.75 : 0.3}
                />
              ))}
            </Bar>
            <Line dataKey="contribution" stroke="#C6F04D" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ─── Monthly table ───────────────────────────────────────────────────────────

function MonthlyTable({ rows }: { rows: MonthRow[] }) {
  const head = "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[1.1px] text-text-muted";
  const num = "px-3 py-2 text-right font-mono text-[13px] tnum";
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">By month</h2>
      <p className="text-[11.5px] text-text-muted">
        "Odoo net" is what Odoo&apos;s own accounts say. Most of the gap is goods cost: returned items are not
        taken out of COGS in Odoo ("COGS gap" column). Odoo books by invoice date, this page by order date, so
        a month can differ by a few days of sales. Meta bills stopped being posted in Odoo after 8 Sep 2026, so
        Odoo net leaves out ad spend from then on.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="border-b border-hairline">
              <th className={cn(head, "text-left")}>Month</th>
              <th className={cn(head, "text-right")}>Revenue</th>
              <th className={cn(head, "text-right")}>Gross margin</th>
              <th className={cn(head, "text-right")}>Ads</th>
              <th className={cn(head, "text-right")}>Before fixed</th>
              <th className={cn(head, "text-right")}>Fixed</th>
              <th className={cn(head, "text-right")}>Net profit</th>
              <th className={cn(head, "text-right")}>Odoo net</th>
              <th className={cn(head, "text-right")}>COGS gap</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = r.totals;
              return (
                <tr key={r.month} className="border-b border-hairline/60">
                  <td className="px-3 py-2 text-[13px] text-text-primary">
                    {monthLabel(r.month)}
                    {!r.complete && <span className="ml-2 text-[11px] text-amber">running</span>}
                  </td>
                  <td className={num}>{iqd(t.revenue)}</td>
                  <td className={num}>{iqd(t.trGross + t.stGross)}</td>
                  <td className={cn(num, "text-neg")}>{iqd(-t.ads)}</td>
                  <td className={num}>{iqd(t.contribution)}</td>
                  <td className={cn(num, "text-neg")}>{iqd(-t.fixedTotal)}</td>
                  <td className={cn(num, "font-semibold", t.net >= 0 ? "text-pos" : "text-neg")}>
                    {iqd(t.net)}
                  </td>
                  <td className={cn(num, "text-text-secondary")}>{r.odooNet == null ? "—" : iqd(r.odooNet)}</td>
                  <td className={cn(num, "text-text-secondary")}>{r.cogsGap == null ? "—" : iqd(r.cogsGap)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Notes & data health ─────────────────────────────────────────────────────

function Notes({ t, model }: { t: Totals; model: ProfitModel }) {
  const h = model.health;
  const warnings: string[] = [];
  if (h.odooError)
    warnings.push(
      `Odoo expenses: ${h.odooError}${h.odooStale ? " — showing the last good sync" : " — fixed costs exclude Odoo"}`
    );
  if (h.metaError)
    warnings.push(`Meta spend: ${h.metaError}${h.metaStale ? " — showing the last good sync" : " — ads are missing"}`);
  if (t.revenue > 0 && t.estCogs / Math.max(1, t.cogs) > 0.05)
    warnings.push(
      `${Math.round((t.estCogs / t.cogs) * 100)}% of goods cost is estimated (products with no usable cost in Odoo)`
    );

  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Notes</h2>
      {warnings.length > 0 && (
        <ul className="mt-3 space-y-2">
          {warnings.map((w) => (
            <li key={w} className="flex gap-2 text-[12.5px] text-amber">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 rounded-lg bg-inset p-3">
        <p className="text-[11px] font-semibold uppercase tracking-[1.1px] text-text-muted">
          Debt repayments (ابو سلطان)
        </p>
        <p className="mt-1 font-mono text-[18px] text-text-primary tnum">{iqd(t.drawings)}</p>
        <p className="text-[11.5px] text-text-muted">Cash out in this period — not an expense, not in profit</p>
      </div>
      <ul className="mt-3 space-y-1.5 text-[12px] text-text-secondary">
        {[
          `Keep rate of finished orders: Turkey ${Math.round(model.keep.turkey * 100)}% · stock ${Math.round(
            model.keep.stock * 100
          )}% of ordered value`,
          "Goods cost from delivered lines × Odoo average cost — not from Odoo's COGS account",
          "Ads: Meta daily spend × 1,380 IQD until 5 Oct 2026, × 1,600 from 6 Oct",
          "Fixed costs spread evenly over each month; the running month uses the recent monthly rate until posted",
          "Rent 1,700,000 IQD / month (not booked in Odoo)",
          `Orders older than ${RULES.matureAfterDays} days are final. Odoo marks an order delivered when it goes to the courier; projected mode removes the refusals still expected to come back`,
          h.syncedAt ? `Expenses & Meta synced ${new Date(h.syncedAt).toLocaleString("en-GB")}` : "Waiting for first sync",
        ].map((n) => (
          <li key={n} className="flex gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
            {n}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Profit() {
  const ops = useOpsData();
  const profit = useProfitData();
  const [mode, setMode] = useState<Mode>("projected");
  const [period, setPeriod] = useState<PeriodKey>("this-month");

  const model = useMemo(
    () =>
      ops && profit !== undefined ? buildProfitModel(ops.ordersDetail, ops.stockDetail, profit) : null,
    [ops, profit]
  );
  const totals = useMemo(
    () => (model ? sumDays(periodDays(model, period), model.keep, mode) : null),
    [model, period, mode]
  );
  const months = useMemo(() => (model ? monthRows(model, mode) : []), [model, mode]);
  type Tab = "profit" | "experiment" | "models";
  const tabFromHash = (h: string): Tab => (h === "#experiment" ? "experiment" : h === "#models" ? "models" : "profit");
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return tabFromHash(window.location.hash);
    } catch {
      return "profit";
    }
  });
  const experiment = useMemo(
    () => (model && ops ? computeExperiment(model, ops.ordersDetail, profit ?? null) : null),
    [model, ops, profit]
  );
  const scout = useMemo(
    () => (model && ops ? computeScout(ops.ordersDetail, ops.stockDetail, profit ?? null, model.today) : null),
    [model, ops, profit]
  );

  return (
    <div>
      <div className="mb-4">
        <FilterPills
          layoutId="profit-tab"
          options={[
            { value: "profit", label: "Profit" },
            { value: "experiment", label: "Budget experiment" },
            { value: "models", label: "Ad models" },
          ]}
          value={tab}
          onChange={(v) => {
            const next = tabFromHash(`#${v}`);
            setTab(next);
            try {
              window.history.replaceState(null, "", next === "profit" ? "#" : `#${next}`);
            } catch {
              /* ignore */
            }
          }}
        />
      </div>
      {tab === "models" ? (
        scout ? (
          <ModelScout r={scout} />
        ) : (
          <EmptyState title="Loading" message="Waiting for the Odoo sync data…" />
        )
      ) : tab === "experiment" ? (
        experiment ? (
          <BudgetExperiment r={experiment} />
        ) : (
          <EmptyState title="Loading" message="Waiting for the Odoo sync data…" />
        )
      ) : (
      <>
      <Header mode={mode} onMode={setMode} period={period} onPeriod={setPeriod} />
      {!model || !totals ? (
        <EmptyState title="Loading" message="Waiting for the Odoo sync data…" />
      ) : (
        <div className="space-y-4">
          <KpiRow t={totals} />
          <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
            <Ladder t={totals} model={model} />
            <Notes t={totals} model={model} />
          </div>
          <DailyChart model={model} mode={mode} />
          <MonthlyTable rows={months} />
        </div>
      )}
      </>
      )}
    </div>
  );
}
