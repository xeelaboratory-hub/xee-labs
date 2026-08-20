// ── Trading Page Constants ────────────────────────────────────────────────────

export const TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const CHART_COLORS = {
  dark: {
    background: "#0b0e14",
    text: "#9298a5",
    grid: "#151923",
    crosshair: "#555c68",
    up: "#0ecb81",
    down: "#f6465d",
    volumeUp: "rgba(14, 203, 129, 0.18)",
    volumeDown: "rgba(246, 70, 93, 0.18)",
    watermark: "rgba(255, 255, 255, 0.03)",
    lastPriceUp: "#0ecb81",
    lastPriceDown: "#f6465d",
    orderLine: "#f0b90b",
    positionLong: "#0ecb81",
    positionShort: "#f6465d",
    tpLine: "#0ecb81",
    slLine: "#f6465d",
    liqLine: "#f97316",
  },
  light: {
    background: "#ffffff",
    text: "#5d6068",
    grid: "#f0f2f5",
    crosshair: "#999",
    up: "#0ecb81",
    down: "#f6465d",
    volumeUp: "rgba(14, 203, 129, 0.25)",
    volumeDown: "rgba(246, 70, 93, 0.25)",
    watermark: "rgba(0, 0, 0, 0.03)",
    lastPriceUp: "#0ecb81",
    lastPriceDown: "#f6465d",
    orderLine: "#f0b90b",
    positionLong: "#0ecb81",
    positionShort: "#f6465d",
    tpLine: "#0ecb81",
    slLine: "#f6465d",
    liqLine: "#f97316",
  },
};

export type ChartColors = (typeof CHART_COLORS)["dark"];

/**
 * Per-user color overrides (Chart Settings → Colors). Empty string = use the
 * theme default. Keys map 1:1 onto `ChartColors` fields via COLOR_OVERRIDE_MAP.
 */
export interface ChartColorOverrides {
  colorBackground: string;
  colorScaleText: string;
  colorCrosshair: string;
  colorPositionLong: string;
  colorPositionShort: string;
  colorOrderLine: string;
  colorTpLine: string;
  colorSlLine: string;
  /** Candle body colors (also drive wicks/borders unless overridden). */
  candleUpColor: string;
  candleDownColor: string;
}

const COLOR_OVERRIDE_MAP: ReadonlyArray<[keyof ChartColorOverrides, keyof ChartColors]> = [
  ["colorBackground", "background"],
  ["colorScaleText", "text"],
  ["colorCrosshair", "crosshair"],
  ["colorPositionLong", "positionLong"],
  ["colorPositionShort", "positionShort"],
  ["colorOrderLine", "orderLine"],
  ["colorTpLine", "tpLine"],
  ["colorSlLine", "slLine"],
  ["candleUpColor", "up"],
  ["candleDownColor", "down"],
];

/** Theme colors with the user's non-empty overrides applied on top. */
export function mergeChartColors(theme: ChartColors, overrides: ChartColorOverrides): ChartColors {
  const merged = { ...theme };
  for (const [overrideKey, themeKey] of COLOR_OVERRIDE_MAP) {
    const value = overrides[overrideKey];
    if (value) merged[themeKey] = value;
  }
  return merged;
}

/**
 * Armable tools. Some are placement-only aliases that commit a different stored
 * `type`: "ray"/"extended" store a "trendline" with extend flags;
 * "long-position"/"short-position" store a "position" with `side`; "measure" is
 * a transient gesture that never commits.
 */
export type DrawingTool =
  | "none"
  | "trendline"
  | "horizontal"
  | "fibonacci"
  | "rectangle"
  | "vertical"
  | "ray"
  | "extended"
  | "channel"
  | "text"
  | "fibextension"
  | "ellipse"
  | "arrow"
  | "triangle"
  | "position"
  | "long-position"
  | "short-position"
  | "measure";

/** Stored drawing kinds (excludes placement-only aliases). */
export type DrawingType = Exclude<
  DrawingTool,
  "none" | "ray" | "extended" | "long-position" | "short-position" | "measure"
>;

export type DrawingLineStyle = "solid" | "dashed" | "dotted";

/** Magnet snapping mode: off, weak (snap within a few px), or strong (always). */
export type MagnetMode = "none" | "weak" | "strong";

export interface DrawingLine {
  id: string;
  type: DrawingType;
  price: number;
  price2?: number;
  time?: number;
  time2?: number;
  /** Third anchor — parallel-channel offset line. */
  price3?: number;
  time3?: number;
  color: string;
  // v2 style/behavior fields — all optional so v1 drawings load unchanged
  /** Line width in px (default 2). */
  width?: number;
  lineStyle?: DrawingLineStyle;
  /** Locked drawings can be selected but not moved or resized. */
  locked?: boolean;
  /** Trendline only: extend the line to the pane edges. */
  extendLeft?: boolean;
  extendRight?: boolean;
  /** Hidden drawings stay in the object tree but don't render or hit-test. */
  hidden?: boolean;
  /** Render order — higher draws on top. Defaults to creation order. */
  zIndex?: number;
  /** Timeframe the drawing was created on (used by visibility "tf"). */
  createdTf?: string;
  /** "all" (default) shows on every timeframe; "tf" only on createdTf. */
  visibility?: "all" | "tf";
  // ── Styling depth (Tier 4) ──
  /** Fill colour for shapes / channel / fib bands (defaults to `color`). */
  fillColor?: string;
  /** Fill opacity 0–1 (defaults per drawing kind). */
  fillOpacity?: number;
  /** Arrowheads on line ends (trendline / arrow). */
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** Text content + size for text/callout drawings and attachable labels. */
  text?: string;
  fontSize?: number;
  /** Bold / italic styling for text drawings. */
  bold?: boolean;
  italic?: boolean;
  /** Optional text-box background (text drawings). */
  textBg?: boolean;
  textBgColor?: string;
  /** Optional text-box border (text drawings). */
  textBorder?: boolean;
  textBorderColor?: string;
  /** Custom fibonacci levels (fractions); defaults applied when absent. */
  fibLevels?: number[];
  // ── Position tool (long/short risk-reward) ──
  side?: "long" | "short";
  /** Stop-loss price (position tool). */
  stopPrice?: number;
  /** Take-profit price (position tool). */
  targetPrice?: number;
  /** % of account equity risked — drives size/$ readout (default 1). */
  riskPct?: number;
  // ── Price alerts on lines ──
  /** When set, the platform alerts when price crosses this line. */
  alertEnabled?: boolean;
  alertMessage?: string;
}

/** Swatch palette for the floating drawing toolbar (TradingView-style). */
export const DRAWING_COLORS = [
  "#2196F3",
  "#f0b90b",
  "#0ecb81",
  "#f6465d",
  "#9c27b0",
  "#ff9800",
  "#787b86",
  "#ffffff",
] as const;

export const DRAWING_WIDTHS = [1, 2, 3, 4] as const;

/** Timeframe interval in milliseconds */
export const TF_INTERVAL_MS: Record<Timeframe, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};
