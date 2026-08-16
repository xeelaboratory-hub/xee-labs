import { useEffect, useState } from "react";
import { LoginPage } from "./pages/LoginPage.tsx";
import { TradingPage } from "./pages/TradingPage.tsx";
import { useAuthStore, useTradingStore } from "./services/store.tsx";

/**
 * Xee.Labs entry point.
 *
 * Requires a real login (services/store.tsx's authStore, backed by
 * backend/app/auth) before rendering the terminal. Once authenticated, loads
 * the real symbol universe and starts the market-data WS.
 */
export function App() {
  const [restoring, setRestoring] = useState(true);
  const accessToken = useAuthStore((s) => s.accessToken);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const loadSymbols = useTradingStore((s) => s.loadSymbols);

  useEffect(() => {
    restoreSession().finally(() => setRestoring(false));
  }, [restoreSession]);

  useEffect(() => {
    if (accessToken) loadSymbols();
  }, [accessToken, loadSymbols]);

  if (restoring) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-neutral-400">
        Loading Xee.Labs…
      </div>
    );
  }

  if (!accessToken) return <LoginPage />;

  return <TradingPage />;
}
