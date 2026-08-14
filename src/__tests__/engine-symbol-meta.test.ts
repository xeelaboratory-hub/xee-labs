import { describe, it, expect, beforeAll } from "vitest";
import * as engine from "../services/demo/engine.ts";
import type { Symbol } from "../services/schemas.ts";

const symbol = (overrides: Partial<Symbol>): Symbol => ({
  id: "BINANCE:BTCUSD",
  name: "BINANCE:BTCUSD",
  displayName: "Bitcoin",
  category: "CRYPTO",
  contractSize: 1,
  tickSize: 0.01,
  tickValue: 0.01,
  marginPercent: 1,
  maxLeverage: 100,
  commission: 0,
  swapLong: 0,
  swapShort: 0,
  tradingHoursStart: null,
  tradingHoursEnd: null,
  isActive: true,
  ...overrides,
});

describe("engine.setSymbolMeta", () => {
  beforeAll(() => {
    engine.setSymbolMeta([symbol({ id: "BINANCE:BTCUSD", name: "BINANCE:BTCUSD", contractSize: 2 })]);
  });

  it("uses the live registry's contractSize for margin/PnL, keyed by the full symbol id", () => {
    const order = engine.placeOrder({
      accountId: "acc",
      symbol: "BINANCE:BTCUSD",
      side: "BUY",
      type: "MARKET",
      quantity: 1,
      price: 100,
    });
    const pos = engine.getPositions().find((p) => p.symbolName === "BINANCE:BTCUSD");
    expect(pos).toBeDefined();
    expect(pos!.contractSize).toBe(2);
    // margin = notional / leverage = (price * qty * contractSize) / 100 = (100*1*2)/100
    expect(pos!.margin).toBeCloseTo(2);
    expect(order.avgFillPrice).toBe(100);
  });

  it("falls back to contractSize 1 for a symbol absent from the registry", () => {
    engine.placeOrder({
      accountId: "acc",
      symbol: "OKX:ETHUSD",
      side: "BUY",
      type: "MARKET",
      quantity: 1,
      price: 50,
    });
    const pos = engine.getPositions().find((p) => p.symbolName === "OKX:ETHUSD");
    expect(pos!.contractSize).toBe(1);
  });
});
