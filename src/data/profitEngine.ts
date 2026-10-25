/**
 * Real Profit engine — net profit per day/month, built from the sources that
 * are actually reliable for each line of the P&L (verified 2026-10-20):
 *
 *   Revenue + goods cost   delivered order lines (live.json ordersDetail).
 *                          Odoo's COGS account is NOT used: customer returns
 *                          don't reverse COGS in this Odoo setup, which
 *                          overstates it by roughly the cost of returned goods.
 *   Unit cost              stockDetail standard_price (AVCO, IQD; USD buys are
 *                          converted by Odoo at its own rate). Costs of 0 or
 *                          < 1,000 IQD are treated as missing (USD typed into
 *                          an IQD field) and estimated from the cost ratio of
 *                          correctly costed lines — the estimate is reported.
 *   Discounts              order-level discount lines (order.disc), allocated
 *                          pro-rata. `discPct` is only a label of those same
 *                          lines and is never applied again.
 *   Delivery               +1,000 IQD per delivered order (customer pays 5,000,
 *                          courier costs 4,000; returns cost nothing).
 *   Ads                    Meta daily spend × the card rate on that day
 *                          (1,380 IQD/$ until 2026-10-05, 1,600 from 10-06).
 *   Fixed costs            Odoo posted expenses (salaries, Turkey agent,
 *                          cargo, other) + rent 1.7M IQD/month (not booked in
 *                          Odoo). Monthly totals are spread evenly over the
 *                          month's days; the running month uses the larger of
 *                          what is posted so far and the recent monthly rate.
 *   Drawings               shareholder debt repayments (ابو سلطان) — reported,
 *                          never subtracted from profit.
 *
 * Kept quantity is `del` (Odoo qty_delivered, already net of returns — a
 * returned line shows del=0, ret=qty). NOTE: Odoo sets qty_delivered when a
 * parcel is handed to the courier, so on young orders `del` still includes
 * refusals that have not come back yet. "Shipped" mode shows it as is;
 * "projected" mode removes the share still expected to return (return curve
 * by order age) and values not-yet-shipped quantity at the keep rate of
 * orders 14–90 days old.
 *
 * Pure functions, no React.
 */

import type { OpsOrder, OpsStockItem } from "@/data/opsData";
import type { ExpenseGroup, ProfitPayload } from "@/data/profitData";

// ─── Business rules (confirmed by the owner) ────────────────────────────────

export const RULES = {
  rentMonthlyIQD: 1_700_000,
  deliveryNetPerOrder: 1_000,
  /** Orders older than this are final: undecided units count as not sold.
   *  Odoo data (Oct 2026): orders 9–10 days old show ~6% returned vs ~22% final;
   *  returns are booked by day 11–14. Owner: cash in 5–6 days, returns ~2 days later. */
  matureAfterDays: 14,
  keepRateMaxAgeDays: 90,
  minPlausibleCostIQD: 1_000,
  /** Earliest day the page may start (profit_sync.py SINCE). */
  since: "2026-06-01",
} as const;

/** IQD per USD paid for Meta ads on a given day. */
export function adsRate(date: string): number {
  return date < "2026-10-06" ? 1380 : 1600;
}

export type FixedGroup = "salaries" | "turkey" | "shipping" | "other" | "rent";
export const FIXED_GROUPS: FixedGroup[] = ["salaries", "turkey", "shipping", "rent", "other"];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DayRaw {
  date: string;
  mature: boolean;
  ordersPlaced: number;
  deliveredOrders: number;
  /** Orders with nothing delivered yet and still inside the maturity window. */
  pendingOrders: number;
  trRev: number;
  trCogs: number;
  stRev: number;
  stCogs: number;
  /** Undecided (not yet delivered/returned) value and cost, young orders only. */
  trPendRev: number;
  trPendCogs: number;
  stPendRev: number;
  stPendCogs: number;
  /** Shipped-and-not-returned value on young orders that is still expected
   *  to come back (return curve) — subtracted in projected mode. */
  trRiskRev: number;
  trRiskCogs: number;
  stRiskRev: number;
  stRiskCogs: number;
  riskOrders: number;
  /** Part of realized COGS that was estimated (missing unit cost). */
  estCogs: number;
  adsUSD: number;
  adsIQD: number;
  fixed: Record<FixedGroup, number>;
  /** Fixed cost of the running month estimated from the recent rate. */
  fixedEstimated: boolean;
  drawings: number;
}

export interface Totals {
  revenue: number;
  trRev: number;
  stRev: number;
  cogs: number;
  trGross: number;
  stGross: number;
  delivery: number;
  ads: number;
  adsUSD: number;
  fixed: Record<FixedGroup, number>;
  fixedTotal: number;
  /** Gross margin + delivery − ads (before fixed costs). */
  contribution: number;
  net: number;
  drawings: number;
  ordersPlaced: number;
  deliveredOrders: number;
  /** Projected-only share of revenue (undecided orders valued at keep rate). */
  projectedRev: number;
  /** Shipped value on young orders expected to still come back (projected). */
  expectedReturnsRev: number;
  estCogs: number;
  days: number;
}

export type Mode = "projected" | "realized";

export interface KeepRates {
  turkey: number;
  stock: number;
  orders: number;
}

export interface ProfitModel {
  days: DayRaw[];
  keep: KeepRates;
  /** Cost/revenue ratio used for lines without a usable unit cost. */
  fallbackCostRatio: number;
  today: string;
  odooMonthly: NonNullable<ProfitPayload["odoo"]["monthly"]>;
  otherByAccount: Record<string, number>;
  health: {
    odooError: string | null;
    odooStale: boolean;
    metaError: string | null;
    metaStale: boolean;
    lastMetaDay: string | null;
    syncedAt: string;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function dayKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()) / 86_400_000
  );
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

const MODEL_RE = /^([A-Za-z]+-\d+)/;
function modelOf(sku: string): string {
  const m = MODEL_RE.exec(sku.trim());
  return m ? m[1].toUpperCase() : sku.split(" (")[0].trim();
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

interface CostLookup {
  bySku: Map<string, number>;
  byModel: Map<string, number>;
}

function buildCosts(stock: OpsStockItem[]): CostLookup {
  const bySku = new Map<string, number>();
  const models = new Map<string, number[]>();
  for (const s of stock) {
    if (!(s.cost >= RULES.minPlausibleCostIQD)) continue;
    bySku.set(s.sku, s.cost);
    const k = modelOf(s.model || s.sku);
    const arr = models.get(k) ?? [];
    arr.push(s.cost);
    models.set(k, arr);
  }
  const byModel = new Map<string, number>();
  for (const [k, arr] of models) byModel.set(k, median(arr));
  return { bySku, byModel };
}

function unitCost(sku: string, c: CostLookup): number | null {
  return c.bySku.get(sku) ?? c.byModel.get(modelOf(sku)) ?? null;
}

function zeroFixed(): Record<FixedGroup, number> {
  return { salaries: 0, turkey: 0, shipping: 0, other: 0, rent: 0 };
}

// ─── Model build ─────────────────────────────────────────────────────────────

interface LineVal {
  turkey: boolean;
  orderedQty: number;
  keptQty: number;
  undecidedQty: number;
  unitNet: number; // per-unit value after the allocated order discount
  cost: number | null;
}

function orderLines(order: OpsOrder, costs: CostLookup): LineVal[] {
  const lines = order.lines.filter((l) => l.qty > 0);
  const gross = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const discFactor = gross > 0 ? Math.max(0, 1 + order.disc / gross) : 1;
  return lines.map((l) => {
    const kept = Math.min(l.qty, Math.max(0, l.del));
    const undecided = Math.max(0, l.qty - kept - (l.ret ?? 0));
    return {
      turkey: l.route === "turkey",
      orderedQty: l.qty,
      keptQty: kept,
      undecidedQty: undecided,
      unitNet: l.price * discFactor,
      cost: unitCost(l.sku, costs),
    };
  });
}

export function buildProfitModel(
  orders: OpsOrder[],
  stock: OpsStockItem[],
  profit: ProfitPayload | null,
  now: Date = new Date()
): ProfitModel {
  const today = dayKey(now);
  const costs = buildCosts(stock);

  // 1. Fallback cost ratio and keep rates from history.
  // Keep rate = kept value / ordered value, on orders old enough to be final.
  let costedCost = 0;
  let costedRev = 0;
  const keepAcc = { tr: [0, 0], st: [0, 0], ord: [0, 0] };
  for (const o of orders) {
    const lines = orderLines(o, costs);
    for (const l of lines) {
      if (l.cost != null && l.keptQty > 0) {
        costedCost += l.cost * l.keptQty;
        costedRev += l.unitNet * l.keptQty;
      }
    }
    const age = daysBetween(o.d, today);
    if (age < RULES.matureAfterDays || age > RULES.keepRateMaxAgeDays) continue;
    for (const l of lines) {
      const acc = l.turkey ? keepAcc.tr : keepAcc.st;
      acc[0] += l.keptQty * l.unitNet;
      acc[1] += l.orderedQty * l.unitNet;
    }
    keepAcc.ord[0] += lines.some((l) => l.keptQty > 0) ? 1 : 0;
    keepAcc.ord[1] += 1;
  }
  const ratio = (a: number[], dflt: number) => (a[1] > 0 ? a[0] / a[1] : dflt);
  const keep: KeepRates = {
    turkey: ratio(keepAcc.tr, 0.75),
    stock: ratio(keepAcc.st, 0.75),
    orders: ratio(keepAcc.ord, 0.75),
  };
  const fallbackCostRatio = costedRev > 0 ? costedCost / costedRev : 0.58;

  // Return curve. Odoo marks a line delivered when it is handed to the
  // courier; a refusal comes back days later and reverses it. So on young
  // orders "delivered" still contains future returns. R(a) = share of shipped
  // value already returned on orders aged a (±1 day); Rf = same on orders
  // 14–90 days old (final). A shipped, not-yet-returned unit of age a will
  // still come back with probability (Rf − R(a)) / (1 − R(a)).
  const shippedByAge = new Array<number>(RULES.matureAfterDays + 1).fill(0);
  const returnedByAge = new Array<number>(RULES.matureAfterDays + 1).fill(0);
  let finShip = 0;
  let finRet = 0;
  for (const o of orders) {
    const age = daysBetween(o.d, today);
    if (age < 0 || age > RULES.keepRateMaxAgeDays) continue;
    let sv = 0;
    let rv = 0;
    for (const l of o.lines) {
      sv += (Math.max(0, l.del) + (l.ret ?? 0)) * l.price;
      rv += (l.ret ?? 0) * l.price;
    }
    if (age >= RULES.matureAfterDays) {
      finShip += sv;
      finRet += rv;
    } else {
      shippedByAge[age] += sv;
      returnedByAge[age] += rv;
    }
  }
  const finalReturn = finShip > 0 ? finRet / finShip : 0.25;
  const returnCurve: number[] = [];
  let prev = 0;
  for (let a = 0; a < RULES.matureAfterDays; a++) {
    let sv = 0;
    let rv = 0;
    for (let k = Math.max(0, a - 1); k <= Math.min(RULES.matureAfterDays - 1, a + 1); k++) {
      sv += shippedByAge[k];
      rv += returnedByAge[k];
    }
    const r = sv > 0 ? rv / sv : prev;
    prev = Math.min(finalReturn, Math.max(prev, r));
    returnCurve.push(prev);
  }
  const stillToReturn = (age: number) => {
    if (age >= RULES.matureAfterDays) return 0;
    const r = returnCurve[Math.max(0, age)] ?? 0;
    return r >= 1 ? 0 : Math.max(0, (finalReturn - r) / (1 - r));
  };

  // 2. Day skeleton. live.json carries a rolling ~120-day order window, so
  // start at the first month whose orders are complete — a half-covered
  // month would show its full ads and salaries against half its sales.
  let firstOrder = today;
  for (const o of orders) if (o.d < firstOrder) firstOrder = o.d;
  let start = firstOrder;
  if (!firstOrder.endsWith("-01")) {
    const d = new Date(`${firstOrder.slice(0, 7)}-01T12:00:00`);
    d.setMonth(d.getMonth() + 1);
    start = dayKey(d);
  }
  if (start < RULES.since) start = RULES.since;
  if (start > today) start = today;
  const span = Math.max(0, daysBetween(start, today));
  const days: DayRaw[] = [];
  for (let i = 0; i <= span; i++) {
    const date = addDays(start, i);
    days.push({
      date,
      mature: daysBetween(date, today) >= RULES.matureAfterDays,
      ordersPlaced: 0,
      deliveredOrders: 0,
      pendingOrders: 0,
      trRev: 0,
      trCogs: 0,
      stRev: 0,
      stCogs: 0,
      trPendRev: 0,
      trPendCogs: 0,
      stPendRev: 0,
      stPendCogs: 0,
      trRiskRev: 0,
      trRiskCogs: 0,
      stRiskRev: 0,
      stRiskCogs: 0,
      riskOrders: 0,
      estCogs: 0,
      adsUSD: 0,
      adsIQD: 0,
      fixed: zeroFixed(),
      fixedEstimated: false,
      drawings: 0,
    });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));

  // 3. Orders → order-date buckets.
  for (const o of orders) {
    const day = byDate.get(o.d);
    if (!day) continue;
    day.ordersPlaced += 1;
    const lines = orderLines(o, costs);
    const q = day.mature ? 0 : stillToReturn(daysBetween(o.d, today));
    let anyKept = false;
    let anyUndecided = false;
    for (const l of lines) {
      const unitCostVal = l.cost ?? l.unitNet * fallbackCostRatio;
      if (l.keptQty > 0) {
        anyKept = true;
        const rev = l.unitNet * l.keptQty;
        const cogs = unitCostVal * l.keptQty;
        if (l.cost == null) day.estCogs += cogs;
        if (l.turkey) {
          day.trRev += rev;
          day.trCogs += cogs;
          day.trRiskRev += rev * q;
          day.trRiskCogs += cogs * q;
        } else {
          day.stRev += rev;
          day.stCogs += cogs;
          day.stRiskRev += rev * q;
          day.stRiskCogs += cogs * q;
        }
      }
      if (l.undecidedQty > 0 && !day.mature) {
        anyUndecided = true;
        const rev = l.unitNet * l.undecidedQty;
        const cogs = unitCostVal * l.undecidedQty;
        if (l.turkey) {
          day.trPendRev += rev;
          day.trPendCogs += cogs;
        } else {
          day.stPendRev += rev;
          day.stPendCogs += cogs;
        }
      }
    }
    if (anyKept) {
      day.deliveredOrders += 1;
      day.riskOrders += q;
    }
    else if (anyUndecided) day.pendingOrders += 1;
  }

  // 4. Ads.
  const metaDaily = profit?.meta?.daily ?? {};
  let lastMetaDay: string | null = null;
  for (const [date, usd] of Object.entries(metaDaily)) {
    const day = byDate.get(date);
    if (!day) continue;
    day.adsUSD = usd;
    day.adsIQD = usd * adsRate(date);
    if (!lastMetaDay || date > lastMetaDay) lastMetaDay = date;
  }

  // 5. Fixed costs: monthly totals spread over the month.
  const odooDaily = profit?.odoo?.daily ?? {};
  const monthTotals = new Map<string, Record<FixedGroup, number>>();
  for (const [date, row] of Object.entries(odooDaily)) {
    const m = date.slice(0, 7);
    const t = monthTotals.get(m) ?? zeroFixed();
    for (const g of ["salaries", "turkey", "shipping", "other"] as const) {
      t[g] += row[g as ExpenseGroup] ?? 0;
    }
    monthTotals.set(m, t);
    const day = byDate.get(date);
    if (day) day.drawings += row.drawings ?? 0;
  }
  const currentMonth = today.slice(0, 7);
  const completeMonths = [...monthTotals.keys()].filter((m) => m < currentMonth).sort();
  const recent = completeMonths.slice(-3);
  // Median daily rate of the last (up to) 3 complete months — robust to a
  // one-off month (bonuses, a large agent settlement).
  const recentDailyRate = zeroFixed();
  if (recent.length > 0) {
    for (const g of ["salaries", "turkey", "shipping", "other"] as const) {
      recentDailyRate[g] = median(recent.map((m) => monthTotals.get(m)![g] / daysInMonth(m)));
    }
  }
  const hasOdoo = Object.keys(odooDaily).length > 0;
  for (const day of days) {
    const m = day.date.slice(0, 7);
    const dim = daysInMonth(m);
    day.fixed.rent = RULES.rentMonthlyIQD / dim;
    if (!hasOdoo) continue;
    const t = monthTotals.get(m) ?? zeroFixed();
    for (const g of ["salaries", "turkey", "shipping", "other"] as const) {
      const posted = t[g] / dim;
      if (m === currentMonth && recentDailyRate[g] > posted) {
        day.fixed[g] = recentDailyRate[g];
        day.fixedEstimated = true;
      } else {
        day.fixed[g] = posted;
      }
    }
  }

  return {
    days,
    keep,
    fallbackCostRatio,
    today,
    odooMonthly: profit?.odoo?.monthly ?? {},
    otherByAccount: profit?.odoo?.otherByAccount ?? {},
    health: {
      odooError: profit ? profit.odoo?.error ?? null : "profit.json not found yet",
      odooStale: Boolean(profit?.odoo?.stale),
      metaError: profit ? profit.meta?.error ?? null : "profit.json not found yet",
      metaStale: Boolean(profit?.meta?.stale),
      lastMetaDay,
      syncedAt: profit?.syncedAt ?? "",
    },
  };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

export function emptyTotals(): Totals {
  return {
    revenue: 0,
    trRev: 0,
    stRev: 0,
    cogs: 0,
    trGross: 0,
    stGross: 0,
    delivery: 0,
    ads: 0,
    adsUSD: 0,
    fixed: zeroFixed(),
    fixedTotal: 0,
    contribution: 0,
    net: 0,
    drawings: 0,
    ordersPlaced: 0,
    deliveredOrders: 0,
    projectedRev: 0,
    expectedReturnsRev: 0,
    estCogs: 0,
    days: 0,
  };
}

/** One day's totals in the chosen mode. */
export function dayTotals(d: DayRaw, keep: KeepRates, mode: Mode): Totals {
  const t = emptyTotals();
  const p = mode === "projected";
  const trRev = d.trRev + (p ? d.trPendRev * keep.turkey - d.trRiskRev : 0);
  const trCogs = d.trCogs + (p ? d.trPendCogs * keep.turkey - d.trRiskCogs : 0);
  const stRev = d.stRev + (p ? d.stPendRev * keep.stock - d.stRiskRev : 0);
  const stCogs = d.stCogs + (p ? d.stPendCogs * keep.stock - d.stRiskCogs : 0);
  const delivered =
    d.deliveredOrders + (p ? d.pendingOrders * keep.orders - d.riskOrders : 0);
  t.trRev = trRev;
  t.stRev = stRev;
  t.revenue = trRev + stRev;
  t.cogs = trCogs + stCogs;
  t.trGross = trRev - trCogs;
  t.stGross = stRev - stCogs;
  t.delivery = delivered * RULES.deliveryNetPerOrder;
  t.ads = d.adsIQD;
  t.adsUSD = d.adsUSD;
  t.fixed = { ...d.fixed };
  t.fixedTotal = FIXED_GROUPS.reduce((s, g) => s + d.fixed[g], 0);
  t.contribution = t.trGross + t.stGross + t.delivery - t.ads;
  t.net = t.contribution - t.fixedTotal;
  t.drawings = d.drawings;
  t.ordersPlaced = d.ordersPlaced;
  t.deliveredOrders = delivered;
  t.projectedRev = p ? d.trPendRev * keep.turkey + d.stPendRev * keep.stock : 0;
  t.expectedReturnsRev = p ? d.trRiskRev + d.stRiskRev : 0;
  t.estCogs = d.estCogs;
  t.days = 1;
  return t;
}

export function addTotals(a: Totals, b: Totals): Totals {
  const fixed = zeroFixed();
  for (const g of FIXED_GROUPS) fixed[g] = a.fixed[g] + b.fixed[g];
  return {
    revenue: a.revenue + b.revenue,
    trRev: a.trRev + b.trRev,
    stRev: a.stRev + b.stRev,
    cogs: a.cogs + b.cogs,
    trGross: a.trGross + b.trGross,
    stGross: a.stGross + b.stGross,
    delivery: a.delivery + b.delivery,
    ads: a.ads + b.ads,
    adsUSD: a.adsUSD + b.adsUSD,
    fixed,
    fixedTotal: a.fixedTotal + b.fixedTotal,
    contribution: a.contribution + b.contribution,
    net: a.net + b.net,
    drawings: a.drawings + b.drawings,
    ordersPlaced: a.ordersPlaced + b.ordersPlaced,
    deliveredOrders: a.deliveredOrders + b.deliveredOrders,
    projectedRev: a.projectedRev + b.projectedRev,
    expectedReturnsRev: a.expectedReturnsRev + b.expectedReturnsRev,
    estCogs: a.estCogs + b.estCogs,
    days: a.days + b.days,
  };
}

export function sumDays(days: DayRaw[], keep: KeepRates, mode: Mode): Totals {
  return days.reduce((acc, d) => addTotals(acc, dayTotals(d, keep, mode)), emptyTotals());
}

export interface MonthRow {
  month: string;
  totals: Totals;
  complete: boolean;
  /** Odoo's own net for the month (income − COGS − expenses − ads), if synced. */
  odooNet: number | null;
  /** Odoo COGS minus the realized goods cost computed here. */
  cogsGap: number | null;
}

export function monthRows(model: ProfitModel, mode: Mode): MonthRow[] {
  const groups = new Map<string, DayRaw[]>();
  for (const d of model.days) {
    const k = d.date.slice(0, 7);
    const arr = groups.get(k) ?? [];
    arr.push(d);
    groups.set(k, arr);
  }
  const current = model.today.slice(0, 7);
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, days]) => {
      const totals = sumDays(days, model.keep, mode);
      const realized = sumDays(days, model.keep, "realized");
      const o = model.odooMonthly[month];
      return {
        month,
        totals,
        complete: month < current,
        odooNet: o ? (o.income ?? 0) - (o.cogs ?? 0) - (o.expenses ?? 0) - (o.ads ?? 0) : null,
        cogsGap: o ? o.cogs - realized.cogs : null,
      };
    });
}

export type PeriodKey = "this-month" | "last-month" | "30d" | "90d" | "custom";

/** Inclusive custom range, YYYY-MM-DD (used when period === "custom"). */
export interface DateRange {
  from: string;
  to: string;
}

export function periodDays(
  model: ProfitModel,
  period: PeriodKey,
  range?: DateRange
): DayRaw[] {
  const t = model.today;
  const cur = t.slice(0, 7);
  const prevDate = new Date(`${cur}-01T12:00:00`);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prev = dayKey(prevDate).slice(0, 7);
  switch (period) {
    case "this-month":
      return model.days.filter((d) => d.date.startsWith(cur));
    case "last-month":
      return model.days.filter((d) => d.date.startsWith(prev));
    case "30d":
      return model.days.filter((d) => daysBetween(d.date, t) < 30);
    case "90d":
      return model.days.filter((d) => daysBetween(d.date, t) < 90);
    case "custom": {
      if (!range?.from || !range?.to) return [];
      const [a, b] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];
      return model.days.filter((d) => d.date >= a && d.date <= b);
    }
  }
}
