import { describe, expect, it } from "vitest";
import { computeLivePnl, computeLivePrice, MAX_TICK_AGE_MS } from "@/lib/livePnl";
import type { Position } from "@/services/schemas";

const NOW = 1_787_296_000_000;

// The real OKX position from the stale-tick incident: 3.99 BTC-USDT-SWAP
// contracts (0.01 BTC each) long from 75,510.50, marked at 76,575.30.
const position = {
  id: "OKX:BTCUSD:net:long",
  symbolName: "OKX:BTCUSD",
  side: "LONG",
  quantity: 3.99,
  entryPrice: 75_510.5,
  currentPrice: 76_575.3,
  unrealizedPnl: 42.49,
  margin: 30.5,
  openedAt: "2026-08-21T09:54:00.000Z",
  takeProfit: null,
  stopLoss: null,
} as unknown as Position;

const tick = (bid: number, ageMs: number) => ({ bid, ask: bid + 0.1, timestamp: NOW - ageMs });

describe("live PnL", () => {
  it("scales the server snapshot by a fresh tick", () => {
    // perPriceUnit = 42.49 / (76575.3 - 75510.5) = 0.0399 = 3.99 x 0.01 BTC
    const result = computeLivePnl(position, tick(76_600, 1_000), NOW);

    expect(result).toBeCloseTo(0.0399 * (76_600 - 75_510.5), 2);
    expect(result).toBeGreaterThan(0);
  });

  it("ignores a stale tick and reports the server value instead", () => {
    // The incident: a 37-minute-old tick of 75,336.8 turned the exchange's
    // real +$42.49 into a displayed -$6.93 on a live position.
    const stale = tick(75_336.8, 37 * 60 * 1000);

    expect(computeLivePnl(position, stale, NOW)).toBe(42.49);
  });

  it("would have produced the wrong figure without the freshness guard", () => {
    // Guards the regression itself: with the same tick treated as fresh, the
    // extrapolation still yields the incident's -6.93.
    const asIfFresh = tick(75_336.8, 0);

    expect(computeLivePnl(position, asIfFresh, NOW)).toBeCloseTo(-6.93, 2);
  });

  it("treats a tick exactly at the age limit as usable", () => {
    const borderline = tick(76_600, MAX_TICK_AGE_MS);

    expect(computeLivePnl(position, borderline, NOW)).toBeGreaterThan(0);
    expect(computeLivePnl(position, tick(76_600, MAX_TICK_AGE_MS + 1), NOW)).toBe(42.49);
  });

  it("falls back to the server value when there is no tick at all", () => {
    expect(computeLivePnl(position, undefined, NOW)).toBe(42.49);
  });

  it("returns the server value when the snapshot has no price movement", () => {
    const flat = { ...position, currentPrice: position.entryPrice } as Position;

    expect(computeLivePnl(flat, tick(76_600, 1_000), NOW)).toBe(flat.unrealizedPnl);
  });

  it("prices a SHORT off the ask", () => {
    const short = { ...position, side: "SHORT" } as Position;

    expect(computeLivePrice(short, tick(76_600, 1_000), NOW)).toBe(76_600.1);
  });

  describe("computeLivePrice", () => {
    it("uses the live bid for a LONG when the tick is fresh", () => {
      expect(computeLivePrice(position, tick(76_600, 1_000), NOW)).toBe(76_600);
    });

    it("holds the server price when the tick is stale", () => {
      expect(computeLivePrice(position, tick(75_336.8, 37 * 60 * 1000), NOW)).toBe(76_575.3);
    });
  });
});
