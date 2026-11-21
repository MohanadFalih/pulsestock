/**
 * Price lab — a second chance for models left in the dark.
 *
 * A model that has been in Odoo for a while and barely sold gets its price
 * cut by one fixed step and its own small ad (~$6/day). The lower price
 * leaves a smaller margin, so the ad gets a smaller limit per piece: what is
 * left after a fixed net profit per piece. After 7 days the model either
 * stays (it sells within the limit) or its ad goes off and its price goes
 * back. A model that keeps selling while the supplier still has it is
 * flagged so we ask the supplier for a discount with the sales as proof.
 *
 * Inputs: public/data/price-lab.json (which models are in the lab, from
 * which day, old/new price — written when the owner cuts a price in Odoo),
 * live.json (Odoo orders, costs, products, supplier stock) and profit.json
 * (Meta spend per model per day).
 *
 * Owner's rules (21 Nov 2026): simple first version, improved daily from
 * the lab's own numbers. Pure functions, no React.
 */

import { useEffect, useState } from "react";
import type { OpsOrder, OpsProduct, OpsStockItem } from "@/data/opsData";
import type { ProfitPayload } from "@/data/profitData";
import { modelOf } from "@/data/experimentEngine";
import { adsRate } from "@/data/profitEngine";

export const LAB = {
  /** Price cut, IQD (one step, same for every model). */
  stepIQD: 10_000,
  /** Net profit we want to keep per piece after returns and ads, USD. */
  netTargetUSD: 6.5,
  /** Ad budget per model per day, USD. */
  dailyBudgetUSD: 6,
  /** Days of the test before the verdict. */
  testDays: 7,
  /** A model passes with at least this many Turkey pieces in the test… */
  minUnitsPass: 3,
  /** …and its ad cost per piece within its limit. Early off: spend since
   *  the last order reaches this multiple of the limit. */
  earlyOffMultiple: 2,
  /** Pieces in the last 7 days that trigger "ask the supplier for a discount". */
  supplierAskUnits7: 10,
  /** Target for the whole lab, pieces per day (owner's example). */
  targetUnitsPerDay: 10,
  /** Models running at the same time. */
  slots: 5,
  /** A model whose ad limit after the cut is below this cannot carry an ad. */
  minAdLimitUSD: 4,
  entry: {
    minDaysInOdoo: 14,
    /** At most this many Turkey pieces in the last 14 days. */
    maxUnits14: 1,
    /** A model that ever sold this many pieces already had its chance. */
    maxLifetimeUnits: 10,
    minSupplierQty: 30,
    minSupplierColors: 3,
    /** Models with a known return rate above this stay out. */
    maxReturnRate: 0.25,
  },
  /** Unit economics (same as the daily ad review). */
  commission: 1_500,
  deliveryNet: 833,
  shippingPerPiece: 1_798,
  selvimExtraPerPiece: 1_620,
  /** A returned piece is resold ~30% below cost. */
  returnLoss: 0.3,
  /** Return-rate sample: Turkey orders at least this old… */
  settledAfterDays: 14,
  /** …and at most this old. Below `minSettled` pieces the supplier rate is used. */
  settledMaxDays: 90,
  minSettled: 30,
  /** Return rate assumed for Modaselvim (M-) until it has enough history. */
  selvimReturn: 0.25,
} as const;

// ─── Config file ─────────────────────────────────────────────────────────────

export interface LabEntry {
  model: string;
  /** First day at the new price (YYYY-MM-DD, Baghdad). */
  start: string;
  oldPrice: number;
  newPrice?: number;
  /** Last day in the lab, when it has left. */
  end?: string;
  note?: string;
}

export interface LabConfig {
  models: LabEntry[];
}

const CONFIG_URL = "/data/price-lab.json";
let cachedCfg: LabConfig | null = null;

/** `undefined` while loading, `null` when the file is missing. */
export function usePriceLabConfig(): LabConfig | null | undefined {
  const [cfg, setCfg] = useState<LabConfig | null | undefined>(cachedCfg ?? undefined);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const raw = (await res.json()) as { models?: unknown };
        const models = Array.isArray(raw.models) ? (raw.models as LabEntry[]) : [];
        cachedCfg = {
          models: models
            .filter((m) => m && typeof m.model === "string" && typeof m.start === "string" && m.oldPrice > 0)
            .map((m) => ({ ...m, model: modelOf(m.model) })),
        };
        if (alive) setCfg(cachedCfg);
      } catch {
        if (alive) setCfg(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return cfg;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}

/** Card rate used to turn IQD margins into dollars of ad room. */
const CARD_RATE = 1520;

interface Keep {
  keep: number;
  ret: number;
  settled: number;
  source: "model" | "supplier" | "selvim";
}

/** Profit per Turkey piece ordered, before ads, IQD — after returns, shipping,
 *  commission and delivery (formula of the daily ad review). */
export function unitProfitIQD(price: number, cost: number, k: Keep, isSelvim: boolean): number {
  const shipped = k.keep + k.ret;
  return (
    k.keep * (price - cost - LAB.commission + LAB.deliveryNet) -
    k.ret * LAB.returnLoss * cost -
    LAB.shippingPerPiece * shipped -
    (isSelvim ? LAB.selvimExtraPerPiece * shipped : 0)
  );
}

// ─── Shared prep ─────────────────────────────────────────────────────────────

interface Line {
  model: string;
  d: string;
  qty: number;
  price: number;
  del: number;
  ret: number;
  turkey: boolean;
  order: string;
}

function prepLines(orders: OpsOrder[]): Line[] {
  const out: Line[] = [];
  for (const o of orders) {
    if (o.st === "cancel") continue;
    for (const l of o.lines) {
      if (!(l.qty > 0) || (l.discPct ?? 0) >= 100) continue;
      out.push({
        model: modelOf(l.sku),
        d: o.d,
        qty: l.qty,
        price: l.price * (1 - (l.discPct ?? 0) / 100),
        del: l.del ?? 0,
        ret: l.ret ?? 0,
        turkey: l.route === "turkey",
        order: o.id,
      });
    }
  }
  return out;
}

function keepRates(lines: Line[], today: string): (model: string) => Keep {
  const lo = addDays(today, -LAB.settledMaxDays);
  const hi = addDays(today, -LAB.settledAfterDays);
  const byModel = new Map<string, { del: number; ret: number }>();
  const bySup = new Map<string, { del: number; ret: number }>();
  for (const l of lines) {
    if (!l.turkey || l.d < lo || l.d > hi) continue;
    for (const [map, key] of [
      [byModel, l.model],
      [bySup, l.model.slice(0, 1)],
    ] as const) {
      const x = map.get(key) ?? { del: 0, ret: 0 };
      x.del += l.del;
      x.ret += l.ret;
      map.set(key, x);
    }
  }
  return (model: string): Keep => {
    const m = byModel.get(model);
    if (m && m.del + m.ret >= LAB.minSettled) {
      const n = m.del + m.ret;
      return { keep: m.del / n, ret: m.ret / n, settled: n, source: "model" };
    }
    const settled = m ? m.del + m.ret : 0;
    if (model.startsWith("M-")) return { keep: 1 - LAB.selvimReturn, ret: LAB.selvimReturn, settled, source: "selvim" };
    const s = bySup.get(model.slice(0, 1));
    if (s && s.del + s.ret > 0) {
      const n = s.del + s.ret;
      return { keep: s.del / n, ret: s.ret / n, settled, source: "supplier" };
    }
    return { keep: 0.8, ret: 0.2, settled, source: "supplier" };
  };
}

function modelCosts(stock: OpsStockItem[]): Map<string, number> {
  const raw = new Map<string, number[]>();
  for (const s of stock) {
    if (!(s.cost > 1000)) continue;
    const m = modelOf(s.model || s.sku);
    const a = raw.get(m) ?? [];
    a.push(s.cost);
    raw.set(m, a);
  }
  const out = new Map<string, number>();
  for (const [k, v] of raw) out.set(k, median(v));
  return out;
}

function spendByModel(profit: ProfitPayload | null): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const [d, row] of Object.entries(profit?.meta?.skuDaily ?? {})) {
    for (const [k, v] of Object.entries(row)) {
      if (k === "OTHER" || !(v > 0)) continue;
      const m = modelOf(k);
      const days = out.get(m) ?? new Map<string, number>();
      days.set(d, (days.get(d) ?? 0) + v);
      out.set(m, days);
    }
  }
  return out;
}

export interface SupplierView {
  qty: number | null;
  colors: number;
  status: string | null;
  /** false for Modaselvim and others not on Butik Sistem: staff confirm. */
  fromRobot: boolean;
}

function supplierOf(p: OpsProduct | undefined): SupplierView {
  const s = p?.supplierStock;
  const colors = new Set((s?.variants ?? []).filter((v) => v.qty > 0).map((v) => v.color)).size;
  return { qty: s?.qty ?? null, colors, status: s?.status ?? null, fromRobot: s?.source === "api" };
}

// ─── Lab models ──────────────────────────────────────────────────────────────

export type LabStatus = "noAd" | "running" | "earlyOff" | "passed" | "failed";

export interface LabDay {
  date: string;
  spend: number;
  units: number;
  /** Profit of the day at the new price, IQD (projected, after returns and ads). */
  profit: number;
}

export interface LabRow {
  model: string;
  start: string;
  end: string | null;
  /** Day of the test (start day = 1). */
  day: number;
  oldPrice: number;
  newPrice: number;
  /** Price on the Odoo product now (to catch a cut that was not applied). */
  odooPrice: number | null;
  /** Average price actually charged on Turkey lines since the start. */
  soldPrice: number | null;
  cost: number | null;
  keep: Keep;
  /** Profit per piece before ads at the old / new price, USD. */
  beOld: number | null;
  beNew: number | null;
  /** Ad limit per piece after the cut = beNew − net target, USD. */
  adLimit: number | null;
  spend: number;
  units: number;
  orders: number;
  /** Pieces of this model sold from the warehouse since the start (not counted in profit). */
  stockUnits: number;
  usdPerUnit: number | null;
  /** Projected profit since the start, IQD (after returns and ads). */
  profit: number;
  netPerUnitUSD: number | null;
  /** Profit per dollar of ads, IQD. */
  profitPerUSD: number | null;
  spendSinceOrder: number;
  units7: number;
  /** Same length window before the start, at the old price. */
  before: { days: number; units: number; spend: number };
  supplier: SupplierView;
  status: LabStatus;
  askSupplier: boolean;
  daily: LabDay[];
  note?: string;
}

export interface LabTotals {
  models: number;
  noAd: number;
  running: number;
  passed: number;
  failed: number;
  earlyOff: number;
  spend: number;
  units: number;
  profit: number;
  /** Last 7 days, whole lab. */
  units7: number;
  profit7: number;
  unitsPerDay7: number;
  profitPerDay7: number;
  monthlyAtPace: number;
  netPerUnitUSD: number | null;
  /** Average daily pieces before the lab, same models. */
  unitsPerDayBefore: number;
  unitsPerDayAfter: number;
}

export interface LabCandidate {
  model: string;
  created: string;
  price: number;
  newPrice: number;
  beOld: number;
  beNew: number;
  adLimit: number;
  lifetimeUnits: number;
  lastOrder: string | null;
  pastAdSpend: number;
  supplier: SupplierView;
}

export interface LabResult {
  today: string;
  rows: LabRow[];
  totals: LabTotals;
  days: LabDay[];
  candidates: LabCandidate[];
  candidateCount: number;
  skipped: Record<string, number>;
}

function judge(r: Omit<LabRow, "status" | "askSupplier">, today: string): LabStatus {
  const limit = r.adLimit ?? 0;
  const doneDay = addDays(r.start, LAB.testDays); // first day after 7 full days
  const finished = (r.end ?? today) >= doneDay;
  if (r.spend === 0 && !r.end) return "noAd";
  if (finished) {
    const ok = r.units >= LAB.minUnitsPass && r.usdPerUnit != null && r.usdPerUnit <= limit;
    return ok ? "passed" : "failed";
  }
  if (limit > 0 && r.spendSinceOrder >= LAB.earlyOffMultiple * limit) return "earlyOff";
  return "running";
}

export function computePriceLab(
  orders: OpsOrder[],
  stock: OpsStockItem[],
  products: OpsProduct[],
  profit: ProfitPayload | null,
  cfg: LabConfig | null,
  today: string
): LabResult {
  const lines = prepLines(orders);
  const keepOf = keepRates(lines, today);
  const costs = modelCosts(stock);
  const spend = spendByModel(profit);
  const prod = new Map<string, OpsProduct>();
  for (const p of products) prod.set(modelOf(p.sku), p);

  const byModel = new Map<string, Line[]>();
  for (const l of lines) {
    const a = byModel.get(l.model) ?? [];
    a.push(l);
    byModel.set(l.model, a);
  }

  const rows: LabRow[] = [];
  const dayMap = new Map<string, LabDay>();
  for (const e of cfg?.models ?? []) {
    const m = e.model;
    const newPrice = e.newPrice ?? e.oldPrice - LAB.stepIQD;
    const last = e.end && e.end < today ? e.end : today;
    const ml = byModel.get(m) ?? [];
    const sp = spend.get(m) ?? new Map<string, number>();
    const cost = costs.get(m) ?? null;
    const keep = keepOf(m);
    const isM = m.startsWith("M-");
    const ppNew = cost != null ? unitProfitIQD(newPrice, cost, keep, isM) : null;
    const ppOld = cost != null ? unitProfitIQD(e.oldPrice, cost, keep, isM) : null;
    const beNew = ppNew != null ? ppNew / CARD_RATE : null;
    const beOld = ppOld != null ? ppOld / CARD_RATE : null;
    const adLimit = beNew != null ? beNew - LAB.netTargetUSD : null;

    const daily: LabDay[] = [];
    let units = 0;
    let stockUnits = 0;
    let spendSum = 0;
    let profitSum = 0;
    let lastOrderDay: string | null = null;
    let priceSum = 0;
    let priceQty = 0;
    const orderIds = new Set<string>();
    for (let d = e.start; d <= last; d = addDays(d, 1)) {
      const dayLines = ml.filter((l) => l.d === d);
      const u = dayLines.filter((l) => l.turkey).reduce((s, l) => s + l.qty, 0);
      stockUnits += dayLines.filter((l) => !l.turkey).reduce((s, l) => s + l.qty, 0);
      for (const l of dayLines)
        if (l.turkey) {
          orderIds.add(l.order);
          priceSum += l.price * l.qty;
          priceQty += l.qty;
        }
      const s = sp.get(d) ?? 0;
      const p = (ppNew ?? 0) * u - s * adsRate(d);
      if (u > 0) lastOrderDay = d;
      units += u;
      spendSum += s;
      profitSum += p;
      daily.push({ date: d, spend: s, units: u, profit: p });
      const t = dayMap.get(d) ?? { date: d, spend: 0, units: 0, profit: 0 };
      t.spend += s;
      t.units += u;
      t.profit += p;
      dayMap.set(d, t);
    }
    let spendSinceOrder = 0;
    for (const x of daily) if (!lastOrderDay || x.date > lastOrderDay) spendSinceOrder += x.spend;
    const w7 = addDays(last, -6);
    const units7 = daily.filter((x) => x.date >= w7).reduce((s, x) => s + x.units, 0);

    const span = daily.length;
    const b0 = addDays(e.start, -span);
    let bu = 0;
    let bs = 0;
    for (const l of ml) if (l.turkey && l.d >= b0 && l.d < e.start) bu += l.qty;
    for (const [d, v] of sp) if (d >= b0 && d < e.start) bs += v;

    const p = prod.get(m);
    const base = {
      model: m,
      start: e.start,
      end: e.end ?? null,
      day: daysBetween(e.start, last) + 1,
      oldPrice: e.oldPrice,
      newPrice,
      odooPrice: p?.unitPrice ?? null,
      soldPrice: priceQty > 0 ? priceSum / priceQty : null,
      cost,
      keep,
      beOld,
      beNew,
      adLimit,
      spend: spendSum,
      units,
      orders: orderIds.size,
      stockUnits,
      usdPerUnit: units > 0 ? spendSum / units : null,
      profit: profitSum,
      netPerUnitUSD: units > 0 ? profitSum / units / CARD_RATE : null,
      profitPerUSD: spendSum > 0 ? profitSum / spendSum : null,
      spendSinceOrder,
      units7,
      before: { days: span, units: bu, spend: bs },
      supplier: supplierOf(p),
      daily,
      note: e.note,
    };
    const status = judge(base, today);
    const sup = base.supplier;
    const supplierOk = !sup.fromRobot || ((sup.qty ?? 0) >= LAB.entry.minSupplierQty && sup.status !== "out");
    rows.push({ ...base, status, askSupplier: units7 >= LAB.supplierAskUnits7 && supplierOk && !e.end });
  }

  const order: Record<LabStatus, number> = { earlyOff: 0, noAd: 1, running: 2, passed: 3, failed: 4 };
  rows.sort((a, b) => (a.end ? 1 : 0) - (b.end ? 1 : 0) || order[a.status] - order[b.status] || b.profit - a.profit);

  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  const d7 = addDays(today, -6);
  const last7 = days.filter((d) => d.date >= d7);
  const units7 = last7.reduce((s, d) => s + d.units, 0);
  const profit7 = last7.reduce((s, d) => s + d.profit, 0);
  const n7 = Math.max(1, last7.length);
  const sum = (f: (r: LabRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const unitsAll = sum((r) => r.units);
  const profitAll = sum((r) => r.profit);
  const labDays = sum((r) => r.daily.length);
  const totals: LabTotals = {
    models: rows.length,
    noAd: rows.filter((r) => r.status === "noAd").length,
    running: rows.filter((r) => r.status === "running" && !r.end).length,
    passed: rows.filter((r) => r.status === "passed").length,
    failed: rows.filter((r) => r.status === "failed").length,
    earlyOff: rows.filter((r) => r.status === "earlyOff" && !r.end).length,
    spend: sum((r) => r.spend),
    units: unitsAll,
    profit: profitAll,
    units7,
    profit7,
    unitsPerDay7: units7 / n7,
    profitPerDay7: profit7 / n7,
    monthlyAtPace: (profit7 / n7) * 30,
    netPerUnitUSD: unitsAll > 0 ? profitAll / unitsAll / CARD_RATE : null,
    unitsPerDayBefore: labDays > 0 ? sum((r) => r.before.units) / labDays : 0,
    unitsPerDayAfter: labDays > 0 ? unitsAll / labDays : 0,
  };

  // ─── Candidates: models in the dark that the rules let in ──────────────────
  const inLab = new Set(rows.filter((r) => !r.end).map((r) => r.model));
  const everIn = new Set(rows.map((r) => r.model));
  const lifetime = new Map<string, number>();
  const units14 = new Map<string, number>();
  const lastOrder = new Map<string, string>();
  const d14 = addDays(today, -13);
  for (const l of lines) {
    if (!l.turkey) continue;
    lifetime.set(l.model, (lifetime.get(l.model) ?? 0) + l.qty);
    if (l.d >= d14) units14.set(l.model, (units14.get(l.model) ?? 0) + l.qty);
    const lo = lastOrder.get(l.model);
    if (!lo || l.d > lo) lastOrder.set(l.model, l.d);
  }
  const d3 = addDays(today, -2);
  const skipped: Record<string, number> = {};
  const skip = (k: string) => (skipped[k] = (skipped[k] ?? 0) + 1);
  const candidates: LabCandidate[] = [];
  for (const [m, p] of prod) {
    if (!/^[A-Z]-\d+$/.test(m) || !"HKLTM".includes(m[0])) continue;
    if (inLab.has(m) || everIn.has(m)) continue;
    const created = p.odooCreatedDate ?? "";
    if (!created || daysBetween(created, today) < LAB.entry.minDaysInOdoo) {
      skip("Newer than 14 days");
      continue;
    }
    if ((units14.get(m) ?? 0) > LAB.entry.maxUnits14) {
      skip("Selling");
      continue;
    }
    if ((lifetime.get(m) ?? 0) >= LAB.entry.maxLifetimeUnits) {
      skip("Already had its chance (≥10 sold)");
      continue;
    }
    const sp = spend.get(m);
    let recent = 0;
    let past = 0;
    for (const [d, v] of sp ?? []) {
      past += v;
      if (d >= d3) recent += v;
    }
    if (recent > 0) {
      skip("Ad running");
      continue;
    }
    const cost = costs.get(m);
    const price = p.unitPrice ?? 0;
    if (!cost || !(price > 0)) {
      skip("No cost or price");
      continue;
    }
    const k = keepOf(m);
    if (k.source === "model" && k.ret > LAB.entry.maxReturnRate) {
      skip("Returns > 25%");
      continue;
    }
    const sup = supplierOf(p);
    const isM = m.startsWith("M-");
    if (
      !isM &&
      (!sup.fromRobot ||
        (sup.qty ?? 0) < LAB.entry.minSupplierQty ||
        sup.colors < LAB.entry.minSupplierColors ||
        ["low", "out", "not_found"].includes(sup.status ?? ""))
    ) {
      skip("Low supplier stock");
      continue;
    }
    const newPrice = price - LAB.stepIQD;
    const beNew = unitProfitIQD(newPrice, cost, k, isM) / CARD_RATE;
    const adLimit = beNew - LAB.netTargetUSD;
    if (adLimit < LAB.minAdLimitUSD) {
      skip("Margin too thin for the cut");
      continue;
    }
    candidates.push({
      model: m,
      created,
      price,
      newPrice,
      beOld: unitProfitIQD(price, cost, k, isM) / CARD_RATE,
      beNew,
      adLimit,
      lifetimeUnits: lifetime.get(m) ?? 0,
      lastOrder: lastOrder.get(m) ?? null,
      pastAdSpend: past,
      supplier: sup,
    });
  }
  // Models that already found a few buyers first, newest first within that.
  candidates.sort(
    (a, b) =>
      Number(b.lifetimeUnits > 0) - Number(a.lifetimeUnits > 0) ||
      Number(a.model.startsWith("M-")) - Number(b.model.startsWith("M-")) ||
      b.created.localeCompare(a.created)
  );

  return { today, rows, totals, days, candidates, candidateCount: candidates.length, skipped };
}
