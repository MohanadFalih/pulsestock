/**
 * Global dashboard window state (the Topbar date-range pill) + an ads-version
 * counter for in-place re-renders after an async Meta ads re-fetch.
 *
 * Implemented as a tiny module-level store on `useSyncExternalStore` so every
 * consuming component updates instantly when the window changes — no page
 * reload, no context provider.
 *
 * `windowDays` is persisted to localStorage ("pulsestock.windowDays").
 * Valid values: 7 | 14 | 30 | 90 (default 30).
 */

import { useSyncExternalStore } from "react";

export const WINDOW_OPTIONS = [7, 14, 30, 90] as const;
export type WindowDays = (typeof WINDOW_OPTIONS)[number];

const STORAGE_KEY = "pulsestock.windowDays";
const DEFAULT_WINDOW: WindowDays = 30;

function loadInitialWindow(): WindowDays {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return (WINDOW_OPTIONS as readonly number[]).includes(n)
      ? (n as WindowDays)
      : DEFAULT_WINDOW;
  } catch {
    return DEFAULT_WINDOW;
  }
}

interface StoreState {
  windowDays: WindowDays;
  /** Bumped each time fresh Meta ads data is merged (async re-fetch). */
  adsVersion: number;
}

let state: StoreState = {
  windowDays:
    typeof window === "undefined" ? DEFAULT_WINDOW : loadInitialWindow(),
  adsVersion: 0,
};

const listeners = new Set<() => void>();
/** Extra listeners fired only on window changes (used by liveSync to re-fetch ads). */
const windowListeners = new Set<(days: WindowDays) => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Currently selected portfolio window in days (7 | 14 | 30 | 90). */
export function getWindowDays(): WindowDays {
  return state.windowDays;
}

/** Select a new window; persists and notifies every subscriber. */
export function setWindowDays(days: number): void {
  if (!(WINDOW_OPTIONS as readonly number[]).includes(days)) return;
  const next = days as WindowDays;
  if (next === state.windowDays) return;
  state = { ...state, windowDays: next };
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* private mode — persistence is best-effort */
  }
  emit();
  for (const l of windowListeners) l(next);
}

/** Monotonic counter bumped when fresh ads data has been merged. */
export function getAdsVersion(): number {
  return state.adsVersion;
}

/** Signal that ads-dependent components should re-render in place. */
export function bumpAdsVersion(): void {
  state = { ...state, adsVersion: state.adsVersion + 1 };
  emit();
}

/**
 * Subscribe to window changes only (no React). Returns an unsubscribe fn.
 * Used by src/data/liveSync.ts to re-fetch ads with the matching preset.
 */
export function subscribeWindowChange(
  cb: (days: WindowDays) => void
): () => void {
  windowListeners.add(cb);
  return () => {
    windowListeners.delete(cb);
  };
}

/** React hook: the selected window in days; re-renders on change. */
export function useWindowDays(): WindowDays {
  return useSyncExternalStore(subscribe, () => state.windowDays);
}

/** React hook: ads data version; re-renders when fresh ads data lands. */
export function useAdsVersion(): number {
  return useSyncExternalStore(subscribe, () => state.adsVersion);
}
