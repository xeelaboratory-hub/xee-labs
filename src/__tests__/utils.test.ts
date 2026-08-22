import { describe, it, expect } from "vitest";
import { cn, decimalsFromTick, formatCurrency, formatMobileSymbolLabel, formatNumber, pnlClass } from "@/lib/utils";

describe("cn (class name merge)", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles undefined and null", () => {
    expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    const hide = false;
    const show = true;
    expect(cn("base", hide && "hidden", show && "visible")).toBe("base visible");
  });

  it("resolves Tailwind conflicts (last wins)", () => {
    const result = cn("p-4", "p-6");
    expect(result).toBe("p-6");
  });

  it("handles empty input", () => {
    expect(cn()).toBe("");
  });
});

describe("formatCurrency", () => {
  it("formats positive numbers", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats negative numbers", () => {
    expect(formatCurrency(-500)).toBe("-$500.00");
  });

  it("respects custom decimals", () => {
    expect(formatCurrency(100, 0)).toBe("$100");
  });

  it("formats large numbers with commas", () => {
    expect(formatCurrency(1000000)).toBe("$1,000,000.00");
  });
});

describe("formatNumber", () => {
  it("formats with default 2 decimals", () => {
    expect(formatNumber(1234.5)).toBe("1,234.50");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0.00");
  });

  it("respects custom decimals", () => {
    expect(formatNumber(3.14159, 4)).toBe("3.1416");
  });
});

describe("formatMobileSymbolLabel", () => {
  it("strips the exchange prefix for mobile display", () => {
    expect(formatMobileSymbolLabel("BINANCE:BTCUSD")).toBe("BTCUSD");
  });

  it("returns the symbol unchanged when no prefix is present", () => {
    expect(formatMobileSymbolLabel("BTCUSD")).toBe("BTCUSD");
  });
});

describe("pnlClass", () => {
  it("returns success for positive values", () => {
    expect(pnlClass(100)).toBe("text-success");
  });

  it("returns destructive for negative values", () => {
    expect(pnlClass(-50)).toBe("text-destructive");
  });

  it("returns muted for zero", () => {
    expect(pnlClass(0)).toBe("text-muted-foreground");
  });
});

describe("decimalsFromTick", () => {
  it("takes its precision from the exchange's own tick", () => {
    // The defect: a constant 5 rendered BTC as 77,280.30000, four digits past
    // anything OKX quotes, on the number an order is built from.
    expect(decimalsFromTick(0.1)).toBe(1);
    expect(decimalsFromTick(0.01)).toBe(2);
    expect(decimalsFromTick(0.00001)).toBe(5);
  });

  it("gives a whole-tick instrument no decimals at all", () => {
    expect(decimalsFromTick(1)).toBe(0);
    expect(decimalsFromTick(10)).toBe(0);
  });

  it("falls back to 2 rather than inventing precision", () => {
    // Too few decimals hides information; too many fabricate it. For an
    // unknown tick the second failure is the worse one.
    expect(decimalsFromTick(undefined)).toBe(2);
    expect(decimalsFromTick(0)).toBe(2);
    expect(decimalsFromTick(-1)).toBe(2);
    expect(decimalsFromTick(Number.NaN)).toBe(2);
    expect(decimalsFromTick(Number.POSITIVE_INFINITY)).toBe(2);
  });

  it("reads a tiny tick as digits, not as an exponent", () => {
    // String(1e-7) is "1e-7" — splitting that on "." counts no decimals and
    // silently rounds a real price to a whole number.
    expect(decimalsFromTick(1e-7)).toBe(7);
  });
});
