import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MarketDataBridge } from "@/components/MarketDataBridge";
import { queryKeys } from "@/services/queries";
import type { EtfFlow } from "@/services/api/market-data";

type Handler = (event: unknown) => void;
type StateHandler = (state: string) => void;

let marketDataHandler: Handler | null = null;
let stateHandler: StateHandler | null = null;
let wsState = "connected";

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
});

describe("MarketDataBridge — EtfFlowUpdated handling", () => {
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
