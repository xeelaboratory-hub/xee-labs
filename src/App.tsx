import { useEffect, useState } from "react";
import { TradingPage } from "./pages/TradingPage.tsx";
import { useAuthStore, useTradingStore } from "./services/store.tsx";

/**
 * Xee.Labs entry point.
 *
 * Restores a saved session when available, but market data and charting are
 * public. Authentication is only required for account and trading actions.
 */
export function App() {
  const [restoring, setRestoring] = useState(true);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const loadSymbols = useTradingStore((s) => s.loadSymbols);

  useEffect(() => {
    restoreSession().finally(() => setRestoring(false));
  }, [restoreSession]);

  useEffect(() => {
    loadSymbols();
  }, [loadSymbols]);

  if (restoring) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-neutral-400">
        Loading Xee.Labs…
      </div>
    );
  }

  return <TradingPage />;
}
