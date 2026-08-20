import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./api";
import type {
  EtfFlow,
  LargeOrderLevel,
  LargeOrderSource,
  LargeOrderThreshold,
  MarketDataCandlesPayload,
  MarketDataInstrumentSpec,
} from "./api/market-data";
import { useAuthStore } from "./store";

import type {
  Account,
  Order,
  Position,
  Symbol,
  Candle,
  PlaceOrderInput,
  TradeHistoryEntry,
  TradingMode,
} from "./schemas";

// ── Query Key Factories ─────────────────────────────────
export const queryKeys = {
  accounts: {
    all: ["accounts"] as const,
    detail: (mode: string) => [...queryKeys.accounts.all, mode] as const,
  },
  trading: {
    positions: (mode: string) => ["positions", mode] as const,
    orders: (mode: string) => ["orders", mode] as const,
  },
  market: {
    symbols: ["symbols"] as const,
    instrument: (symbol: string) => ["instrument", symbol] as const,
    candles: (symbol: string, tf: string) => ["candles", symbol, tf] as const,
    sessionVolumeProfile: (symbol: string, market: string, date: string) =>
      ["session-volume-profile", symbol, market, date] as const,
    sessionVolumeProfiles: ["session-volume-profile"] as const,
    economicCalendar: (currencies: string[]) => ["economicCalendar", ...currencies] as const,
    etfFlows: ["etf-flows"] as const,
    largeOrderBook: ["large-order-book"] as const,
  },
} as const;

export function useAccount(mode: TradingMode | null, opts?: Partial<UseQueryOptions<Account>>) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const authScope = useAuthStore((s) => s.user?.id ?? "guest");
  return useQuery<Account>({
    queryKey: [...queryKeys.accounts.detail(mode!), authScope],
    queryFn: () => api.getAccount(mode!),
    enabled: !!accessToken && !!mode,
    staleTime: 15_000,
    // No WS push for balance/equity — poll so it can't go silently out of
    // date while a user is watching it (matches positions/orders below,
    // which hit the same gap for the same reason).
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
    ...opts,
  });
}

// ── Trading Queries ────────────────────────────────────
export function usePositions(mode: TradingMode | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const authScope = useAuthStore((s) => s.user?.id ?? "guest");
  return useQuery<Position[]>({
    queryKey: [...queryKeys.trading.positions(mode!), authScope],
    queryFn: () => api.getPositions(mode!),
    enabled: !!accessToken && !!mode,
    // 10s staleTime avoids refetch storms; 30s refetchInterval is the primary
    // update path (no WS push for positions/orders — see MarketDataBridge.tsx).
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useOrders(mode: TradingMode | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const authScope = useAuthStore((s) => s.user?.id ?? "guest");
  return useQuery<Order[]>({
    queryKey: [...queryKeys.trading.orders(mode!), authScope],
    queryFn: () => api.getOrders(mode!),
    enabled: !!accessToken && !!mode,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useTradeHistory(mode: TradingMode | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const authScope = useAuthStore((s) => s.user?.id ?? "guest");
  return useQuery<TradeHistoryEntry[]>({
    queryKey: ["tradeHistory", mode, authScope] as const,
    queryFn: () => api.getTradeHistory(mode!),
    enabled: !!accessToken && !!mode,
    staleTime: 30_000,
  });
}

// ── Market Data Queries ────────────────────────────────
export function useSymbols() {
  return useQuery<Symbol[]>({
    queryKey: queryKeys.market.symbols,
    queryFn: () => api.getSymbols(),
    staleTime: 5 * 60_000, // 5min
  });
}

// Real OKX instrument specs (ctVal/lotSz/minSz/tickSz/maxLever) for Position
// Builder's sizing math — 400s server-side for non-OKX symbols, so don't
// retry that expected failure.
export function useInstrument(symbol: string | undefined) {
  return useQuery<MarketDataInstrumentSpec>({
    queryKey: queryKeys.market.instrument(symbol!),
    queryFn: () => api.getInstrument(symbol!),
    enabled: !!symbol,
    staleTime: 30 * 60_000, // 30min — instrument specs change rarely
    retry: 1,
  });
}

export interface EconomicCalendarEvent {
  id: string;
  time: string;
  currency: string;
  impact: "low" | "medium" | "high";
  event: string;
  forecast?: string;
  previous?: string;
  actual?: string;
  country: string;
}

export function useEconomicCalendar(currencies: string[]) {
  return useQuery<EconomicCalendarEvent[]>({
    queryKey: queryKeys.market.economicCalendar(currencies),
    queryFn: async () => {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 14);
      const to = new Date(now);
      to.setDate(to.getDate() + 14);
      const res = await api.getEconomicCalendar(
        currencies,
        from.toISOString().split("T")[0],
        to.toISOString().split("T")[0],
      );
      return res as EconomicCalendarEvent[];
    },
    enabled: currencies.length > 0,
    staleTime: 10 * 60_000, // refresh every 10min
  });
}

export function useCandles(
  symbol: string,
  timeframe: string,
  limit?: number,
  replayVersion?: number,
) {
  return useQuery<MarketDataCandlesPayload, Error, Candle[]>({
    // Include replayVersion in the query key so each replay session forces a
    // completely fresh query — React Query won't reuse structural sharing or
    // stale cache from a previous replay / normal session.
    queryKey: [...queryKeys.market.candles(symbol, timeframe), limit ?? "auto", replayVersion ?? 0],
    queryFn: () => api.getCandlesWithMeta(symbol, timeframe, limit),
    // Extract just the candles array for consumers — raw payload (with isPartial)
    // is still accessible via query.state.data inside refetchInterval below.
    select: (data) => data.candles,
    staleTime: 30_000,
    // Keep previously-fetched candles visible while a new depth query (different
    // limit in the key) is in-flight. Without this, switching from firstPaint
    // → deep limit causes a momentary empty array, which lets a live WS candle
    // paint as the only bar before history arrives.
    placeholderData: (prev) => prev,
    // When the server signals the response is partial (backfill queued), poll
    // at 3 s until data fills in. Otherwise use the 5-min safety-net cadence.
    refetchInterval: (query) => (query.state.data?.metadata?.isPartial ? 3_000 : 5 * 60_000),
  });
}

// ── Market Data Health ──
export function useMarketDataHealth() {
  return useQuery({
    queryKey: ["market-data-health"] as const,
    queryFn: () => api.getMarketDataHealth(),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
}

// ── ETF Flow (BTC, context indicator only) ──
export function useEtfFlows() {
  return useQuery<EtfFlow[]>({
    queryKey: queryKeys.market.etfFlows,
    queryFn: () => api.getEtfFlows(),
    staleTime: Infinity, // WS pushes updates directly into this cache; no polling
  });
}

export function useLargeOrderBookHistory(
  base: "BTC" | "ETH",
  sources: LargeOrderSource[],
  threshold: LargeOrderThreshold,
  from?: string,
  to?: string,
  enabled = true,
  limit?: number,
) {
  return useQuery<LargeOrderLevel[]>({
    queryKey: [...queryKeys.market.largeOrderBook, base, sources.join(","), threshold, from, to, limit],
    queryFn: () => api.getLargeOrderBookHistory(base, sources, threshold, from, to, limit),
    enabled: enabled && sources.length > 0,
    staleTime: 30_000,
    retry: 1,
  });
}

// ── Mutations ──────────────────────────────────────────
export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlaceOrderInput) => api.placeOrder(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.trading.orders(vars.mode) });
      qc.invalidateQueries({ queryKey: queryKeys.trading.positions(vars.mode) });
      qc.invalidateQueries({ queryKey: queryKeys.accounts.detail(vars.mode) });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, mode, symbol }: { orderId: string; mode: TradingMode; symbol: string }) =>
      api.cancelOrder(orderId, mode, symbol),
    onMutate: async ({ orderId, mode }) => {
      // Optimistic update: remove order from list
      await qc.cancelQueries({ queryKey: queryKeys.trading.orders(mode) });
      const prev = qc.getQueryData<Order[]>(queryKeys.trading.orders(mode));
      if (prev) {
        qc.setQueryData(
          queryKeys.trading.orders(mode),
          prev.map((o) => (o.id === orderId ? { ...o, status: "CANCELLED" } : o)),
        );
      }
      return { prev };
    },
    onError: (_err, { mode }, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.trading.orders(mode), ctx.prev);
    },
    onSettled: (_data, _err, { mode }) => {
      qc.invalidateQueries({ queryKey: queryKeys.trading.orders(mode) });
    },
  });
}

export function useClosePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      positionId,
      mode,
      quantity,
    }: {
      positionId: string;
      mode: TradingMode;
      quantity?: number;
    }) => api.closePosition(positionId, mode, quantity),
    onSuccess: (_data, { mode }) => {
      qc.invalidateQueries({ queryKey: queryKeys.trading.positions(mode) });
      qc.invalidateQueries({ queryKey: queryKeys.accounts.detail(mode) });
      qc.invalidateQueries({ queryKey: ["tradeHistory", mode] });
    },
  });
}

/** TP/SL editing on an open position isn't wired to OKX yet (needs conditional/algo
 * orders) — this mutation always rejects so callers surface a clear error. */
export function useModifyPosition() {
  return useMutation({
    mutationFn: (_vars: {
      positionId: string;
      mode: TradingMode;
      modifications: { takeProfit?: number | null; stopLoss?: number | null };
    }) => Promise.reject(new Error("Modifying take-profit/stop-loss isn't supported yet")),
  });
}

export function useCloseAllPositions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mode, positionIds }: { mode: TradingMode; positionIds: string[] }) =>
      Promise.all(positionIds.map((id) => api.closePosition(id, mode))),
    onSuccess: (_data, { mode }) => {
      qc.invalidateQueries({ queryKey: queryKeys.trading.positions(mode) });
      qc.invalidateQueries({ queryKey: queryKeys.accounts.detail(mode) });
    },
  });
}

// ── Pattern Detection ──

/** Amending a pending order isn't wired to OKX yet — cancel and re-place instead. */
export function useModifyOrder() {
  return useMutation({
    mutationFn: (_vars: {
      orderId: string;
      mode: TradingMode;
      modifications: { price?: number; quantity?: number };
    }) => Promise.reject(new Error("Modifying orders isn't supported yet — cancel and re-place instead")),
  });
}

