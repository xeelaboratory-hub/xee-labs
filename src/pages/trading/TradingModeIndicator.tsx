import { cn } from "../../lib/utils.ts";
import { useTradingStore } from "../../services/store.tsx";

/**
 * Read-only trading mode badge for the mobile top bar.
 * The switch lives in Settings; this keeps the active mode visible at a glance.
 */
export function TradingModeIndicator({
  className,
  compact = false,
}: {
  className?: string;
  /** Inline pill for the single-row mobile header. */
  compact?: boolean;
}) {
  const mode = useTradingStore((s) => s.mode);

  if (mode === "live") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-0.5 font-semibold uppercase text-destructive",
          compact
            ? "rounded bg-destructive/15 px-1 py-0.5 text-[9px] tracking-wide"
            : "gap-1 text-[10px] tracking-wide",
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
        "inline-flex shrink-0 font-semibold uppercase text-muted-foreground",
        compact
          ? "rounded bg-secondary/80 px-1 py-0.5 text-[9px] tracking-wide"
          : "text-[10px] tracking-wide",
        className,
      )}
      aria-label="Demo trading mode"
    >
      DEMO
    </span>
  );
}
