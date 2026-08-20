import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { ThemeSwitcher } from "../../components/ThemeSwitcher.tsx";
import { api } from "../../services/api.ts";
import { ApiError } from "../../services/api/request.ts";
import { useAuthStore, useTradingStore } from "../../services/store.tsx";
import { cn } from "../../lib/utils.ts";
import type { TradingMode } from "../../services/schemas.ts";

/**
 * Global trading status bar — DEMO/LIVE mode, exchange connection status,
 * equity, theme, and an entry point into Settings. Always visible (mounted
 * in Footer, not gated by the right panel); account/API management lives in
 * the Settings view (see TradingPage's showSettings toggle) so this stays a
 * thin, always-on strip.
 */
export function AccountPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const mode = useTradingStore((s) => s.mode);
  const setMode = useTradingStore((s) => s.setMode);
  const loadPositions = useTradingStore((s) => s.loadPositions);
  const loadOrders = useTradingStore((s) => s.loadOrders);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();

  const { error: accountError } = useQuery({
    queryKey: ["account", mode, user?.id ?? "guest"],
    queryFn: () => api.getAccount(mode),
    enabled: !!accessToken,
    retry: false,
    refetchInterval: 15_000,
  });
  const noCredentials = accountError instanceof ApiError && accountError.status === 404;

  const switchMode = (next: TradingMode) => {
    if (next === mode) return;
    setMode(next);
    queryClient.invalidateQueries({ queryKey: ["account"] });
    if (accessToken) {
      loadPositions();
      loadOrders();
    }
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex rounded border border-border overflow-hidden shrink-0">
        {(["demo", "live"] as const).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={cn(
              "px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
              m === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {accessToken ? (
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full shrink-0",
              accountError ? "bg-destructive" : "bg-success",
            )}
            title={accountError ? undefined : "OKX Connected"}
          />
          {accountError && (
            <span className="text-destructive truncate" title={accountError.message}>
              {noCredentials ? `No ${mode} credentials` : "Exchange error"}
            </span>
          )}
        </div>
      ) : (
        <button
          onClick={onOpenSettings}
          className="text-muted-foreground hover:text-foreground whitespace-nowrap"
        >
          Log in
        </button>
      )}

      <div className="flex items-center gap-2 ml-auto shrink-0">
        <ThemeSwitcher />
        <button onClick={onOpenSettings} title="Settings" className="text-muted-foreground hover:text-foreground">
          <Settings className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}
