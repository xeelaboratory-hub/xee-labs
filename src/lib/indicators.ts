export type IndicatorType = "ETF_FLOW";

export const INDICATOR_REGISTRY = [
  {
    type: "ETF_FLOW" as const,
    label: "ETF Flow (BTC)",
    pane: "overlay" as const,
    color: "#0ecb81",
  },
];
