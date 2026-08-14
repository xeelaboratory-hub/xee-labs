import { describe, it, expect, vi } from "vitest";

vi.mock("../services/api/market-data.ts", () => ({
  marketdataApi: {
    getSymbols: vi.fn(() => Promise.resolve(["real-symbols"])),
    getTick: vi.fn(() => Promise.resolve({ symbol: "BINANCE:BTCUSD", bid: 1, ask: 2 })),
    getCandles: vi.fn(() => Promise.resolve(["real-candles"])),
    getCandlesWithMeta: vi.fn(() => Promise.resolve({ candles: ["real-candles"], metadata: {} })),
  },
}));

describe("services/api.ts facade", () => {
  it("routes market-data methods to marketdataApi", async () => {
    const { api } = await import("../services/api.ts");
    await expect(api.getSymbols()).resolves.toEqual(["real-symbols"]);
    await expect(api.getTick("BINANCE:BTCUSD")).resolves.toMatchObject({ symbol: "BINANCE:BTCUSD" });
    await expect(api.getCandles("BINANCE:BTCUSD", "1m")).resolves.toEqual(["real-candles"]);
    await expect(api.getCandlesWithMeta("BINANCE:BTCUSD", "1m")).resolves.toMatchObject({
      candles: ["real-candles"],
    });
  });

  it("still routes non-market-data methods to demoApi", async () => {
    const { api } = await import("../services/api.ts");
    const account = await api.getMyAccounts();
    expect(Array.isArray(account)).toBe(true);
  });

  it("resolves unknown methods to a benign null instead of throwing", async () => {
    const { api } = await import("../services/api.ts");
    const unknownMethod = (api as unknown as Record<string, () => Promise<unknown>>).someUnknownMethod;
    await expect(unknownMethod!()).resolves.toBeNull();
  });
});
