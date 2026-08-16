import type { ISeriesApi } from "lightweight-charts";
import type { RefObject } from "react";
import type { Position } from "../../services/schemas.ts";

/**
 * Prop-firm challenge risk overlay (daily loss limit / max drawdown / profit
 * target price lines) — a PropSim-era concept with no equivalent on a real
 * OKX account (no challenge phases, no firm-imposed risk rules). Kept as a
 * no-op so the (user-toggleable, off-by-default) chart preference and its
 * call site don't need touching, but it never renders or fetches anything.
 */
export interface ChallengeLevelFlags {
  enabled: boolean;
  dailyLoss: boolean;
  maxDrawdown: boolean;
  profitTarget: boolean;
}

export function useChallengeLevels(_opts: {
  accountId: string | null | undefined;
  selectedSymbol: string;
  positions: Position[];
  tick: { bid: number; ask: number } | undefined;
  contractSize: number;
  accountEquity: number;
  candleSeriesRef: RefObject<ISeriesApi<"Candlestick"> | null>;
  flags: ChallengeLevelFlags;
  chartEpoch: number;
}): void {
  // Intentionally empty — see file docstring.
}
