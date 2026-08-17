import { useEffect } from "react";
import type { CandlestickData, ISeriesApi, Time } from "lightweight-charts";
import type { IndicatorType } from "../../lib/indicators.ts";
import type { EtfFlow } from "../../services/api/market-data.ts";
import { CHART_COLORS, type Timeframe } from "./constants.ts";
import { computeEtfFlowMarkers } from "./utils.ts";

export function useIndicators(
  candleSeriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>,
  chartData: CandlestickData<Time>[],
  activeIndicators: IndicatorType[],
  isDark: boolean,
  etfFlowData: EtfFlow[] | undefined,
  timeframe: Timeframe,
): void {
  const colors = isDark ? CHART_COLORS.dark : CHART_COLORS.light;

  useEffect(() => {
    if (!candleSeriesRef.current || chartData.length === 0) return;

    if (!activeIndicators.includes("ETF_FLOW") || !etfFlowData?.length) {
      candleSeriesRef.current.setMarkers([]);
    } else {
      candleSeriesRef.current.setMarkers(
        computeEtfFlowMarkers(etfFlowData, chartData, timeframe, colors),
      );
    }
    // candleSeriesRef is stable; colors are derived from isDark.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndicators, chartData, isDark, etfFlowData, timeframe]);
}
