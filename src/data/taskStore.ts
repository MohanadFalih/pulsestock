/**
 * Daily task completion store — localStorage, per-day scoped.
 *
 * Shape: { days: { "2025-12-05": { "kill:PLD-013": true, ... } }, config: {...} }
 *
 * Daily reset logic: completion is keyed by local ISO day, so a new day simply
 * starts with an empty map — yesterday's checks never leak into today. Days
 * older than KEEP_DAYS are pruned on every write so the blob stays small.
 *
 * Follows windowStore.ts conventions: module-level store on
 * useSyncExternalStore, best-effort persistence (private mode tolerated).
 */

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "pulsestock.dailyTasks.v1";
/** Retention for finished days (history is only kept for the tiny blob). */
const KEEP_DAYS = 7;

export interface TaskQuotaConfig {
  /** New models to publish per day (engine default: 2). */
  publishTargetPerDay: number;
  /** Stale units to list for direct sale per day (engine default: 10). */
  directListTargetPerDay: number;
}

const DEFAULT_QUOTA: TaskQuotaConfig = {
  publishTargetPerDay: 2,
  directListTargetPerDay: 10,
};

interface StoreShape {
  days: Record<string, Record<string, boolean>>;
  config: TaskQuotaConfig;
}

/** Local (not UTC) ISO day — matches how the shop thinks about "today". */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function load(): StoreShape {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoreShape>;
      return {
        days: parsed.days && typeof parsed.days === "object" ? parsed.days : {},
        config: { ...DEFAULT_QUOTA, ...(parsed.config ?? {}) },
      };
    }
  } catch {
    /* corrupt blob or private mode — start clean */
  }
  return { days: {}, config: { ...DEFAULT_QUOTA } };
}

let state: StoreShape =
  typeof window === "undefined" ? { days: {}, config: { ...DEFAULT_QUOTA } } : load();

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function persist(next: StoreShape): void {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode — persistence is best-effort */
  }
  for (const l of listeners) l();
}

/** Drop day buckets older than KEEP_DAYS (the "reset" sweeper). */
function prune(days: StoreShape["days"], today: string): StoreShape["days"] {
  const cutoff = new Date(`${today}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const out: StoreShape["days"] = {};
  for (const [day, map] of Object.entries(days)) {
    if (new Date(`${day}T00:00:00`) >= cutoff) out[day] = map;
  }
  return out;
}

/** Is this task checked off today? */
export function isTaskDone(taskId: string, date: Date = new Date()): boolean {
  return state.days[todayKey(date)]?.[taskId] === true;
}

/** Check/uncheck a task for today; unchecking removes the key. */
export function setTaskDone(taskId: string, done: boolean, date: Date = new Date()): void {
  const key = todayKey(date);
  const dayMap = { ...(state.days[key] ?? {}) };
  if (done) dayMap[taskId] = true;
  else delete dayMap[taskId];
  persist({ ...state, days: prune({ ...state.days, [key]: dayMap }, key) });
}

/** How many of the given task ids are done today. */
export function doneToday(taskIds: string[], date: Date = new Date()): number {
  const map = state.days[todayKey(date)] ?? {};
  return taskIds.reduce((a, id) => a + (map[id] ? 1 : 0), 0);
}

/** Current quota targets (editable on the Tasks page). */
export function getQuotaConfig(): TaskQuotaConfig {
  return state.config;
}

export function setQuotaConfig(patch: Partial<TaskQuotaConfig>): void {
  persist({ ...state, config: { ...state.config, ...patch } });
}

// ─── React bindings ──────────────────────────────────────────────────────────

const EMPTY_MAP: Record<string, boolean> = {};

interface Snapshot {
  doneMap: Record<string, boolean>;
  config: TaskQuotaConfig;
}

// useSyncExternalStore requires a referentially stable snapshot between
// store mutations — cache by (state reference, day key).
let snapCache: { stateRef: StoreShape; key: string; snap: Snapshot } | null = null;

function getSnapshot(key: string): Snapshot {
  if (snapCache && snapCache.stateRef === state && snapCache.key === key) {
    return snapCache.snap;
  }
  const snap: Snapshot = {
    doneMap: state.days[key] ?? EMPTY_MAP,
    config: state.config,
  };
  snapCache = { stateRef: state, key, snap };
  return snap;
}

/**
 * Subscribe to the store. Returns today's completion map + quota config —
 * components re-render on every check/uncheck or quota change.
 */
export function useTaskStore(date: Date = new Date()): Snapshot {
  const key = todayKey(date);
  return useSyncExternalStore(subscribe, () => getSnapshot(key));
}
