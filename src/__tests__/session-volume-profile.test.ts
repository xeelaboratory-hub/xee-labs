import { describe, expect, it } from "vitest";
import {
  calculateSessionVolumeProfile,
  isInSession,
  sessionWindowForDate,
  sessionWindowsInRange,
  type OhlcvBar,
} from "@/lib/session-volume-profile";

function bar(time: number, low: number, high: number, volume: number, up = true): OhlcvBar {
  return { time, open: up ? low : high, high, low, close: up ? high : low, volume };
}

describe("session market windows", () => {
  it("uses local DST-aware New York hours", () => {
    expect(new Date(sessionWindowForDate("2026-01-15", "NEW_YORK").start * 1_000).toISOString()).toBe(
      "2026-01-15T14:30:00.000Z",
    );
    expect(new Date(sessionWindowForDate("2026-07-15", "NEW_YORK").start * 1_000).toISOString()).toBe(
      "2026-07-15T13:30:00.000Z",
    );
  });

  it("uses local DST-aware London and Sydney hours", () => {
    expect(new Date(sessionWindowForDate("2026-07-15", "LONDON").start * 1_000).toISOString()).toBe(
      "2026-07-15T07:00:00.000Z",
    );
    expect(new Date(sessionWindowForDate("2026-12-15", "ASX").start * 1_000).toISOString()).toBe(
      "2026-12-14T23:00:00.000Z",
    );
  });

  it("excludes Tokyo's lunch break while keeping one session window", () => {
    const window = sessionWindowForDate("2026-08-17", "TOKYO");
    expect(isInSession(Date.UTC(2026, 7, 17, 2, 29) / 1_000, window)).toBe(true);
    expect(isInSession(Date.UTC(2026, 7, 17, 2, 30) / 1_000, window)).toBe(false);
    expect(isInSession(Date.UTC(2026, 7, 17, 3, 30) / 1_000, window)).toBe(true);
  });

  it("includes weekend sessions and caps visible history at ten", () => {
    const from = Date.UTC(2026, 7, 1) / 1_000;
    const to = Date.UTC(2026, 7, 20) / 1_000;
    const windows = sessionWindowsInRange(from, to, "NEW_YORK");
    expect(windows).toHaveLength(10);
    expect(windows.some((window) => window.date === "2026-08-16")).toBe(true);
  });
});

describe("calculateSessionVolumeProfile", () => {
  const window = sessionWindowForDate("2026-08-17", "NEW_YORK");

  it("preserves volume and classifies up/down bars", () => {
    const profile = calculateSessionVolumeProfile(
      window,
      [bar(window.start + 60, 100, 101, 12, true), bar(window.start + 120, 101, 102, 8, false)],
      10,
    );
    expect(profile).not.toBeNull();
    expect(profile!.totalVolume).toBeCloseTo(20);
    expect(profile!.rows.reduce((sum, row) => sum + row.up, 0)).toBeCloseTo(12);
    expect(profile!.rows.reduce((sum, row) => sum + row.down, 0)).toBeCloseTo(8);
  });

  it("puts a flat candle in one price row", () => {
    const profile = calculateSessionVolumeProfile(window, [bar(window.start + 60, 100, 100, 7)], 10);
    expect(profile!.rows.filter((row) => row.total > 0)).toHaveLength(1);
    expect(profile!.totalVolume).toBeCloseTo(7);
  });

  it("uses the lower price row for a POC tie", () => {
    const profile = calculateSessionVolumeProfile(
      window,
      [bar(window.start + 60, 100, 100, 5), bar(window.start + 120, 101, 101, 5)],
      10,
    );
    expect(profile!.poc).toBeLessThan(100.2);
  });

  it("clamps the requested row count to the documented bounds", () => {
    const bars = [bar(window.start + 60, 100, 101, 1)];
    expect(calculateSessionVolumeProfile(window, bars, 10)!.rows).toHaveLength(10);
    expect(calculateSessionVolumeProfile(window, bars, 100)!.rows).toHaveLength(100);
    expect(calculateSessionVolumeProfile(window, bars, 999)!.rows).toHaveLength(100);
  });

  it("returns null when no bars fall inside the session window", () => {
    const outsideSession = bar(window.start - 3600, 100, 101, 5);
    expect(calculateSessionVolumeProfile(window, [outsideSession], 10)).toBeNull();
  });

  it("ignores bars with zero or non-finite volume/price fields", () => {
    const zeroVolume = bar(window.start + 60, 100, 101, 0);
    const nanHigh = { ...bar(window.start + 120, 100, 101, 5), high: NaN };
    expect(calculateSessionVolumeProfile(window, [zeroVolume, nanHigh], 10)).toBeNull();
  });

  it("expands the value area outward from the POC without exceeding the 70% target", () => {
    // Five equal-volume rows spread across the session; the algorithm grows the
    // value area from the POC (middle row) outward, but stops before any addition
    // would push it past 70% of total volume — so it can land under 70%, never over.
    const bars = [
      bar(window.start + 60, 100, 100.2, 10),
      bar(window.start + 120, 100.2, 100.4, 10),
      bar(window.start + 180, 100.4, 100.6, 10),
      bar(window.start + 240, 100.6, 100.8, 10),
      bar(window.start + 300, 100.8, 101.0, 10),
    ];
    const profile = calculateSessionVolumeProfile(window, bars, 5)!;
    const valueAreaCount = profile.rows.filter((row) => row.isValueArea).length;
    const valueAreaVolume = profile.rows
      .filter((row) => row.isValueArea)
      .reduce((sum, row) => sum + row.total, 0);
    expect(valueAreaVolume / profile.totalVolume).toBeLessThanOrEqual(0.7);
    expect(valueAreaCount).toBeGreaterThan(1);
    expect(profile.vah).toBeGreaterThan(profile.poc);
    expect(profile.val).toBeLessThan(profile.poc);
  });
});
