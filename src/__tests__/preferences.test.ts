import { beforeEach, describe, expect, it } from "vitest";
import {
  readLocalPreferences,
  updateLocalPreferences,
  writeLocalPreferences,
} from "@/services/preferences";

describe("user preferences", () => {
  beforeEach(() => localStorage.clear());

  it("keeps browser preferences isolated per user", () => {
    updateLocalPreferences({ tradingMode: "live" }, "user-a");
    updateLocalPreferences({ tradingMode: "demo" }, "user-b");

    expect(readLocalPreferences("user-a").tradingMode).toBe("live");
    expect(readLocalPreferences("user-b").tradingMode).toBe("demo");
  });

  it("uses guest preferences as the first-login snapshot", () => {
    writeLocalPreferences(
      {
        chart: { sessionBreaks: "true" },
        timeframes: { "BINANCE:BTCUSD": "15m" },
        activeIndicators: ["ETF_FLOW"],
        watchlistFavorites: ["BINANCE:BTCUSD"],
      },
      null,
    );

    expect(readLocalPreferences("new-user")).toEqual(readLocalPreferences(null));
  });
});
