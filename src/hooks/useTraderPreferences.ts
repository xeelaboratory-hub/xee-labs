import { useEffect, useMemo, useState } from "react";
import { readLocalPreferences, updateLocalPreferences } from "../services/preferences.ts";
import { useAuthStore } from "../services/store.tsx";

export type TraderPrefs = Record<string, string>;

const CHART_PREFS_UPDATED_EVENT = "chart-preferences-updated";

export function readTraderPrefs(userId?: string | null): TraderPrefs {
  return readLocalPreferences(userId).chart;
}

export function writeTraderPrefs(prefs: TraderPrefs, userId?: string | null): void {
  updateLocalPreferences({ chart: prefs }, userId);
}

export function applyAccentColorFromPrefs(prefs: TraderPrefs): void {
  const accent = prefs.accentColor;
  if (!accent) return;
  document.documentElement.style.setProperty("--accent", accent);
}

function dispatchChartPrefsUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHART_PREFS_UPDATED_EVENT));
}

export function useTraderPreferences() {
  const userId = useAuthStore((s) => s.user?.id);
  const [prefs, setPrefs] = useState<TraderPrefs>(() => readTraderPrefs(userId));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const local = readTraderPrefs(userId);
    setPrefs(local);
    applyAccentColorFromPrefs(local);
    setLoaded(true);
  }, [userId]);

  const savePreferences = useMemo(
    () => (next: TraderPrefs) => {
      setPrefs(next);
      writeTraderPrefs(next, userId);
      applyAccentColorFromPrefs(next);
      dispatchChartPrefsUpdated();
    },
    [userId],
  );

  const savePreference = useMemo(
    () => (key: string, value: string) => {
      const next = { ...prefs, [key]: value };
      savePreferences(next);
    },
    [prefs, savePreferences],
  );

  return {
    prefs,
    loaded,
    savePreference,
    savePreferences,
  };
}
