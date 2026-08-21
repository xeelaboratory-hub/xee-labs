import { INDICATOR_REGISTRY, type IndicatorType } from "../../lib/indicators.ts";
import type { SessionMarket } from "../../lib/session-volume-profile.ts";
import { cn } from "../../lib/utils.ts";

const SESSION_MARKETS = ["ASX", "TOKYO", "LONDON", "NEW_YORK"] as const;

const SESSION_LABEL: Record<(typeof SESSION_MARKETS)[number], string> = {
  ASX: "ASX",
  TOKYO: "TKY",
  LONDON: "LONDON",
  NEW_YORK: "NY",
};

export interface IndicatorListProps {
  activeIndicators: IndicatorType[];
  onToggleIndicator: (type: IndicatorType) => void;
  sessionVolumeProfileMarkets: SessionMarket[];
  sessionVolumeProfileRows: number;
  onSessionVolumeProfileMarket: (market: SessionMarket) => void;
  onSessionVolumeProfileRows: (rows: number) => void;
  /** Pointer-sized rows for the desktop dropdown. Touch targets otherwise. */
  compact?: boolean;
}

/**
 * The indicator registry as a toggle list, plus the Session Volume Profile's
 * own controls where they belong — under the indicator that owns them.
 *
 * Shared between the desktop dropdown and the phone's sheet rather than
 * written twice. The two differ only in target size, and the sub-controls are
 * the part that would drift: a market toggle or the rows input added on one
 * side and forgotten on the other is a silent divergence between what the two
 * form factors can configure.
 */
export function IndicatorList({
  activeIndicators,
  onToggleIndicator,
  sessionVolumeProfileMarkets,
  sessionVolumeProfileRows,
  onSessionVolumeProfileMarket,
  onSessionVolumeProfileRows,
  compact = false,
}: IndicatorListProps) {
  return (
    <div className={cn(compact ? "space-y-0.5" : "space-y-1")}>
      {INDICATOR_REGISTRY.map((ind) => {
        const active = activeIndicators.includes(ind.type);
        return (
          <div key={ind.type}>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              onClick={() => onToggleIndicator(ind.type)}
              className={cn(
                "w-full flex items-center gap-2 rounded text-left",
                compact
                  ? "px-2 py-1.5 text-sm hover:bg-secondary"
                  : "min-h-[44px] px-3 py-2 text-base active:bg-secondary",
                active && "bg-secondary",
              )}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: ind.color }}
              />
              <span className="flex-1">{ind.label}</span>
              <span className={cn("text-muted-foreground", compact ? "text-xs" : "text-sm")}>
                {ind.pane}
              </span>
            </button>

            {ind.type === "SESSION_VOLUME_PROFILE" && active && (
              <div
                className={cn(
                  "rounded border border-border/70 bg-background/40",
                  compact ? "ml-4 mr-1 mt-1 space-y-2 p-2" : "mx-2 mt-2 space-y-3 p-3",
                )}
              >
                <div className="grid grid-cols-4 gap-1">
                  {SESSION_MARKETS.map((market) => (
                    <button
                      key={market}
                      type="button"
                      aria-pressed={sessionVolumeProfileMarkets.includes(market)}
                      onClick={() => onSessionVolumeProfileMarket(market)}
                      className={cn(
                        "rounded font-medium",
                        compact
                          ? "px-1 py-1 text-xs hover:bg-secondary"
                          : "min-h-[44px] px-1 text-sm active:bg-secondary",
                        sessionVolumeProfileMarkets.includes(market) &&
                          "bg-primary text-primary-foreground",
                      )}
                    >
                      {SESSION_LABEL[market]}
                    </button>
                  ))}
                </div>
                <label
                  className={cn(
                    "flex items-center justify-between gap-2 text-muted-foreground",
                    compact ? "text-[13px]" : "text-base",
                  )}
                >
                  Rows
                  <input
                    aria-label="Session Volume Profile rows"
                    type="number"
                    inputMode="numeric"
                    min={10}
                    max={100}
                    step={1}
                    value={sessionVolumeProfileRows}
                    onChange={(event) => onSessionVolumeProfileRows(Number(event.target.value))}
                    className={cn(
                      "rounded border border-border bg-background text-right text-foreground outline-none focus:border-primary",
                      compact ? "w-16 px-1.5 py-0.5" : "min-h-[44px] w-20 px-2 text-base",
                    )}
                  />
                </label>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
