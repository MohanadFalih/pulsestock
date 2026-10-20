/**
 * profit.json loader — inputs for the Real Profit page that live.json does
 * not carry (written by scripts/profit_sync.py on every sync run):
 *
 *   odoo.daily     date → { salaries, turkey, shipping, other, drawings } IQD
 *                  (posted journal items on the fixed-cost accounts)
 *   odoo.monthly   "YYYY-MM" → Odoo's own P&L { income, cogs, expenses, ads }
 *   meta.daily     date → Meta account spend, USD
 *
 * Either half may carry `error` (fetch failed) and `stale: true` (the
 * previous good data was kept). Returns null when the file is missing.
 */

import { useEffect, useState } from "react";

export type ExpenseGroup = "salaries" | "turkey" | "shipping" | "other" | "drawings";

export interface ProfitOdoo {
  error: string | null;
  stale?: boolean;
  since?: string;
  daily?: Record<string, Partial<Record<ExpenseGroup, number>>>;
  otherByAccount?: Record<string, number>;
  monthly?: Record<string, { income: number; cogs: number; expenses: number; ads: number }>;
}

export interface ProfitMeta {
  error: string | null;
  stale?: boolean;
  since?: string;
  daily?: Record<string, number>;
}

export interface ProfitPayload {
  syncedAt: string;
  odoo: ProfitOdoo;
  meta: ProfitMeta;
}

const URL = "/data/profit.json";
const TIMEOUT_MS = 8000;

let cached: ProfitPayload | null = null;
let inflight: Promise<ProfitPayload | null> | null = null;

function isPayload(raw: unknown): raw is ProfitPayload {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as Record<string, unknown>;
  return typeof p.odoo === "object" && p.odoo !== null && typeof p.meta === "object" && p.meta !== null;
}

export function loadProfitData(): Promise<ProfitPayload | null> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(`${URL}?t=${Date.now()}`, { signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) return null;
      const raw: unknown = await res.json();
      if (!isPayload(raw)) return null;
      cached = raw;
      return cached;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** `undefined` while loading, `null` when the file is missing/unreadable. */
export function useProfitData(): ProfitPayload | null | undefined {
  const [data, setData] = useState<ProfitPayload | null | undefined>(cached ?? undefined);
  useEffect(() => {
    let alive = true;
    void loadProfitData().then((p) => {
      if (alive) setData(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}
