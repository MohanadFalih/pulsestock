/**
 * Price lab — models in the dark get one price cut and a small ad; this tab
 * shows how each one is doing and what the lab earns in total.
 * Numbers come from src/data/priceLabEngine.ts.
 */

import { BadgePercent, FlaskConical, Handshake, ListChecks } from "lucide-react";
import { LAB, type LabCandidate, type LabResult, type LabRow, type LabStatus } from "@/data/priceLabEngine";
import { compact } from "@/lib/money";
import { cn } from "@/lib/utils";

const usd = (n: number, d = 1) => `$${n.toFixed(d)}`;
const iqd = (n: number) => (n < 0 ? `−${compact(-n)}` : compact(n));
const day = (s: string) =>
  new Date(`${s}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

const head = "px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[1px] text-text-muted";
const num = "px-3 py-2 text-right font-mono text-[12.5px] tnum text-text-secondary";

const STATUS: Record<LabStatus, { label: string; cls: string }> = {
  noAd: { label: "Ad not running yet", cls: "bg-amber/15 text-amber" },
  running: { label: "Running", cls: "bg-cyan/15 text-cyan" },
  earlyOff: { label: "Switch ad off", cls: "bg-neg/15 text-neg" },
  passed: { label: "Passed", cls: "bg-pos/15 text-pos" },
  failed: { label: "Failed", cls: "bg-neg/15 text-neg" },
};

function action(r: LabRow): string {
  if (r.end) return `Left the lab on ${day(r.end)}.`;
  switch (r.status) {
    case "noAd":
      return `Price cut from ${day(r.start)}. Start its $${LAB.dailyBudgetUSD}/day ad.`;
    case "running":
      return `Day ${r.day} of ${LAB.testDays}. Verdict on ${day(addDay(r.start, LAB.testDays))}.`;
    case "earlyOff":
      return `Spent ${usd(r.spendSinceOrder)} since its last order (limit ${usd(LAB.earlyOffMultiple * (r.adLimit ?? 0))}). Switch the ad off and restore ${compact(r.oldPrice)}.`;
    case "passed":
      return "Sells within its limit: keep it, move it to the main campaigns on an edit day.";
    case "failed":
      return `Switch the ad off and restore the price to ${compact(r.oldPrice)}.`;
  }
}

function addDay(s: string, n: number): string {
  const d = new Date(`${s}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ─── Totals ──────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="rounded-xl border border-hairline bg-panel p-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[1px] text-text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 font-mono text-[22px] font-semibold tnum",
          tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-text-primary"
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11.5px] text-text-muted">{sub}</p>}
    </div>
  );
}

function Totals({ r }: { r: LabResult }) {
  const t = r.totals;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Kpi
        label="Models"
        value={String(t.models)}
        sub={`${t.running} running · ${t.noAd} waiting for ad · ${t.passed} passed · ${t.failed} failed${t.earlyOff ? ` · ${t.earlyOff} to switch off` : ""}`}
      />
      <Kpi
        label="Pieces / day · 7 days"
        value={t.unitsPerDay7.toFixed(1)}
        sub={`Target ${LAB.targetUnitsPerDay}/day · before the cut ${t.unitsPerDayBefore.toFixed(1)} → in the lab ${t.unitsPerDayAfter.toFixed(1)}`}
      />
      <Kpi
        label="Net profit · since start"
        value={iqd(t.profit)}
        tone={t.profit >= 0 ? "pos" : "neg"}
        sub={`${t.units} pieces · ${t.netPerUnitUSD != null ? `${usd(t.netPerUnitUSD)} net per piece` : "no pieces yet"} (target ${usd(LAB.netTargetUSD)})`}
      />
      <Kpi
        label="Per month at this pace"
        value={iqd(t.monthlyAtPace)}
        tone={t.monthlyAtPace >= 0 ? "pos" : "neg"}
        sub={`Last 7 days: ${iqd(t.profit7)} · ${t.units7} pieces`}
      />
      <Kpi label="Ad spend · since start" value={usd(t.spend, 0)} sub={`$${LAB.dailyBudgetUSD}/day per model · ${LAB.slots} slots`} />
    </div>
  );
}

// ─── Per model ───────────────────────────────────────────────────────────────

function DayStrip({ r }: { r: LabRow }) {
  const last = r.daily.slice(-14);
  return (
    <div className="mt-1 flex flex-wrap gap-0.5">
      {last.map((d) => (
        <span
          key={d.date}
          title={`${day(d.date)} · ${d.units} pcs · ${usd(d.spend)} · ${iqd(d.profit)} IQD`}
          className={cn(
            "inline-flex h-4 min-w-[16px] items-center justify-center rounded px-0.5 font-mono text-[9.5px] tnum",
            d.units > 0 ? "bg-pos/20 text-pos" : d.spend > 0 ? "bg-neg/10 text-text-muted" : "bg-inset text-text-muted"
          )}
        >
          {d.units}
        </span>
      ))}
    </div>
  );
}

function Models({ r }: { r: LabResult }) {
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-lime" />
        <h2 className="font-display text-[15px] font-semibold text-text-primary">Models in the lab</h2>
      </div>
      <p className="mt-1 text-[11.5px] text-text-muted">
        Profit is projected: Turkey pieces at the new price, after expected returns, shipping, commission and ads (card
        rate). The day strip shows pieces per day (green = sold, grey-red = spent with no piece). “Before” = Turkey
        pieces and ad spend over the same number of days before the cut, at the old price.
      </p>
      {r.rows.length === 0 ? (
        <div className="mt-3 rounded-lg bg-inset p-4 text-[13px] text-text-secondary">
          No model in the lab yet. When a price is cut in Odoo, the model is added to{" "}
          <span className="font-mono text-[12px]">public/data/price-lab.json</span> (model, first day at the new price,
          old price) and appears here from the next deploy.
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1080px]">
            <thead>
              <tr className="border-b border-hairline">
                <th className={cn(head, "text-left")}>Model</th>
                <th className={cn(head, "text-right")}>Price</th>
                <th className={cn(head, "text-right")}>Ad limit /pc</th>
                <th className={cn(head, "text-right")}>Spend</th>
                <th className={cn(head, "text-right")}>Pieces</th>
                <th className={cn(head, "text-right")}>$/piece</th>
                <th className={cn(head, "text-right")}>Net /piece</th>
                <th className={cn(head, "text-right")}>Profit IQD</th>
                <th className={cn(head, "text-right")}>Before</th>
                <th className={cn(head, "text-right")}>Supplier</th>
                <th className={cn(head, "text-left")}>Status</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((m) => {
                const over = m.usdPerUnit != null && m.adLimit != null && m.usdPerUnit > m.adLimit;
                const priceOff = !m.end && m.odooPrice != null && Math.abs(m.odooPrice - m.newPrice) >= 1000;
                return (
                  <tr key={`${m.model}-${m.start}`} className={cn("border-b border-hairline/50 align-top", m.end && "opacity-60")}>
                    <td className="px-3 py-2 text-[13px]">
                      <span className="font-medium text-text-primary">{m.model}</span>
                      <div className="text-[11px] text-text-muted">
                        from {day(m.start)} · day {m.day}
                      </div>
                      <DayStrip r={m} />
                    </td>
                    <td className={num}>
                      <span className="text-text-muted line-through">{compact(m.oldPrice)}</span>{" "}
                      <span className="text-text-primary">{compact(m.newPrice)}</span>
                      {priceOff && <div className="text-[10.5px] text-amber">Odoo shows {compact(m.odooPrice!)}</div>}
                    </td>
                    <td className={num}>
                      {m.adLimit != null ? usd(m.adLimit) : "—"}
                      {m.beNew != null && m.beOld != null && (
                        <div className="text-[10.5px] text-text-muted">
                          BE {usd(m.beOld)} → {usd(m.beNew)}
                        </div>
                      )}
                    </td>
                    <td className={num}>{usd(m.spend)}</td>
                    <td className={cn(num, "font-semibold text-text-primary")}>
                      {m.units}
                      {m.stockUnits > 0 && <div className="text-[10.5px] font-normal text-text-muted">+{m.stockUnits} warehouse</div>}
                    </td>
                    <td className={cn(num, m.usdPerUnit == null ? "" : over ? "text-neg" : "text-pos")}>
                      {m.usdPerUnit != null ? usd(m.usdPerUnit) : "—"}
                    </td>
                    <td className={cn(num, m.netPerUnitUSD == null ? "" : m.netPerUnitUSD >= LAB.netTargetUSD ? "text-pos" : "text-neg")}>
                      {m.netPerUnitUSD != null ? usd(m.netPerUnitUSD) : "—"}
                    </td>
                    <td className={cn(num, m.profit >= 0 ? "text-pos" : "text-neg")}>{iqd(m.profit)}</td>
                    <td className={num}>
                      {m.before.units} pcs
                      <div className="text-[10.5px] text-text-muted">{usd(m.before.spend, 0)} ads</div>
                    </td>
                    <td className={num}>
                      {m.supplier.qty != null ? `${m.supplier.qty} · ${m.supplier.colors}c` : m.supplier.fromRobot ? "—" : "staff check"}
                    </td>
                    <td className="max-w-[260px] px-3 py-2">
                      <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10.5px] font-semibold", STATUS[m.status].cls)}>
                        {STATUS[m.status].label}
                      </span>
                      {m.askSupplier && (
                        <span className="ml-1 inline-block rounded bg-lime/15 px-1.5 py-0.5 text-[10.5px] font-semibold text-lime">
                          Ask supplier for a discount
                        </span>
                      )}
                      <p className="mt-1 text-[11.5px] text-text-secondary">{action(m)}</p>
                      {m.askSupplier && (
                        <p className="mt-0.5 text-[11px] text-text-muted">
                          Proof: {m.units7} pieces in 7 days, {m.units} since {day(m.start)}, supplier {m.supplier.qty ?? "?"} left.
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ─── Daily totals ────────────────────────────────────────────────────────────

function Daily({ r }: { r: LabResult }) {
  const rows = r.days.slice(-14).reverse();
  if (rows.length === 0) return null;
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <h2 className="font-display text-[15px] font-semibold text-text-primary">Lab total by day</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[420px]">
          <thead>
            <tr className="border-b border-hairline">
              <th className={cn(head, "text-left")}>Day</th>
              <th className={cn(head, "text-right")}>Spend</th>
              <th className={cn(head, "text-right")}>Pieces</th>
              <th className={cn(head, "text-right")}>Profit IQD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.date} className="border-b border-hairline/50">
                <td className="px-3 py-1.5 text-[12.5px] text-text-primary">
                  {day(d.date)}
                  {d.date === r.today && <span className="ml-1 text-[10.5px] text-text-muted">(today, partial)</span>}
                </td>
                <td className={num}>{usd(d.spend)}</td>
                <td className={cn(num, "text-text-primary")}>{d.units}</td>
                <td className={cn(num, d.profit >= 0 ? "text-pos" : "text-neg")}>{iqd(d.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Candidates ──────────────────────────────────────────────────────────────

function Candidates({ r }: { r: LabResult }) {
  const list: LabCandidate[] = r.candidates.slice(0, 20);
  const skipped = Object.entries(r.skipped).sort((a, b) => b[1] - a[1]);
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <div className="flex items-center gap-2">
        <ListChecks className="h-4 w-4 text-cyan" />
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Next in line · {r.candidateCount} models qualify
        </h2>
      </div>
      <p className="mt-1 text-[11.5px] text-text-muted">
        In Odoo ≥ {LAB.entry.minDaysInOdoo} days, ≤ {LAB.entry.maxUnits14} Turkey piece in 14 days, under{" "}
        {LAB.entry.maxLifetimeUnits} pieces ever, no ad running, supplier ≥ {LAB.entry.minSupplierQty} pieces in ≥{" "}
        {LAB.entry.minSupplierColors} colours (Modaselvim: staff check), returns ≤ 25%, and an ad limit ≥{" "}
        {usd(LAB.minAdLimitUSD, 0)} after the cut. Models that already found a buyer come first, newest first.
        {skipped.length > 0 && ` Left out: ${skipped.map(([k, v]) => `${k} ${v}`).join(" · ")}.`}
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[820px]">
          <thead>
            <tr className="border-b border-hairline">
              <th className={cn(head, "text-left")}>Model</th>
              <th className={cn(head, "text-right")}>In Odoo since</th>
              <th className={cn(head, "text-right")}>Price → lab price</th>
              <th className={cn(head, "text-right")}>BE now → after</th>
              <th className={cn(head, "text-right")}>Ad limit /pc</th>
              <th className={cn(head, "text-right")}>Sold ever</th>
              <th className={cn(head, "text-right")}>Last order</th>
              <th className={cn(head, "text-right")}>Past ads</th>
              <th className={cn(head, "text-right")}>Supplier</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.model} className="border-b border-hairline/50">
                <td className="px-3 py-2 text-[13px] font-medium text-text-primary">{c.model}</td>
                <td className={num}>{day(c.created)}</td>
                <td className={num}>
                  {compact(c.price)} → <span className="text-text-primary">{compact(c.newPrice)}</span>
                </td>
                <td className={num}>
                  {usd(c.beOld)} → {usd(c.beNew)}
                </td>
                <td className={cn(num, "text-text-primary")}>{usd(c.adLimit)}</td>
                <td className={num}>{c.lifetimeUnits}</td>
                <td className={num}>{c.lastOrder ? day(c.lastOrder) : "—"}</td>
                <td className={num}>{c.pastAdSpend > 0 ? usd(c.pastAdSpend, 0) : "—"}</td>
                <td className={num}>{c.supplier.fromRobot ? `${c.supplier.qty ?? "?"} · ${c.supplier.colors}c` : "staff check"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Rules ───────────────────────────────────────────────────────────────────

function Rules() {
  return (
    <div className="grid gap-3 text-[11.5px] text-text-secondary md:grid-cols-3">
      <div className="flex gap-2 rounded-lg bg-inset p-3">
        <BadgePercent className="h-4 w-4 shrink-0 text-lime" />
        <span>
          Price −{compact(LAB.stepIQD)} IQD, own ad at ${LAB.dailyBudgetUSD}/day. We keep {usd(LAB.netTargetUSD)} net per
          piece; what is left of the margin is the ad limit per piece.
        </span>
      </div>
      <div className="flex gap-2 rounded-lg bg-inset p-3">
        <FlaskConical className="h-4 w-4 shrink-0 text-cyan" />
        <span>
          After {LAB.testDays} days: ≥ {LAB.minUnitsPass} pieces and $/piece within the limit → stays. Otherwise the ad
          goes off and the price comes back. Early off: {LAB.earlyOffMultiple}× the limit spent since the last order.
        </span>
      </div>
      <div className="flex gap-2 rounded-lg bg-inset p-3">
        <Handshake className="h-4 w-4 shrink-0 text-amber" />
        <span>
          ≥ {LAB.supplierAskUnits7} pieces in 7 days and still at the supplier → ask the supplier for a discount, with these
          sales as proof.
        </span>
      </div>
    </div>
  );
}

export default function PriceLab({ r }: { r: LabResult }) {
  return (
    <div className="space-y-4">
      <Rules />
      <Totals r={r} />
      <Models r={r} />
      <Daily r={r} />
      <Candidates r={r} />
    </div>
  );
}
