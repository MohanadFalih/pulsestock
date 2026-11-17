/**
 * Resale ladder monitor (إعادة البيع).
 *
 * Three questions, in the order the owner asks them every morning:
 *   1. Does the ad price match Odoo? (sheet vs «تصفية» pricelist)
 *   2. How many pieces sit at each step, and how many wait for approval?
 *   3. Is each step earning its place? (14-day sell-through, days to sale)
 *
 * Data: public/data/resale.json (scripts/resale_sync.py).
 */

import { useMemo } from "react";
import { CircleCheck, TriangleAlert } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EmptyState } from "@/components/EmptyState";
import { STEP_LABEL, useResaleData, type ResalePayload } from "@/data/resaleData";
import { cn } from "@/lib/utils";

const STEPS = ["0", "1", "2", "3", "4"];
const STEP_COLOR = ["#93A1B0", "#C6F36B", "#4ADE80", "#FBBF24", "#FB923C"];
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

function Header({ data }: { data: ResalePayload }) {
  const when = new Date(data.syncedAt).toLocaleString("en-GB", {
    timeZone: "Asia/Baghdad",
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
  return (
    <div className="mb-6">
      <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-lime/80">Clearance</p>
      <h1 className="mt-1 font-display text-[28px] font-semibold tracking-[-0.5px] text-text-primary">
        Resale ladder
      </h1>
      <p className="mt-1 text-[13.5px] text-text-secondary">
        Full price → cost + 15k → cost + 3k → 80% of cost → 60% of cost (min 25,000), 14 days per step.
        Synced {when}.
      </p>
    </div>
  );
}

function PriceCheck({ data }: { data: ResalePayload }) {
  const pc = data.priceCheck;
  const ok = pc.mismatchCount === 0;
  return (
    <section
      className={cn(
        "mb-6 rounded-xl border p-5",
        ok ? "border-hairline bg-panel" : "border-rose/50 bg-rose/5",
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        {ok ? (
          <CircleCheck className="h-5 w-5 text-pos" />
        ) : (
          <TriangleAlert className="h-5 w-5 text-rose" />
        )}
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Ad price vs Odoo «تصفية»
        </h2>
        <span className="font-mono text-[13px] text-text-secondary tnum">
          {fmt(pc.mismatchCount)} mismatched of {fmt(pc.checked)} in-stock sheet rows
        </span>
        {pc.tasfiyaIntegrated !== null && (
          <span className="rounded-md bg-inset px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.8px] text-text-muted">
            merge {pc.tasfiyaIntegrated ? "on" : "off"}
          </span>
        )}
      </div>
      <p className="mt-1 text-[12px] text-text-muted">
        A row matches when any in-stock variant of its model gets the ad price on the «تصفية» list (±500).
        {pc.note ? ` ${pc.note}.` : ""}
      </p>
      {!ok && (
        <div className="mt-4 max-h-[340px] overflow-auto rounded-lg border border-hairline bg-panel">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-panel shadow-[0_1px_0_0_#232E3B]">
              <tr className="text-[11px] uppercase tracking-[1px] text-text-muted">
                <th className="px-4 py-2">Sheet row</th>
                <th className="px-4 py-2 text-right">Ad price</th>
                <th className="px-4 py-2 text-right">Odoo «تصفية»</th>
                <th className="px-4 py-2 text-right">Gap</th>
                <th className="px-4 py-2 text-right">Pieces</th>
              </tr>
            </thead>
            <tbody>
              {pc.mismatches.map((m) => (
                <tr key={`${m.feed}-${m.code}`} className="border-t border-hairline">
                  <td className="px-4 py-1.5 text-[13px] text-text-primary">
                    {m.feed ?? m.code}
                    <span className="ml-2 text-[11px] text-text-muted">{m.kind}</span>
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-[13px] text-text-secondary tnum">
                    {fmt(m.adPrice)}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-[13px] text-text-secondary tnum">
                    {fmt(m.odooPrice)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-1.5 text-right font-mono text-[13px] font-semibold tnum",
                      m.odooPrice > m.adPrice ? "text-rose" : "text-amber",
                    )}
                  >
                    {m.odooPrice > m.adPrice ? "+" : ""}
                    {fmt(m.odooPrice - m.adPrice)}
                  </td>
                  <td className="px-4 py-1.5 text-right font-mono text-[13px] text-text-secondary tnum">
                    {m.qty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Queue({ data }: { data: ResalePayload }) {
  const s = data.byState;
  const costIssues = data.items.filter((i) => i.costIssue).length;
  const tiles = [
    { label: "Waiting approval", v: s.suggested?.lines ?? 0, sub: `${fmt(s.suggested?.pieces ?? 0)} pieces`, tone: "text-amber" },
    { label: "Priced (live)", v: s.active?.lines ?? 0, sub: `${fmt(s.active?.pieces ?? 0)} pieces`, tone: "text-text-primary" },
    { label: "Due next step", v: s.due?.lines ?? 0, sub: `${fmt(s.due?.pieces ?? 0)} pieces`, tone: "text-text-primary" },
    { label: "Need a cost", v: costIssues, sub: "no / odd cost in Odoo", tone: costIssues ? "text-rose" : "text-text-primary" },
  ];
  return (
    <section className="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-hairline bg-panel p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-text-muted">{t.label}</p>
          <p className={cn("mt-2 font-mono text-[30px] font-semibold leading-none tnum", t.tone)}>{fmt(t.v)}</p>
          <p className="mt-2 text-[12px] text-text-secondary">{t.sub}</p>
        </div>
      ))}
    </section>
  );
}

function StepTable({ data }: { data: ResalePayload }) {
  return (
    <section className="mb-6 rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Does each step earn its place?</h2>
      <p className="mt-0.5 text-[12px] text-text-muted">
        Sell-through = pieces sold within {data.window} days of entering the step ÷ pieces that entered at least{" "}
        {data.window} days ago. A step under ~5% is a candidate to shorten to 7 days or drop.
      </p>
      <div className="mt-4 overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="text-[11px] uppercase tracking-[1px] text-text-muted">
              <th className="px-3 py-2">Step</th>
              <th className="px-3 py-2 text-right">On shelf now</th>
              <th className="px-3 py-2 text-right">Cost · price now</th>
              <th className="px-3 py-2 text-right">Entered</th>
              <th className="px-3 py-2 text-right">Sold</th>
              <th className="px-3 py-2 text-right">Sold 7d</th>
              <th className="px-3 py-2 text-right">14-day sell-through</th>
              <th className="px-3 py-2 text-right">Median days to sale</th>
            </tr>
          </thead>
          <tbody>
            {STEPS.map((k, i) => {
              const st = data.steps[k];
              const b = data.byStep[k];
              return (
                <tr key={k} className="border-t border-hairline">
                  <td className="px-3 py-2 text-[13px] text-text-primary">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: STEP_COLOR[i] }} />
                    {k} · {STEP_LABEL[k]}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary tnum">
                    {fmt(b?.pieces ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px] text-text-muted tnum">
                    {b ? `${(b.cost / 1e6).toFixed(1)}M · ${(b.price / 1e6).toFixed(1)}M` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary tnum">{fmt(st?.entered ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary tnum">{fmt(st?.sold ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary tnum">{fmt(st?.soldLast7 ?? 0)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] font-semibold text-lime tnum">
                    {pct(st?.sellThrough14 ?? null)}
                    {st && st.maturedPieces > 0 && (
                      <span className="ml-1 text-[11px] font-normal text-text-muted">
                        ({st.maturedSold14}/{st.maturedPieces})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[13px] text-text-secondary tnum">
                    {st?.medianDaysToSale ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DailyChart({ data }: { data: ResalePayload }) {
  const rows = useMemo(
    () =>
      Object.entries(data.daily).map(([d, v]) => ({
        day: d.slice(5),
        ...Object.fromEntries(STEPS.map((k) => [k, v[k] ?? 0])),
      })),
    [data],
  );
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Pieces sold per day, by step</h2>
      <p className="mt-0.5 text-[12px] text-text-muted">
        Ladder pieces only (sold at or under their step price). Owner's old «تصفية» prices are not in this chart.
      </p>
      {rows.length === 0 ? (
        <p className="mt-6 text-center text-[13px] text-text-muted">No ladder sales yet.</p>
      ) : (
        <div className="mt-4 h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows}>
              <CartesianGrid stroke="#232E3B" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "#93A1B0", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "#93A1B0", fontSize: 11 }} width={28} />
              <Tooltip contentStyle={{ background: "#10161E", border: "1px solid #33414F", fontSize: 12 }} />
              {STEPS.map((k, i) => (
                <Bar key={k} dataKey={k} name={STEP_LABEL[k]} stackId="s" fill={STEP_COLOR[i]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

export default function Resale() {
  const data = useResaleData();
  if (data === undefined) return <div className="p-6 text-[13px] text-text-muted">Loading…</div>;
  if (data === null)
    return <EmptyState title="Resale data not synced yet" message="resale.json appears after the next Odoo sync." />;
  return (
    <div>
      <Header data={data} />
      <PriceCheck data={data} />
      <Queue data={data} />
      <StepTable data={data} />
      <DailyChart data={data} />
    </div>
  );
}
