import type { CandlestickData, SeriesMarker, Time } from "lightweight-charts";
import type { CandleData } from "../../lib/indicators.ts";
import type { EtfFlow } from "../../services/api/market-data.ts";
import type { Timeframe } from "./constants.ts";

/** Derive pip (decimal) precision from symbolInfo.tickSize or symbol name */
export function getPipDigits(
  symbolInfo?: { tickSize?: number | string },
  symbolName?: string,
): number {
  const symbolDecimals = _symbolNameDecimals(symbolName);
  if (symbolInfo?.tickSize) {
    const s = String(symbolInfo.tickSize);
    const tickDecimals = s.includes(".")
      ? s.split(".")[1]!.replace(/0+$/, "").length || s.split(".")[1]!.length
      : 0;
    // Use the higher of tick-derived or symbol-name-derived so forex pairs
    // (tickSize=0.0001) still show 5 decimal places instead of 4.
    return Math.max(tickDecimals, symbolDecimals, 2);
  }
  return symbolDecimals;
}

function _symbolNameDecimals(symbolName?: string): number {
  if (!symbolName) return 5;
  const n = symbolName.toUpperCase();
  if (n.includes("JPY") || n.includes("XAU") || n.includes("GOLD")) return 3;
  if (n.includes("BTC") || n.includes("ETH")) return 2;
  if (n.includes("US30") || n.includes("SPX") || n.includes("NAS") || n.includes("DAX")) return 2;
  return 5;
}

/** Get the minMove for lightweight-charts priceFormat from pip digits */
export function getMinMove(pipDigits: number): number {
  return Number((1 / Math.pow(10, pipDigits)).toFixed(pipDigits + 1));
}

/** Parse timestamp to unix seconds */
export function toUnixSeconds(ts: number | string | Date): number {
  if (typeof ts === "number") return ts > 1e12 ? Math.floor(ts / 1000) : ts;
  return Math.floor(new Date(ts).getTime() / 1000);
}

/** Normalise a numeric timestamp to unix milliseconds (accepts seconds or ms) */
export function toUnixMs(ts: number): number {
  return ts > 1e12 ? ts : ts * 1000;
}

/** Convert candles for indicator lib */
export function toIndicatorCandles(candles: CandlestickData<Time>[]): CandleData[] {
  return candles.map((c) => ({
    time: c.time as number,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: 0,
  }));
}

/** Format seconds remaining as M:SS or H:MM:SS */
export function formatCountdown(totalSec: number): string {
  if (totalSec <= 0) return "0:00";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Return the candle-bucket start (unix seconds) for a given timestamp */
export function getCandleBucketTime(timestampMs: number, tf: Timeframe): number {
  const SEC = 1000;
  const intervals: Record<Timeframe, number> = {
    "1m": 60 * SEC,
    "5m": 5 * 60 * SEC,
    "15m": 15 * 60 * SEC,
    "30m": 30 * 60 * SEC,
    "1h": 60 * 60 * SEC,
    "4h": 4 * 60 * 60 * SEC,
    "1d": 24 * 60 * 60 * SEC,
    "1w": 7 * 24 * 60 * 60 * SEC,
  };
  const ms = intervals[tf];
  return Math.floor((Math.floor(timestampMs / ms) * ms) / 1000);
}

/**
 * Historical ETF Flow backfill rows have no real observation timestamp
 * (Farside publishes by date only). This computes a synthetic, display-only
 * anchor — flow_date @ 07:00 Asia/Jerusalem, DST-aware — for marker
 * placement only; it must never be persisted as `observed_at`. No date
 * library exists in this repo, so this uses the native Intl.DateTimeFormat
 * offset trick rather than adding one.
 */
export function flowDateToIsraelMorningUtcMs(flowDate: string): number {
  const [y, m, d] = flowDate.split("-").map(Number);
  const naiveUtcMs = Date.UTC(y!, m! - 1, d!, 7, 0, 0);
  const offsetMs = getTimeZoneOffsetMs("Asia/Jerusalem", naiveUtcMs);
  return naiveUtcMs - offsetMs;
}

/** Offset (ms) of `timeZone` from UTC at the instant `atUtcMs`, DST-aware. */
function getTimeZoneOffsetMs(timeZone: string, atUtcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(atUtcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - atUtcMs;
}

/**
 * Pure marker-array computation for the ETF Flow indicator — extracted from
 * useIndicators.ts so it's independently testable without a live chart.
 * 0 and missing values produce no marker; markers only appear for times that
 * match an already-loaded candle (lightweight-charts v4.2 requirement), and
 * are returned sorted ascending (also a v4.2 requirement for setMarkers()).
 */
export function computeEtfFlowMarkers(
  etfFlowData: EtfFlow[],
  chartData: CandlestickData<Time>[],
  timeframe: Timeframe,
  colors: { up: string; down: string },
): SeriesMarker<Time>[] {
  const loadedTimes = new Set(chartData.map((c) => c.time as number));
  const markers: SeriesMarker<Time>[] = [];

  for (const flow of etfFlowData) {
    if (flow.totalNetFlow === 0) continue;
    const anchorMs =
      flow.observedAt != null ? new Date(flow.observedAt).getTime() : flowDateToIsraelMorningUtcMs(flow.flowDate);
    const bucketTime = getCandleBucketTime(anchorMs, timeframe);
    if (!loadedTimes.has(bucketTime)) continue;
    markers.push({
      time: bucketTime as Time,
      position: flow.totalNetFlow > 0 ? "belowBar" : "aboveBar",
      shape: flow.totalNetFlow > 0 ? "arrowUp" : "arrowDown",
      color: flow.totalNetFlow > 0 ? colors.up : colors.down,
      id: flow.flowDate,
    });
  }

  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}
