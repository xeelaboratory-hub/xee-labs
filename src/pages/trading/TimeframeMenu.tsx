import { ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils.ts";
import { TIMEFRAMES, type Timeframe } from "./constants.ts";

/**
 * Timeframe picker for the phone.
 *
 * The desktop toolbar lays all eight timeframes out as a chip strip. On a
 * 375px screen that strip runs past the edge inside an `overflow-x-auto` row:
 * `15m` sits half-clipped and everything from `30m` up is off-screen with
 * nothing on the toolbar suggesting it exists. Scrolling a row that shares its
 * axis with the chart's own pan gesture is not a discoverable fix.
 *
 * A dropdown inverts the trade-off. The current timeframe — the thing you
 * actually read — stays visible, and the other seven are one tap away in a
 * sheet where each is a full-size target.
 *
 * The sheet is `fixed` rather than absolutely positioned under its button
 * because the toolbar clips anything that tries to escape it; the symbol
 * picker in `ChartToolbar` is fixed for the same reason.
 */
export function TimeframeMenu({
  timeframe,
  onTimeframeChange,
  compact = false,
}: {
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  /** Tighter padding for the single-row mobile chart header. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Timeframe: ${timeframe}`}
        className={cn(
          "flex items-center gap-0.5 rounded-md font-medium text-foreground hover:bg-secondary active:bg-secondary",
          compact ? "h-9 min-w-[44px] px-1.5 text-xs" : "min-h-[44px] gap-1 px-2.5 text-xs",
        )}
      >
        {timeframe}
        <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] bg-black/60" onClick={() => setOpen(false)}>
          <div
            role="menu"
            aria-label="Timeframe"
            className="fixed inset-x-0 top-0 bg-card border-b border-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-3 border-b border-border">
              <span className="text-base font-semibold">Timeframe</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-md hover:bg-secondary"
              >
                <X className="h-8 w-8" aria-hidden="true" />
              </button>
            </div>

            {/* A grid, not a list: eight short labels read faster side by side,
                and every cell clears the 44px finger target the list would
                have to pad out to anyway. */}
            <div className="grid grid-cols-4 gap-2 p-3">
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  role="menuitemradio"
                  aria-checked={tf === timeframe}
                  onClick={() => {
                    onTimeframeChange(tf);
                    setOpen(false);
                  }}
                  className={cn(
                    "min-h-[44px] rounded-md text-base font-medium transition-colors",
                    tf === timeframe
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-secondary/60 text-foreground active:bg-secondary",
                  )}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
