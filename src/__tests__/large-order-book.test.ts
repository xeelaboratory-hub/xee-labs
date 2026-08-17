import { describe, expect, it } from "vitest";
import type { CandlestickData, Time } from "lightweight-charts";
import { findLatestCandleAtPrice, findTimeBounds } from "../lib/chart-plugins/large-order-book/large-order-book.ts";

describe("large order book time lookup", () => {
  it("finds adjacent candles and clamps outside the loaded range", () => {
    const data = [100, 200, 300].map((time) => ({ time: time as Time }));

    expect(findTimeBounds(50, data)?.map((item) => item.time)).toEqual([100, 200]);
    expect(findTimeBounds(250, data)?.map((item) => item.time)).toEqual([200, 300]);
    expect(findTimeBounds(400, data)?.map((item) => item.time)).toEqual([200, 300]);
  });

  it("stops an active wall at the nearest candle that trades through its price", () => {
    const candle = (time: number, low: number, high: number): CandlestickData<Time> => ({
      time: time as Time, open: low, low, high, close: high,
    });
    const data = [candle(100, 90, 110), candle(200, 120, 140), candle(300, 95, 105)];

    expect(findLatestCandleAtPrice(100, data)?.time).toBe(300);
    expect(findLatestCandleAtPrice(130, data)?.time).toBe(200);
    expect(findLatestCandleAtPrice(200, data)).toBeUndefined();
  });
});
