import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionVolumeProfileSummary } from "@/pages/trading/useSessionVolumeProfile";
import { PositionBuilderPanel } from "@/pages/trading/PositionBuilderPanel";
import type { Symbol } from "@/services/schemas";

vi.mock("@/hooks/useIsDesktop.ts", () => ({
  useIsDesktop: () => false,
}));

vi.mock("@/services/queries.ts", () => ({
  useInstrument: () => ({ data: undefined, isLoading: false }),
  usePlaceOrder: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null }),
}));

vi.mock("@/services/store.tsx", () => ({
  useAuthStore: (selector: (s: { accessToken: string | null }) => unknown) =>
    selector({ accessToken: "token" }),
}));

const symbolInfo: Symbol = {
  id: "btc",
  name: "OKX:BTCUSD",
  displayName: "BTCUSD",
  category: "crypto",
  contractSize: 1,
  tickSize: 0.01,
  tickValue: 1,
  marginPercent: 1,
  maxLeverage: 100,
  commission: 0,
  swapLong: 0,
  swapShort: 0,
  tradingHoursStart: null,
  tradingHoursEnd: null,
  isActive: true,
  exchange: "okx",
};

const volumeProfile: SessionVolumeProfileSummary = {
  market: "LONDON",
  date: "2026-08-22",
  vah: 78000,
  poc: 77500,
  val: 77000,
  totalVolume: 1000,
  isDeveloping: false,
};

describe("PositionBuilderPanel mobile layout", () => {
  it("separates inputs from calculated trade summary and collapsible volume profile", async () => {
    const user = userEvent.setup();
    render(
      <PositionBuilderPanel
        symbol="OKX:BTCUSD"
        symbolInfo={symbolInfo}
        tick={{ bid: 77000, ask: 77010, timestamp: Date.now() }}
        mode="demo"
        accountEquity={1450.57}
        onPreviewChange={() => {}}
        volumeProfile={volumeProfile}
        isFeedConnected
      />,
    );

    expect(screen.getByText("OKX · Available $1,450.57")).toBeInTheDocument();
    expect(screen.getByText("Risk Management")).toBeInTheDocument();
    expect(screen.getByTestId("trade-summary")).toBeInTheDocument();
    expect(screen.getByText("Trade Summary")).toBeInTheDocument();
    expect(screen.getByText("Stop Loss Price")).toBeInTheDocument();
    expect(screen.getByText("Risk Amount")).toBeInTheDocument();
    expect(screen.getByTestId("trade-apply-footer")).toBeInTheDocument();
    expect(screen.queryByTestId("volume-profile-details")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("volume-profile-toggle"));
    expect(screen.getByTestId("volume-profile-details")).toBeInTheDocument();
    expect(screen.getByText("Point of Control")).toBeInTheDocument();
  });
});
