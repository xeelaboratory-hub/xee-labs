import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { CandlestickData, IChartApi, ISeriesApi, LogicalRange, Time } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { SessionVolumeProfilePrimitive } from "../../lib/chart-plugins/session-volume-profile/session-volume-profile.ts";
import {
  calculateSessionVolumeProfile,
  isInSession,
  type OhlcvBar,
  type SessionMarket,
  sessionWindowsInRange,
} from "../../lib/session-volume-profile.ts";
import { api } from "../../services/api.ts";
import { queryKeys } from "../../services/queries.ts";
import { useTradingStore } from "../../services/store.tsx";
import { toast } from "../../services/toast.ts";
import { TF_INTERVAL_MS, type Timeframe } from "./constants.ts";

const SUPPORTED_TIMEFRAMES = new Set<Timeframe>(["1m", "5m", "15m", "30m", "1h"]);

type VisibleTimeRange = { from: number; to: number };

function toOhlcv(bar: OhlcvBar): OhlcvBar {
  return {
    time: Math.floor(bar.time),
    open: Number(bar.open),
    high: Number(bar.high),
    low: Number(bar.low),
    close: Number(bar.close),
    volume: Number(bar.volume),
  };
}

function rangeFromLogical(
  range: LogicalRange | null,
  data: readonly CandlestickData<Time>[],
  timeframe: Timeframe,
): VisibleTimeRange | null {
  if (!range || !data.length) return null;
  const first = Math.max(0, Math.ceil(range.from));
  const last = Math.min(data.length - 1, Math.floor(range.to));
  if (first > last) return null;
  const from = data[first]?.time as number | undefined;
  const lastTime = data[last]?.time as number | undefined;
  if (!from || !lastTime) return null;
  return { from, to: lastTime + (TF_INTERVAL_MS[timeframe] ?? 60_000) / 1_000 };
}

function upsertBar(bars: readonly OhlcvBar[] | undefined, next: OhlcvBar): OhlcvBar[] {
  const current = bars ? [...bars] : [];
  const index = current.findIndex((bar) => bar.time === next.time);
  if (index === -1) current.push(next);
  else current[index] = next;
  return current.sort((a, b) => a.time - b.time);
}

interface UseSessionVolumeProfileArgs {
  chartRef: React.RefObject<IChartApi | null>;
  candleSeriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>;
  chartEpoch: number;
  chartData: readonly CandlestickData<Time>[];
  active: boolean;
  selectedSymbol: string;
  timeframe: Timeframe;
  market: SessionMarket;
  rows: number;
}

export function useSessionVolumeProfile({
  chartRef,
  candleSeriesRef,
  chartEpoch,
  chartData,
  active,
  selectedSymbol,
  timeframe,
  market,
  rows,
}: UseSessionVolumeProfileArgs): React.RefObject<SessionVolumeProfilePrimitive | null> {
  const queryClient = useQueryClient();
  const primitiveRef = useRef<SessionVolumeProfilePrimitive | null>(null);
  const errorRef = useRef<string | null>(null);
  const liveCandle = useTradingStore((state) => state.liveCandleUpdates[`${selectedSymbol}:1m`]);
  const [visibleRange, setVisibleRange] = useState<VisibleTimeRange | null>(null);
  const supported = SUPPORTED_TIMEFRAMES.has(timeframe);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (range: LogicalRange | null) => {
      const next = rangeFromLogical(range, chartData, timeframe);
      if (!next) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        setVisibleRange((current) =>
          current?.from === next.from && current.to === next.to ? current : next,
        );
      }, 150);
    };
    update(chart.timeScale().getVisibleLogicalRange());
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    return () => {
      clearTimeout(timer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(update);
    };
  }, [chartRef, chartEpoch, chartData, timeframe]);

  const windows = useMemo(
    () => (visibleRange && active && supported ? sessionWindowsInRange(visibleRange.from, visibleRange.to, market) : []),
    [active, market, supported, visibleRange],
  );
  const queries = useQueries({
    queries: windows.map((window) => ({
      queryKey: queryKeys.market.sessionVolumeProfile(selectedSymbol, market, window.date),
      queryFn: () =>
        api
          .getCandles(selectedSymbol, "1m", undefined, {
            fromMs: window.start * 1_000,
            toMs: window.end * 1_000 - 1,
          })
          .then((bars) => bars.map(toOhlcv)),
      enabled: active && supported,
      staleTime: Infinity,
      retry: 1,
    })),
  });

  useEffect(() => {
    if (!active || !supported || !liveCandle) return;
    const time = Math.floor(liveCandle.timestamp / 60_000) * 60;
    const window = windows.find((candidate) => isInSession(time, candidate));
    if (!window) return;
    queryClient.setQueryData<OhlcvBar[]>(
      queryKeys.market.sessionVolumeProfile(selectedSymbol, market, window.date),
      (old) =>
        upsertBar(old, {
          time,
          open: liveCandle.open,
          high: liveCandle.high,
          low: liveCandle.low,
          close: liveCandle.close,
          volume: liveCandle.volume,
        }),
    );
  }, [active, liveCandle, market, queryClient, selectedSymbol, supported, windows]);

  const profiles = useMemo(
    () =>
      windows.flatMap((window, index) => {
        const bars = queries[index]?.data;
        const profile = bars ? calculateSessionVolumeProfile(window, bars, rows) : null;
        return profile ? [profile] : [];
      }),
    [queries, rows, windows],
  );

  useEffect(() => {
    const queryError = queries.find((query) => query.isError)?.error;
    const message = queryError instanceof Error ? queryError.message : queryError ? "Unable to load Volume Profile" : null;
    if (!message || errorRef.current === message) return;
    errorRef.current = message;
    toast.error("Volume Profile unavailable", message);
  }, [queries]);

  useEffect(() => {
    if (!active || !supported || !candleSeriesRef.current) return;
    const primitive = new SessionVolumeProfilePrimitive();
    primitiveRef.current = primitive;
    candleSeriesRef.current.attachPrimitive(primitive);
    return () => {
      candleSeriesRef.current?.detachPrimitive(primitive);
      if (primitiveRef.current === primitive) primitiveRef.current = null;
    };
  }, [active, candleSeriesRef, chartEpoch, supported]);

  useEffect(() => {
    primitiveRef.current?.setProfiles(active && supported ? profiles : []);
  }, [active, profiles, supported]);

  return primitiveRef;
}
