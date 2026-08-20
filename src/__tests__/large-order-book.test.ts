import { describe, expect, it } from "vitest";
import type { CandlestickData, Time } from "lightweight-charts";
import {
  findLatestCandleAtPrice,
  findTimeBounds,
  LargeOrderBookPrimitive,
} from "../lib/chart-plugins/large-order-book/large-order-book.ts";
import type { LargeOrderLevel } from "../services/api/market-data.ts";

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

// Minimal fakes for the subset of IChartApi/ISeriesApi that renderLines() touches.
function fakeChartAndSeries(candles: CandlestickData<Time>[], height: number) {
  const chart = {
    timeScale: () => ({
      width: () => 500,
      getVisibleLogicalRange: () => (candles.length ? { from: 0, to: candles.length - 1 } : null),
      timeToCoordinate: (t: Time) => Number(t),
    }),
    paneSize: () => ({ height, width: 500 }),
  };
  const series = {
    data: () => candles,
    priceToCoordinate: (price: number) => price,
    subscribeDataChanged: () => {},
    unsubscribeDataChanged: () => {},
  };
  return { chart, series };
}

function level(overrides: Partial<LargeOrderLevel>): LargeOrderLevel {
  return {
    id: "lvl-1",
    source: "okx",
    symbol: "BTC-USD",
    side: "bid",
    price: 100,
    quantity: 1,
    currentNotional: 1_000_000,
    peakNotional: 1_000_000,
    firstSeen: "1970-01-01T00:00:10.000Z",
    lastSeen: "1970-01-01T00:00:10.000Z",
    endedAt: null,
    ...overrides,
  };
}

describe("LargeOrderBookPrimitive.renderLines", () => {
  const candle = (time: number, low: number, high: number): CandlestickData<Time> => ({
    time: time as Time,
    open: low,
    low,
    high,
    close: high,
  });
  const candles = [candle(0, 90, 110), candle(10, 90, 110), candle(40, 90, 110)];

  function primitiveWith(levels: LargeOrderLevel[], height = 200) {
    const primitive = new LargeOrderBookPrimitive();
    const { chart, series } = fakeChartAndSeries(candles, height);
    primitive.attached({ chart: chart as never, series: series as never, requestUpdate: () => {} });
    primitive.setLevels(levels);
    return primitive;
  }

  it("skips levels whose price falls outside the visible pane", () => {
    const primitive = primitiveWith([level({ id: "offscreen", price: 250 })], 200);
    expect(primitive.renderLines()).toHaveLength(0);
  });

  it("scales line width by notional value, thicker for larger walls", () => {
    const small = level({ id: "small", price: 100, currentNotional: 500_000 });
    const large = level({ id: "large", price: 105, currentNotional: 12_000_000 });
    const lines = primitiveWith([small, large]).renderLines();
    const smallLine = lines.find((l) => l.id === "small")!;
    const largeLine = lines.find((l) => l.id === "large")!;
    expect(smallLine.width).toBe(1);
    expect(largeLine.width).toBe(7);
  });

  it("colors bid levels green and ask levels red", () => {
    const bid = level({ id: "bid", price: 100, side: "bid" });
    const ask = level({ id: "ask", price: 101, side: "ask" });
    const lines = primitiveWith([bid, ask]).renderLines();
    expect(lines.find((l) => l.id === "bid")!.color).toContain("14, 203, 129");
    expect(lines.find((l) => l.id === "ask")!.color).toContain("246, 70, 93");
  });

  it("widens and fully opacifies the hovered level's line", () => {
    const lvl = level({ id: "hover-me", price: 100, currentNotional: 500_000 });
    const primitive = primitiveWith([lvl]);
    primitive.setHoveredId("hover-me");
    const line = primitive.renderLines().find((l) => l.id === "hover-me")!;
    expect(line.width).toBe(4); // base width 1 + 3 while hovered
    expect(line.color).toContain(", 1)");
  });

  it("dims an ended level and anchors its line between firstSeen and endedAt", () => {
    const ended = level({
      id: "ended",
      price: 100,
      firstSeen: "1970-01-01T00:00:10.000Z",
      endedAt: "1970-01-01T00:00:40.000Z",
    });
    const line = primitiveWith([ended]).renderLines().find((l) => l.id === "ended")!;
    expect(line.x1).toBe(10);
    expect(line.x2).toBe(40);
    expect(line.color).toContain("0.25"); // dimmed since ended and not hovered
  });
});
