import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradingModeIndicator } from "@/pages/trading/TradingModeIndicator";
import { useTradingStore } from "@/services/store";

describe("TradingModeIndicator", () => {
  it("shows DEMO in demo mode", () => {
    useTradingStore.setState({ mode: "demo" });
    render(<TradingModeIndicator />);
    expect(screen.getByLabelText("Demo trading mode")).toHaveTextContent("DEMO");
  });

  it("shows a distinct LIVE badge in live mode", () => {
    useTradingStore.setState({ mode: "live" });
    render(<TradingModeIndicator />);
    const badge = screen.getByLabelText("Live trading mode");
    expect(badge).toHaveTextContent("LIVE");
    expect(badge.className).toContain("text-destructive");
  });
});
