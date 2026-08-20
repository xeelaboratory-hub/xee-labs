/**
 * API facade — calls the real backend for everything (auth, market data,
 * accounts, trading). There is no demo/mock fallback: a failed call throws
 * and the UI is expected to show a Disconnected/Error state, never silently
 * substitute fake data.
 *
 * PropSim-era features with no real backend and zero UI consumers (leaderboards,
 * competitions, bots, MFA, push notifications, profile/scaling/profit-split,
 * account-merge, support tickets, trade journal, analytics) are intentionally
 * NOT implemented here. Accessing any of them throws a clear "not implemented"
 * error instead of the old silent-null demo stub, via the Proxy below.
 */
import { request } from "./api/request.ts";
import { marketdataApi } from "./api/market-data.ts";
import type { UserPreferences } from "./preferences.ts";
import type {
  Account,
  AuthResponse,
  Order,
  PlaceOrderInput,
  Position,
  TradeHistoryEntry,
  TradingMode,
  User,
} from "./schemas.ts";

export interface ExchangeCredentialInput {
  exchange: "okx";
  isDemo: boolean;
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  label?: string;
}

export interface ExchangeCredential {
  id: string;
  exchange: string;
  isDemo: boolean;
  label: string;
  createdAt: string;
}

const realImplementation = {
  // ── Auth ──
  login: (email: string, password: string) =>
    request<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, firstName: string, lastName: string) =>
    request<AuthResponse>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, firstName, lastName }),
    }),
  refreshToken: (refreshToken: string) =>
    request<{ accessToken: string; refreshToken: string }>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  logout: (refreshToken?: string) =>
    request<{ success: boolean }>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken }),
    }),
  getMe: () => request<User>("/auth/me"),

  // ── Per-user UI preferences ──
  getPreferences: () =>
    request<{ exists: boolean; preferences: UserPreferences; updatedAt?: string }>("/preferences"),
  savePreferences: (preferences: UserPreferences) =>
    request<{ exists: true; preferences: UserPreferences; updatedAt: string }>("/preferences", {
      method: "PUT",
      body: JSON.stringify(preferences),
    }),

  // ── Exchange credentials ──
  listCredentials: () => request<ExchangeCredential[]>("/credentials"),
  createCredential: (input: ExchangeCredentialInput) =>
    request<ExchangeCredential>("/credentials", { method: "POST", body: JSON.stringify(input) }),
  deleteCredential: (id: string) => request<void>(`/credentials/${id}`, { method: "DELETE" }),

  // ── Market data (real backend, unchanged since Phase 3) ──
  getSymbols: marketdataApi.getSymbols,
  getInstrument: marketdataApi.getInstrument,
  getTick: marketdataApi.getTick,
  getCandles: marketdataApi.getCandles,
  getCandlesWithMeta: marketdataApi.getCandlesWithMeta,
  getMarketDataHealth: marketdataApi.getMarketDataHealth,
  getEconomicCalendar: marketdataApi.getEconomicCalendar,
  getEtfFlows: marketdataApi.getEtfFlows,
  getLargeOrderBookHistory: marketdataApi.getLargeOrderBookHistory,

  // ── Trading (OKX, via backend) ──
  getAccount: (mode: TradingMode) => request<Account>(`/account?mode=${mode}`),
  getPositions: (mode: TradingMode) => request<Position[]>(`/positions?mode=${mode}`),
  getOrders: (mode: TradingMode) => request<Order[]>(`/orders?mode=${mode}`),
  placeOrder: (input: PlaceOrderInput) =>
    request<{ orderId: string }>(`/orders?mode=${input.mode}`, {
      method: "POST",
      body: JSON.stringify({
        symbol: input.symbol,
        side: input.side,
        type: input.type,
        quantity: input.quantity,
        price: input.price,
      }),
    }),
  cancelOrder: (orderId: string, mode: TradingMode, symbol: string) =>
    request<{ success: boolean }>(
      `/orders/${orderId}?mode=${mode}&symbol=${encodeURIComponent(symbol)}`,
      { method: "DELETE" },
    ),
  /**
   * positionId is the composite "{symbol}:{posSide}:{side}" id from mapping.py
   * — posSide is OKX's raw long/short/net (needed verbatim for a full close),
   * side is our derived LONG/SHORT (needed to pick a reduce-only direction for
   * a partial close). Parsed from the end — symbol itself contains a colon.
   */
  closePosition: (positionId: string, mode: TradingMode, quantity?: number) => {
    const parts = positionId.split(":");
    const side = (parts.pop() === "short" ? "SHORT" : "LONG") as "LONG" | "SHORT";
    const posSide = parts.pop() as "long" | "short" | "net";
    const symbol = parts.join(":");
    return request<{ success: boolean }>(`/positions/close?mode=${mode}`, {
      method: "POST",
      body: JSON.stringify({ symbol, posSide, side, quantity }),
    });
  },
  getTradeHistory: (mode: TradingMode) => request<TradeHistoryEntry[]>(`/trades/history?mode=${mode}`),
};

const unimplemented = (name: string) => () =>
  Promise.reject(
    new Error(`"${name}" is not implemented — this feature isn't part of Xee.Labs' real backend`),
  );

export const api = new Proxy(realImplementation as Record<string, unknown>, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    return unimplemented(prop);
  },
}) as typeof realImplementation & Record<string, (...args: never[]) => Promise<unknown>>;
