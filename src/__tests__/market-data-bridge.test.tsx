import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarketDataBridge } from "@/components/MarketDataBridge";
import { queryKeys } from "@/services/queries";
import type { EtfFlow } from "@/services/api/market-data";
import { useTradingStore } from "@/services/store";

type Handler = (event: unknown) => void;
type StateHandler = (state: string) => void;

let marketDataHandler: Handler | null = null;
let stateHandler: StateHandler | null = null;
let wsState = "connected";
const { resync } = vi.hoisted(() => ({ resync: vi.fn() }));

vi.mock("@/services/ws", () => ({
  wsClient: {
    get state() {
      return wsState;
    },
    subscribe: (_channel: string, handler: Handler) => {
      marketDataHandler = handler;
      return () => {
        marketDataHandler = null;
      };
    },
    onStateChange: (cb: StateHandler) => {
      stateHandler = cb;
      return () => {
        stateHandler = null;
      };
    },
    resync,
  },
}));

function renderBridge(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketDataBridge />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  marketDataHandler = null;
  stateHandler = null;
  wsState = "connected";
  resync.mockClear();
  useTradingStore.setState({ largeOrderBooks: {} });
});

describe("MarketDataBridge — EtfFlowUpdated handling", () => {
  it("replaces the live large-order snapshot for one exchange symbol", () => {
    const qc = new QueryClient();
    renderBridge(qc);
    const level = {
      id: "level-1",
      source: "binance" as const,
      symbol: "BINANCE:BTCUSD",
      side: "bid" as const,
      price: 50_000,
      quantity: 20,
      currentNotional: 1_000_000,
      peakNotional: 1_000_000,
      firstSeen: "2026-08-17T00:00:00Z",
      lastSeen: "2026-08-17T00:00:05Z",
      endedAt: null,
    };

    marketDataHandler?.({
      eventType: "LargeOrderBookUpdated",
      mode: "snapshot",
      sequence: 1,
      symbol: "BINANCE:BTCUSD",
      source: "binance",
      levels: [level],
      removedIds: [],
      occurredAt: "2026-08-17T00:00:05Z",
    });

    expect(useTradingStore.getState().largeOrderBooks["BINANCE:BTCUSD"]).toEqual([level]);
  });

  it("applies large-order deltas and removes ended levels", () => {
    const qc = new QueryClient();
    renderBridge(qc);
    const level = {
      id: "delta-level", source: "okx" as const, symbol: "OKX:ETHUSD", side: "ask" as const,
      price: 4_000, quantity: 200, currentNotional: 800_000, peakNotional: 800_000,
      firstSeen: "2026-08-17T00:00:00Z", lastSeen: "2026-08-17T00:00:01Z", endedAt: null,
    };

    marketDataHandler?.({
      eventType: "LargeOrderBookUpdated", mode: "snapshot", sequence: 4,
      symbol: "OKX:ETHUSD", source: "okx", levels: [level], removedIds: [],
      occurredAt: "2026-08-17T00:00:01Z",
    });
    marketDataHandler?.({
      eventType: "LargeOrderBookUpdated", mode: "delta", sequence: 5,
      symbol: "OKX:ETHUSD", source: "okx", levels: [], removedIds: [level.id],
      occurredAt: "2026-08-17T00:00:02Z",
    });

    expect(useTradingStore.getState().largeOrderBooks["OKX:ETHUSD"]).toEqual([]);
    expect(resync).not.toHaveBeenCalled();
  });

  it("resyncs instead of applying a delta after a sequence gap", () => {
    const qc = new QueryClient();
    renderBridge(qc);

    marketDataHandler?.({
      eventType: "LargeOrderBookUpdated", mode: "snapshot", sequence: 2,
      symbol: "OKX:BTCUSD", source: "okx", levels: [], removedIds: [],
      occurredAt: "2026-08-17T00:00:01Z",
    });
    marketDataHandler?.({
      eventType: "LargeOrderBookUpdated", mode: "delta", sequence: 4,
      symbol: "OKX:BTCUSD", source: "okx", levels: [], removedIds: [],
      occurredAt: "2026-08-17T00:00:02Z",
    });

    expect(resync).toHaveBeenCalledOnce();
  });

  it("upserts a new row into the etf-flows cache", () => {
    const qc = new QueryClient();
    qc.setQueryData<EtfFlow[]>(queryKeys.market.etfFlows, [
      { flowDate: "2026-08-13", totalNetFlow: 5, observedAt: "2026-08-13T04:00:00Z", updatedAt: "a" },
    ]);
    renderBridge(qc);

    marketDataHandler?.({
      eventType: "EtfFlowUpdated",
      changeType: "new",
      flowDate: "2026-08-14",
      totalNetFlow: 100,
      observedAt: "2026-08-14T04:00:00Z",
      updatedAt: "b",
    });

    const cache = qc.getQueryData<EtfFlow[]>(queryKeys.market.etfFlows);
    expect(cache).toEqual([
      { flowDate: "2026-08-13", totalNetFlow: 5, observedAt: "2026-08-13T04:00:00Z", updatedAt: "a" },
      { flowDate: "2026-08-14", totalNetFlow: 100, observedAt: "2026-08-14T04:00:00Z", updatedAt: "b" },
    ]);
  });

  it("replaces an existing row by flowDate on revision", () => {
    const qc = new QueryClient();
    qc.setQueryData<EtfFlow[]>(queryKeys.market.etfFlows, [
      { flowDate: "2026-08-14", totalNetFlow: 100, observedAt: "2026-08-14T04:00:00Z", updatedAt: "a" },
    ]);
    renderBridge(qc);

    marketDataHandler?.({
      eventType: "EtfFlowUpdated",
      changeType: "revision",
      flowDate: "2026-08-14",
      totalNetFlow: 999,
      observedAt: "2026-08-14T04:00:00Z",
      updatedAt: "b",
    });

    const cache = qc.getQueryData<EtfFlow[]>(queryKeys.market.etfFlows);
    expect(cache).toEqual([
      { flowDate: "2026-08-14", totalNetFlow: 999, observedAt: "2026-08-14T04:00:00Z", updatedAt: "b" },
    ]);
  });

  it("a revision to 0 replaces the row (clearing the stale marker downstream)", () => {
    const qc = new QueryClient();
    qc.setQueryData<EtfFlow[]>(queryKeys.market.etfFlows, [
      { flowDate: "2026-08-14", totalNetFlow: 100, observedAt: "2026-08-14T04:00:00Z", updatedAt: "a" },
    ]);
    renderBridge(qc);

    marketDataHandler?.({
      eventType: "EtfFlowUpdated",
      changeType: "revision",
      flowDate: "2026-08-14",
      totalNetFlow: 0,
      observedAt: "2026-08-14T04:00:00Z",
      updatedAt: "b",
    });

    const cache = qc.getQueryData<EtfFlow[]>(queryKeys.market.etfFlows);
    expect(cache).toEqual([
      { flowDate: "2026-08-14", totalNetFlow: 0, observedAt: "2026-08-14T04:00:00Z", updatedAt: "b" },
    ]);
  });

  it("reconnect invalidates the etf-flows query for a REST gap-fill resync", () => {
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    wsState = "disconnected";
    renderBridge(qc);

    wsState = "connected";
    stateHandler?.("connected");

    const calledKeys = invalidateSpy.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(calledKeys).toContain(JSON.stringify(queryKeys.market.etfFlows));
  });
});
