/**
 * Finance engine — pure Cash P&L math over the ops payload.
 *
 * Inputs:
 *   - ordersDetail / stockDetail from src/data/opsData.ts (Odoo sync)
 *   - daily + monthly expenses from src/data/expenseStore.ts
 *   - ads spend total (IQD) from src/data/adsProvider.ts for the window
 *
 * Cash-vs-paper honesty rules (per the finance plan):
 *   - CASH revenue counts DELIVERED quantities only (net of returns —
 *     returned items hand the cash back). Line discounts and the order-level
 *     discount are allocated pro-rata, then scaled by the delivered fraction.
 *   - PAPER revenue is the ordered value (what a naive "sales" readout says)
 *     — kept side-by-side so the inflation is visible.
 *   - Delivery economics: +1,000 IQD net per DELIVERED order (customer pays
 *     5,000, courier costs 4,000). Returns cost ZERO courier fees.
 *   - COGS matches line sku → stockDetail average cost; falls back to the
 *     model-level average cost map built from stockDetail; unknown SKUs are
 *     NOT guessed — their revenue share is flagged as % uncosted.
 *   - Fixed monthly overhead is prorated at total / 30 per day.
 *
 * No React, no fetch — everything is a pure function of its arguments.
 */

import type { OpsOrder, OpsStockItem } from "@/data/opsData";
import {
  DEFAULT_RENT_IQD,
  PRORATE_DAYS,
  type DailyExpense,
  type MonthlyExpense,
} from "@/data/expenseStore";

/** Customer pays 5,000 IQD delivery; courier costs 4,000 → +1,000 net. */
export const DELIVERY_NET_PER_ORDER_IQD = 1_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DayPnL {
  /** Local date "YYYY-MM-DD". */
  date: string;
  /** e.g. "Sep 7". */
  label: string;
  /** Delivered (net of returns) line value after discounts, IQD. */
  cashRev: number;
  /** Ordered line value after discounts, IQD. */
  paperRev: number;
  /** Cost of delivered units (known-cost lines only), IQD. */
  cogs: number;
  /** Ads spend allocated to this day (window total spread evenly), IQD. */
  ads: number;
  /** +1,000 IQD per delivered order. */
  deliveryNet: number;
  /** One-off daily expense entries that day, IQD. */
  dailyExpenses: number;
  /** Prorated fixed monthly overhead for the day, IQD. */
  proratedFixed: number;
  /** cashRev - cogs - ads + deliveryNet - dailyExpenses - proratedFixed. */
  netCash: number;
  ordersPlaced: number;
  deliveredOrders: number;
  /** Cash revenue on lines with no known cost, IQD. */
  uncostedValue: number;
}

export interface PnLTotals {
  cashRev: number;
  paperRev: number;
  cogs: number;
  ads: number;
  deliveryNet: number;
  dailyExpenses: number;
  proratedFixed: number;
  netCash: number;
  ordersPlaced: number;
  deliveredOrders: number;
  uncostedValue: number;
  /** uncostedValue / cashRev (0 when no revenue). */
  uncostedPct: number;
  /** paperRev vs cashRev inflation: (paper - cash) / paper (0 when no paper). */
  paperInflationPct: number;
}

export interface ChannelPnL extends PnLTotals {
  /** Order source label ("Instagram", "Facebook", …; "Unknown" when unset). */
  channel: string;
}

export interface UnitEconomics {
  deliveredOrders: number;
  /** Average cash revenue collected per delivered order. */
  revenuePerOrder: number;
  cogsPerOrder: number;
  adsPerOrder: number;
  /** Always +1,000 (delivery fee margin). */
  deliveryPerOrder: number;
  expensesPerOrder: number;
  /** The honest bottom line per delivered order (reference ≈ 25,000 IQD). */
  netPerOrder: number;
}

export interface FinanceResult {
  days: DayPnL[];
  totals: PnLTotals;
  /** ISO-week rollups, oldest first (key e.g. "2026-W36"). */
  weekly: { key: string; totals: PnLTotals }[];
  /** Calendar-month rollups, oldest first (key "YYYY-MM"). */
  monthly: { key: string; totals: PnLTotals }[];
  channels: ChannelPnL[];
  unitEconomics: UnitEconomics;
}

// ─── Cost maps ───────────────────────────────────────────────────────────────

export interface CostMaps {
  /** Variant sku → average cost (IQD). */
  bySku: Map<string, number>;
  /** Model code → qty-weighted average cost across its variants. */
  byModel: Map<string, number>;
}

export function buildCostMaps(stock: OpsStockItem[]): CostMaps {
  const bySku = new Map<string, number>();
  const acc = new Map<string, { qty: number; total: number }>();
  for (const s of stock) {
    if (Number.isFinite(s.cost)) bySku.set(s.sku, s.cost);
    const a = acc.get(s.model) ?? { qty: 0, total: 0 };
    // Weight by on-hand qty; fall back to 1 so zero-stock variants still count.
    const w = s.qty > 0 ? s.qty : 1;
    a.qty += w;
    a.total += s.cost * w;
    acc.set(s.model, a);
  }
  const byModel = new Map<string, number>();
  for (const [model, a] of acc) {
    if (a.qty > 0) byModel.set(model, a.total / a.qty);
  }
  return { bySku, byModel };
}

/** Unit cost for a line: exact variant match, else the model average. */
export function unitCostFor(sku: string, maps: CostMaps): number | null {
  const exact = maps.bySku.get(sku);
  if (exact != null) return exact;
  const model = sku.split(" (")[0];
  return maps.byModel.get(model) ?? null;
}

// ─── Order math ──────────────────────────────────────────────────────────────

/** Line gross value at the ordered quantity, after the line discount. */
function lineOrderedValue(line: OpsOrder["lines"][number]): number {
  return line.qty * line.price * (1 - line.discPct / 100);
}

/** Units that stayed with the customer (delivered minus returned). */
function netDeliveredQty(line: OpsOrder["lines"][number]): number {
  return Math.max(0, line.del - (line.ret ?? 0));
}

/** True when the order delivered at least one unit. */
export function isDeliveredOrder(order: OpsOrder): boolean {
  return order.lines.some((l) => l.del > 0);
}

interface OrderSplit {
  /** Ordered value after all discounts (paper), IQD. */
  paper: number;
  /** Delivered value after all discounts (cash), IQD. */
  cash: number;
  /** Cost of delivered units where the cost is known, IQD. */
  cogs: number;
  /** Cash revenue sitting on lines whose cost is unknown, IQD. */
  uncosted: number;
}

/**
 * Split one order into paper vs cash value with discounts allocated.
 * The order-level discount (negative) is spread pro-rata over the ordered
 * line values; each line's cash side takes its share scaled by that line's
 * delivered fraction.
 */
function splitOrder(order: OpsOrder, maps: CostMaps): OrderSplit {
  const lines = order.lines.filter((l) => l.qty > 0);
  const orderedSum = lines.reduce((s, l) => s + lineOrderedValue(l), 0);

  let paper = 0;
  let cash = 0;
  let cogs = 0;
  let uncosted = 0;

  for (const line of lines) {
    const ordered = lineOrderedValue(line);
    // Share of the order-level discount belonging to this line.
    const share = orderedSum > 0 ? (order.disc * ordered) / orderedSum : 0;
    const netQty = netDeliveredQty(line);
    const deliveredFrac = line.qty > 0 ? netQty / line.qty : 0;

    paper += ordered + share;
    const cashLine = ordered * deliveredFrac + share * deliveredFrac;
    cash += cashLine;

    if (netQty > 0) {
      const cost = unitCostFor(line.sku, maps);
      if (cost == null) uncosted += cashLine;
      else cogs += cost * netQty;
    }
  }
  return { paper, cash, cogs, uncosted };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

function emptyTotals(): PnLTotals {
  return {
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
}

function finalizeTotals(t: PnLTotals): PnLTotals {
  t.netCash =
    t.cashRev - t.cogs - t.ads + t.deliveryNet - t.dailyExpenses - t.proratedFixed;
  t.uncostedPct = t.cashRev > 0 ? t.uncostedValue / t.cashRev : 0;
  t.paperInflationPct = t.paperRev > 0 ? (t.paperRev - t.cashRev) / t.paperRev : 0;
  return t;
}

function addDayInto(t: PnLTotals, d: DayPnL): void {
  t.cashRev += d.cashRev;
  t.paperRev += d.paperRev;
  t.cogs += d.cogs;
  t.ads += d.ads;
  t.deliveryNet += d.deliveryNet;
  t.dailyExpenses += d.dailyExpenses;
  t.proratedFixed += d.proratedFixed;
  t.ordersPlaced += d.ordersPlaced;
  t.deliveredOrders += d.deliveredOrders;
  t.uncostedValue += d.uncostedValue;
}

/** Local "YYYY-MM-DD" for a Date. */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO week key, e.g. "2026-W36". */
export function weekKey(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day + 3); // Thursday of this week
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const fDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - fDay + 3);
  const week =
    1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${d.getFullYear()}-W${`${week}`.padStart(2, "0")}`;
}

const MONTH_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/**
 * Build the full finance result for a trailing window of `windowDays` days
 * ending today. `adsTotalIQD` is the ads spend for the SAME window; it is
 * spread evenly across days for the daily series (the ads bridge reports
 * window totals only) and attributed to channels pro-rata by cash revenue.
 */
export function computeFinance(
  orders: OpsOrder[],
  stock: OpsStockItem[],
  dailyExpenses: DailyExpense[],
  monthly: MonthlyExpense[],
  adsTotalIQD: number,
  windowDays: number,
  today: Date = new Date()
): FinanceResult {
  const maps = buildCostMaps(stock);

  // Day skeleton for the window (so zero-days still render on the chart).
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days: DayPnL[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    const date = dayKey(d);
    days.push({
      date,
      label: MONTH_FMT.format(d),
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
    });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));

  // Orders → their creation day (revenue is recognised by order date).
  for (const order of orders) {
    const day = byDate.get(order.d);
    if (!day) continue;
    const split = splitOrder(order, maps);
    day.ordersPlaced += 1;
    day.paperRev += split.paper;
    day.cashRev += split.cash;
    day.cogs += split.cogs;
    day.uncostedValue += split.uncosted;
    if (isDeliveredOrder(order)) {
      day.deliveredOrders += 1;
      day.deliveryNet += DELIVERY_NET_PER_ORDER_IQD;
    }
  }

  // Expenses (entries outside the window are ignored). Monthly overhead is
  // prorated at total / 30; months without a stored entry carry the default
  // rent only — same rule as expenseStore.monthlyExpenseFor.
  const monthMap = new Map(monthly.map((m) => [m.month, m]));
  for (const day of days) {
    day.dailyExpenses = dailyExpensesTotalFrom(dailyExpenses, day.date);
    const m = monthMap.get(day.date.slice(0, 7));
    day.proratedFixed =
      ((m?.salariesIQD ?? 0) +
        (m?.rentIQD ?? DEFAULT_RENT_IQD) +
        (m?.otherMonthlyIQD ?? 0)) /
      PRORATE_DAYS;
    day.ads = adsTotalIQD / Math.max(1, windowDays);
    day.netCash =
      day.cashRev -
      day.cogs -
      day.ads +
      day.deliveryNet -
      day.dailyExpenses -
      day.proratedFixed;
  }

  const totals = finalizeTotals(days.reduce((t, d) => (addDayInto(t, d), t), emptyTotals()));

  // Weekly + monthly rollups.
  const rollup = (keyOf: (date: string) => string) => {
    const map = new Map<string, PnLTotals>();
    for (const d of days) {
      const key = keyOf(d.date);
      const t = map.get(key) ?? emptyTotals();
      addDayInto(t, d);
      map.set(key, t);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, t]) => ({ key, totals: finalizeTotals(t) }));
  };
  const weekly = rollup(weekKey);
  const monthlyRollups = rollup((date) => date.slice(0, 7));

  // Per-channel P&L (order.src), ads attributed pro-rata by cash revenue.
  const channelMap = new Map<string, PnLTotals>();
  for (const order of orders) {
    if (!byDate.has(order.d)) continue;
    const channel = order.src?.trim() || "Unknown";
    const t = channelMap.get(channel) ?? emptyTotals();
    const split = splitOrder(order, maps);
    t.ordersPlaced += 1;
    t.paperRev += split.paper;
    t.cashRev += split.cash;
    t.cogs += split.cogs;
    t.uncostedValue += split.uncosted;
    if (isDeliveredOrder(order)) {
      t.deliveredOrders += 1;
      t.deliveryNet += DELIVERY_NET_PER_ORDER_IQD;
    }
    channelMap.set(channel, t);
  }
  const channels: ChannelPnL[] = [...channelMap.entries()]
    .map(([channel, t]) => {
      const ads =
        totals.cashRev > 0 ? (adsTotalIQD * t.cashRev) / totals.cashRev : 0;
      t.ads = ads;
      // Channel rows exclude daily/fixed expenses (not channel-attributable);
      // net = cashRev - cogs - ads + deliveryNet.
      t.dailyExpenses = 0;
      t.proratedFixed = 0;
      return { channel, ...finalizeTotals(t) };
    })
    .sort((a, b) => b.cashRev - a.cashRev);

  const deliveredOrders = totals.deliveredOrders;
  const unitEconomics: UnitEconomics = {
    deliveredOrders,
    revenuePerOrder: deliveredOrders > 0 ? totals.cashRev / deliveredOrders : 0,
    cogsPerOrder: deliveredOrders > 0 ? totals.cogs / deliveredOrders : 0,
    adsPerOrder: deliveredOrders > 0 ? totals.ads / deliveredOrders : 0,
    deliveryPerOrder: deliveredOrders > 0 ? DELIVERY_NET_PER_ORDER_IQD : 0,
    expensesPerOrder:
      deliveredOrders > 0
        ? (totals.dailyExpenses + totals.proratedFixed) / deliveredOrders
        : 0,
    netPerOrder: deliveredOrders > 0 ? totals.netCash / deliveredOrders : 0,
  };

  return {
    days,
    totals,
    weekly,
    monthly: monthlyRollups,
    channels,
    unitEconomics,
  };
}

// ─── Local helpers (keep the store's rounding rules out of the hot loop) ─────

function dailyExpensesTotalFrom(entries: DailyExpense[], date: string): number {
  let sum = 0;
  for (const e of entries) if (e.date === date) sum += e.amountIQD;
  return sum;
}
