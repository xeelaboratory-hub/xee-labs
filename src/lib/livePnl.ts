import type { Position } from "../services/schemas";

export interface LiveTick {
  bid: number;
  ask: number;
  timestamp: number;
}

/**
 * A tick older than this is not trusted to price a position. The server
 * snapshot (from the exchange's own mark price) is used instead.
 *
 * This guard exists because of a real incident: OKX's ticker channel died
 * while its candle and book channels kept flowing, so ticks froze for 37
 * minutes while every health signal stayed green. The extrapolation below
 * faithfully scaled the exchange's correct +$42.49 into a displayed -$6.93
 * on a live position. A stale tick is worse than no tick — the server value
 * is authoritative, and silently overriding it with a stale price is how a
 * correct number becomes a wrong one.
 */
export const MAX_TICK_AGE_MS = 30_000;

function isFresh(tick: LiveTick | undefined, now: number): tick is LiveTick {
  return !!tick && now - tick.timestamp <= MAX_TICK_AGE_MS;
}

// Linear scaling: server snapshot (currentPrice, unrealizedPnl) tells us
// PnL-per-price-unit including contract size, side and FX conversion.
// We multiply by the live price delta to get instantaneous PnL between
// REST polls without re-deriving contract math on the client.
export function computeLivePnl(p: Position, tick?: LiveTick, now: number = Date.now()): number {
  if (!isFresh(tick, now)) return p.unrealizedPnl;
  const livePrice = p.side === "LONG" ? tick.bid : tick.ask;
  const snapPrice = p.currentPrice ?? p.entryPrice;
  const snapDelta = snapPrice - p.entryPrice;
  if (Math.abs(snapDelta) < 1e-12) return p.unrealizedPnl;
  const perPriceUnit = p.unrealizedPnl / snapDelta;
  return perPriceUnit * (livePrice - p.entryPrice);
}

export function computeLivePrice(p: Position, tick?: LiveTick, now: number = Date.now()): number {
  if (!isFresh(tick, now)) return p.currentPrice ?? p.entryPrice;
  return p.side === "LONG" ? tick.bid : tick.ask;
}
