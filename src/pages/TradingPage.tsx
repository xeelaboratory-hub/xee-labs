import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StaleDataBanner, useIsFeedConnected } from "../components/ConnectionIndicator.tsx";
import { Footer } from "../components/Footer.tsx";
import {
  OrderConfirmDialog,
  OrderModifyDialog,
  PositionModifyDialog,
} from "../components/TradingDialogs.tsx";
import { useChartDrawings } from "../hooks/useChartDrawings.ts";
import {
  getChartPreferencesFromStorage,
  updateChartPreferences,
  useChartPreferences,
} from "../hooks/useChartPreferences.ts";
import { useIsDesktop } from "../hooks/useIsDesktop.ts";
import { useTradeSound } from "../hooks/useTradeSound";
import type { IndicatorType } from "../lib/indicators.ts";
import type { SessionMarket } from "../lib/session-volume-profile.ts";
import { posthog } from "../lib/posthog";
import { cn, formatCurrency, pnlClass } from "../lib/utils.ts";
import { api } from "../services/api.ts";
import {
  normalizeSessionVolumeProfileRows,
  readLocalPreferences,
  updateLocalPreferences,
} from "../services/preferences.ts";
import { useAccount, useCandles, useOrders, usePositions, useSymbols } from "../services/queries.ts";
import type { Order, PlaceOrderInput, Position, Symbol } from "../services/schemas.ts";
import { useTradingStore } from "../services/store.tsx";
import { useThemeStore } from "../services/themeStore.ts";
import { toast } from "../services/toast.ts";
import { AiTraderPanel } from "./AiTraderPage.tsx";
import { BottomPanel } from "./trading/BottomPanel.tsx";
import { ChartPanel } from "./trading/ChartPanel.tsx";
import { ChartToolbar } from "./trading/ChartToolbar.tsx";
import { type DrawingTool, type MagnetMode, TIMEFRAMES, type Timeframe } from "./trading/constants.ts";
import { DOMPanel } from "./trading/DOMPanel.tsx";
import { MarketClosedBanner } from "./trading/MarketClosedBanner.tsx";
import { MobileTabBar, type MobileTab } from "./trading/MobileTabBar.tsx";
import { PositionBuilderPanel, type PositionBuilderPreview } from "./trading/PositionBuilderPanel.tsx";
import type { SessionVolumeProfileSummary } from "./trading/useSessionVolumeProfile.ts";
import { getPipDigits } from "./trading/utils.ts";
import { WatchlistPanel } from "./trading/WatchlistPanel.tsx";
import { SettingsPage } from "./SettingsPage.tsx";

type ConfirmOrderState = {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT";
  quantity: number;
  price?: number;
  // The attached bracket, so the confirmation dialog shows the same stop and
  // target the Position Builder sized the trade from — its TP/SL rows already
  // render these; before the bracket was wired up they were never populated.
  takeProfit?: number;
  stopLoss?: number;
  _submit: () => Promise<unknown>;
} | null;

type BottomTab = "positions" | "orders" | "history" | "calendar" | "ai-trader";
type RightPanelId = "dom" | "watchlist" | "ai-trader" | "position-builder";

export function TradingPage() {
  const hasTrackedFirstTrade = useRef(false);

  const handleFirstTrade = useCallback(() => {
    if (!hasTrackedFirstTrade.current) {
      hasTrackedFirstTrade.current = true;
      posthog.capture("funnel.trade.first_executed", { sessionId: posthog.get_session_id?.() });
    }
  }, []);

  const { selectedSymbol, setSelectedSymbol, ticks, updateTick, mode, symbols: _storeSymbols } =
    useTradingStore();
  // Chart timeframe persistence (#8)
  const [timeframe, setTimeframe] = useState<Timeframe>(() => {
    const saved = readLocalPreferences().timeframes[selectedSymbol];
    return saved && TIMEFRAMES.includes(saved as Timeframe) ? (saved as Timeframe) : "15m";
  });
  const handleTimeframeChange = useCallback(
    (tf: Timeframe) => {
      setTimeframe(tf);
      const preferences = readLocalPreferences();
      updateLocalPreferences({ timeframes: { ...preferences.timeframes, [selectedSymbol]: tf } });
    },
    [selectedSymbol],
  );
  // Restore timeframe when symbol changes
  useEffect(() => {
    const saved = readLocalPreferences().timeframes[selectedSymbol];
    if (saved && TIMEFRAMES.includes(saved as Timeframe)) setTimeframe(saved as Timeframe);
  }, [selectedSymbol]);

  const [activeIndicators, setActiveIndicators] = useState<IndicatorType[]>(
    () => readLocalPreferences().activeIndicators,
  );
  const handleToggleIndicator = useCallback((type: IndicatorType) => {
    setActiveIndicators((current) => {
      const next = current.includes(type) ? current.filter((item) => item !== type) : [...current, type];
      updateLocalPreferences({ activeIndicators: next });
      return next;
    });
  }, []);
  const [showIndicatorMenu, setShowIndicatorMenu] = useState(false);
  const [sessionVolumeProfileMarkets, setSessionVolumeProfileMarkets] = useState<SessionMarket[]>(
    () => readLocalPreferences().sessionVolumeProfileMarkets ?? ["NEW_YORK"],
  );
  const [sessionVolumeProfileRows, setSessionVolumeProfileRows] = useState(
    () => readLocalPreferences().sessionVolumeProfileRows ?? 30,
  );
  const handleSessionVolumeProfileMarket = useCallback((market: SessionMarket) => {
    setSessionVolumeProfileMarkets((current) => {
      const next = current.includes(market)
        ? current.filter((candidate) => candidate !== market)
        : [...current, market];
      if (!next.length) return current;
      updateLocalPreferences({ sessionVolumeProfileMarkets: next });
      return next;
    });
  }, []);
  const handleSessionVolumeProfileRows = useCallback((rows: number) => {
    const next = normalizeSessionVolumeProfileRows(rows);
    setSessionVolumeProfileRows(next);
    updateLocalPreferences({ sessionVolumeProfileRows: next });
  }, []);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>("none");
  const {
    drawings,
    addDrawing,
    updateDrawing,
    removeDrawing,
    clearDrawings,
    undo: undoDrawing,
    redo: redoDrawing,
  } = useChartDrawings(selectedSymbol, timeframe);
  const [activePlugins, setActivePlugins] = useState<string[]>(
    () =>
      getChartPreferencesFromStorage().activePlugins.includes("session-breaks")
        ? ["session-breaks"]
        : [],
  );
  const handleTogglePlugin = useCallback((id: string) => {
    setActivePlugins((prev) => {
      const next = prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id];
      updateChartPreferences({ activePlugins: next });
      return next;
    });
  }, []);
  const [bottomTab, setBottomTab] = useState<BottomTab>("positions");
  const [bottomCollapsed, setBottomCollapsed] = useState(
    () => readLocalPreferences().bottomPanelCollapsed ?? false,
  );
  // AI trader is a PropSim-era feature not part of Xee.Labs (see AiTraderPage.tsx).
  const aiTraderEnabled = false;
  const [rightPanel, setRightPanel] = useState<RightPanelId>(
    () => readLocalPreferences().rightPanel ?? "position-builder",
  );
  const [showRightPanel, setShowRightPanel] = useState(
    () => !(readLocalPreferences().rightPanelCollapsed ?? false),
  );
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = readLocalPreferences().rightPanelWidth;
    return typeof saved === "number" && saved >= 240 && saved <= 520 ? saved : 320;
  });

  // Position Builder: chart preview lines for entry/stop/take-profit/liquidation.
  const [positionBuilderPreview, setPositionBuilderPreview] = useState<PositionBuilderPreview | null>(
    null,
  );
  // Computed inside ChartPanel (it needs the chart's visible range) and shown
  // in the trade panel, which is a sibling — so TradingPage holds it, matching
  // how positionBuilderPreview travels in the opposite direction.
  const [volumeProfile, setVolumeProfile] = useState<SessionVolumeProfileSummary | null>(null);

  const toggleBottomPanel = useCallback(() => {
    setBottomCollapsed((current) => {
      updateLocalPreferences({ bottomPanelCollapsed: !current });
      return !current;
    });
  }, []);

  const handleBottomTabChange = useCallback((tab: BottomTab) => {
    setBottomTab(tab);
    setBottomCollapsed(false);
    updateLocalPreferences({ bottomPanelCollapsed: false });
  }, []);

  const toggleRightPanel = useCallback(() => {
    setShowRightPanel((current) => {
      updateLocalPreferences({ rightPanelCollapsed: current });
      return !current;
    });
  }, []);

  const handleRightPanel = useCallback(
    (panel: RightPanelId) => {
      if (panel === rightPanel && showRightPanel) {
        toggleRightPanel();
        return;
      }
      setRightPanel(panel);
      setShowRightPanel(true);
      updateLocalPreferences({ rightPanel: panel, rightPanelCollapsed: false });
    },
    [rightPanel, showRightPanel, toggleRightPanel],
  );

  // ── Vertical resize: chart vs bottom panel ──
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() => {
    return readLocalPreferences().bottomPanelHeight ?? 220;
  });
  const resizingRef = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartH = useRef(0);
  const rightResizeStartX = useRef(0);
  const rightResizeStartW = useRef(0);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      const clientY = "touches" in e ? e.touches[0]!.clientY : e.clientY;
      resizeStartY.current = clientY;
      resizeStartH.current = bottomPanelHeight;

      const onMove = (ev: MouseEvent | TouchEvent) => {
        if (!resizingRef.current) return;
        const y = "touches" in ev ? ev.touches[0]!.clientY : (ev as MouseEvent).clientY;
        const delta = resizeStartY.current - y;
        const newH = Math.max(100, Math.min(600, resizeStartH.current + delta));
        setBottomPanelHeight(newH);
      };
      const onUp = () => {
        resizingRef.current = false;
        setBottomPanelHeight((h) => {
          updateLocalPreferences({ bottomPanelHeight: h });
          return h;
        });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
    },
    [bottomPanelHeight],
  );

  const handleRightResizeStart = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const startX = "touches" in e ? e.touches[0]!.clientX : e.clientX;
      rightResizeStartX.current = startX;
      rightResizeStartW.current = rightPanelWidth;

      const onMove = (ev: MouseEvent | TouchEvent) => {
        const x = "touches" in ev ? ev.touches[0]!.clientX : (ev as MouseEvent).clientX;
        setRightPanelWidth(
          Math.max(240, Math.min(520, rightResizeStartW.current + rightResizeStartX.current - x)),
        );
      };
      const onUp = () => {
        setRightPanelWidth((width) => {
          updateLocalPreferences({ rightPanelWidth: width });
          return width;
        });
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onMove);
        window.removeEventListener("touchend", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onMove, { passive: false });
      window.addEventListener("touchend", onUp);
    },
    [rightPanelWidth],
  );

  // (#4) One-click trading mode
  const [oneClick, setOneClick] = useState(
    () => readLocalPreferences().oneClickTrading ?? false,
  );
  const toggleOneClick = useCallback(() => {
    setOneClick((prev) => {
      const v = !prev;
      updateLocalPreferences({ oneClickTrading: v });
      return v;
    });
  }, []);

  // Trade sound effect
  const { muted: soundMuted, toggleMute: toggleSoundMute, playTradeSound } = useTradeSound();

  // (#6) Position modify dialog
  const [modifyingPosition, setModifyingPosition] = useState<Position | null>(null);

  // (#30) Order modify dialog
  const [modifyingOrder, setModifyingOrder] = useState<Order | null>(null);

  // (#7) Order confirmation dialog
  const [confirmOrder, setConfirmOrder] = useState<ConfirmOrderState>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const queryClient = useQueryClient();
  const { data: symbols = [] } = useSymbols();
  const isFeedConnected = useIsFeedConnected();

  // Prime the active symbol with a fresh server-side snapshot immediately on
  // symbol switch so bid/ask appears without waiting for the next WS tick.
  useEffect(() => {
    let cancelled = false;
    void api
      .getTick(selectedSymbol)
      .then((tick) => {
        if (cancelled || !tick) return;
        updateTick(
          selectedSymbol,
          Number(tick.bid),
          Number(tick.ask),
          typeof tick.timestamp === "number" ? tick.timestamp : Date.now(),
        );
      })
      .catch(() => {
        // Ignore snapshot misses; WS stream remains authoritative.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSymbol, updateTick]);

  // Handler for chart drag-to-edit SL/TP levels — not supported yet (OKX
  // conditional orders aren't wired up). Always reverts the dragged line.
  const handleChartModifyPosition = useCallback(
    async (_positionId: string, _mods: { takeProfit?: number | null; stopLoss?: number | null }) => {
      toast.warning("Not Supported", "Editing take-profit/stop-loss isn't supported yet");
      queryClient.invalidateQueries({ queryKey: ["positions", mode] });
    },
    [mode, queryClient],
  );

  // Chart context-menu quick orders (Buy/Sell limit at the clicked price).
  // Always routes through the confirm dialog so a stray right-click can never
  // place an order directly. Stop orders aren't supported yet (OKX conditional
  // orders aren't wired up).
  const handleQuickOrder = useCallback(
    (side: "BUY" | "SELL", type: "LIMIT" | "STOP", price: number) => {
      if (type === "STOP") {
        toast.warning("Not Supported", "Stop orders aren't supported yet");
        return;
      }
      const input: PlaceOrderInput = {
        mode,
        symbol: selectedSymbol,
        side,
        type: "LIMIT",
        quantity: 1,
        price,
      };
      setConfirmOrder({
        symbol: selectedSymbol,
        side,
        type: "LIMIT",
        quantity: 1,
        price,
        _submit: () => api.placeOrder(input),
      });
    },
    [mode, selectedSymbol],
  );

  const handleClearIndicators = useCallback(() => {
    setActiveIndicators([]);
    updateLocalPreferences({ activeIndicators: [] });
  }, []);

  // Deep-history target used after the initial fast render completes.
  // Capped at 1500 — the backend's hard per-request limit (CandlesRequest.limit
  // le=1500); ChartPanel's scroll-back pagination fetches further history on
  // demand beyond this window.
  const deepCandleLimit = useMemo(() => {
    switch (timeframe) {
      case "1m":
        return 1_500;
      case "5m":
        return 1_500;
      case "15m":
        return 1_500;
      case "30m":
        return 1_500;
      case "1h":
        return 1_500;
      case "4h":
        return 1_500;
      case "1d":
        return 1_000;
      case "1w":
        return 520;
      default:
        return 1_500;
    }
  }, [timeframe]);
  // First paint: viewport-sized so the initial fetch is as small as possible.
  // Mobile (<768px) needs fewer bars to fill the screen; desktop gets more.
  // The deep-history fetch fires 400ms later and loads a full year of data.
  const firstPaintCandleLimit = useMemo(() => {
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
    return isMobile ? 500 : 400;
  }, []);
  const [candleLimit, setCandleLimit] = useState(firstPaintCandleLimit);
  useEffect(() => {
    setCandleLimit(firstPaintCandleLimit);
    // Wait long enough for the first-paint response to arrive and render
    // before firing the heavier deep-history request. 400 ms is a reasonable
    // budget for a cached/warm DB response; users on fast connections will
    // see data before the deep load starts, avoiding visible re-draws.
    const timer = window.setTimeout(() => {
      setCandleLimit(deepCandleLimit);
    }, 400);
    return () => {
      window.clearTimeout(timer);
    };
  }, [selectedSymbol, timeframe, firstPaintCandleLimit, deepCandleLimit]);
  const { data: candles = [] } = useCandles(selectedSymbol, timeframe, candleLimit);
  const chartPrefs = useChartPreferences();
  const cycleMagnetMode = useCallback(() => {
    const order: MagnetMode[] = ["none", "weak", "strong"];
    const next = order[(order.indexOf(chartPrefs.magnetMode) + 1) % order.length] ?? "none";
    updateChartPreferences({ magnetMode: next });
  }, [chartPrefs.magnetMode]);
  const { data: positions = [] } = usePositions(mode);
  const { data: orders = [] } = useOrders(mode);
  const chartPositions = chartPrefs.overlayPositionsOnChart ? positions : [];
  const chartOrders = chartPrefs.overlayPositionsOnChart ? orders : [];
  const positionPnl = useMemo(
    () => positions.reduce((sum, position) => sum + (position.unrealizedPnl || 0), 0),
    [positions],
  );

  // Account balance for the current mode (demo/live) — real backend, no local caching.
  const { data: account } = useAccount(mode);

  const tick = ticks[selectedSymbol];
  const symbolInfo = symbols.find((s) => s.name === selectedSymbol) as Symbol | undefined;
  const liveCandleUpdates = useTradingStore((s) => s.liveCandleUpdates);
  const liveCandle = liveCandleUpdates[`${selectedSymbol}:${timeframe}`];
  const pipDigits = useMemo(
    () => getPipDigits(symbolInfo, selectedSymbol),
    [symbolInfo, selectedSymbol],
  );

  const isDark = useThemeStore((s) => s.mode === "dark");

  // Mobile navigation. One destination is on screen at a time (see
  // MobileTabBar) — the drag-up sheet this replaces opened over the chart on
  // first paint and left 20% of the screen for it.
  //
  // Not persisted to preferences: PreferencesPayload declares extra="forbid",
  // so a new key here is a backend schema change, and 1.8.1 is the release
  // that had to go fix exactly that after four keys were added client-side
  // only. The chart is the right place to land anyway.
  const [mobileTab, setMobileTab] = useState<MobileTab>("chart");

  // The right panel is `hidden md:flex` — hidden on a phone but still mounted.
  // Now that Position Builder has a mobile home too, mounting both would run
  // two copies pushing into the same chart-preview state. This decides which
  // one exists, rather than which one is visible.
  const isDesktop = useIsDesktop();

  // Settings is an in-page view-swap (not a route) — see SettingsPage.tsx.
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {showSettings ? (
        <div className="flex-1 min-h-0">
          <SettingsPage onBack={() => setShowSettings(false)} />
        </div>
      ) : (
        <>
      {/* ── Top Toolbar ──────────────────────────────────── */}
      <ChartToolbar
        selectedSymbol={selectedSymbol}
        symbols={symbols}
        onSymbolChange={setSelectedSymbol}
        timeframe={timeframe}
        onTimeframeChange={handleTimeframeChange}
        activeIndicators={activeIndicators}
        onToggleIndicator={handleToggleIndicator}
        sessionVolumeProfileMarkets={sessionVolumeProfileMarkets}
        sessionVolumeProfileRows={sessionVolumeProfileRows}
        onSessionVolumeProfileMarket={handleSessionVolumeProfileMarket}
        onSessionVolumeProfileRows={handleSessionVolumeProfileRows}
        showIndicatorMenu={showIndicatorMenu}
        onToggleIndicatorMenu={() => setShowIndicatorMenu((v) => !v)}
        rightPanel={rightPanel}
        onRightPanel={handleRightPanel}
        showRightPanel={showRightPanel}
        tick={tick}
        symbolInfo={symbolInfo}
        aiTraderEnabled={aiTraderEnabled}
      />

      {/* Surfaces a feed whose prices have stopped arriving. Written long ago
          but never mounted, so a 37-minute OKX price freeze that mispriced a
          live position went unannounced — the user spotted it, not the app. */}
      <StaleDataBanner />

      <MarketClosedBanner symbolInfo={symbolInfo} />

      {/* ── Main Layout ──────────────────────────────────── */}
      <div
        className={cn(
          "flex flex-col md:flex-row flex-1 overflow-hidden",
          // Both children below are desktop-or-chart-tab only. Without hiding
          // the wrapper too it keeps its flex-1 share with nothing inside it,
          // which showed up as ~250px of dead space above every other tab.
          !isDesktop && mobileTab !== "chart" && "hidden",
        )}
      >
        {/* Chart + Bottom Panel */}
        <div
          className={cn(
            "flex flex-col flex-1 min-w-0",
            // Mobile: the chart owns its tab and nothing else. Hidden rather
            // than unmounted — tearing down the lightweight-charts instance on
            // every tab switch would drop the series, the drawings and the
            // scroll position, and pay for a full re-init on the way back.
            !isDesktop && mobileTab !== "chart" && "hidden",
          )}
        >
          {/* Chart Area */}
          <div className="flex-1 min-h-[200px] relative">
            <ChartPanel
              candles={candles}
              selectedSymbol={selectedSymbol}
              timeframe={timeframe}
              isDark={isDark}
              activeIndicators={activeIndicators}
              sessionVolumeProfileMarkets={sessionVolumeProfileMarkets}
              sessionVolumeProfileRows={sessionVolumeProfileRows}
              drawingTool={drawingTool}
              drawings={drawings}
              onAddDrawing={addDrawing}
              onUpdateDrawing={updateDrawing}
              onRemoveDrawing={removeDrawing}
              onDrawingComplete={() => setDrawingTool("none")}
              onDrawingToolSelect={setDrawingTool}
              onUndoDrawing={undoDrawing}
              onRedoDrawing={redoDrawing}
              magnetMode={chartPrefs.magnetMode}
              onCycleMagnet={cycleMagnetMode}
              stayInDrawingMode={chartPrefs.stayInDrawingMode}
              onToggleStayInDrawingMode={() =>
                updateChartPreferences({ stayInDrawingMode: !chartPrefs.stayInDrawingMode })
              }
              positions={chartPositions}
              orders={chartOrders}
              tick={tick}
              liveCandle={liveCandle}
              pipDigits={pipDigits}
              symbolInfo={symbolInfo}
              onModifyPosition={handleChartModifyPosition}
              activePlugins={activePlugins}
              onTogglePlugin={handleTogglePlugin}
              accountEquity={account?.equity ?? account?.balance ?? 0}
              onQuickOrder={handleQuickOrder}
              onClearDrawings={clearDrawings}
              onClearIndicators={handleClearIndicators}
              positionBuilderPreview={rightPanel === "position-builder" ? positionBuilderPreview : null}
              onVolumeProfileChange={setVolumeProfile}
            />
          </div>

          {/* ── Resize Handle ── */}
          {isDesktop && !bottomCollapsed && (
            <div
              onMouseDown={handleResizeStart}
              onTouchStart={handleResizeStart}
              onDoubleClick={toggleBottomPanel}
              className="flex h-1.5 cursor-row-resize items-center justify-center hover:bg-primary/20 active:bg-primary/30 transition-colors group border-t border-border bg-secondary/40 touch-none"
            >
              <div className="w-8 h-0.5 rounded-full bg-border group-hover:bg-primary/50 transition-colors" />
            </div>
          )}

          {/* Bottom Panel (Positions / Orders / Trade History / Calendar / News).
              Desktop only — on mobile the same content is the Positions tab,
              mounted below at full height instead of in a 45vh drawer. */}
          {isDesktop && (
          <BottomPanel
            tab={bottomTab}
            onTabChange={handleBottomTabChange}
            collapsed={bottomCollapsed}
            onToggleCollapsed={toggleBottomPanel}
            positions={positions}
            orders={orders}
            mode={mode}
            onModifyPosition={setModifyingPosition}
            onModifyOrder={setModifyingOrder}
            onSelectPositionSymbol={setSelectedSymbol}
            onSelectOrderSymbol={setSelectedSymbol}
            aiTraderEnabled={aiTraderEnabled}
            height={bottomPanelHeight}
            isFeedConnected={isFeedConnected}
          />
          )}
        </div>

        {/* Right Panel + centered collapse/resize handle */}
        {isDesktop && (
        <div
          className="relative flex shrink-0"
          style={{ width: showRightPanel ? rightPanelWidth : 24 }}
        >
          <button
            type="button"
            title={showRightPanel ? "Collapse right panel" : "Expand right panel"}
            aria-expanded={showRightPanel}
            onClick={toggleRightPanel}
            className={cn(
              "absolute top-1/2 z-30 -translate-y-1/2 border border-border bg-card px-1 py-2 text-muted-foreground shadow-md hover:text-foreground",
              showRightPanel
                ? "right-full rounded-l-md border-r-0"
                : "right-0 rounded-l-md border-r-0",
            )}
          >
            {showRightPanel ? (
              <ChevronRight className="h-7 w-7" />
            ) : (
              <ChevronLeft className="h-7 w-7" />
            )}
          </button>
          {showRightPanel && (
            <div
              onMouseDown={handleRightResizeStart}
              onTouchStart={handleRightResizeStart}
              className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none"
            />
          )}
          {showRightPanel && (
            <div
              className="flex h-full flex-col overflow-hidden border-l border-border bg-card"
              style={{ width: rightPanelWidth }}
            >
            {isDesktop && rightPanel === "dom" && <DOMPanel symbol={selectedSymbol} tick={tick} />}
            {isDesktop && rightPanel === "position-builder" && (
              <PositionBuilderPanel
                onRequestSignIn={() => setShowSettings(true)}
                symbol={selectedSymbol}
                symbolInfo={symbolInfo}
                tick={tick}
                mode={mode}
                accountEquity={account?.equity ?? account?.balance ?? 0}
                onPreviewChange={setPositionBuilderPreview}
                volumeProfile={volumeProfile}
                oneClick={oneClick}
                onToggleOneClick={toggleOneClick}
                onConfirmOrder={setConfirmOrder}
                isFeedConnected={isFeedConnected}
                soundMuted={soundMuted}
                onToggleMute={toggleSoundMute}
                onOrderSuccess={() => {
                  playTradeSound();
                  handleFirstTrade();
                }}
              />
            )}
            {isDesktop && rightPanel === "watchlist" && (
              <WatchlistPanel
                symbols={symbols}
                ticks={ticks}
                selectedSymbol={selectedSymbol}
                onSelect={setSelectedSymbol}
                oneClick={oneClick}
                mode={mode}
                isFeedConnected={isFeedConnected}
              />
            )}
            {isDesktop && rightPanel === "ai-trader" && (
              <div className="flex-1 overflow-hidden">
                <AiTraderPanel mode={mode} />
              </div>
            )}
            </div>
          )}
        </div>
        )}
      </div>

      {/* ── Mobile tabs (small screens only) ─────────────
          Trade / Positions / Book. The chart is the fourth and lives in the
          main layout above so it never unmounts. Each of these gets the full
          pane instead of the 45vh the drag sheet allowed. */}
      {/* The same Position Builder the desktop right panel mounts — not a
          second, simpler ticket. Before this, a phone got MobileTradingPanel:
          fixed lot buttons, no risk sizing, and a "stop-loss/take-profit
          aren't supported yet" note that stayed true on mobile even after
          1.9.0 shipped the attached bracket. `isDesktop` guarantees only one
          of the two mounts at a time. */}
      {!isDesktop && mobileTab === "trade" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <PositionBuilderPanel
            onRequestSignIn={() => setShowSettings(true)}
            symbol={selectedSymbol}
            symbolInfo={symbolInfo}
            tick={tick}
            mode={mode}
            accountEquity={account?.equity ?? account?.balance ?? 0}
            onPreviewChange={setPositionBuilderPreview}
            volumeProfile={volumeProfile}
            oneClick={oneClick}
            onToggleOneClick={toggleOneClick}
            onConfirmOrder={setConfirmOrder}
            isFeedConnected={isFeedConnected}
            soundMuted={soundMuted}
            onToggleMute={toggleSoundMute}
            onOrderSuccess={() => {
              playTradeSound();
              handleFirstTrade();
              // Nothing on the Trade tab reflects a filled order, so send the
              // trader where the result actually shows up.
              setMobileTab("positions");
            }}
          />
        </div>
      )}

      {!isDesktop && mobileTab === "positions" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Aggregate unrealized P&L. It used to sit in MobileAccountBar,
              which this redesign removed as a duplicate of the footer's
              AccountPanel — but AccountPanel carries equity, not P&L, so
              without this the number has no home on a phone. */}
          <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-4 py-2">
            <span className="text-label uppercase text-muted-foreground">Unrealized P&amp;L</span>
            <span className={cn("text-data font-semibold", pnlClass(positionPnl))}>
              {positionPnl >= 0 ? "+" : ""}
              {formatCurrency(positionPnl)}
            </span>
          </div>
          <BottomPanel
            tab={bottomTab}
            onTabChange={handleBottomTabChange}
            collapsed={false}
            fill
            onToggleCollapsed={toggleBottomPanel}
            positions={positions}
            orders={orders}
            mode={mode}
            onModifyPosition={setModifyingPosition}
            onModifyOrder={setModifyingOrder}
            onSelectPositionSymbol={setSelectedSymbol}
            onSelectOrderSymbol={setSelectedSymbol}
            aiTraderEnabled={aiTraderEnabled}
            isFeedConnected={isFeedConnected}
          />
        </div>
      )}

      {!isDesktop && mobileTab === "book" && (
        <div className="flex-1 overflow-y-auto">
          <DOMPanel symbol={selectedSymbol} tick={tick} />
        </div>
      )}

        </>
      )}

      {/* Dialogs */}
      <PositionModifyDialog
        position={modifyingPosition}
        onClose={() => setModifyingPosition(null)}
        onSaved={() => setModifyingPosition(null)}
        tick={tick}
        isFeedConnected={isFeedConnected}
      />
      <OrderModifyDialog
        order={modifyingOrder}
        onClose={() => setModifyingOrder(null)}
        onSaved={() => setModifyingOrder(null)}
        tick={tick}
      />
      <OrderConfirmDialog
        isOpen={!!confirmOrder}
        order={confirmOrder}
        onConfirm={() => {
          if (confirmOrder?._submit) {
            setConfirmLoading(true);
            confirmOrder
              ._submit()
              .then(() => {
                playTradeSound();
                handleFirstTrade();
              })
              .finally(() => {
                setConfirmLoading(false);
                setConfirmOrder(null);
              });
          }
        }}
        onCancel={() => setConfirmOrder(null)}
        tick={tick}
        symbolInfo={symbolInfo}
        loading={confirmLoading}
      />

      {/* ── Footer ──────────────────────────────────────── */}
      <Footer onOpenSettings={() => setShowSettings(true)} />

      {/* Last element on the page on purpose: a bottom tab bar is the anchor
          every mobile OS puts against the bottom edge, and anything rendered
          below it reads as belonging to the tab bar rather than to the app. */}
      {!isDesktop && !showSettings && (
        <MobileTabBar tab={mobileTab} onTabChange={setMobileTab} />
      )}
    </div>
  );
}
