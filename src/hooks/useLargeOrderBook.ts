import { useEffect, useMemo, useState } from "react";
import type { LargeOrderLevel, LargeOrderSource, LargeOrderThreshold } from "../services/api/market-data.ts";
import { PREFERENCES_UPDATED_EVENT, readLocalPreferences, updateLocalPreferences } from "../services/preferences.ts";
import { useLargeOrderBookHistory } from "../services/queries.ts";
import { useTradingStore } from "../services/store.tsx";

export type LargeOrderBookSettings = {
  threshold: LargeOrderThreshold;
  sources: LargeOrderSource[];
  showInactive: boolean;
};

function readSettings(): LargeOrderBookSettings {
  const preferences = readLocalPreferences();
  return {
    threshold: preferences.largeOrderBookThreshold ?? 1_000_000,
    sources: preferences.largeOrderBookSources ?? ["binance", "okx"],
    showInactive: preferences.largeOrderBookShowInactive ?? false,
  };
}

export function useLargeOrderBook(selectedSymbol: string, enabled = true, range?: { from: string; to: string }, historyLimit?: number) {
  const [settings, setSettings] = useState(readSettings);
  const base = selectedSymbol.includes("ETH") ? "ETH" : "BTC";
  const books = useTradingStore((state) => state.largeOrderBooks);
  const live = useMemo(
    () => settings.sources.flatMap((source) => books[`${source.toUpperCase()}:${base}USD`] ?? []),
    [base, books, settings.sources],
  );
  const history = useLargeOrderBookHistory(
    base,
    settings.sources,
    settings.threshold,
    range?.from,
    range?.to,
    enabled && settings.showInactive && (range !== undefined || historyLimit !== undefined),
    historyLimit,
  );

  useEffect(() => {
    const refresh = () => setSettings(readSettings());
    window.addEventListener(PREFERENCES_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, refresh);
  }, []);

  const levels = useMemo(() => {
    const merged = new Map<string, LargeOrderLevel>();
    for (const level of history.data ?? []) merged.set(level.id, level);
    for (const level of live) merged.set(level.id, level);
    return [...merged.values()].filter((level) => {
      if (!settings.sources.includes(level.source)) return false;
      if (level.endedAt) return settings.showInactive && level.peakNotional >= settings.threshold;
      return level.currentNotional >= settings.threshold;
    });
  }, [history.data, live, settings]);

  const updateSettings = (patch: Partial<LargeOrderBookSettings>) => {
    const next = { ...settings, ...patch };
    updateLocalPreferences({
      largeOrderBookThreshold: next.threshold,
      largeOrderBookSources: next.sources,
      largeOrderBookShowInactive: next.showInactive,
    });
    setSettings(next);
  };

  return { levels, settings, updateSettings, historyUnavailable: history.isError };
}
