/**
 * Ops data loader — Cash P&L contract (Stage 3, data-layer branch).
 *
 * Reads the `ordersDetail` + `stockDetail` blocks that scripts/odoo_sync.py
 * appends to `public/data/live.json`. This module is SELF-CONTAINED: it does
 * not import from (or modify) any existing data module, and tolerates a
 * live.json that predates the new blocks (returns null).
 *
 * Compact wire format (see odoo_sync.py section 6c/6d):
 *   ordersDetail: [{id, d, src?, ful?, st, fee, disc, lines:[{sku, qty,
 *                 price, discPct, route?, del, ret?}]}]
 *   stockDetail:  [{sku, model, qty, cost, created}]
 */

import { useEffect, useState } from "react";

export const USD_IQD = 1380;

export interface OpsOrderLine {
  sku: string;
  qty: number;
  /** Cash charged for the line per unit (price_total / qty), IQD. */
  price: number;
  /** Discount percent, attached only when unambiguous (else 0). */
  discPct: number;
  /** "turkey" when the line routes "Order from Turkey"; omitted otherwise. */
  route?: "turkey";
  /** qty_delivered. */
  del: number;
  /** Returned qty from done return moves; omitted when 0. */
  ret?: number;
}

export interface OpsOrder {
  /** Order name, e.g. "S31874". */
  id: string;
  /** Local (Asia/Baghdad) creation date, "YYYY-MM-DD". */
  d: string;
  /** Order source label (utm.source), e.g. "Instagram"; omitted if unset. */
  src?: string;
  /** "نوع التجهيز" label (e.g. "تجهيز تركيا") or "turkey" fallback. */
  ful?: string;
  /** Odoo state: "sale" | "done". */
  st: string;
  /** Delivery fee total (folded from delivery lines), IQD. */
  fee: number;
  /** Order-level discount total (negative), IQD. */
  disc: number;
  lines: OpsOrderLine[];
}

export interface OpsStockItem {
  /** Variant display name, e.g. "H-1840 (عنابي / Murdum, 2)". */
  sku: string;
  /** Model code = sku before " (", e.g. "H-1840". */
  model: string;
  qty: number;
  /** Average cost (standard_price, AVCO) in IQD. */
  cost: number;
  /** Variant create_date, local "YYYY-MM-DD". */
  created: string;
}

export interface OpsPayload {
  syncedAt: string;
  currency: string;
  ordersDetail: OpsOrder[];
  stockDetail: OpsStockItem[];
}

const LIVE_URL = "/data/live.json";
const TIMEOUT_MS = 8000;

let cached: OpsPayload | null = null;
let inflight: Promise<OpsPayload | null> | null = null;

function isOpsPayload(raw: unknown): raw is OpsPayload {
  if (!raw || typeof raw !== "object") return false;
  const p = raw as Record<string, unknown>;
  return Array.isArray(p.ordersDetail) && Array.isArray(p.stockDetail);
}

/**
 * Fetch + cache the ops blocks from live.json. Returns null on ANY failure
 * (missing file, timeout, old payload without the new blocks). The result is
 * cached for the session — live.json refreshes hourly server-side.
 */
export function loadOpsData(): Promise<OpsPayload | null> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(`${LIVE_URL}?t=${Date.now()}`, {
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const raw: unknown = await res.json();
      if (!isOpsPayload(raw)) return null;
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

/** Tiny React hook wrapper around loadOpsData (null until loaded/failed). */
export function useOpsData(): OpsPayload | null {
  const [data, setData] = useState<OpsPayload | null>(cached);
  useEffect(() => {
    let alive = true;
    void loadOpsData().then((p) => {
      if (alive && p) setData(p);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}
