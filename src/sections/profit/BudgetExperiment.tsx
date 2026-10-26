/**
 * Budget experiment (300 ↔ 400 USD/day, week by week) + Meta delivery
 * health. All numbers come from src/data/experimentEngine.ts.
 */

import { AlertTriangle, CheckCircle2, Clock, FlaskConical } from "lucide-react";
import {
  EXPERIMENT,
  type BlockResult,
  type ExperimentResult,
  type HealthSignal,
} from "@/data/experimentEngine";
import { compact } from "@/lib/money";
import { cn } from "@/lib/utils";

function iqd(n: number): string {
  const s = compact(Math.abs(n));
  return n < 0 ? `−${s}` : s;
}
const usd = (n: number, d = 0) => `$${n.toFixed(d)}`;
const pct = (n: number | null, d = 1) => (n == null ? "—" : `${(n * 100).toFixed(d)}%`);
const signed = (n: number | null) => (n == null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(0)}%`);

function day(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

const STATUS: Record<BlockResult["status"], { label: string; cls: string }> = {
  upcoming: { label: "Upcoming", cls: "bg-inset text-text-muted" },
  running: { label: "Running", cls: "bg-cyan/15 text-cyan" },
  settling: { label: "Orders delivering", cls: "bg-amber/15 text-amber" },
  settled: { label: "Settled", cls: "bg-pos/15 text-pos" },
};

function Rules() {
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-lime" />
        <h2 className="font-display text-[15px] font-semibold text-text-primary">Budget experiment · 300 vs 400</h2>
      </div>
      <ul className="mt-3 grid gap-1.5 text-[12.5px] text-text-secondary md:grid-cols-2">
        <li>• 8 weeks, alternating 300 / 400. Budget changes on the first morning of each week. No extension, no postponement.</li>
        <li>• Models are fed as usual, any day: promising models (any margin) are added when they arrive; models that stop selling or sell out are switched off. Same criteria in 300 and 400 weeks.</li>
        <li>• Measured on profit before fixed costs per day (projected, by order date).</li>
        <li>
          • Decision, written in advance: 400 wins only if the 400 weeks beat their 300 neighbours by ≥{" "}
          {compact(EXPERIMENT.winMarginIQD)} IQD/day on average AND at least {EXPERIMENT.minWins} of{" "}
          {EXPERIMENT.comparisons.length} beat them. Otherwise the standing budget is 300.
        </li>
        <li>• A week counts {EXPERIMENT.settleDays} days after it ends, once most orders are delivered. 22–28 Oct is a warm-up and is not counted.</li>
        <li>• Model strength = Turkey gross margin per Turkey order; a model taking ≥30% of units or spend is flagged.</li>
      </ul>
    </section>
  );
}

function Weeks({ r }: { r: ExperimentResult }) {
  const head = "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[1.1px] text-text-muted";
  const num = "px-3 py-2 text-right font-mono text-[13px] tnum";
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Weeks</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[920px] border-collapse">
          <thead>
            <tr className="border-b border-hairline">
              <th className={cn(head, "text-left")}>Week</th>
              <th className={cn(head, "text-right")}>Plan</th>
              <th className={cn(head, "text-right")}>Actual $/day</th>
              <th className={cn(head, "text-right")}>Before fixed /day</th>
              <th className={cn(head, "text-right")}>Net /day</th>
              <th className={cn(head, "text-right")}>Turkey orders /day</th>
              <th className={cn(head, "text-right")}>Margin / Turkey order</th>
              <th className={cn(head, "text-right")}>Chats /day</th>
              <th className={cn(head, "text-right")}>Close rate</th>
            </tr>
          </thead>
          <tbody>
            {r.blocks.map((b) => (
              <tr key={b.block.key} className={cn("border-b border-hairline/60", b.block.excluded && "opacity-60")}>
                <td className="px-3 py-2">
                  <div className="text-[13px] text-text-primary">
                    {b.block.label}{" "}
                    <span className="text-[11.5px] text-text-muted">
                      {day(b.block.start)} – {day(b.block.end)}
                    </span>
                  </div>
                  {b.block.excluded ? (
                    <span className="mt-1 inline-block rounded bg-inset px-1.5 py-0.5 text-[10.5px] font-semibold text-text-muted">
                      Not counted
                    </span>
                  ) : (
                    <span className={cn("mt-1 inline-block rounded px-1.5 py-0.5 text-[10.5px] font-semibold", STATUS[b.status].cls)}>
                      {STATUS[b.status].label}
                      {b.days > 0 && b.status !== "settled" ? ` · ${b.days}/7 days` : ""}
                    </span>
                  )}
                </td>
                <td className={num}>{usd(b.block.budgetUSD)}</td>
                <td className={cn(num, b.offPlan && "text-amber")}>
                  {b.days ? usd(b.adsUSDPerDay) : "—"}
                  {b.offPlan && <span className="ml-1 text-[10.5px]">off plan</span>}
                </td>
                <td className={cn(num, "font-semibold text-text-primary")}>{b.days ? iqd(b.contributionPerDay) : "—"}</td>
                <td className={cn(num, b.netPerDay >= 0 ? "text-pos" : "text-neg")}>{b.days ? iqd(b.netPerDay) : "—"}</td>
                <td className={num}>{b.days ? b.turkeyOrdersPerDay.toFixed(1) : "—"}</td>
                <td className={num}>{b.turkeyGrossPerOrder != null ? iqd(b.turkeyGrossPerOrder) : "—"}</td>
                <td className={num}>{b.health.convPerDay != null ? b.health.convPerDay.toFixed(0) : "—"}</td>
                <td className={num}>{pct(b.closeRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Verdict({ r }: { r: ExperimentResult }) {
  const label = (k: string) => r.blocks.find((b) => b.block.key === k)?.block.label ?? k;
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Comparison</h2>
      <div className="mt-3 space-y-2">
        {r.comparisons.map((c) => {
          const final = c.diffPerDay != null;
          const d = final ? c.diffPerDay : c.provisionalDiff;
          return (
            <div key={c.test} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-inset px-3 py-2.5">
              <span className="text-[13px] text-text-secondary">
                {label(c.test)} (400) vs {c.against.map(label).join(" + ")} (300)
              </span>
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "font-mono text-[14px] font-semibold tnum",
                    d == null ? "text-text-muted" : d >= EXPERIMENT.winMarginIQD ? "text-pos" : d >= 0 ? "text-amber" : "text-neg"
                  )}
                >
                  {d == null ? "waiting" : `${d >= 0 ? "+" : "−"}${compact(Math.abs(d))} IQD/day`}
                </span>
                {!final && d != null && <span className="text-[11px] text-text-muted">provisional</span>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 px-1 text-[12.5px] text-text-secondary">
        <span>
          Average gain:{" "}
          <span className={cn("font-mono font-semibold tnum", r.avgDiffPerDay == null ? "text-text-muted" : r.avgDiffPerDay >= EXPERIMENT.winMarginIQD ? "text-pos" : "text-amber")}>
            {r.avgDiffPerDay == null ? "waiting" : `${r.avgDiffPerDay >= 0 ? "+" : "−"}${compact(Math.abs(r.avgDiffPerDay))} IQD/day`}
          </span>{" "}
          (needs ≥ {compact(EXPERIMENT.winMarginIQD)})
        </span>
        <span>
          400 weeks ahead: <span className="font-mono font-semibold tnum">{r.wins}/{EXPERIMENT.comparisons.length}</span> settled (needs ≥ {EXPERIMENT.minWins})
        </span>
      </div>
      <div className="mt-4 flex items-center gap-2 rounded-lg border border-hairline px-3 py-3">
        {r.decisionReady ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-pos" />
            <span className="text-[14px] font-semibold text-text-primary">
              Standing budget: ${r.decisionUSD}/day
            </span>
          </>
        ) : (
          <>
            <Clock className="h-4 w-4 text-text-muted" />
            <span className="text-[13px] text-text-secondary">
              Decision when Week 8 settles ({day(EXPERIMENT.blocks[EXPERIMENT.blocks.length - 1].end)} + {EXPERIMENT.settleDays} days)
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function SignalRow({ s }: { s: HealthSignal }) {
  const fmt = (v: number | null) =>
    v == null ? "—" : s.key === "ctr" ? pct(v, 2) : s.key === "frequency" ? v.toFixed(2) : usd(v, 2);
  return (
    <div className="grid grid-cols-[minmax(120px,1fr)_auto_auto] items-center gap-3 border-b border-hairline/60 py-2 last:border-0">
      <div>
        <div className="flex items-center gap-1.5 text-[13px] text-text-primary">
          {s.tone === "warn" ? (
            <AlertTriangle className="h-3.5 w-3.5 text-amber" />
          ) : (
            <CheckCircle2 className={cn("h-3.5 w-3.5", s.tone === "ok" ? "text-pos" : "text-text-muted")} />
          )}
          {s.label}
        </div>
        <div className={cn("text-[11.5px]", s.tone === "warn" ? "text-amber" : "text-text-muted")}>{s.note}</div>
      </div>
      <span className="font-mono text-[13px] text-text-primary tnum">{fmt(s.value)}</span>
      <span className="min-w-[110px] text-right font-mono text-[12px] text-text-muted tnum">
        {signed(s.change)} vs {fmt(s.baseline)}
      </span>
    </div>
  );
}

function AdHealth({ r }: { r: ExperimentResult }) {
  const warn = r.last7Signals.filter((s) => s.tone === "warn").length;
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Are the ads healthy? · last 7 days</h2>
      <p className="text-[11.5px] text-text-muted">
        Compared with the 60 days before. Context for the profit numbers, not a replacement for them.
      </p>
      {!r.hasDetail ? (
        <p className="mt-3 text-[13px] text-text-muted">Waiting for the next sync to bring Meta delivery details.</p>
      ) : (
        <>
          <p className={cn("mt-3 text-[13.5px] font-semibold", warn ? "text-amber" : "text-pos")}>
            {warn === 0 ? "Delivery looks normal" : `${warn} signal${warn > 1 ? "s" : ""} off normal`}
          </p>
          <div className="mt-2">
            {r.last7Signals.map((s) => (
              <SignalRow key={s.key} s={s} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Models({ r }: { r: ExperimentResult }) {
  const active = r.blocks.filter((b) => b.days > 0);
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Model mix by week</h2>
      <p className="text-[11.5px] text-text-muted">
        Turkey units and share of SKU-attributed Meta spend. NEW = first Turkey sale in that week or the 3 days before.
      </p>
      {active.length === 0 ? (
        <p className="mt-3 text-[13px] text-text-muted">Starts with Week 1 on {day(EXPERIMENT.start)}.</p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {active.map((b) => (
            <div key={b.block.key} className="min-w-0 rounded-lg bg-inset p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-text-primary">
                  {b.block.label} · ${b.block.budgetUSD}
                </span>
                {b.concentrated && (
                  <span className="rounded bg-amber/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber">
                    {b.concentrated} dominates
                  </span>
                )}
              </div>
              <table className="mt-2 w-full text-[12.5px]">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-[1px] text-text-muted">
                    <th className="py-1 text-left font-semibold">Model</th>
                    <th className="py-1 text-right font-semibold">Units</th>
                    <th className="py-1 text-right font-semibold">Unit share</th>
                    <th className="py-1 text-right font-semibold">Spend share</th>
                  </tr>
                </thead>
                <tbody>
                  {b.models.map((m) => (
                    <tr key={m.model} className="border-t border-hairline/50">
                      <td className="py-1 text-text-primary">
                        {m.model}
                        {m.isNew && <span className="ml-1.5 rounded bg-cyan/15 px-1 text-[10px] font-bold text-cyan">NEW</span>}
                      </td>
                      <td className="py-1 text-right font-mono tnum text-text-secondary">{m.units}</td>
                      <td className="py-1 text-right font-mono tnum text-text-secondary">{pct(m.share, 0)}</td>
                      <td className="py-1 text-right font-mono tnum text-text-secondary">{pct(m.spendShare, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function BudgetExperiment({ r }: { r: ExperimentResult }) {
  return (
    <div className="space-y-4">
      <Rules />
      <Weeks r={r} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Verdict r={r} />
        <AdHealth r={r} />
      </div>
      <Models r={r} />
    </div>
  );
}
