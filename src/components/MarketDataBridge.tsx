import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTradingStore } from "../services/store.tsx";
import { wsClient } from "../services/ws.ts";
import { queryKeys } from "../services/queries.ts";

/**
 * Global WebSocket subscriber. Owns the market-data subscription for the app.
 *
 * Why: Subscriptions used to live inside Layout / MobileShell, both rendered
 * BELOW the global ErrorBoundary. When any subtree threw (e.g. a lazy chunk
 * failed to load), ErrorBoundary unmounted the route tree → useEffect cleanups
 * ran → unsub() removed the market-data handler → every subsequent tick was
 * silently dropped. Hosting the subscription here, ABOVE the ErrorBoundary,
 * means subtree errors no longer kill the live data stream.
 *
 * There is no WS push for positions/orders/account balance — the real OKX
 * backend (backend/app/api/ws_gateway.py) only streams market data. Those
 * three are kept fresh via REST polling (usePositions/useOrders/useAccount's
 * refetchInterval) plus an immediate invalidateQueries after each trading
 * mutation (see services/queries.ts). Real-time push for them would need
 * OKX's private WS channels wired into the backend — not built yet.
 */

type MarketDataEvent =
  | {
      eventType: "MarketTick";
      symbol: string;
      bid: number;
      ask: number;
      occurredAt?: number | string;
    }
  | {
      eventType: "CandleUpdate";
      symbol: string;
      timeframe: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      timestamp: number;
    }
  | { eventType: "CandleClosed"; symbol: string; timeframe: string };

function toTimestamp(value: number | string | undefined): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

export function MarketDataBridge() {
  const updateTick = useTradingStore((s) => s.updateTick);
  const updateLiveTick = useTradingStore((s) => s.updateLiveTick);
  const updateCandleFromWs = useTradingStore((s) => s.updateCandleFromWs);
  const queryClient = useQueryClient();

  // Market-data: ticks, candles.
  useEffect(() => {
    const unsub = wsClient.subscribe("market-data", (event) => {
      const wsEvent = event as MarketDataEvent;
      if (wsEvent.eventType === "MarketTick") {
        updateTick(wsEvent.symbol, wsEvent.bid, wsEvent.ask, toTimestamp(wsEvent.occurredAt));
      } else if ((wsEvent as { eventType: string }).eventType === "HftLiveTick") {
        const liveTick = wsEvent as unknown as { symbol: string; bid: number; ask: number; occurredAt?: number | string };
        updateLiveTick(liveTick.symbol, liveTick.bid, liveTick.ask, toTimestamp(liveTick.occurredAt));
      } else if (wsEvent.eventType === "CandleUpdate") {
        updateCandleFromWs(wsEvent.symbol, wsEvent.timeframe, {
          open: wsEvent.open,
          high: wsEvent.high,
          low: wsEvent.low,
          close: wsEvent.close,
          volume: wsEvent.volume,
          timestamp: wsEvent.timestamp,
        });
      } else if (wsEvent.eventType === "CandleClosed") {
        queryClient.invalidateQueries({
          queryKey: queryKeys.market.candles(wsEvent.symbol, wsEvent.timeframe),
        });
      }
    });
    return () => {
      unsub();
    };
  }, [updateTick, updateLiveTick, updateCandleFromWs, queryClient]);

  // Gap-fill on WS reconnect: refetch caches so anything that happened
  // while the socket was down lands instantly.
  useEffect(() => {
    let wasConnected = wsClient.state === "connected";
    return wsClient.onStateChange((state) => {
      if (state === "connected" && !wasConnected) {
        queryClient.invalidateQueries({ queryKey: ["candles"] });
        queryClient.invalidateQueries({ queryKey: ["positions"] });
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
      }
      wasConnected = state === "connected";
    });
  }, [queryClient]);

  return null;
}
