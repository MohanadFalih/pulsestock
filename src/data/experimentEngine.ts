/**
 * Budget experiment engine (agreed with the owner 2026-10-21).
 *
 * Design: alternate the daily Meta budget week by week — 300 → 400 → 300 →
 * 400 USD — with no ad changes inside a week (in 400 weeks only sold-out
 * Turkey models are swapped for their replacement). Adjacent weeks share a
 * similar model mix, so each 400 week is judged against its 300 neighbours.
 *
 * Metric: profit before fixed costs per day (gross margin + delivery − ads),
 * projected mode, by order date. Fixed costs don't move with the budget.
 *
 * Decision rule (written before the test): 400 becomes the standing budget
 * only if every 400 week beats its 300 neighbour average by ≥ 50,000 IQD/day.
 * Otherwise the standing budget is 300.
 *
 * Also computes Meta delivery health (CPM, link CTR, cost per conversation,
 * daily frequency) against a 60-day baseline, and the Turkey model mix of
 * each week so a strong or weak model can be accounted for.
 *
 * Pure functions, no React.
 */

import type { OpsOrder } from "@/data/opsData";
import type { MetaDayDetail, ProfitPayload } from "@/data/profitData";
import { dayTotals, type ProfitModel } from "@/data/profitEngine";

export interface Block {
  key: string;
  label: string;
  start: string;
  end: string;
  budgetUSD: number;
}

export const EXPERIMENT = {
  start: "2026-10-22",
  blocks: [
    { key: "w1", label: "Week 1", start: "2026-10-22", end: "2026-10-28", budgetUSD: 300 },
    { key: "w2", label: "Week 2", start: "2026-10-29", end: "2026-11-04", budgetUSD: 400 },
    { key: "w3", label: "Week 3", start: "2026-11-05", end: "2026-11-11", budgetUSD: 300 },
    { key: "w4", label: "Week 4", start: "2026-11-12", end: "2026-11-18", budgetUSD: 400 },
  ] as Block[],
  /** 400 week vs its 300 neighbours. */
  comparisons: [
    { test: "w2", against: ["w1", "w3"] },
    { test: "w4", against: ["w3"] },
  ],
  winMarginIQD: 50_000,
  /** Days after a week ends before its numbers count (orders mostly delivered). */
  settleDays: 7,
  spendTolerance: 0.1,
  baselineDays: 60,
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function datesBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

const MODEL_RE = /^([A-Za-z]+)-?(\d+)/;
export function modelOf(sku: string): string {
  const m = MODEL_RE.exec(sku.trim());
  return m ? `${m[1].toUpperCase()}-${m[2]}` : sku.trim().toUpperCase();
}

// ─── Delivery health ─────────────────────────────────────────────────────────

export interface Health {
  days: number;
  spendUSD: number;
  /** USD per 1,000 impressions. */
  cpm: number | null;
  /** Link clicks / impressions, 0–1. */
  ctr: number | null;
  /** USD per messaging conversation. */
  costPerConv: number | null;
  /** Average of daily impressions / reach. */
  frequency: number | null;
  convPerDay: number | null;
}

export function healthOf(detail: Record<string, MetaDayDetail>, dates: string[]): Health {
  let spend = 0;
  let impr = 0;
  let clicks = 0;
  let conv = 0;
  const freqs: number[] = [];
  let days = 0;
  for (const d of dates) {
    const r = detail[d];
    if (!r || r.spend <= 0) continue;
    days += 1;
    spend += r.spend;
    impr += r.impr;
    clicks += r.clicks;
    conv += r.conv;
    if (r.reach > 0) freqs.push(r.impr / r.reach);
  }
  return {
    days,
    spendUSD: spend,
    cpm: impr > 0 ? (spend / impr) * 1000 : null,
    ctr: impr > 0 ? clicks / impr : null,
    costPerConv: conv > 0 ? spend / conv : null,
    frequency: freqs.length ? freqs.reduce((a, b) => a + b, 0) / freqs.length : null,
    convPerDay: days > 0 ? conv / days : null,
  };
}

export type Tone = "ok" | "warn" | "na";

export interface HealthSignal {
  key: "cpm" | "ctr" | "costPerConv" | "frequency";
  label: string;
  value: number | null;
  baseline: number | null;
  /** value / baseline − 1. */
  change: number | null;
  tone: Tone;
  note: string;
}

/** Thresholds: a metric is flagged when it moves this far the wrong way. */
const LIMITS = { cpm: 0.2, ctr: -0.2, costPerConv: 0.25, frequency: 0.25 };

export function healthSignals(now: Health, base: Health): HealthSignal[] {
  const sig = (
    key: HealthSignal["key"],
    label: string,
    v: number | null,
    b: number | null,
    bad: (c: number) => boolean,
    warnNote: string,
    okNote: string
  ): HealthSignal => {
    const change = v != null && b != null && b > 0 ? v / b - 1 : null;
    const tone: Tone = change == null ? "na" : bad(change) ? "warn" : "ok";
    return { key, label, value: v, baseline: b, change, tone, note: tone === "warn" ? warnNote : okNote };
  };
  return [
    sig("cpm", "CPM", now.cpm, base.cpm, (c) => c > LIMITS.cpm,
      "Reaching people got more expensive — competition or a narrow audience",
      "Cost to reach people is normal"),
    sig("ctr", "Link CTR", now.ctr, base.ctr, (c) => c < LIMITS.ctr,
      "Fewer people click — creatives or models are tiring",
      "Ads are clicked as usual"),
    sig("costPerConv", "Cost / conversation", now.costPerConv, base.costPerConv, (c) => c > LIMITS.costPerConv,
      "Each chat costs more than usual",
      "Chats cost what they usually cost"),
    sig("frequency", "Daily frequency", now.frequency, base.frequency, (c) => c > LIMITS.frequency,
      "The same people see the ads more often — audience saturating",
      "Audience is not saturated"),
  ];
}

// ─── Weeks ───────────────────────────────────────────────────────────────────

export type BlockStatus = "upcoming" | "running" | "settling" | "settled";

export interface ModelShare {
  model: string;
  units: number;
  share: number;
  /** First Turkey sale inside this week or the 3 days before it. */
  isNew: boolean;
  /** Share of SKU-attributed Meta spend in the week. */
  spendShare: number | null;
}

export interface BlockResult {
  block: Block;
  status: BlockStatus;
  /** Completed days counted (today excluded). */
  days: number;
  adsUSDPerDay: number;
  /** Actual spend more than ±10% off plan. */
  offPlan: boolean;
  contributionPerDay: number;
  netPerDay: number;
  turkeyOrdersPerDay: number;
  /** Turkey gross margin per Turkey order — the "model strength" gauge. */
  turkeyGrossPerOrder: number | null;
  /** FB + IG orders / Meta conversations. */
  closeRate: number | null;
  health: Health;
  models: ModelShare[];
  /** One model took ≥ 30% of Turkey units or of spend. */
  concentrated: string | null;
}

export interface Comparison {
  test: string;
  against: string[];
  /** test − average(against), IQD/day; null until all weeks are settled. */
  diffPerDay: number | null;
  provisionalDiff: number | null;
  pass: boolean | null;
}

export interface ExperimentResult {
  blocks: BlockResult[];
  comparisons: Comparison[];
  /** Standing budget once every week is settled; null before. */
  decisionUSD: 300 | 400 | null;
  decisionReady: boolean;
  baseline: Health;
  last7: Health;
  last7Signals: HealthSignal[];
  today: string;
  hasDetail: boolean;
}

export function computeExperiment(
  model: ProfitModel,
  orders: OpsOrder[],
  profit: ProfitPayload | null
): ExperimentResult {
  const today = model.today;
  const yesterday = addDays(today, -1);
  const detail = profit?.meta?.detail ?? {};
  const skuDaily = profit?.meta?.skuDaily ?? {};
  const byDate = new Map(model.days.map((d) => [d.date, d]));

  // Orders per day: Turkey orders, FB/IG orders, Turkey units per model.
  const trOrders = new Map<string, number>();
  const socialOrders = new Map<string, number>();
  const firstTurkey = new Map<string, string>();
  for (const o of orders) {
    const tr = o.lines.some((l) => l.route === "turkey");
    if (tr) trOrders.set(o.d, (trOrders.get(o.d) ?? 0) + 1);
    if (o.src === "Facebook" || o.src === "Instagram") socialOrders.set(o.d, (socialOrders.get(o.d) ?? 0) + 1);
    for (const l of o.lines) {
      if (l.route !== "turkey") continue;
      const m = modelOf(l.sku);
      const prev = firstTurkey.get(m);
      if (!prev || o.d < prev) firstTurkey.set(m, o.d);
    }
  }

  const baselineDates = datesBetween(addDays(EXPERIMENT.start, -EXPERIMENT.baselineDays), addDays(EXPERIMENT.start, -1));
  const baseline = healthOf(detail, baselineDates);

  const blocks: BlockResult[] = EXPERIMENT.blocks.map((block) => {
    const status: BlockStatus =
      today < block.start
        ? "upcoming"
        : today <= block.end
          ? "running"
          : today < addDays(block.end, EXPERIMENT.settleDays)
            ? "settling"
            : "settled";
    const lastDay = block.end < yesterday ? block.end : yesterday;
    const dates = lastDay >= block.start ? datesBetween(block.start, lastDay) : [];

    let ads = 0;
    let contribution = 0;
    let net = 0;
    let trGross = 0;
    let trCount = 0;
    let social = 0;
    let days = 0;
    for (const d of dates) {
      const raw = byDate.get(d);
      if (!raw) continue;
      const t = dayTotals(raw, model.keep, "projected");
      days += 1;
      ads += t.adsUSD;
      contribution += t.contribution;
      net += t.net;
      trGross += t.trGross;
      trCount += trOrders.get(d) ?? 0;
      social += socialOrders.get(d) ?? 0;
    }
    const health = healthOf(detail, dates);

    // Model mix (Turkey units) and spend shares.
    const units = new Map<string, number>();
    const inBlock = new Set(dates);
    for (const o of orders) {
      if (!inBlock.has(o.d)) continue;
      for (const l of o.lines) {
        if (l.route !== "turkey" || l.qty <= 0) continue;
        const m = modelOf(l.sku);
        units.set(m, (units.get(m) ?? 0) + l.qty);
      }
    }
    const spendBy = new Map<string, number>();
    let spendTotal = 0;
    for (const d of dates) {
      for (const [sku, usd] of Object.entries(skuDaily[d] ?? {})) {
        if (sku === "OTHER") continue;
        const m = modelOf(sku);
        spendBy.set(m, (spendBy.get(m) ?? 0) + usd);
        spendTotal += usd;
      }
    }
    const totalUnits = [...units.values()].reduce((a, b) => a + b, 0);
    const newFrom = addDays(block.start, -3);
    const names = new Set([...units.keys(), ...spendBy.keys()]);
    const modelsArr: ModelShare[] = [...names]
      .map((m) => ({
        model: m,
        units: units.get(m) ?? 0,
        share: totalUnits > 0 ? (units.get(m) ?? 0) / totalUnits : 0,
        isNew: (firstTurkey.get(m) ?? "") >= newFrom,
        spendShare: spendTotal > 0 ? (spendBy.get(m) ?? 0) / spendTotal : null,
      }))
      .sort((a, b) => b.units - a.units || (b.spendShare ?? 0) - (a.spendShare ?? 0))
      .slice(0, 8);
    const concentrated =
      modelsArr.find((m) => m.share >= 0.3 || (m.spendShare ?? 0) >= 0.3)?.model ?? null;

    return {
      block,
      status,
      days,
      adsUSDPerDay: days ? ads / days : 0,
      offPlan: days > 0 && Math.abs(ads / days / block.budgetUSD - 1) > EXPERIMENT.spendTolerance,
      contributionPerDay: days ? contribution / days : 0,
      netPerDay: days ? net / days : 0,
      turkeyOrdersPerDay: days ? trCount / days : 0,
      turkeyGrossPerOrder: trCount > 0 ? trGross / trCount : null,
      closeRate: health.convPerDay && health.days ? social / days / health.convPerDay : null,
      health,
      models: modelsArr,
      concentrated,
    };
  });

  const byKey = new Map(blocks.map((b) => [b.block.key, b]));
  const comparisons: Comparison[] = EXPERIMENT.comparisons.map((c) => {
    const t = byKey.get(c.test)!;
    const others = c.against.map((k) => byKey.get(k)!);
    const withData = [t, ...others].every((b) => b.days > 0);
    const settled = [t, ...others].every((b) => b.status === "settled");
    const avg = others.reduce((s, b) => s + b.contributionPerDay, 0) / Math.max(1, others.length);
    const diff = withData ? t.contributionPerDay - avg : null;
    return {
      test: c.test,
      against: [...c.against],
      provisionalDiff: diff,
      diffPerDay: settled ? diff : null,
      pass: settled && diff != null ? diff >= EXPERIMENT.winMarginIQD : null,
    };
  });
  const decisionReady = comparisons.every((c) => c.pass != null);
  const decisionUSD = decisionReady ? (comparisons.every((c) => c.pass) ? 400 : 300) : null;

  const last7Dates = datesBetween(addDays(today, -7), yesterday);
  const last7Base = datesBetween(addDays(today, -7 - EXPERIMENT.baselineDays), addDays(today, -8));
  const last7 = healthOf(detail, last7Dates);

  return {
    blocks,
    comparisons,
    decisionUSD,
    decisionReady,
    baseline,
    last7,
    last7Signals: healthSignals(last7, healthOf(detail, last7Base)),
    today,
    hasDetail: Object.keys(detail).length > 0,
  };
}
