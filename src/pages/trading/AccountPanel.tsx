import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Settings } from "lucide-react";
import { useState } from "react";
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
  const [confirmingLive, setConfirmingLive] = useState(false);

  const { error: accountError } = useQuery({
    queryKey: ["account", mode, user?.id ?? "guest"],
    queryFn: () => api.getAccount(mode),
    enabled: !!accessToken,
    retry: false,
    refetchInterval: 15_000,
  });
  const noCredentials = accountError instanceof ApiError && accountError.status === 404;

  const applyMode = (next: TradingMode) => {
    setMode(next);
    queryClient.invalidateQueries({ queryKey: ["account"] });
    if (accessToken) {
      loadPositions();
      loadOrders();
    }
  };

  /**
   * Going to live asks first; coming back to demo does not.
   *
   * The switch itself places nothing — but it decides which credentials the
   * *next* order uses, and that order can be one tap away on a phone, where
   * this control sits in the thumb's path. The asymmetry is the point: a
   * mistake in one direction costs real money, and in the other it costs a
   * tap.
   */
  const switchMode = (next: TradingMode) => {
    if (next === mode) return;
    if (next === "live") {
      setConfirmingLive(true);
      return;
    }
    applyMode(next);
  };

  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex rounded border border-border overflow-hidden shrink-0">
        {(["demo", "live"] as const).map((m) => (
          <button
            key={m}
            onClick={() => switchMode(m)}
            className={cn(
              // This row is the only account chrome left on a phone, so its
              // controls carry the 44px floor there. Desktop keeps the tight
              // status-bar sizing it was drawn for.
              "px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
              "max-md:flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center max-md:justify-center",
              m === mode
                ? m === "live"
                  // Live is the one state where the colour is load-bearing:
                  // the two modes were the same green, so the only thing
                  // distinguishing "real money" from "not" was a four-letter
                  // word at a glance.
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary",
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
          className="text-muted-foreground hover:text-foreground whitespace-nowrap max-md:flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center max-md:justify-center"
        >
          Log in
        </button>
      )}

      {confirmingLive && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setConfirmingLive(false)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Switch to live trading"
            className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-8 w-8 shrink-0 text-destructive" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-base font-semibold text-foreground">Switch to live trading?</p>
                <p className="text-sm text-muted-foreground">
                  Orders placed after this use your real OKX account and real funds.
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingLive(false)}
                className="min-h-[44px] flex-1 rounded-md border border-border text-sm font-medium hover:bg-secondary"
              >
                Stay in Demo
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingLive(false);
                  applyMode("live");
                }}
                className="min-h-[44px] flex-1 rounded-md bg-destructive text-sm font-semibold text-destructive-foreground"
              >
                Go Live
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 ml-auto shrink-0">
        <ThemeSwitcher />
        <button
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className="text-muted-foreground hover:text-foreground max-md:flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center max-md:justify-center"
        >
          <Settings className="h-7 w-7" />
        </button>
      </div>
    </div>
  );
}
