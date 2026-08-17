import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_VOLUME_PROFILE_MARKET,
  DEFAULT_SESSION_VOLUME_PROFILE_MARKETS,
  DEFAULT_SESSION_VOLUME_PROFILE_ROWS,
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

  it("keeps Session Volume Profile settings and normalizes invalid saved values", () => {
    writeLocalPreferences(
      {
        chart: {},
        timeframes: {},
        activeIndicators: ["SESSION_VOLUME_PROFILE"],
        sessionVolumeProfileMarket: "TOKYO",
        sessionVolumeProfileRows: 64,
        watchlistFavorites: [],
      },
      "profile-user",
    );
    expect(readLocalPreferences("profile-user").sessionVolumeProfileMarkets).toEqual(["TOKYO"]);
    expect(readLocalPreferences("profile-user").sessionVolumeProfileMarket).toBe("TOKYO");
    expect(readLocalPreferences("profile-user").sessionVolumeProfileRows).toBe(64);

    localStorage.setItem(
      "xee_user_preferences:invalid-profile-user",
      JSON.stringify({ chart: {}, timeframes: {}, activeIndicators: ["UNKNOWN"], watchlistFavorites: [], sessionVolumeProfileRows: 999 }),
    );
    const invalid = readLocalPreferences("invalid-profile-user");
    expect(invalid.activeIndicators).toEqual([]);
    expect(invalid.sessionVolumeProfileMarkets).toEqual(DEFAULT_SESSION_VOLUME_PROFILE_MARKETS);
    expect(invalid.sessionVolumeProfileMarket).toBe(DEFAULT_SESSION_VOLUME_PROFILE_MARKET);
    expect(invalid.sessionVolumeProfileRows).toBe(100);
    expect(DEFAULT_SESSION_VOLUME_PROFILE_ROWS).toBe(30);
  });

  it("keeps multiple Session Volume Profile markets and removes invalid duplicates", () => {
    localStorage.setItem(
      "xee_user_preferences:multi-market-user",
      JSON.stringify({
        chart: {},
        timeframes: {},
        activeIndicators: ["SESSION_VOLUME_PROFILE"],
        sessionVolumeProfileMarkets: ["NEW_YORK", "LONDON", "NEW_YORK", "INVALID"],
        watchlistFavorites: [],
      }),
    );

    expect(readLocalPreferences("multi-market-user").sessionVolumeProfileMarkets).toEqual([
      "LONDON",
      "NEW_YORK",
    ]);
  });
});
