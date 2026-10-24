/**
 * Ad models — daily: which Turkey models to add to ads, which advertised
 * models are failing, and which run in more than one campaign.
 * Numbers come from src/data/modelScout.ts.
 */

import { Copy, Search, Sparkles, TrendingDown } from "lucide-react";
import { SCOUT, type ScoutResult, type ScoutRow } from "@/data/modelScout";
import { compact } from "@/lib/money";
import { cn } from "@/lib/utils";

const usd = (n: number, d = 0) => `$${n.toFixed(d)}`;

const FLAG: Record<ScoutRow["flags"][number], { label: string; cls: string; tip: string }> = {
  drop: {
    label: "Orders dropped",
    cls: "bg-neg/15 text-neg",
    tip: "Last 3 days below half of last week's rate while ads keep spending: check the supplier, then the ad.",
  },
  dup: {
    label: "In 2+ campaigns",
    cls: "bg-amber/15 text-amber",
    tip: "Keep it in the campaign with the cheapest conversation, switch off the others.",
  },
  costly: {
    label: `Over $${SCOUT.maxUSDPerUnit}/unit`,
    cls: "bg-neg/15 text-neg",
    tip: "Ad cost per Turkey unit is above break-even.",
  },
  lowMargin: {
    label: "Low margin",
    cls: "bg-inset text-text-muted",
    tip: `Unit margin under ${compact(SCOUT.lowMarginIQD)} IQD.`,
  },
};

function Flags({ r }: { r: ScoutRow }) {
  return (
    <div className="flex flex-wrap gap-1">
      {r.flags.map((f) => (
        <span key={f} title={FLAG[f].tip} className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-semibold", FLAG[f].cls)}>
          {FLAG[f].label}
        </span>
      ))}
    </div>
  );
}

function Name({ r }: { r: ScoutRow }) {
  return (
    <span className="whitespace-nowrap font-medium text-text-primary">
      {r.model}
      {r.isNew && <span className="ml-1.5 rounded bg-cyan/15 px-1 text-[10px] font-bold text-cyan">NEW</span>}
    </span>
  );
}

const head = "px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[1px] text-text-muted";
const num = "px-3 py-2 text-right font-mono text-[12.5px] tnum text-text-secondary";

function Candidates({ r }: { r: ScoutResult }) {
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-lime" />
        <h2 className="font-display text-[15px] font-semibold text-text-primary">Promising · selling without ads</h2>
      </div>
      <p className="mt-1 text-[11.5px] text-text-muted">
        Turkey models with ≥{SCOUT.minUnits} units in the last 7 days and under {usd(SCOUT.unadvertisedMaxUSD)} of ad
        spend. Check supplier stock, then add to an existing campaign — budget unchanged. Ads with no model code in
        their name are invisible here, so a model in a carousel may show up as unadvertised.
      </p>
      {r.candidates.length === 0 ? (
        <p className="mt-3 text-[13px] text-text-muted">No model is selling on its own this week.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-hairline">
                <th className={cn(head, "text-left")}>Model</th>
                <th className={cn(head, "text-right")}>Units 7d</th>
                <th className={cn(head, "text-right")}>Prev 7d</th>
                <th className={cn(head, "text-right")}>Price</th>
                <th className={cn(head, "text-right")}>Margin/unit</th>
                <th className={cn(head, "text-left")}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {r.candidates.map((m) => (
                <tr key={m.model} className="border-b border-hairline/50">
                  <td className="px-3 py-2 text-[13px]">
                    <Name r={m} />
                  </td>
                  <td className={cn(num, "font-semibold text-text-primary")}>{m.units7}</td>
                  <td className={num}>{m.unitsPrev7}</td>
                  <td className={num}>{m.price != null ? compact(m.price) : "—"}</td>
                  <td className={num}>{m.marginIQD != null ? compact(m.marginIQD) : "—"}</td>
                  <td className="px-3 py-2">
                    <Flags r={m} />
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

function Campaigns({ m }: { m: ScoutRow }) {
  if (m.campaigns.length === 0) return <span className="text-text-muted">—</span>;
  const live = m.campaigns.filter((c) => c.spend >= 0.5);
  const best = m.campaigns.length > 1
    ? [...live].filter((c) => c.conv > 0).sort((a, b) => a.spend / a.conv - b.spend / b.conv)[0]
    : undefined;
  return (
    <div className="space-y-0.5">
      {live.map((c) => (
        <div key={c.campaign} className="flex items-center gap-2 text-[11.5px]">
          <span className={cn("truncate", best?.campaign === c.campaign ? "font-semibold text-pos" : "text-text-secondary")}>
            {c.campaign}
          </span>
          <span className="whitespace-nowrap font-mono tnum text-text-muted">
            {usd(c.spend)} · {c.conv} conv{c.conv > 0 ? ` · ${usd(c.spend / c.conv, 2)}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

function Advertised({ r }: { r: ScoutResult }) {
  return (
    <section className="rounded-xl border border-hairline bg-panel p-5">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-cyan" />
        <h2 className="font-display text-[15px] font-semibold text-text-primary">Advertised models · last 7 days</h2>
      </div>
      <p className="mt-1 text-[11.5px] text-text-muted">
        Spend from ad names, units from Odoo Turkey orders. Break-even ≈ {usd(SCOUT.maxUSDPerUnit)} of ads per unit.
        Where a model runs in several campaigns, the one with the cheapest conversation is in green.
        {r.otherShare > 0 && ` ${Math.round(r.otherShare * 100)}% of spend is in ads with no model code in the name.`}
      </p>
      {!r.hasCampaigns && (
        <p className="mt-2 text-[11.5px] text-amber">Campaign split appears after the next Meta sync.</p>
      )}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-hairline">
              <th className={cn(head, "text-left")}>Model</th>
              <th className={cn(head, "text-right")}>Spend 7d</th>
              <th className={cn(head, "text-right")}>Units 7d</th>
              <th className={cn(head, "text-right")}>$/unit</th>
              <th className={cn(head, "text-right")}>Last 3d / prev 7d</th>
              <th className={cn(head, "text-left")}>Campaigns</th>
              <th className={cn(head, "text-left")}>Flags</th>
            </tr>
          </thead>
          <tbody>
            {r.advertised.map((m) => (
              <tr key={m.model} className="border-b border-hairline/50 align-top">
                <td className="px-3 py-2 text-[13px]">
                  <Name r={m} />
                </td>
                <td className={num}>{usd(m.spend7)}</td>
                <td className={cn(num, "text-text-primary")}>{m.units7}</td>
                <td className={cn(num, m.usdPerUnit == null || m.usdPerUnit > SCOUT.maxUSDPerUnit ? "text-neg" : "text-pos")}>
                  {m.usdPerUnit != null ? usd(m.usdPerUnit, 1) : "—"}
                </td>
                <td className={num}>
                  {m.units3} / {m.unitsPrev7}
                </td>
                <td className="max-w-[260px] px-3 py-2">
                  <Campaigns m={m} />
                </td>
                <td className="px-3 py-2">
                  <Flags r={m} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div className="grid gap-3 text-[11.5px] text-text-secondary md:grid-cols-3">
      <div className="flex gap-2 rounded-lg bg-inset p-3">
        <Sparkles className="h-4 w-4 shrink-0 text-lime" />
        Selling without ads = demand already there. Best candidates to add.
      </div>
      <div className="flex gap-2 rounded-lg bg-inset p-3">
        <TrendingDown className="h-4 w-4 shrink-0 text-neg" />
        Orders dropped while ads run: check the supplier. If in stock, the ad is tired — move its budget.
      </div>
      <div className="flex gap-2 rounded-lg bg-inset p-3">
        <Copy className="h-4 w-4 shrink-0 text-amber" />
        One model, one campaign. Copies bid against each other and stay in limited learning.
      </div>
    </div>
  );
}

export default function ModelScout({ r }: { r: ScoutResult }) {
  return (
    <div className="space-y-4">
      <Legend />
      <Candidates r={r} />
      <Advertised r={r} />
    </div>
  );
}
