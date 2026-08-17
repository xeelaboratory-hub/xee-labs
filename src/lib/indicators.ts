export type IndicatorType = "ETF_FLOW" | "SESSION_VOLUME_PROFILE" | "LARGE_ORDER_BOOK";
export const ETF_FLOW_COLOR = "#f0b90b";
export const ETF_FLOW_MARKER_SIZE = 1.2;
export const SESSION_VOLUME_PROFILE_COLOR = "#0ecb81";
export const LARGE_ORDER_BOOK_COLOR = "#f0b90b";

export const INDICATOR_REGISTRY = [
  {
    type: "ETF_FLOW" as const,
    label: "ETF Flow (BTC)",
    pane: "overlay" as const,
    color: ETF_FLOW_COLOR,
  },
  {
    type: "SESSION_VOLUME_PROFILE" as const,
    label: "Session Volume Profile",
    pane: "overlay" as const,
    color: SESSION_VOLUME_PROFILE_COLOR,
  },
  {
    type: "LARGE_ORDER_BOOK" as const,
    label: "Large Order Book",
    pane: "overlay" as const,
    color: LARGE_ORDER_BOOK_COLOR,
  },
];
