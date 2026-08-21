import { describe, expect, it } from "vitest";
import { resolveProfileEntry } from "@/pages/trading/positionBuilder";
import {
  type SessionVolumeProfile,
  summarizeLatestProfile,
} from "@/lib/session-volume-profile";

// Real numbers from the running OKX BTC-USDT-SWAP session, whose tick is 0.1.
const OKX_TICK = 0.1;
const PROFILE = { poc: 76_451.67166666666, vah: 78_396.16666666667 };

const profile = (over: Partial<SessionVolumeProfile>): SessionVolumeProfile =>
  ({
    market: "NEW_YORK",
    date: "2026-08-21",
    start: 1_787_000_000,
    end: 1_787_020_000,
    rows: [],
    totalVolume: 100,
    poc: 1,
    vah: 2,
    val: 0.5,
    isDeveloping: false,
    ...over,
  }) as SessionVolumeProfile;

describe("resolveProfileEntry", () => {
  it("snaps a profile level to the instrument tick", () => {
    // The bug this guards: a profile level is a histogram bucket boundary, not
    // a tradeable price. Sending 76451.67166666666 as a limit price gets
    // rejected by the exchange.
    const { price } = resolveProfileEntry("poc", PROFILE, OKX_TICK);

    expect(price).toBe(76_451.7);
    expect(String(price)).not.toContain("6666");
  });

  it("alternates between the two levels", () => {
    const first = resolveProfileEntry("poc", PROFILE, OKX_TICK);
    expect(first.next).toBe("vah");

    const second = resolveProfileEntry(first.next, PROFILE, OKX_TICK);
    expect(second.next).toBe("poc");
  });

  it("reads the level the caller asked for, not always the POC", () => {
    expect(resolveProfileEntry("vah", PROFILE, OKX_TICK).price).toBe(78_396.2);
    expect(resolveProfileEntry("poc", PROFILE, OKX_TICK).price).toBe(76_451.7);
  });

  it("rounds to whatever tick the instrument declares", () => {
    expect(resolveProfileEntry("poc", PROFILE, 1).price).toBe(76_452);
    expect(resolveProfileEntry("poc", PROFILE, 0.01).price).toBe(76_451.67);
    expect(resolveProfileEntry("poc", PROFILE, 50).price).toBe(76_450);
  });

  it("leaves the value alone when the tick is unusable", () => {
    // roundToTick's contract for a missing/zero tick — asserted here so a
    // fallback instrument spec can't silently corrupt the price.
    expect(resolveProfileEntry("poc", PROFILE, 0).price).toBe(PROFILE.poc);
  });
});

describe("summarizeLatestProfile", () => {
  it("returns null when the indicator produced nothing", () => {
    expect(summarizeLatestProfile([])).toBeNull();
  });

  it("picks the most recent session when several markets are selected", () => {
    const summary = summarizeLatestProfile([
      profile({ market: "TOKYO", start: 1_787_000_000, poc: 100 }),
      profile({ market: "LONDON", start: 1_787_030_000, poc: 300 }),
      profile({ market: "ASX", start: 1_787_010_000, poc: 200 }),
    ]);

    expect(summary?.market).toBe("LONDON");
    expect(summary?.poc).toBe(300);
  });

  it("carries the developing flag through, since the panel labels it", () => {
    const summary = summarizeLatestProfile([
      profile({ start: 1_787_000_000, isDeveloping: false }),
      profile({ start: 1_787_030_000, isDeveloping: true }),
    ]);

    expect(summary?.isDeveloping).toBe(true);
  });

  it("omits rows so the full histogram never travels up the tree", () => {
    const summary = summarizeLatestProfile([
      profile({ rows: [{ low: 1, high: 2, up: 1, down: 1, total: 2, isValueArea: true }] }),
    ]);

    expect(summary).not.toHaveProperty("rows");
    expect(Object.keys(summary ?? {}).sort()).toEqual(
      ["date", "isDeveloping", "market", "poc", "totalVolume", "vah", "val"],
    );
  });

  it("handles a single session without comparing anything", () => {
    const summary = summarizeLatestProfile([profile({ market: "NEW_YORK", poc: 42 })]);

    expect(summary?.market).toBe("NEW_YORK");
    expect(summary?.poc).toBe(42);
  });
});
