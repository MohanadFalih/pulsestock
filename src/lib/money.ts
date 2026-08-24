/**
 * Currency-aware money formatting.
 *
 * Mock mode formats USD ($-prefixed). When the live Odoo sync loads, it calls
 * `setCurrency()` with the company currency (IQD) and every `fmtMoney` caller
 * switches to "<n> IQD" style: 0 decimals, thousands separators, compact
 * suffix (k/M) for large values.
 */

let currency = "USD";

export function setCurrency(code: string): void {
  currency = code || "USD";
}

export function getCurrency(): string {
  return currency;
}

/** Compact magnitude: 12,400 → "12,400" · 1,240,000 → "1.2M". */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  }
  return Math.round(n).toLocaleString("en-US");
}

/** Money with the active currency, 0 decimals, compact for big numbers. */
export function fmtMoney(n: number): string {
  if (currency === "USD") return `$${compact(n)}`;
  return `${compact(n)} ${currency}`;
}

/** Two-decimal money (CAC-style); falls back to 0 decimals for non-USD. */
export function fmtMoney2(n: number): string {
  if (currency !== "USD") return fmtMoney(n);
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
