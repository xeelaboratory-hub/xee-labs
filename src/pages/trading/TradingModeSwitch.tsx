import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { TradingMode } from "../../services/schemas.ts";
import { useAuthStore, useTradingStore } from "../../services/store.tsx";

/**
 * DEMO/LIVE mode switch with the live-trading confirmation gate.
 * Shared by the desktop footer and Settings → Trading.
 */
export function TradingModeSwitch({ className }: { className?: string }) {
  const mode = useTradingStore((s) => s.mode);
  const setMode = useTradingStore((s) => s.setMode);
  const loadPositions = useTradingStore((s) => s.loadPositions);
  const loadOrders = useTradingStore((s) => s.loadOrders);
  const accessToken = useAuthStore((s) => s.accessToken);
  const queryClient = useQueryClient();
  const [confirmingLive, setConfirmingLive] = useState(false);

  const applyMode = (next: TradingMode) => {
    setMode(next);
    queryClient.invalidateQueries({ queryKey: ["account"] });
    if (accessToken) {
      loadPositions();
      loadOrders();
    }
  };

  const switchMode = (next: TradingMode) => {
    if (next === mode) return;
    if (next === "live") {
      setConfirmingLive(true);
      return;
    }
    applyMode(next);
  };

  return (
    <>
      <div className={cn("flex rounded border border-border overflow-hidden shrink-0", className)}>
        {(["demo", "live"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold uppercase tracking-wide min-h-[44px] min-w-[44px]",
              m === mode
                ? m === "live"
                  ? "bg-destructive text-destructive-foreground"
                  : "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary",
            )}
          >
            {m}
          </button>
        ))}
      </div>

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
    </>
  );
}
