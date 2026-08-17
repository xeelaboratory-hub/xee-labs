export type IndicatorType = "ETF_FLOW";
export const ETF_FLOW_COLOR = "#f0b90b";

export const INDICATOR_REGISTRY = [
  {
    type: "ETF_FLOW" as const,
    label: "ETF Flow (BTC)",
    pane: "overlay" as const,
    color: ETF_FLOW_COLOR,
  },
];
