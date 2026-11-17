/**
 * resale.json loader — written by scripts/resale_sync.py on every sync run.
 *
 *   steps        per ladder step (0 = first exposure, 1..4 = cost ladder):
 *                pieces entered, sold, 14-day sell-through, days to first sale
 *   byState      Odoo ladder lines by state (suggested = waiting approval)
 *   byStep       applied lines by current step (pieces, cost, price)
 *   daily        day → step → units sold at that step's price
 *   priceCheck   in-stock rows of the META LIQU sheet whose ad price differs
 *                from the price Odoo gives on the «تصفية» pricelist
 *
 * Returns null when the file is missing (sync not run yet).
 */

import { useEffect, useState } from "react";

export interface StepStat {
  openVariants: number;
  openPieces: number;
  entered: number;
  sold: number;
  maturedPieces: number;
  maturedSold14: number;
  sellThrough14: number | null;
  medianDaysToSale: number | null;
  soldLast7: number;
}

export interface PriceMismatch {
  kind: string;
  code: string;
  feed: string | null;
  adPrice: number;
  odooPrice: number;
  odooPrices?: number[];
  fullPrice: number;
  qty: number;
}

export interface ResaleItem {
  code: string;
  colour: string | null;
  state: string;
  step: number;
  proposedStep: number;
  price: number;
  proposed: number;
  full: number;
  cost: number;
  manual: number;
  idle: number;
  shown: number;
  offSeason: boolean;
  costIssue: string | null;
  qty: number;
  stageStart: string | null;
  nextReview: string | null;
}

export interface ResalePayload {
  syncedAt: string;
  today: string;
  window: number;
  byState: Record<string, { lines: number; pieces: number }>;
  byStep: Record<string, { lines: number; pieces: number; cost: number; price: number }>;
  steps: Record<string, StepStat>;
  daily: Record<string, Record<string, number>>;
  priceCheck: {
    checked: number;
    mismatchCount: number;
    tasfiyaIntegrated: boolean | null;
    note: string | null;
    mismatches: PriceMismatch[];
  };
  items: ResaleItem[];
}

const URL = "/data/resale.json";
const TIMEOUT_MS = 8000;

let cached: ResalePayload | null = null;
let inflight: Promise<ResalePayload | null> | null = null;

function isPayload(raw: unknown): raw is ResalePayload {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as Record<string, unknown>;
  return typeof p.steps === "object" && p.steps !== null && typeof p.priceCheck === "object";
}

export function loadResaleData(): Promise<ResalePayload | null> {
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
export function useResaleData(): ResalePayload | null | undefined {
  const [data, setData] = useState<ResalePayload | null | undefined>(cached ?? undefined);
  useEffect(() => {
    let alive = true;
    void loadResaleData().then((p) => {
      if (alive) setData(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/** Owner's ladder (2026-11-15): step → label. */
export const STEP_LABEL: Record<string, string> = {
  "0": "Full price (first exposure)",
  "1": "Cost + 15,000",
  "2": "Cost + 3,000",
  "3": "80% of cost",
  "4": "60% of cost",
};
