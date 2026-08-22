import {
  BarChart3,
  Bot,
  Calculator,
  ChevronDown,
  Layers,
  type LucideIcon,
  Search,
  Settings,
  X,
} from "lucide-react";
import { useState } from "react";
import { useIsDesktop } from "../../hooks/useIsDesktop.ts";
import { type IndicatorType } from "../../lib/indicators.ts";
import type { SessionMarket } from "../../lib/session-volume-profile.ts";
import { cn, formatMobileSymbolLabel, formatNumber } from "../../lib/utils.ts";
import { TIMEFRAMES, type Timeframe } from "./constants.ts";
import { IndicatorList } from "./IndicatorList.tsx";
import { TimeframeMenu } from "./TimeframeMenu.tsx";
import { TradingModeIndicator } from "./TradingModeIndicator.tsx";

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
  /** Mobile only — opens the Settings view-swap. */
  onOpenSettings?: () => void;
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
  onOpenSettings,
  symbolInfo,
  aiTraderEnabled,
}: ChartToolbarProps) {
  const [showSymbolSearch, setShowSymbolSearch] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState("");
  const isDesktop = useIsDesktop();

  const filteredSymbols = symbols.filter(
    (s) =>
      s.name.toLowerCase().includes(symbolFilter.toLowerCase()) ||
      (s.category || "").toLowerCase().includes(symbolFilter.toLowerCase()),
  );

  const priceDecimals = symbolInfo?.tickSize
    ? String(symbolInfo.tickSize).split(".")[1]?.length || 2
    : 5;
  const midPrice =
    tick !== undefined
      ? formatNumber((tick.bid + tick.ask) / 2, priceDecimals)
      : null;

  const symbolSearchOverlay = showSymbolSearch ? (
    <>
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
  ) : null;

  const mobileIconButtonClass = (active: boolean) =>
    cn(
      "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
      active ? "bg-primary/15 text-primary" : "text-muted-foreground active:bg-secondary",
    );

  if (!isDesktop) {
    return (
      <div className="shrink-0 border-b border-border bg-card safe-top">
        <div className="flex min-h-[44px] items-center gap-1 overflow-hidden px-1.5 py-1">
          <div className="relative min-w-0 max-w-[32%] shrink">
            <button
              type="button"
              onClick={() => setShowSymbolSearch((v) => !v)}
              aria-label={`Symbol: ${selectedSymbol}`}
              className="flex max-w-full items-center gap-0.5 rounded-md px-1 py-1 active:bg-secondary"
            >
              <span className="truncate text-xs font-semibold tracking-tight">
                {formatMobileSymbolLabel(selectedSymbol)}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
            </button>
            {symbolSearchOverlay}
          </div>

          {midPrice !== null && (
            <span className="min-w-0 flex-1 truncate text-center font-mono text-xs font-semibold tabular-nums tracking-tight text-foreground">
              {midPrice}
            </span>
          )}

          <TimeframeMenu compact timeframe={timeframe} onTimeframeChange={onTimeframeChange} />

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onToggleIndicatorMenu}
              aria-haspopup="dialog"
              aria-expanded={showIndicatorMenu}
              aria-label={
                activeIndicators.length > 0
                  ? `Indicators: ${activeIndicators.length} active`
                  : "Indicators"
              }
              className={mobileIconButtonClass(activeIndicators.length > 0)}
            >
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              {activeIndicators.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold leading-none text-primary-foreground">
                  {activeIndicators.length}
                </span>
              )}
            </button>

            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                title="Settings"
                aria-label="Settings"
                className={mobileIconButtonClass(false)}
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            <TradingModeIndicator compact />
          </div>
        </div>

        {showIndicatorMenu && (
          <div className="fixed inset-0 z-[100] bg-black/60" onClick={onToggleIndicatorMenu}>
            <div
              role="dialog"
              aria-label="Indicators"
              className="fixed inset-x-0 top-0 flex max-h-[85vh] flex-col bg-card border-b border-border shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-3 border-b border-border">
                <span className="text-base font-semibold">Indicators</span>
                <button
                  type="button"
                  onClick={onToggleIndicatorMenu}
                  aria-label="Close"
                  className="p-1.5 rounded-md hover:bg-secondary"
                >
                  <X className="h-8 w-8" aria-hidden="true" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto overscroll-contain p-2">
                <IndicatorList
                  activeIndicators={activeIndicators}
                  onToggleIndicator={onToggleIndicator}
                  sessionVolumeProfileMarkets={sessionVolumeProfileMarkets}
                  sessionVolumeProfileRows={sessionVolumeProfileRows}
                  onSessionVolumeProfileMarket={onSessionVolumeProfileMarket}
                  onSessionVolumeProfileRows={onSessionVolumeProfileRows}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const toolbarRow = (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1 text-xs shrink-0">
      {/* Symbol Selector — TradingView style */}
      <div className="relative shrink-0">
        <button
          onClick={() => setShowSymbolSearch((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-secondary font-bold text-sm tracking-tight"
        >
          {selectedSymbol}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
        {symbolSearchOverlay}
      </div>

      {/* Live Price — current (mid) price */}
      {tick && (
        <div className="flex items-center px-2 border-l border-r border-border shrink-0">
          <span className="font-mono font-bold text-[14px] tabular-nums tracking-tight text-foreground">
            {midPrice}
          </span>
        </div>
      )}

      <div className="flex items-center gap-0.5 ml-1 shrink-0">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-all",
              tf === timeframe
                ? "bg-primary text-primary-foreground shadow-sm"
                : "hover:bg-secondary/80 text-muted-foreground hover:text-foreground",
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="h-4 border-l border-border mx-1" />

      <div className="relative">
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
          <div className="absolute top-full left-0 z-50 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl p-2">
            <IndicatorList
              compact
              activeIndicators={activeIndicators}
              onToggleIndicator={onToggleIndicator}
              sessionVolumeProfileMarkets={sessionVolumeProfileMarkets}
              sessionVolumeProfileRows={sessionVolumeProfileRows}
              onSessionVolumeProfileMarket={onSessionVolumeProfileMarket}
              onSessionVolumeProfileRows={onSessionVolumeProfileRows}
            />
          </div>
        )}
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
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

  return toolbarRow;
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
