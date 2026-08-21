import { describe, expect, it } from "vitest";
import {
  calcStopFromMargin,
  calcTakeProfitFromRr,
  roundDownToStep,
  roundToTick,
  type InstrumentSpec,
} from "../pages/trading/positionBuilder.ts";
import { validateOrderInput } from "../pages/trading/order-validation.ts";

const SWAP_INSTRUMENT: InstrumentSpec = {
  instId: "BTC-USDT-SWAP",
  instType: "SWAP",
  ctVal: 0.01,
  ctValCcy: "BTC",
  lotSz: 1,
  minSz: 1,
  tickSz: 0.1,
  settleCcy: "USDT",
  quoteCcy: "USDT",
  baseCcy: "BTC",
  maxLever: 100,
};

const SPOT_INSTRUMENT: InstrumentSpec = {
  instId: "BTC-USDT",
  instType: "SPOT",
  ctVal: 1,
  ctValCcy: "BTC",
  lotSz: 0.0001,
  minSz: 0.0001,
  tickSz: 0.01,
  settleCcy: "USDT",
  quoteCcy: "USDT",
  baseCcy: "BTC",
  maxLever: 1,
};

const baseInput = {
  side: "long" as const,
  entry: 70000,
  riskPercent: 2,
  totalEquity: 1000,
  margin: 100,
  leverage: 10,
  instrument: SWAP_INSTRUMENT,
};

describe("roundDownToStep", () => {
  it("rounds down to the nearest step", () => {
    expect(roundDownToStep(1.27, 0.1)).toBeCloseTo(1.2);
    expect(roundDownToStep(5, 1)).toBe(5);
  });

  it("returns 0 for a non-positive step or non-finite value", () => {
    expect(roundDownToStep(5, 0)).toBe(0);
    expect(roundDownToStep(5, -1)).toBe(0);
    expect(roundDownToStep(Infinity, 1)).toBe(0);
    expect(roundDownToStep(NaN, 1)).toBe(0);
  });
});

describe("roundToTick", () => {
  it("rounds to the nearest tick", () => {
    expect(roundToTick(70012.34, 0.1)).toBeCloseTo(70012.3);
    expect(roundToTick(70012.37, 0.1)).toBeCloseTo(70012.4);
  });

  it("returns the raw value for a non-positive tick or non-finite value", () => {
    expect(roundToTick(5, 0)).toBe(5);
    expect(roundToTick(5, -1)).toBe(5);
    expect(roundToTick(Infinity, 0.1)).toBe(Infinity);
  });
});

describe("calcStopFromMargin", () => {
  it("computes a valid long plan using contract sizing", () => {
    const result = calcStopFromMargin(baseInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.riskAmount).toBe(20); // 2% of 1000
    expect(result.contracts).toBeGreaterThan(0);
    expect(result.stop).toBeLessThan(baseInput.entry); // long: stop below entry
    expect(result.approxLiq).toBeLessThan(baseInput.entry);
  });

  it("computes a valid short plan — stop above entry, liquidation above entry", () => {
    const result = calcStopFromMargin({ ...baseInput, side: "short" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stop).toBeGreaterThan(baseInput.entry);
    expect(result.approxLiq).toBeGreaterThan(baseInput.entry);
  });

  it("uses base-asset sizing (not contracts) for SPOT instruments", () => {
    const result = calcStopFromMargin({ ...baseInput, instrument: SPOT_INSTRUMENT, leverage: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contracts).toBe(result.baseSize);
  });

  it.each([
    ["entry", { entry: 0 }, "Entry price must be greater than 0"],
    ["riskPercent", { riskPercent: 0 }, "Risk % must be greater than 0"],
    ["totalEquity", { totalEquity: 0 }, "No Total Equity available"],
    ["margin", { margin: 0 }, "Margin must be greater than 0"],
    ["leverage", { leverage: 0 }, "Leverage must be greater than 0"],
  ])("rejects non-positive %s", (_label, override, expectedError) => {
    const result = calcStopFromMargin({ ...baseInput, ...override });
    expect(result).toEqual({ ok: false, error: expectedError });
  });

  it("rejects leverage above the instrument's max leverage", () => {
    const result = calcStopFromMargin({ ...baseInput, leverage: 200 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("Max leverage for this instrument is 100x");
  });

  it("rejects a size below the instrument's minimum", () => {
    const result = calcStopFromMargin({
      ...baseInput,
      margin: 0.01,
      leverage: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/below min/);
  });

  it("warns when margin exceeds total equity", () => {
    const result = calcStopFromMargin({ ...baseInput, margin: 2000, totalEquity: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain("Margin is larger than Total Equity");
  });

  it("warns when risk amount exceeds margin", () => {
    const result = calcStopFromMargin({ ...baseInput, riskPercent: 50, margin: 100, totalEquity: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes("Risk amount exceeds margin"))).toBe(true);
  });

  it("does not warn when risk amount exactly equals margin (Position Builder's auto-margin case)", () => {
    // margin sized as totalEquity × riskPercent/100 makes riskAmount === margin by
    // construction — that equality is the intended design, not a misconfiguration.
    const result = calcStopFromMargin({ ...baseInput, riskPercent: 10, margin: 100, totalEquity: 1000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.riskAmount).toBe(result.margin);
    expect(result.warnings.some((w) => w.includes("Risk amount exceeds margin"))).toBe(false);
  });

  it("warns when the stop crosses approx. liquidation — long", () => {
    // High risk% pushes the stop far past the liquidation estimate.
    const result = calcStopFromMargin({ ...baseInput, riskPercent: 90, leverage: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes("below approx. liquidation"))).toBe(true);
  });

  it("warns when the stop crosses approx. liquidation — short", () => {
    const result = calcStopFromMargin({ ...baseInput, side: "short", riskPercent: 90, leverage: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((w) => w.includes("above approx. liquidation"))).toBe(true);
  });

  it("warns when stop distance exceeds 25%", () => {
    const result = calcStopFromMargin({ ...baseInput, riskPercent: 20 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain("Stop distance > 25% — check margin / leverage");
  });

  it("rejects when the computed stop would be ≤ 0", () => {
    const result = calcStopFromMargin({
      ...baseInput,
      riskPercent: 1000,
      margin: 100000,
      leverage: 1,
      totalEquity: 10_000_000,
    });
    expect(result.ok).toBe(false);
  });
});

describe("calcTakeProfitFromRr", () => {
  const tp = { side: "long" as const, entry: 70000, stop: 69000, rr: 2, tickSz: 0.1 };

  it("computes take-profit for a long position", () => {
    const result = calcTakeProfitFromRr(tp);
    expect(result).not.toBeNull();
    expect(result?.takeProfit).toBeCloseTo(72000);
  });

  it("computes take-profit for a short position", () => {
    const result = calcTakeProfitFromRr({ ...tp, side: "short", entry: 70000, stop: 71000 });
    expect(result).not.toBeNull();
    expect(result?.takeProfit).toBeCloseTo(68000);
  });

  it("rounds the take-profit to the instrument's tick size", () => {
    const result = calcTakeProfitFromRr({ ...tp, tickSz: 100 });
    expect(result).not.toBeNull();
    expect((result!.takeProfit / 100) % 1).toBeCloseTo(0);
  });

  it.each([
    ["entry", { entry: 0 }],
    ["stop", { stop: 0 }],
    ["rr", { rr: 0 }],
  ])("returns null for non-positive %s", (_label, override) => {
    expect(calcTakeProfitFromRr({ ...tp, ...override })).toBeNull();
  });

  it("returns null when stop equals entry (zero stop distance)", () => {
    expect(calcTakeProfitFromRr({ ...tp, stop: tp.entry })).toBeNull();
  });
});

describe("validateOrderInput", () => {
  const base = { isFeedConnected: true, quantity: "1", orderType: "MARKET" as const, price: "" };

  it("rejects placing an order while the data feed is disconnected", () => {
    const result = validateOrderInput({ ...base, isFeedConnected: false });
    expect(result).toEqual({
      ok: false,
      title: "No Data Feed",
      message: "Cannot place orders while disconnected from the data feed",
    });
  });

  it("rejects non-numeric or non-positive quantity", () => {
    expect(validateOrderInput({ ...base, quantity: "abc" }).ok).toBe(false);
    expect(validateOrderInput({ ...base, quantity: "0" }).ok).toBe(false);
    expect(validateOrderInput({ ...base, quantity: "-5" }).ok).toBe(false);
  });

  it("rejects quantity above the 1000 lot cap", () => {
    const result = validateOrderInput({ ...base, quantity: "1000.01" });
    expect(result).toEqual({
      ok: false,
      title: "Invalid Quantity",
      message: "Maximum quantity is 1000 lots",
    });
  });

  it("accepts exactly the 1000 lot cap", () => {
    expect(validateOrderInput({ ...base, quantity: "1000" })).toEqual({ ok: true, quantity: 1000 });
  });

  it("requires a valid price for LIMIT orders", () => {
    expect(validateOrderInput({ ...base, orderType: "LIMIT", price: "" }).ok).toBe(false);
    expect(validateOrderInput({ ...base, orderType: "LIMIT", price: "0" }).ok).toBe(false);
    expect(validateOrderInput({ ...base, orderType: "LIMIT", price: "abc" }).ok).toBe(false);
  });

  describe("attached TP/SL bracket", () => {
    // The bracket rides along with the entry order (OKX attachAlgoOrds). Each
    // leg has to sit on the side of the entry where it does its job — a stop
    // above a long's entry fires the instant the order fills, closing the
    // position it was meant to protect.
    const buy = { ...base, side: "BUY" as const, referencePrice: 50000 };
    const sell = { ...base, side: "SELL" as const, referencePrice: 50000 };

    it("passes the bracket through when both legs straddle the entry", () => {
      expect(validateOrderInput({ ...buy, stopLoss: 49000, takeProfit: 52000 })).toEqual({
        ok: true,
        quantity: 1,
        takeProfit: 52000,
        stopLoss: 49000,
      });
    });

    it("passes a short's bracket through inverted", () => {
      expect(validateOrderInput({ ...sell, stopLoss: 51000, takeProfit: 48000 })).toEqual({
        ok: true,
        quantity: 1,
        takeProfit: 48000,
        stopLoss: 51000,
      });
    });

    it("omits the bracket keys entirely when no bracket was given", () => {
      expect(validateOrderInput(buy)).toEqual({ ok: true, quantity: 1 });
    });

    it("accepts a stop-loss with no take-profit", () => {
      expect(validateOrderInput({ ...buy, stopLoss: 49000 })).toEqual({
        ok: true,
        quantity: 1,
        stopLoss: 49000,
      });
    });

    it("rejects a stop-loss above a long's entry", () => {
      const result = validateOrderInput({ ...buy, stopLoss: 51000 });
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ title: "Invalid Stop Loss" });
    });

    it("rejects a take-profit below a long's entry", () => {
      expect(validateOrderInput({ ...buy, takeProfit: 49000 })).toMatchObject({
        ok: false,
        title: "Invalid Take Profit",
      });
    });

    it("rejects a stop-loss below a short's entry", () => {
      expect(validateOrderInput({ ...sell, stopLoss: 49000 })).toMatchObject({
        ok: false,
        title: "Invalid Stop Loss",
      });
    });

    it("rejects a take-profit above a short's entry", () => {
      expect(validateOrderInput({ ...sell, takeProfit: 51000 })).toMatchObject({
        ok: false,
        title: "Invalid Take Profit",
      });
    });

    it("rejects a bracket leg sitting exactly on the entry", () => {
      expect(validateOrderInput({ ...buy, stopLoss: 50000 }).ok).toBe(false);
      expect(validateOrderInput({ ...buy, takeProfit: 50000 }).ok).toBe(false);
    });

    it("rejects a non-positive or non-finite bracket leg", () => {
      expect(validateOrderInput({ ...buy, stopLoss: 0 }).ok).toBe(false);
      expect(validateOrderInput({ ...buy, stopLoss: -1 }).ok).toBe(false);
      expect(validateOrderInput({ ...buy, takeProfit: Number.NaN }).ok).toBe(false);
      expect(validateOrderInput({ ...buy, takeProfit: Number.POSITIVE_INFINITY }).ok).toBe(false);
    });

    it("measures a LIMIT order's bracket against its limit price, not the tick", () => {
      // referencePrice (the live tick) says 50000, but the order rests at
      // 45000 — a 44000 stop is valid there and would look invalid against
      // the tick.
      const limit = { ...base, side: "BUY" as const, orderType: "LIMIT" as const, price: "45000" };
      expect(validateOrderInput({ ...limit, referencePrice: 50000, stopLoss: 44000 })).toEqual({
        ok: true,
        quantity: 1,
        price: 45000,
        stopLoss: 44000,
      });
      expect(validateOrderInput({ ...limit, referencePrice: 50000, stopLoss: 46000 }).ok).toBe(false);
    });

    it("leaves the bracket to OKX when there is no entry to measure against", () => {
      // A MARKET order placed before any tick has arrived: no referencePrice,
      // so direction can't be judged. Guessing one would be worse than
      // deferring to the exchange's own rules.
      expect(validateOrderInput({ ...base, side: "BUY", stopLoss: 51000 })).toEqual({
        ok: true,
        quantity: 1,
        stopLoss: 51000,
      });
    });
  });

  it("ignores any price for MARKET orders even if garbage was left in the field", () => {
    const result = validateOrderInput({ ...base, orderType: "MARKET", price: "not-a-number" });
    expect(result).toEqual({ ok: true, quantity: 1 });
  });

  it("parses a valid LIMIT order with quantity and price", () => {
    const result = validateOrderInput({ ...base, orderType: "LIMIT", price: "50000" });
    expect(result).toEqual({ ok: true, quantity: 1, price: 50000 });
  });
});
