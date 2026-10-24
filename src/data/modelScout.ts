/**
 * Model scout — which Turkey models to add to ads, which to pull, and which
 * run in more than one campaign. Daily, from Odoo orders + Meta ad spend per
 * model (ad name carries the model code, e.g. "K-6676 VID").
 *
 * Window: last 7 complete days vs the 7 before. Orders enter Odoo only after
 * a salesperson confirmed the supplier has the item, so a sharp drop in a
 * model's orders while its ads keep spending means "check the supplier /
 * the ad is tired".
 *
 * Pure functions, no React.
 */

import type { OpsOrder, OpsStockItem } from "@/data/opsData";
import type { ProfitPayload } from "@/data/profitData";
import { modelOf } from "@/data/experimentEngine";

export const SCOUT = {
  /** Ad spend below this (USD, last 7 days) counts as "not advertised". */
  unadvertisedMaxUSD: 5,
  /** A candidate needs at least this many Turkey units in the last 7 days. */
  minUnits: 3,
  /** Break-even ad cost per Turkey unit, USD (≈ 30k IQD margin / 1600). */
  maxUSDPerUnit: 19,
  /** Below this unit margin (IQD) a model is flagged low margin. */
  lowMarginIQD: 25_000,
  /** Last 3 days below this share of the previous week's daily rate = drop. */
  dropRatio: 0.5,
  /** A second campaign counts as a duplicate from this spend (USD, 7 days). */
  dupMinUSD: 3,
  /** First Turkey order within this many days = NEW. */
  newDays: 14,
} as const;

export interface CampaignSpend {
  campaign: string;
  spend: number;
  conv: number;
}

export interface ScoutRow {
  model: string;
  units7: number;
  unitsPrev7: number;
  units3: number;
  spend7: number;
  usdPerUnit: number | null;
  price: number | null;
  marginIQD: number | null;
  isNew: boolean;
  firstOrder: string;
  campaigns: CampaignSpend[];
  flags: ("drop" | "dup" | "costly" | "lowMargin")[];
}

export interface ScoutResult {
  today: string;
  candidates: ScoutRow[];
  advertised: ScoutRow[];
  hasCampaigns: boolean;
  otherShare: number;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

export function computeScout(
  orders: OpsOrder[],
  stock: OpsStockItem[],
  profit: ProfitPayload | null,
  today: string
): ScoutResult {
  const d1 = addDays(today, -7); // first day of last 7
  const p1 = addDays(today, -14); // first day of previous 7
  const d3 = addDays(today, -3);

  const costs = new Map<string, number[]>();
  for (const s of stock) {
    if (!(s.cost >= 1000)) continue;
    const m = modelOf(s.model || s.sku);
    const arr = costs.get(m) ?? [];
    arr.push(s.cost);
    costs.set(m, arr);
  }

  const u7 = new Map<string, number>();
  const uPrev = new Map<string, number>();
  const u3 = new Map<string, number>();
  const price = new Map<string, number>();
  const first = new Map<string, string>();
  const bump = (m: Map<string, number>, k: string, q: number) => m.set(k, (m.get(k) ?? 0) + q);
  for (const o of orders) {
    for (const l of o.lines) {
      if (l.route !== "turkey" || !(l.qty > 0)) continue;
      const m = modelOf(l.sku);
      const f = first.get(m);
      if (!f || o.d < f) first.set(m, o.d);
      if (o.d >= today || o.d < p1) continue;
      if (o.d >= d1) {
        bump(u7, m, l.qty);
        price.set(m, l.price);
        if (o.d >= d3) bump(u3, m, l.qty);
      } else bump(uPrev, m, l.qty);
    }
  }

  const sku = profit?.meta?.skuDaily ?? {};
  const spend = new Map<string, number>();
  let total = 0;
  let other = 0;
  for (let d = d1; d < today; d = addDays(d, 1)) {
    for (const [k, v] of Object.entries(sku[d] ?? {})) {
      total += v;
      if (k === "OTHER") other += v;
      else bump(spend, modelOf(k), v);
    }
  }
  const campRaw = profit?.meta?.skuCampaigns7d ?? {};
  const camps = new Map<string, CampaignSpend[]>();
  for (const [k, list] of Object.entries(campRaw)) {
    if (k === "OTHER") continue;
    const m = modelOf(k);
    camps.set(m, [...(camps.get(m) ?? []), ...list].sort((a, b) => b.spend - a.spend));
  }

  const models = new Set<string>([...u7.keys(), ...spend.keys()]);
  const rows: ScoutRow[] = [];
  for (const m of models) {
    const units7 = u7.get(m) ?? 0;
    const unitsPrev7 = uPrev.get(m) ?? 0;
    const units3 = u3.get(m) ?? 0;
    const spend7 = spend.get(m) ?? 0;
    const c = costs.get(m);
    const p = price.get(m) ?? null;
    const marginIQD = p != null && c ? p - median(c) : null;
    const campaigns = camps.get(m) ?? [];
    const flags: ScoutRow["flags"] = [];
    const prevRate = unitsPrev7 / 7;
    if (spend7 >= SCOUT.unadvertisedMaxUSD && prevRate > 0 && units3 / 3 < prevRate * SCOUT.dropRatio) flags.push("drop");
    if (campaigns.filter((x) => x.spend >= SCOUT.dupMinUSD).length >= 2) flags.push("dup");
    const usdPerUnit = units7 > 0 ? spend7 / units7 : null;
    if (spend7 >= SCOUT.unadvertisedMaxUSD && (usdPerUnit == null || usdPerUnit > SCOUT.maxUSDPerUnit)) flags.push("costly");
    if (marginIQD != null && marginIQD < SCOUT.lowMarginIQD) flags.push("lowMargin");
    const firstOrder = first.get(m) ?? "";
    rows.push({
      model: m,
      units7,
      unitsPrev7,
      units3,
      spend7,
      usdPerUnit,
      price: p,
      marginIQD,
      isNew: firstOrder >= addDays(today, -SCOUT.newDays),
      firstOrder,
      campaigns,
      flags,
    });
  }

  const candidates = rows
    .filter((r) => r.spend7 < SCOUT.unadvertisedMaxUSD && r.units7 >= SCOUT.minUnits)
    .sort((a, b) => b.units7 - a.units7);
  const advertised = rows
    .filter((r) => r.spend7 >= SCOUT.unadvertisedMaxUSD)
    .sort((a, b) => b.spend7 - a.spend7);

  return {
    today,
    candidates,
    advertised,
    hasCampaigns: Object.keys(campRaw).length > 0,
    otherShare: total > 0 ? other / total : 0,
  };
}
