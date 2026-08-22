/**
 * Mobile typography & icon scale — the chart header is the baseline.
 *
 * Typography roles:
 * - primary / primaryMono — important values (price, balance)
 * - ui — standard controls & copy (text-xs)
 * - label — nav labels, field headers (text-label, 10px)
 * - meta — hints, secondary copy (text-meta, 11px)
 * - value — panel-level figures (text-data, 13px)
 * - status — compact badges (text-status, 9px)
 *
 * Icon roles:
 * - ui / nav — 16px (h-4 w-4)
 * - status — 12px (h-3 w-3)
 *
 * Touch targets are separate from visible icon size.
 */
export const mobileText = {
  primary: "text-xs font-semibold",
  primaryMono: "text-xs font-semibold font-mono tabular-nums tracking-tight",
  ui: "text-xs",
  label: "text-label",
  meta: "text-meta",
  data: "text-data",
  value: "text-data font-semibold",
  status: "text-status font-semibold uppercase tracking-wide",
} as const;

export const mobileIcon = {
  ui: "h-4 w-4 shrink-0",
  nav: "h-4 w-4 shrink-0",
  status: "h-3 w-3 shrink-0",
} as const;

export const mobileTouch = {
  target: "min-h-[44px] min-w-[44px]",
  navTab: "min-h-[48px]",
  headerIcon: "h-9 w-9",
} as const;

/** Compact page chrome — matches chart header horizontal padding. */
export const mobilePage = {
  paddingX: "px-3",
  paddingY: "py-3",
  sectionGap: "space-y-3",
  rowGap: "gap-3",
} as const;

/**
 * Compact form controls — chart-header density.
 *
 * Visual heights target ~44px for inputs/segments and ~46px for the primary
 * CTA. Touch floors stay at 44px where controls are primary tap targets.
 */
export const mobileForm = {
  /** Text inputs, segments, secondary actions — 44px touch-friendly */
  control: "h-11 min-h-[44px] px-2",
  /** Primary sticky CTA — slightly taller than field controls */
  cta: "h-[46px] min-h-[44px] px-3 py-0",
  /** Vertical spacing between field groups / sections */
  sectionGap: "space-y-1.5",
  /** Horizontal / grid gap between paired controls */
  rowGap: "gap-1.5",
  /** Label → control spacing within a field */
  labelGap: "gap-0.5",
} as const;
