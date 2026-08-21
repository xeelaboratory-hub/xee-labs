import {
  BarChart3,
  Bot,
  Calculator,
  ChevronDown,
  Layers,
  type LucideIcon,
  Search,
  X,
} from "lucide-react";
import { useState } from "react";
import { INDICATOR_REGISTRY, type IndicatorType } from "../../lib/indicators.ts";
import type { SessionMarket } from "../../lib/session-volume-profile.ts";
import { cn, formatNumber } from "../../lib/utils.ts";
import { TIMEFRAMES, type Timeframe } from "./constants.ts";

export interface ChartToolbarProps {
  selectedSymbol: string;
  symbols: Array<{
    id?: string;
    name: string;
    displayName?: string | null;
    assetClass?: string;
    baseCurrency?: string;
    quoteCurrency?: string;
    category?: string;
    isActive?: boolean;
  }>;
  onSymbolChange: (s: string) => void;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  activeIndicators: IndicatorType[];
  onToggleIndicator: (type: IndicatorType) => void;
  sessionVolumeProfileMarkets: SessionMarket[];
  sessionVolumeProfileRows: number;
  onSessionVolumeProfileMarket: (market: SessionMarket) => void;
  onSessionVolumeProfileRows: (rows: number) => void;
  showIndicatorMenu: boolean;
  onToggleIndicatorMenu: () => void;
  rightPanel: string;
  onRightPanel: (p: "dom" | "watchlist" | "ai-trader" | "position-builder") => void;
  aiTraderEnabled?: boolean;
  showRightPanel: boolean;
  tick?: { bid: number; ask: number; timestamp: number };
  symbolInfo?: {
    tickSize?: number;
    pipSize?: number;
    lotSize?: number;
    minLot?: number;
    maxLot?: number;
    lotStep?: number;
    contractSize?: number;
    marginPercent?: number;
    commission?: number;
  };
}

export function ChartToolbar({
  selectedSymbol,
  symbols,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  activeIndicators,
  onToggleIndicator,
  sessionVolumeProfileMarkets,
  sessionVolumeProfileRows,
  onSessionVolumeProfileMarket,
  onSessionVolumeProfileRows,
  showIndicatorMenu,
  onToggleIndicatorMenu,
  rightPanel,
  onRightPanel,
  showRightPanel,
  tick,
  symbolInfo,
  aiTraderEnabled,
}: ChartToolbarProps) {
  const [showSymbolSearch, setShowSymbolSearch] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState("");

  const filteredSymbols = symbols.filter(
    (s) =>
      s.name.toLowerCase().includes(symbolFilter.toLowerCase()) ||
      (s.category || "").toLowerCase().includes(symbolFilter.toLowerCase()),
  );
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-card text-xs shrink-0 overflow-x-auto md:overflow-visible flex-nowrap md:flex-wrap no-scrollbar">
      {/* Symbol Selector — TradingView style */}
      <div className="relative shrink-0">
        <button
          onClick={() => setShowSymbolSearch((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-secondary font-bold text-sm tracking-tight max-md:min-h-[44px]"
        >
          {selectedSymbol}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>

        {showSymbolSearch && (
          <>
            {/* Mobile: full-screen modal (avoids parent overflow clipping) */}
            <div
              className="md:hidden fixed inset-0 z-[100] bg-black/60"
              onClick={() => setShowSymbolSearch(false)}
            >
              <div
                className="fixed inset-x-0 top-0 bg-card border-b border-border shadow-2xl flex flex-col max-h-[85vh]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-2 p-3 border-b border-border">
                  <Search className="h-8 w-8 text-muted-foreground shrink-0" />
                  <input
                    autoFocus
                    placeholder="Search symbols..."
                    value={symbolFilter}
                    onChange={(e) => setSymbolFilter(e.target.value)}
                    className="flex-1 bg-transparent text-base outline-none"
                  />
                  <button
                    onClick={() => {
                      setShowSymbolSearch(false);
                      setSymbolFilter("");
                    }}
                    className="p-1.5 rounded-md hover:bg-secondary"
                  >
                    <X className="h-8 w-8" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto overscroll-contain">
                  {filteredSymbols.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No symbols match &ldquo;{symbolFilter}&rdquo;
                    </div>
                  ) : (
                    filteredSymbols.map((s) => (
                      <button
                        key={s.id || s.name}
                        onClick={() => {
                          onSymbolChange(s.name);
                          setShowSymbolSearch(false);
                          setSymbolFilter("");
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-3 text-base hover:bg-secondary border-b border-border/40 active:bg-secondary",
                          s.name === selectedSymbol && "bg-secondary",
                        )}
                      >
                        <div className="flex flex-col items-start">
                          <span className="font-semibold">{s.name}</span>
                          {s.displayName && s.displayName !== s.name && (
                            <span className="text-xs text-muted-foreground">{s.displayName}</span>
                          )}
                        </div>
                        <span className="text-muted-foreground text-xs uppercase tracking-wide">
                          {s.category || s.assetClass}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Desktop: absolute dropdown */}
            <div className="hidden md:block absolute top-full left-0 z-50 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
              <input
                autoFocus
                placeholder="Search symbols..."
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                className="w-full px-3 py-2 text-sm border-b border-border bg-card"
              />
              <div className="max-h-60 overflow-y-auto">
                {filteredSymbols.map((s) => (
                  <button
                    key={s.id || s.name}
                    onClick={() => {
                      onSymbolChange(s.name);
                      setShowSymbolSearch(false);
                      setSymbolFilter("");
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-1.5 text-sm hover:bg-secondary",
                      s.name === selectedSymbol && "bg-secondary",
                    )}
                  >
                    <span className="font-medium">{s.name}</span>
                    <span className="text-muted-foreground text-xs">{s.category}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Live Price — current (mid) price */}
      {tick && (
        <div className="flex items-center px-1.5 md:px-2 border-l border-r border-border shrink-0">
          <span className="font-mono font-bold text-[13px] md:text-[14px] tabular-nums tracking-tight text-foreground">
            {formatNumber(
              (tick.bid + tick.ask) / 2,
              symbolInfo?.tickSize ? String(symbolInfo.tickSize).split(".")[1]?.length || 2 : 5,
            )}
          </span>
        </div>
      )}

      {/* Timeframe Selector */}
      <div className="flex items-center gap-0.5 ml-1 shrink-0">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={cn(
              // max-md sizing only: the desktop toolbar packs a lot into one
              // row and is driven by a pointer, so it keeps its tighter chip.
              "rounded-md text-xs font-medium transition-all",
              "max-md:flex max-md:min-h-[44px] max-md:min-w-[44px] max-md:items-center max-md:justify-center",
              "md:px-2 md:py-1",
              tf === timeframe
                ? "bg-primary text-primary-foreground shadow-sm"
                : "hover:bg-secondary/80 text-muted-foreground hover:text-foreground",
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="h-4 border-l border-border mx-1 hidden md:block" />

      {/* Indicators */}
      {
        <div className="relative hidden md:block">
          <button
            onClick={onToggleIndicatorMenu}
            className={cn(
              "flex items-center gap-1 px-2 py-1 rounded text-xs",
              activeIndicators.length > 0
                ? "bg-primary/20 text-primary"
                : "hover:bg-secondary text-muted-foreground",
            )}
          >
            <BarChart3 className="h-3 w-3" />
            Indicators
            {activeIndicators.length > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full px-1 text-[11px]">
                {activeIndicators.length}
              </span>
            )}
          </button>

          {showIndicatorMenu && (
            <div className="absolute top-full left-0 z-50 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl p-2 space-y-0.5">
              {INDICATOR_REGISTRY.map((ind) => (
                <div key={ind.type}>
                  <button
                    onClick={() => onToggleIndicator(ind.type)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-secondary text-left",
                      activeIndicators.includes(ind.type) && "bg-secondary",
                    )}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: ind.color }}
                    />
                    <span className="flex-1">{ind.label}</span>
                    <span className="text-xs text-muted-foreground">{ind.pane}</span>
                  </button>
                  {ind.type === "SESSION_VOLUME_PROFILE" && activeIndicators.includes(ind.type) && (
                    <div className="ml-4 mr-1 mt-1 space-y-2 rounded border border-border/70 bg-background/40 p-2">
                      <div className="grid grid-cols-4 gap-1">
                        {(["ASX", "TOKYO", "LONDON", "NEW_YORK"] as const).map((market) => (
                          <button
                            key={market}
                            onClick={() => onSessionVolumeProfileMarket(market)}
                            className={cn(
                              "rounded px-1 py-1 text-xs font-medium hover:bg-secondary",
                              sessionVolumeProfileMarkets.includes(market) && "bg-primary text-primary-foreground",
                            )}
                          >
                            {market === "NEW_YORK" ? "NY" : market === "TOKYO" ? "TKY" : market}
                          </button>
                        ))}
                      </div>
                      <label className="flex items-center justify-between gap-2 text-[13px] text-muted-foreground">
                        Rows
                        <input
                          aria-label="Session Volume Profile rows"
                          type="number"
                          min={10}
                          max={100}
                          step={1}
                          value={sessionVolumeProfileRows}
                          onChange={(event) => onSessionVolumeProfileRows(Number(event.target.value))}
                          className="w-16 rounded border border-border bg-background px-1.5 py-0.5 text-right text-foreground outline-none focus:border-primary"
                        />
                      </label>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      }

      <div className="flex-1 hidden md:block" />

      {/* Right Panel Toggles */}
      <div className="hidden md:flex items-center gap-0.5">
        <ToolButton
          icon={Layers}
          tooltip="Depth of Market"
          active={showRightPanel && rightPanel === "dom"}
          onClick={() => onRightPanel("dom")}
        />
        <ToolButton
          icon={BarChart3}
          tooltip="Watchlist"
          active={showRightPanel && rightPanel === "watchlist"}
          onClick={() => onRightPanel("watchlist")}
        />
        <ToolButton
          icon={Calculator}
          tooltip="Position Builder"
          active={showRightPanel && rightPanel === "position-builder"}
          onClick={() => onRightPanel("position-builder")}
        />
        {aiTraderEnabled && (
          <ToolButton
            icon={Bot}
            tooltip="AI Trader"
            active={showRightPanel && rightPanel === "ai-trader"}
            onClick={() => onRightPanel("ai-trader")}
          />
        )}
      </div>
    </div>
  );
}

export function ToolButton({
  icon: Icon,
  tooltip,
  active,
  onClick,
}: {
  icon: LucideIcon;
  tooltip: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={tooltip}
      className={cn(
        "px-1.5 py-1 rounded",
        active ? "bg-primary/20 text-primary" : "hover:bg-secondary text-muted-foreground",
      )}
    >
      <Icon className="h-7 w-7" />
    </button>
  );
}
