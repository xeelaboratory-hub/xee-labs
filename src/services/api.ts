/**
 * API facade.
 *
 * Market data (symbols/ticks/candles) is served by the real backend via
 * `marketdataApi`. Everything else the terminal needs — auth, accounts,
 * trading, journal, chart drawings, preferences, feature flags — still has
 * no backend and is served by the in-browser demo layer (services/demo).
 * `api` is the demo implementation wrapped in a Proxy that overlays the real
 * market-data methods ahead of it, with a fallback that returns a benign
 * async no-op for any method implemented by neither — so leftover calls from
 * non-terminal code resolve harmlessly instead of throwing network errors.
 */
import { demoApi } from "./demo/api.ts";
import { marketdataApi } from "./api/market-data.ts";

export const API_BASE = "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// react-query rejects `undefined` query results, so resolve to null instead.
const benign = () => Promise.resolve(null);

const realMarketData = {
  getSymbols: marketdataApi.getSymbols,
  getTick: marketdataApi.getTick,
  getCandles: marketdataApi.getCandles,
  getCandlesWithMeta: marketdataApi.getCandlesWithMeta,
};

export const api = new Proxy(demoApi as Record<string, unknown>, {
  get(target, prop: string) {
    if (prop in realMarketData) return realMarketData[prop as keyof typeof realMarketData];
    if (prop in target) return target[prop];
    return benign;
  },
}) as typeof demoApi & Record<string, (...args: never[]) => Promise<unknown>>;
