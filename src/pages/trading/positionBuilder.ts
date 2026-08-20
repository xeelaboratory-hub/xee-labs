/** Position Builder — pure position-sizing math. No React/DOM dependency,
 * so it's directly unit-testable and shared between the panel component and
 * its tests without mocking anything. Ported from the risk%/margin/leverage
 * → stop/TP/size/liquidation model used by the reference OKX position
 * planner this feature is based on. */

export type Side = "long" | "short";

export interface InstrumentSpec {
  instId: string;
  instType: string;
  ctVal: number;
  ctValCcy: string;
  lotSz: number;
  minSz: number;
  tickSz: number;
  settleCcy: string;
  quoteCcy: string;
  baseCcy: string;
  maxLever: number;
}

export interface PositionPlanInput {
  side: Side;
  entry: number;
  riskPercent: number;
  totalEquity: number;
  margin: number;
  leverage: number;
  instrument: InstrumentSpec;
}

export type PositionPlanResult =
  | {
      ok: true;
      riskAmount: number;
      margin: number;
      leverage: number;
      notional: number;
      contracts: number;
      baseSize: number;
      stop: number;
      stopDistance: number;
      stopDistancePct: number;
      approxLiq: number;
      lossPerContract: number;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
    };

export function roundDownToStep(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(value)) return 0;
  const precision = Math.max(0, Math.round(-Math.log10(step)));
  const rounded = Math.floor(value / step + 1e-12) * step;
  return Number(rounded.toFixed(Math.min(12, precision + 2)));
}

export function roundToTick(value: number, tickSz: number): number {
  if (!(tickSz > 0) || !Number.isFinite(value)) return value;
  const precision = Math.max(0, Math.round(-Math.log10(tickSz)));
  const rounded = Math.round(value / tickSz) * tickSz;
  return Number(rounded.toFixed(Math.min(12, precision + 2)));
}

/**
 * TP from risk/reward: distance from entry = stopDistance × RR.
 * Long: entry + dist · RR. Short: entry − dist · RR.
 */
export function calcTakeProfitFromRr(input: {
  side: Side;
  entry: number;
  stop: number;
  rr: number;
  tickSz: number;
}): { takeProfit: number; rewardDistance: number } | null {
  const { side, entry, stop, rr, tickSz } = input;
  if (!(entry > 0) || !(stop > 0) || !(rr > 0)) return null;

  const stopDistance = Math.abs(entry - stop);
  if (!(stopDistance > 0)) return null;

  const rewardDistance = stopDistance * rr;
  const raw = side === "long" ? entry + rewardDistance : entry - rewardDistance;
  if (!(raw > 0)) return null;

  const takeProfit = roundToTick(raw, tickSz);
  if (!(takeProfit > 0)) return null;

  return {
    takeProfit,
    rewardDistance: Math.abs(takeProfit - entry),
  };
}

/**
 * Risk% of Total Equity + margin + leverage → contracts + stop price.
 * notional = margin × leverage
 * stopDistance = risk$ / baseSize
 *
 * approxLiq is a rough isolated-margin estimate — it ignores fees and
 * maintenance margin, so it must always be surfaced to the user as an
 * approximation, never as an exact liquidation price.
 */
export function calcStopFromMargin(input: PositionPlanInput): PositionPlanResult {
  const { side, entry, riskPercent, totalEquity, margin, leverage, instrument } = input;

  if (!(entry > 0)) {
    return { ok: false, error: "Entry price must be greater than 0" };
  }
  if (!(riskPercent > 0)) {
    return { ok: false, error: "Risk % must be greater than 0" };
  }
  if (!(totalEquity > 0)) {
    return { ok: false, error: "No Total Equity available" };
  }
  if (!(margin > 0)) {
    return { ok: false, error: "Margin must be greater than 0" };
  }
  if (!(leverage > 0)) {
    return { ok: false, error: "Leverage must be greater than 0" };
  }

  const maxLever = instrument.maxLever > 0 ? instrument.maxLever : null;
  if (maxLever != null && leverage > maxLever) {
    return {
      ok: false,
      error: `Max leverage for this instrument is ${maxLever}x`,
    };
  }

  const riskAmount = totalEquity * (riskPercent / 100);
  const targetNotional = margin * leverage;
  const warnings: string[] = [];

  if (margin > totalEquity) {
    warnings.push("Margin is larger than Total Equity");
  }
  if (riskAmount >= margin) {
    warnings.push(
      "Risk amount ≥ margin — stop may be unrealistically far at this leverage",
    );
  }

  const isContract = instrument.instType === "SWAP" || instrument.instType === "FUTURES";
  const ctVal = instrument.ctVal > 0 ? instrument.ctVal : 1;

  let contracts = 0;
  let baseSize = 0;

  if (isContract) {
    const rawContracts = targetNotional / (entry * ctVal);
    contracts = roundDownToStep(rawContracts, instrument.lotSz);
    if (contracts < instrument.minSz) {
      return {
        ok: false,
        error: `Size (${rawContracts.toFixed(4)}) is below min ${instrument.minSz} contracts — increase margin or leverage`,
      };
    }
    baseSize = contracts * ctVal;
  } else {
    const step = instrument.lotSz > 0 ? instrument.lotSz : 0.00000001;
    const rawBase = targetNotional / entry;
    baseSize = roundDownToStep(rawBase, step);
    if (baseSize < instrument.minSz) {
      return {
        ok: false,
        error: `Size is below minimum ${instrument.minSz}`,
      };
    }
    contracts = baseSize;
  }

  const notional = baseSize * entry;
  if (!(baseSize > 0) || !(notional > 0)) {
    return { ok: false, error: "Unable to calculate position size" };
  }

  const stopDistance = riskAmount / baseSize;
  const stopDistancePct = (stopDistance / entry) * 100;
  const rawStop = side === "long" ? entry - stopDistance : entry + stopDistance;
  const stop = roundToTick(rawStop, instrument.tickSz);

  if (!(stop > 0)) {
    return {
      ok: false,
      error: "Stop price ≤ 0 — lower risk, raise margin, or reduce leverage",
    };
  }

  // Rough isolated-style estimate (ignores fees / maintenance margin)
  const approxLiq = side === "long" ? entry * (1 - 1 / leverage) : entry * (1 + 1 / leverage);

  if (side === "long" && stop < approxLiq) {
    warnings.push(
      `SL (${stop.toFixed(4)}) is below approx. liquidation (~${approxLiq.toFixed(4)}) — may get liquidated before stop`,
    );
  }
  if (side === "short" && stop > approxLiq) {
    warnings.push(
      `SL (${stop.toFixed(4)}) is above approx. liquidation (~${approxLiq.toFixed(4)}) — may get liquidated before stop`,
    );
  }

  if (stopDistancePct > 25) {
    warnings.push("Stop distance > 25% — check margin / leverage");
  }

  const lossPerContract = isContract ? stopDistance * ctVal : stopDistance;

  return {
    ok: true,
    riskAmount,
    margin,
    leverage,
    notional,
    contracts,
    baseSize,
    stop,
    stopDistance: Math.abs(entry - stop),
    stopDistancePct: (Math.abs(entry - stop) / entry) * 100,
    approxLiq,
    lossPerContract,
    warnings,
  };
}
