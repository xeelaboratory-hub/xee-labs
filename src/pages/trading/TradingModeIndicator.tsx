import { cn } from "../../lib/utils.ts";
import { useTradingStore } from "../../services/store.tsx";

/**
 * Read-only trading mode badge for the mobile top bar.
 * The switch lives in Settings; this keeps the active mode visible at a glance.
 */
export function TradingModeIndicator({ className }: { className?: string }) {
  const mode = useTradingStore((s) => s.mode);

  if (mode === "live") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-destructive",
          className,
        )}
        aria-label="Live trading mode"
      >
        <span aria-hidden="true">●</span>
        LIVE
      </span>
    );
  }

  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
        className,
      )}
      aria-label="Demo trading mode"
    >
      DEMO
    </span>
  );
}
