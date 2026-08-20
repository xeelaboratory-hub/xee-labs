import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

let mockHealth: unknown;
let mockWsState: "connected" | "disconnected" = "connected";
const wsStateListeners = new Set<(s: string) => void>();

vi.mock("@/services/queries", () => ({
  useMarketDataHealth: () => ({ data: mockHealth }),
}));

vi.mock("@/services/ws", () => ({
  wsClient: {
    get state() {
      return mockWsState;
    },
    onStateChange(cb: (s: string) => void) {
      wsStateListeners.add(cb);
      return () => wsStateListeners.delete(cb);
    },
  },
}));

import { StaleDataBanner } from "@/components/ConnectionIndicator";

function renderBanner() {
  return render(<StaleDataBanner />);
}

beforeEach(() => {
  vi.useFakeTimers();
  mockWsState = "connected";
  mockHealth = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  wsStateListeners.clear();
});

describe("StaleDataBanner", () => {
  it("stays hidden when every exchange is connected and fresh", () => {
    mockHealth = {
      binance: { connected: true, lastEventAt: Date.now() },
      okx: { connected: true, lastEventAt: Date.now() },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.queryByText(/Feed|Outage|Connection Lost|Data Interruption/)).toBeNull();
  });

  it("warns once an exchange is disconnected", () => {
    mockHealth = {
      binance: { connected: false, lastEventAt: Date.now() },
      okx: { connected: true, lastEventAt: Date.now() },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.getByText(/Binance disconnected/)).toBeInTheDocument();
  });

  it("warns when a connected exchange hasn't reported a recent event (stale)", () => {
    mockHealth = {
      binance: { connected: true, lastEventAt: Date.now() - 60_000 },
      okx: { connected: true, lastEventAt: Date.now() },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.getByText(/Binance.*hasn't reported a recent update/)).toBeInTheDocument();
  });

  it("does not flip the banner on before the 10s debounce elapses", () => {
    mockHealth = {
      binance: { connected: false, lastEventAt: null },
      okx: { connected: true, lastEventAt: Date.now() },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText(/disconnected/)).toBeNull();
  });
});
