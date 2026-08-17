import { describe, it, expect } from "vitest";
import {
  flowDateToIsraelMorningUtcMs,
  computeEtfFlowMarkers,
  getCandleBucketTime,
} from "@/pages/trading/utils";
import type { EtfFlow } from "@/services/api/market-data";
import type { CandlestickData, Time } from "lightweight-charts";

const COLORS = { up: "#0ecb81", down: "#f6465d" };

function candle(timeSec: number): CandlestickData<Time> {
  return { time: timeSec as Time, open: 1, high: 1, low: 1, close: 1 };
}

describe("flowDateToIsraelMorningUtcMs", () => {
  it("uses winter (IST, UTC+2) offset outside DST", () => {
    expect(new Date(flowDateToIsraelMorningUtcMs("2024-01-15")).toISOString()).toBe(
      "2024-01-15T05:00:00.000Z",
    );
  });

  it("uses summer (IDT, UTC+3) offset inside DST", () => {
    expect(new Date(flowDateToIsraelMorningUtcMs("2026-08-14")).toISOString()).toBe(
      "2026-08-14T04:00:00.000Z",
    );
  });

  it("flips correctly across the spring-forward transition", () => {
    expect(new Date(flowDateToIsraelMorningUtcMs("2026-03-26")).toISOString()).toBe(
      "2026-03-26T05:00:00.000Z",
    );
    expect(new Date(flowDateToIsraelMorningUtcMs("2026-03-28")).toISOString()).toBe(
      "2026-03-28T04:00:00.000Z",
    );
  });

  it("flips correctly across the fall-back transition", () => {
    expect(new Date(flowDateToIsraelMorningUtcMs("2026-10-24")).toISOString()).toBe(
      "2026-10-24T04:00:00.000Z",
    );
    expect(new Date(flowDateToIsraelMorningUtcMs("2026-10-26")).toISOString()).toBe(
      "2026-10-26T05:00:00.000Z",
    );
  });
});

describe("computeEtfFlowMarkers", () => {
  const dayCandle = getCandleBucketTime(Date.UTC(2026, 7, 14, 4, 0, 0), "1d");
  const chartData = [candle(dayCandle)];

  it("positive value produces a green inflow arrow below the candle", () => {
    const flows: EtfFlow[] = [
      { flowDate: "2026-08-14", totalNetFlow: 100, observedAt: "2026-08-14T04:00:00Z", updatedAt: "x" },
    ];
    const markers = computeEtfFlowMarkers(flows, chartData, "1d", COLORS);
    expect(markers).toEqual([
      { time: dayCandle, position: "belowBar", shape: "arrowUp", color: COLORS.up, id: "2026-08-14" },
    ]);
  });

  it("negative value produces a red outflow arrow above the candle", () => {
    const flows: EtfFlow[] = [
      { flowDate: "2026-08-14", totalNetFlow: -50, observedAt: "2026-08-14T04:00:00Z", updatedAt: "x" },
    ];
    const markers = computeEtfFlowMarkers(flows, chartData, "1d", COLORS);
    expect(markers).toEqual([
      { time: dayCandle, position: "aboveBar", shape: "arrowDown", color: COLORS.down, id: "2026-08-14" },
    ]);
  });

  it("zero value produces no marker", () => {
    const flows: EtfFlow[] = [
      { flowDate: "2026-08-14", totalNetFlow: 0, observedAt: "2026-08-14T04:00:00Z", updatedAt: "x" },
    ];
    expect(computeEtfFlowMarkers(flows, chartData, "1d", COLORS)).toEqual([]);
  });

  it("a date with no candle loaded produces no marker", () => {
    const flows: EtfFlow[] = [
      { flowDate: "2020-01-01", totalNetFlow: 10, observedAt: "2020-01-01T04:00:00Z", updatedAt: "x" },
    ];
    expect(computeEtfFlowMarkers(flows, chartData, "1d", COLORS)).toEqual([]);
  });

  it("uses the Israel-morning synthetic anchor for historical rows with no observedAt", () => {
    const flows: EtfFlow[] = [
      { flowDate: "2026-08-14", totalNetFlow: 10, observedAt: null, updatedAt: "x" },
    ];
    const markers = computeEtfFlowMarkers(flows, chartData, "1d", COLORS);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.time).toBe(dayCandle);
  });

  it("a revision that changes the value to 0 removes the previously-shown marker", () => {
    const before: EtfFlow[] = [
      { flowDate: "2026-08-14", totalNetFlow: 100, observedAt: "2026-08-14T04:00:00Z", updatedAt: "x" },
    ];
    expect(computeEtfFlowMarkers(before, chartData, "1d", COLORS)).toHaveLength(1);

    const afterRevision: EtfFlow[] = [
      { flowDate: "2026-08-14", totalNetFlow: 0, observedAt: "2026-08-14T04:00:00Z", updatedAt: "y" },
    ];
    expect(computeEtfFlowMarkers(afterRevision, chartData, "1d", COLORS)).toEqual([]);
  });

  it("returns markers sorted ascending by time", () => {
    const earlyDay = getCandleBucketTime(Date.UTC(2026, 7, 13, 4, 0, 0), "1d");
    const lateDay = dayCandle;
    const twoDayChart = [candle(earlyDay), candle(lateDay)];
    const flows: EtfFlow[] = [
      { flowDate: "2026-08-14", totalNetFlow: 10, observedAt: "2026-08-14T04:00:00Z", updatedAt: "x" },
      { flowDate: "2026-08-13", totalNetFlow: 5, observedAt: "2026-08-13T04:00:00Z", updatedAt: "x" },
    ];
    const markers = computeEtfFlowMarkers(flows, twoDayChart, "1d", COLORS);
    expect(markers.map((m) => m.time)).toEqual([earlyDay, lateDay]);
  });
});
