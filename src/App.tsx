import { useEffect, useState } from "react";
import { TradingPage } from "./pages/TradingPage.tsx";
import { api } from "./services/api.ts";
import {
  PREFERENCES_UPDATED_EVENT,
  readLocalPreferences,
  writeLocalPreferences,
} from "./services/preferences.ts";
import { useAuthStore, useTradingStore } from "./services/store.tsx";

/**
 * Xee.Labs entry point.
 *
 * Restores a saved session when available, but market data and charting are
 * public. Authentication is only required for account and trading actions.
 */
export function App() {
  const [restoring, setRestoring] = useState(true);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const user = useAuthStore((s) => s.user);
  const loadSymbols = useTradingStore((s) => s.loadSymbols);

  useEffect(() => {
    restoreSession().finally(() => setRestoring(false));
  }, [restoreSession]);

  useEffect(() => {
    loadSymbols();
  }, [loadSymbols]);

  useEffect(() => {
    if (restoring) return;
    let cancelled = false;
    setPreferencesReady(false);
    const local = readLocalPreferences(user?.id);

    const apply = (preferences: typeof local) => {
      writeLocalPreferences(preferences, user?.id, false);
      useTradingStore.setState({
        mode: preferences.tradingMode ?? "demo",
        selectedSymbol: preferences.selectedSymbol ?? "BINANCE:BTCUSD",
      });
    };

    if (!user) {
      apply(local);
      setPreferencesReady(true);
      return;
    }

    api
      .getPreferences()
      .then((server) => {
        if (cancelled) return;
        if (server.exists) apply(server.preferences);
        else {
          apply(local);
          return api.savePreferences(local);
        }
      })
      .catch(() => {
        if (!cancelled) apply(local);
      })
      .finally(() => {
        if (!cancelled) setPreferencesReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [restoring, user?.id]);

  useEffect(() => {
    if (!user || !preferencesReady) return;
    let timer: number | undefined;
    const save = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void api.savePreferences(readLocalPreferences(user.id));
      }, 500);
    };
    window.addEventListener(PREFERENCES_UPDATED_EVENT, save);
    return () => {
      window.removeEventListener(PREFERENCES_UPDATED_EVENT, save);
      window.clearTimeout(timer);
    };
  }, [user, preferencesReady]);

  if (restoring || !preferencesReady) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background text-muted-foreground">
        Loading Xee.Labs…
      </div>
    );
  }

  return <TradingPage />;
}
