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
      binance: { connected: true, lastEventAt: Date.now(), lastTickAt: Date.now() },
      okx: { connected: true, lastEventAt: Date.now(), lastTickAt: Date.now() },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.queryByText(/Feed|Outage|Connection Lost|Data Interruption/)).toBeNull();
  });

  it("warns once an exchange is disconnected", () => {
    mockHealth = {
      binance: { connected: false, lastEventAt: Date.now(), lastTickAt: Date.now() },
      okx: { connected: true, lastEventAt: Date.now(), lastTickAt: Date.now() },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.getByText(/Binance disconnected/)).toBeInTheDocument();
  });

  it("warns when a connected exchange hasn't reported a recent event (stale)", () => {
    mockHealth = {
      binance: { connected: true, lastEventAt: Date.now() - 90_000, lastTickAt: Date.now() - 90_000 },
      okx: { connected: true, lastEventAt: Date.now(), lastTickAt: Date.now() },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.getByText(/Binance.*hasn't reported a recent update/)).toBeInTheDocument();
  });

  it("warns on a frozen ticker even while other feed traffic keeps the connection current", () => {
    // The $49 incident: OKX's ticker channel died while its candle and book
    // channels kept flowing, so lastEventAt stayed fresh and nothing warned
    // for 37 minutes. Staleness must be judged on lastTickAt alone.
    mockHealth = {
      binance: { connected: true, lastEventAt: Date.now(), lastTickAt: Date.now() },
      okx: { connected: true, lastEventAt: Date.now(), lastTickAt: Date.now() - 37 * 60_000 },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.getByText(/OKX.*hasn't reported a recent update/)).toBeInTheDocument();
  });

  it("stays quiet through a long tick gap that is still under the threshold", () => {
    // OKX's measured cadence is bimodal — mostly under 5s, but with sustained
    // stretches in the tens of seconds. 45s must not raise the banner.
    mockHealth = {
      binance: { connected: true, lastEventAt: Date.now(), lastTickAt: Date.now() - 45_000 },
      okx: { connected: true, lastEventAt: Date.now(), lastTickAt: Date.now() - 45_000 },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(11_000));
    expect(screen.queryByText(/hasn't reported a recent update/)).toBeNull();
  });

  it("does not flip the banner on before the 10s debounce elapses", () => {
    mockHealth = {
      binance: { connected: false, lastEventAt: null, lastTickAt: null },
      okx: { connected: true, lastEventAt: Date.now(), lastTickAt: Date.now() },
    };
    renderBanner();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByText(/disconnected/)).toBeNull();
  });
});
