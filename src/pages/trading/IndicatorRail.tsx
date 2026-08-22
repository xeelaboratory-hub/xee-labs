import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { INDICATOR_REGISTRY, type IndicatorType } from "../../lib/indicators.ts";
import type { SessionMarket } from "../../lib/session-volume-profile.ts";
import { cn } from "../../lib/utils.ts";
import { mobileIcon, mobileText, mobileTouch } from "../../lib/mobile-ui.ts";
import { MOBILE_TIME_AXIS_INSET } from "./DrawingToolRail.tsx";

const SESSION_MARKETS = ["ASX", "TOKYO", "LONDON", "NEW_YORK"] as const;

const SESSION_LABEL: Record<(typeof SESSION_MARKETS)[number], string> = {
  ASX: "ASX",
  TOKYO: "TKY",
  LONDON: "LONDON",
  NEW_YORK: "NY",
};

const ITEM_BOX = cn(mobileTouch.headerIcon, "shrink-0 overflow-hidden");

/**
 * Mobile-only left rail for indicators — takes the spot the drawing tool
 * rail used to occupy there, now that the drawing tools live in the fixed
 * horizontal toolbar below the header instead. Same collapse/expand shell
 * as that rail for a consistent feel, but each item toggles its indicator
 * directly rather than opening a menu.
 */
export function IndicatorRail({
  activeIndicators,
  onToggleIndicator,
  sessionVolumeProfileMarkets,
  sessionVolumeProfileRows,
  onSessionVolumeProfileMarket,
  onSessionVolumeProfileRows,
}: {
  activeIndicators: IndicatorType[];
  onToggleIndicator: (type: IndicatorType) => void;
  sessionVolumeProfileMarkets: SessionMarket[];
  sessionVolumeProfileRows: number;
  onSessionVolumeProfileMarket: (market: SessionMarket) => void;
  onSessionVolumeProfileRows: (rows: number) => void;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [openSettingsFor, setOpenSettingsFor] = useState<IndicatorType | null>(null);
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<IndicatorType, HTMLDivElement>());

  useEffect(() => {
    if (!openSettingsFor) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (flyoutRef.current?.contains(target)) return;
      setOpenSettingsFor(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openSettingsFor]);

  useEffect(() => {
    if (!openSettingsFor) {
      setFlyoutPos(null);
      return;
    }
    const sync = () => {
      const anchor = itemRefs.current.get(openSettingsFor);
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      setFlyoutPos({ top: rect.top, left: rect.right + 6 });
    };
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [openSettingsFor]);

  if (collapsed) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute left-0 z-30 flex items-center top-0",
          MOBILE_TIME_AXIS_INSET,
        )}
      >
        <button
          type="button"
          title="Show indicators"
          aria-label="Show indicators"
          aria-expanded={false}
          onClick={() => setCollapsed(false)}
          className="pointer-events-auto flex h-11 w-7 items-center justify-center rounded-r-md border border-l-0 border-border bg-card/95 text-muted-foreground shadow-sm backdrop-blur-[2px] active:bg-secondary"
        >
          <SlidersHorizontal className={mobileIcon.ui} strokeWidth={1.75} aria-hidden="true" />
          {activeIndicators.length > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-0.5 leading-none text-primary-foreground"
            >
              <span className={mobileText.status}>{activeIndicators.length}</span>
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn("pointer-events-none absolute top-0 left-0 z-30 flex items-stretch", MOBILE_TIME_AXIS_INSET)}
      data-mobile-overlay="true"
    >
      <div className="w-[50px] pointer-events-auto flex h-full flex-col items-center rounded-r-lg border-y border-l-0 border-r-0 border-border bg-card/90 py-1 shadow-md backdrop-blur-[2px]">
        <button
          type="button"
          title="Collapse indicators"
          aria-label="Collapse indicators"
          aria-expanded={true}
          onClick={() => {
            setOpenSettingsFor(null);
            setCollapsed(true);
          }}
          className={cn(
            mobileTouch.headerIcon,
            "mb-0.5 flex shrink-0 items-center justify-center rounded-md text-muted-foreground active:bg-secondary",
          )}
        >
          <ChevronLeft className={mobileIcon.ui} strokeWidth={2} aria-hidden="true" />
        </button>

        <div className="no-scrollbar flex min-h-0 w-full flex-1 flex-col items-center gap-0.5 overflow-y-auto overscroll-contain">
          {INDICATOR_REGISTRY.map((ind) => {
            const active = activeIndicators.includes(ind.type);
            const hasSettings = ind.type === "SESSION_VOLUME_PROFILE";
            return (
              <div
                key={ind.type}
                ref={(el) => {
                  if (el) itemRefs.current.set(ind.type, el);
                  else itemRefs.current.delete(ind.type);
                }}
                className="relative shrink-0"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={active}
                  title={ind.label}
                  aria-label={ind.label}
                  onClick={() =>
                    hasSettings && !active
                      ? (onToggleIndicator(ind.type), setOpenSettingsFor(ind.type))
                      : onToggleIndicator(ind.type)
                  }
                  className={cn(
                    ITEM_BOX,
                    "flex items-center justify-center rounded-md transition-colors active:bg-secondary",
                    active ? "bg-primary/15" : "text-muted-foreground",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: active ? ind.color : "currentColor", opacity: active ? 1 : 0.4 }}
                  />
                </button>
                {hasSettings && active && (
                  <button
                    type="button"
                    title="Session Volume Profile settings"
                    aria-label="Session Volume Profile settings"
                    aria-expanded={openSettingsFor === ind.type}
                    onClick={() => setOpenSettingsFor((v) => (v === ind.type ? null : ind.type))}
                    className="absolute bottom-0 right-0 flex h-3.5 w-3.5 items-center justify-center text-muted-foreground/80"
                  >
                    <ChevronRight
                      className={cn("h-2 w-2 transition-transform", openSettingsFor === ind.type && "rotate-90")}
                      strokeWidth={2.5}
                    />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {openSettingsFor === "SESSION_VOLUME_PROFILE" &&
        flyoutPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={flyoutRef}
            className="pointer-events-auto z-50 min-w-[200px] space-y-2 rounded-md border border-border bg-card p-2 shadow-lg"
            style={{ position: "fixed", top: flyoutPos.top, left: flyoutPos.left }}
          >
            <div className="grid grid-cols-4 gap-1">
              {SESSION_MARKETS.map((market) => (
                <button
                  key={market}
                  type="button"
                  aria-pressed={sessionVolumeProfileMarkets.includes(market)}
                  onClick={() => onSessionVolumeProfileMarket(market)}
                  className={cn(
                    mobileTouch.target,
                    mobileText.ui,
                    "rounded px-1 font-medium active:bg-secondary",
                    sessionVolumeProfileMarkets.includes(market) && "bg-primary text-primary-foreground",
                  )}
                >
                  {SESSION_LABEL[market]}
                </button>
              ))}
            </div>
            <label className={cn("flex items-center justify-between gap-2 text-muted-foreground", mobileText.ui)}>
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
                  mobileTouch.target,
                  mobileText.ui,
                  "w-20 rounded border border-border bg-background px-2 text-right text-foreground outline-none focus:border-primary",
                )}
              />
            </label>
          </div>,
          document.body,
        )}
    </div>
  );
}
