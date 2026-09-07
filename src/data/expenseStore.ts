/**
 * Expense store — Cash P&L (finance branch).
 *
 * localStorage-backed store for the two expense classes the finance page
 * tracks on top of Odoo/Meta data:
 *
 *   Daily   — one-off cash out the door on a given day (kind
 *             'turkey_shipping' = شحن تركيا cargo payments, or 'other').
 *   Monthly — fixed overhead per calendar month: salaries, rent
 *             (default 1,000 USD × 1,380 = 1,380,000 IQD) and other monthly.
 *             Monthly totals are prorated at total / 30 per day so the daily
 *             P&L carries its share of fixed costs.
 *
 * Tiny subscribe/notify pattern on `useSyncExternalStore` (same shape as
 * windowStore.ts) — every change persists and re-renders subscribers.
 */

import { useSyncExternalStore } from "react";

export const USD_IQD_RATE = 1380;
/** Default monthly rent: 1,000 USD × 1,380 = 1,380,000 IQD. */
export const DEFAULT_RENT_IQD = 1_000 * USD_IQD_RATE;
/** Fixed monthly totals are spread evenly: total / 30 per day. */
export const PRORATE_DAYS = 30;

export type DailyExpenseKind = "turkey_shipping" | "other";

export interface DailyExpense {
  id: string;
  /** Local date "YYYY-MM-DD". */
  date: string;
  kind: DailyExpenseKind;
  amountIQD: number;
  note: string;
}

export interface MonthlyExpense {
  /** "YYYY-MM". */
  month: string;
  salariesIQD: number;
  rentIQD: number;
  otherMonthlyIQD: number;
}

export const DAILY_KIND_META: Record<DailyExpenseKind, { label: string; arabic: string }> = {
  turkey_shipping: { label: "Turkey shipping", arabic: "شحن تركيا" },
  other: { label: "Other", arabic: "" },
};

const DAILY_KEY = "pulsestock.expenses.daily";
const MONTHLY_KEY = "pulsestock.expenses.monthly";

// ─── Persistence ─────────────────────────────────────────────────────────────

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode — persistence is best-effort */
  }
}

function isDailyExpense(v: unknown): v is DailyExpense {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.id === "string" &&
    typeof e.date === "string" &&
    (e.kind === "turkey_shipping" || e.kind === "other") &&
    typeof e.amountIQD === "number" &&
    Number.isFinite(e.amountIQD)
  );
}

function isMonthlyExpense(v: unknown): v is MonthlyExpense {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.month === "string" &&
    typeof e.salariesIQD === "number" &&
    typeof e.rentIQD === "number" &&
    typeof e.otherMonthlyIQD === "number"
  );
}

// ─── Store state ─────────────────────────────────────────────────────────────

interface ExpenseState {
  daily: DailyExpense[];
  monthly: MonthlyExpense[];
  /** Bumped on every mutation so useSyncExternalStore re-renders. */
  version: number;
}

function loadState(): ExpenseState {
  if (typeof window === "undefined") return { daily: [], monthly: [], version: 0 };
  return {
    daily: readJson<unknown[]>(DAILY_KEY, []).filter(isDailyExpense),
    monthly: readJson<unknown[]>(MONTHLY_KEY, []).filter(isMonthlyExpense),
    version: 0,
  };
}

let state: ExpenseState = loadState();

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function emit(): void {
  for (const l of listeners) l();
}

function commit(next: Omit<ExpenseState, "version">): void {
  state = { ...next, version: state.version + 1 };
  writeJson(DAILY_KEY, state.daily);
  writeJson(MONTHLY_KEY, state.monthly);
  emit();
}

function uid(): string {
  return `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Daily entries ───────────────────────────────────────────────────────────

export function getDailyExpenses(): DailyExpense[] {
  return state.daily;
}

export function addDailyExpense(
  entry: Omit<DailyExpense, "id">
): DailyExpense {
  const full: DailyExpense = { ...entry, id: uid() };
  commit({ daily: [...state.daily, full], monthly: state.monthly });
  return full;
}

export function updateDailyExpense(
  id: string,
  patch: Partial<Omit<DailyExpense, "id">>
): void {
  commit({
    daily: state.daily.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    monthly: state.monthly,
  });
}

export function removeDailyExpense(id: string): void {
  commit({
    daily: state.daily.filter((e) => e.id !== id),
    monthly: state.monthly,
  });
}

/** All daily entries for a local date "YYYY-MM-DD". */
export function dailyExpensesFor(date: string): DailyExpense[] {
  return state.daily.filter((e) => e.date === date);
}

/** Sum of daily entries on a date, IQD. */
export function dailyExpensesTotal(date: string): number {
  return dailyExpensesFor(date).reduce((s, e) => s + e.amountIQD, 0);
}

// ─── Monthly entries ─────────────────────────────────────────────────────────

export function getMonthlyExpenses(): MonthlyExpense[] {
  return state.monthly;
}

/** The stored entry for "YYYY-MM", or the defaults (rent pre-filled). */
export function monthlyExpenseFor(month: string): MonthlyExpense {
  const found = state.monthly.find((m) => m.month === month);
  return (
    found ?? {
      month,
      salariesIQD: 0,
      rentIQD: DEFAULT_RENT_IQD,
      otherMonthlyIQD: 0,
    }
  );
}

export function upsertMonthlyExpense(entry: MonthlyExpense): void {
  const rest = state.monthly.filter((m) => m.month !== entry.month);
  commit({ daily: state.daily, monthly: [...rest, entry] });
}

export function removeMonthlyExpense(month: string): void {
  commit({
    daily: state.daily,
    monthly: state.monthly.filter((m) => m.month !== month),
  });
}

/** Total fixed overhead for the month, IQD. */
export function monthlyTotal(entry: MonthlyExpense): number {
  return entry.salariesIQD + entry.rentIQD + entry.otherMonthlyIQD;
}

/** Prorated fixed cost per day for a "YYYY-MM-DD" date: month total / 30. */
export function proratedFixedFor(date: string): number {
  return monthlyTotal(monthlyExpenseFor(date.slice(0, 7))) / PRORATE_DAYS;
}

// ─── React hook ──────────────────────────────────────────────────────────────

/** Subscribe to the store; re-renders on every mutation (state ref changes). */
export function useExpenses(): ExpenseState {
  return useSyncExternalStore(subscribe, () => state);
}
