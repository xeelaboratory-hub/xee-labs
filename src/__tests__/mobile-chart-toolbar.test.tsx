import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChartToolbar } from "@/pages/trading/ChartToolbar";

vi.mock("@/hooks/useIsDesktop.ts", () => ({
  useIsDesktop: () => false,
}));

const baseProps = {
  selectedSymbol: "BINANCE:BTCUSD",
  symbols: [{ name: "BINANCE:BTCUSD", category: "crypto" }],
  onSymbolChange: () => {},
  timeframe: "15m" as const,
  onTimeframeChange: () => {},
  activeIndicators: [],
  onToggleIndicator: () => {},
  sessionVolumeProfileMarkets: [],
  sessionVolumeProfileRows: 24,
  onSessionVolumeProfileMarket: () => {},
  onSessionVolumeProfileRows: () => {},
  showIndicatorMenu: false,
  onToggleIndicatorMenu: () => {},
  rightPanel: "dom",
  onRightPanel: () => {},
  showRightPanel: false,
  tick: { bid: 77239, ask: 77240, timestamp: Date.now() },
};

describe("ChartToolbar on mobile", () => {
  it("shows Settings in the top bar", async () => {
    const onOpenSettings = vi.fn();
    render(<ChartToolbar {...baseProps} onOpenSettings={onOpenSettings} />);

    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows a shortened symbol label while keeping the full symbol in aria-label", () => {
    render(<ChartToolbar {...baseProps} onOpenSettings={() => {}} />);
    expect(screen.getByText("BTCUSD")).toBeInTheDocument();
    expect(screen.queryByText("BINANCE:BTCUSD")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Symbol: BINANCE:BTCUSD" })).toBeInTheDocument();
  });

  it("keeps the trading mode badge in the single header row", () => {
    render(<ChartToolbar {...baseProps} onOpenSettings={() => {}} />);
    expect(screen.getByLabelText("Demo trading mode")).toBeInTheDocument();
  });
});
