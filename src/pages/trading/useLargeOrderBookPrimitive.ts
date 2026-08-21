import type { CandlestickData, IChartApi, ISeriesApi, LogicalRange, Time } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { useLargeOrderBook } from "../../hooks/useLargeOrderBook.ts";
import { LargeOrderBookPrimitive } from "../../lib/chart-plugins/large-order-book/large-order-book.ts";
import { useTradingStore } from "../../services/store.tsx";

type Args = {
  chartRef: React.RefObject<IChartApi | null>;
  candleSeriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>;
  chartEpoch: number;
  chartData: readonly CandlestickData<Time>[];
  selectedSymbol: string;
  active: boolean;
};

export function useLargeOrderBookPrimitive({ chartRef, candleSeriesRef, chartEpoch, chartData, selectedSymbol, active }: Args) {
  const primitiveRef = useRef<LargeOrderBookPrimitive | null>(null);
  const [range, setRange] = useState<{ from: string; to: string }>();
  const book = useLargeOrderBook(selectedSymbol, active, range, 500);
  const hoveredId = useTradingStore((state) => state.hoveredLargeOrderId);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !active || !book.settings.showInactive) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = (logical: LogicalRange | null) => {
      if (!logical || !chartData.length) return;
      const first = chartData[Math.max(0, Math.ceil(logical.from))]?.time as number | undefined;
      const last = chartData[Math.min(chartData.length - 1, Math.floor(logical.to))]?.time as number | undefined;
      if (!first || !last) return;
      clearTimeout(timer);
      timer = setTimeout(() => setRange({ from: new Date(first * 1000).toISOString(), to: new Date(last * 1000).toISOString() }), 150);
    };
    update(chart.timeScale().getVisibleLogicalRange());
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    return () => {
      clearTimeout(timer);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(update);
    };
  }, [active, book.settings.showInactive, chartData, chartEpoch, chartRef]);

  useEffect(() => {
    // Capture the series rather than re-reading the ref in cleanup: chartEpoch
    // only bumps *after* ChartPanel has already written the new series into
    // the ref, so cleanup would otherwise detach from the replacement series
    // instead of the one this primitive was attached to.
    const series = candleSeriesRef.current;
    if (!active || !series) return;
    const primitive = new LargeOrderBookPrimitive();
    primitiveRef.current = primitive;
    series.attachPrimitive(primitive);
    return () => {
      series.detachPrimitive(primitive);
      if (primitiveRef.current === primitive) primitiveRef.current = null;
    };
  }, [active, candleSeriesRef, chartEpoch]);

  useEffect(() => primitiveRef.current?.setLevels(active ? book.levels : []), [active, book.levels]);
  useEffect(() => primitiveRef.current?.setHoveredId(active ? hoveredId : null), [active, hoveredId]);
  return { primitiveRef, historyUnavailable: book.historyUnavailable };
}
