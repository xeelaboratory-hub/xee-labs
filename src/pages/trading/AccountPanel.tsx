import { useQuery } from "@tanstack/react-query";
import { Settings } from "lucide-react";
import { ThemeSwitcher } from "../../components/ThemeSwitcher.tsx";
import { api } from "../../services/api.ts";
import { ApiError } from "../../services/api/request.ts";
import { useAuthStore, useTradingStore } from "../../services/store.tsx";
import { cn } from "../../lib/utils.ts";
import { TradingModeSwitch } from "./TradingModeSwitch.tsx";

/**
 * Global trading status bar — DEMO/LIVE mode, exchange connection status,
 * equity, theme, and an entry point into Settings. Desktop footer only;
 * on mobile these controls live in the top bar (indicator + Settings) and
 * Settings view.
 */
export function AccountPanel({ onOpenSettings }: { onOpenSettings: () => void }) {
  const mode = useTradingStore((s) => s.mode);
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  const { error: accountError } = useQuery({
    queryKey: ["account", mode, user?.id ?? "guest"],
    queryFn: () => api.getAccount(mode),
    enabled: !!accessToken,
    retry: false,
    refetchInterval: 15_000,
  });
  const noCredentials = accountError instanceof ApiError && accountError.status === 404;

  return (
    <div className="flex items-center gap-2 text-xs">
      <TradingModeSwitch
        className="[&_button]:px-2 [&_button]:py-0.5 [&_button]:min-h-0 [&_button]:min-w-0"
      />

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
        <button
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}
