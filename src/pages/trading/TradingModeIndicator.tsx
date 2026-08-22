import { cn } from "../../lib/utils.ts";
import { mobileText } from "../../lib/mobile-ui.ts";
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
          "inline-flex shrink-0 items-center gap-0.5",
          mobileText.status,
          "text-destructive",
          compact && "rounded bg-destructive/15 px-1 py-0.5",
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
        "inline-flex shrink-0",
        mobileText.status,
        "text-muted-foreground",
        compact && "rounded bg-secondary/80 px-1 py-0.5",
        className,
      )}
      aria-label="Demo trading mode"
    >
      DEMO
    </span>
  );
}
