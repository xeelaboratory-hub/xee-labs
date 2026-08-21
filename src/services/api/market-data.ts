import { request } from "./request";

export interface MarketDataSymbol {
  id: string;
  name: string;
  displayName: string | null;
  category: string;
  contractSize: number;
  tickSize: number;
  tickValue: number;
  marginPercent: number;
  maxLeverage: number;
  commission: number;
  swapLong: number;
  swapShort: number;
  tradingHoursStart: string | null;
  tradingHoursEnd: string | null;
  isActive: boolean;
  // Optional/extra fields backend may include
  symbol?: string;
  digits?: number;
  pipDigits?: number;
  [key: string]: unknown;
}

// Mirrors backend/app/schemas.py's InstrumentSpec — real per-instrument
// specs from OKX's public instruments endpoint, used by Position Builder.
export interface MarketDataInstrumentSpec {
  instId: string;
  instType: string;
  ctVal: number;
  ctValCcy: string;
  lotSz: number;
  minSz: number;
  tickSz: number;
  settleCcy: string;
  quoteCcy: string;
  baseCcy: string;
  maxLever: number;
}

export interface MarketDataCandle {
  time: number;
  timestamp: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketDataCandleMetadata {
  historicalCoverageStart: number | null;
  isPartial: boolean;
  backfillQueued: boolean;
}

// Mirrors backend/app/schemas.py ExchangeHealth / HealthResponse — one entry
// per exchange, keyed by exchange name.
export interface MarketDataExchangeHealth {
  connected: boolean;
  /** Any feed traffic — ticker, candles or book. Connection liveness. */
  lastEventAt: number | null; // unix ms
  /**
   * Ticker events only: the last time a *price* actually arrived. Judge
   * staleness on this, never on lastEventAt — a dead ticker channel leaves
   * prices frozen while candle and book traffic keep lastEventAt current.
   * Null until the first tick of a feed's lifetime.
   */
  lastTickAt: number | null; // unix ms
}

export type MarketDataHealth = Record<string, MarketDataExchangeHealth>;

export interface MarketDataCandlesPayload {
  candles: MarketDataCandle[];
  metadata: MarketDataCandleMetadata;
}

export interface MarketDataTick {
  symbol: string;
  bid: number;
  ask: number;
  timestamp?: number | string;
}

export interface EtfFlow {
  flowDate: string;
  totalNetFlow: number;
  observedAt: string | null;
  updatedAt: string;
}

export type LargeOrderSource = "binance" | "okx";
export type LargeOrderThreshold = 0 | 500_000 | 1_000_000 | 3_000_000 | 5_000_000 | 10_000_000;

export interface LargeOrderLevel {
  id: string;
  source: LargeOrderSource;
  symbol: string;
  side: "bid" | "ask";
  price: number;
  quantity: number;
  currentNotional: number;
  peakNotional: number;
  firstSeen: string;
  lastSeen: string;
  endedAt: string | null;
}

export interface EconomicEvent {
  id: string;
  time: string;
  currency: string;
  event: string;
  impact: "low" | "medium" | "high";
  forecast?: string;
  previous?: string;
  actual?: string;
  country: string;
  [key: string]: unknown;
}

export const marketdataApi = {
  // ── Market Data ──
  getSymbols: () => request<MarketDataSymbol[]>("/market-data/symbols"),

  getInstrument: (symbol: string) =>
    request<MarketDataInstrumentSpec>(`/market-data/instrument/${encodeURIComponent(symbol)}`),

  getTick: (symbol: string) => request<MarketDataTick>(`/market-data/ticks/${symbol}`),

  getTicks: () => request<Record<string, MarketDataTick>>("/market-data/ticks"),

  getCandles: (
    symbol: string,
    timeframe: string,
    limit?: number,
    range?: { fromMs: number; toMs: number },
  ) => {
    const payload: Record<string, number | string> = { timeframe };
    if (limit != null) payload.limit = limit;
    if (range) {
      payload.from = range.fromMs;
      payload.to = range.toMs;
    }
    return request<MarketDataCandle[] | MarketDataCandlesPayload>(
      `/market-data/candles/${symbol}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ).then((res) => (Array.isArray(res) ? res : res.candles));
  },

  getCandlesWithMeta: (
    symbol: string,
    timeframe: string,
    limit?: number,
    range?: { fromMs: number; toMs: number },
  ): Promise<MarketDataCandlesPayload> => {
    const payload: Record<string, number | string> = { timeframe };
    if (limit != null) payload.limit = limit;
    if (range) {
      payload.from = range.fromMs;
      payload.to = range.toMs;
    }
    return request<MarketDataCandle[] | MarketDataCandlesPayload>(
      `/market-data/candles/${symbol}`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    ).then((res) =>
      Array.isArray(res)
        ? {
            candles: res,
            metadata: { isPartial: false, backfillQueued: false, historicalCoverageStart: null },
          }
        : res,
    );
  },

  getMarketDataHealth: () => request<MarketDataHealth>("/market-data/health"),

  getEconomicCalendar: (currencies?: string[], from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (currencies?.length) params.set("currencies", currencies.join(","));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return request<EconomicEvent[]>(`/market-data/economic-calendar?${params.toString()}`);
  },

  getMarketDataStaleness: () => request<Record<string, unknown>>("/market-data/staleness"),

  getEtfFlows: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return request<EtfFlow[]>(`/market-data/etf-flows${qs ? `?${qs}` : ""}`);
  },

  getLargeOrderBookHistory: (
    base: "BTC" | "ETH",
    sources: LargeOrderSource[],
    threshold: LargeOrderThreshold,
    from?: string,
    to?: string,
    limit?: number,
  ) => {
    const params = new URLSearchParams({ base, threshold: String(threshold) });
    sources.forEach((source) => params.append("source", source));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (limit) params.set("limit", String(limit));
    return request<LargeOrderLevel[]>(`/market-data/large-order-book/history?${params}`);
  },
};
