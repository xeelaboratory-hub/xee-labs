import { describe, expect, it } from "vitest";
import { submitButtonLabel, validateOrderInput } from "../pages/trading/OrderPanel.tsx";

describe("validateOrderInput", () => {
  const base = { isFeedConnected: true, quantity: "1", orderType: "MARKET" as const, price: "" };

  it("rejects placing an order while the data feed is disconnected", () => {
    const result = validateOrderInput({ ...base, isFeedConnected: false });
    expect(result).toEqual({
      ok: false,
      title: "No Data Feed",
      message: "Cannot place orders while disconnected from the data feed",
    });
  });

  it("rejects non-numeric or non-positive quantity", () => {
    expect(validateOrderInput({ ...base, quantity: "abc" }).ok).toBe(false);
    expect(validateOrderInput({ ...base, quantity: "0" }).ok).toBe(false);
    expect(validateOrderInput({ ...base, quantity: "-5" }).ok).toBe(false);
  });

  it("rejects quantity above the 1000 lot cap", () => {
    const result = validateOrderInput({ ...base, quantity: "1000.01" });
    expect(result).toEqual({
      ok: false,
      title: "Invalid Quantity",
      message: "Maximum quantity is 1000 lots",
    });
  });

  it("accepts exactly the 1000 lot cap", () => {
    expect(validateOrderInput({ ...base, quantity: "1000" })).toEqual({ ok: true, quantity: 1000 });
  });

  it("requires a valid price for LIMIT orders", () => {
    expect(validateOrderInput({ ...base, orderType: "LIMIT", price: "" }).ok).toBe(false);
    expect(validateOrderInput({ ...base, orderType: "LIMIT", price: "0" }).ok).toBe(false);
    expect(validateOrderInput({ ...base, orderType: "LIMIT", price: "abc" }).ok).toBe(false);
  });

  it("ignores any price for MARKET orders even if garbage was left in the field", () => {
    const result = validateOrderInput({ ...base, orderType: "MARKET", price: "not-a-number" });
    expect(result).toEqual({ ok: true, quantity: 1 });
  });

  it("parses a valid LIMIT order with quantity and price", () => {
    const result = validateOrderInput({ ...base, orderType: "LIMIT", price: "50000" });
    expect(result).toEqual({ ok: true, quantity: 1, price: 50000 });
  });
});

describe("submitButtonLabel", () => {
  it("shows the disconnected message regardless of other state", () => {
    expect(submitButtonLabel(false, true, "BUY", "1", "BTC-USD", "live")).toBe(
      "Disconnected — Trading Disabled",
    );
  });

  it("shows a placing indicator while the order is pending", () => {
    expect(submitButtonLabel(true, true, "SELL", "2", "ETH-USD", "demo")).toBe("Placing…");
  });

  it("shows the buy/sell action with quantity, symbol, and mode", () => {
    expect(submitButtonLabel(true, false, "BUY", "0.5", "BTC-USD", "live")).toBe(
      "Buy 0.5 BTC-USD (live)",
    );
    expect(submitButtonLabel(true, false, "SELL", "0.5", "BTC-USD", "demo")).toBe(
      "Sell 0.5 BTC-USD (demo)",
    );
  });
});
