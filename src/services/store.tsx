import { create } from "zustand";
import { api } from "./api.ts";
import { readLocalPreferences, updateLocalPreferences } from "./preferences.ts";
import { wsClient } from "./ws.ts";
import type { Order, Position, Symbol, TradingMode, User } from "./schemas.ts";

// ── Auth Store ──────────────────────────────────────────────
interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, firstName: string, lastName: string) => Promise<void>;
  logout: () => void;
  restoreSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: localStorage.getItem("access_token"),
  refreshToken: localStorage.getItem("refresh_token"),
  user: JSON.parse(localStorage.getItem("user") || "null"),

  login: async (email, password) => {
    const data = await api.login(email, password);
    localStorage.setItem("access_token", data.accessToken);
    localStorage.setItem("refresh_token", data.refreshToken);
    localStorage.setItem("user", JSON.stringify(data.user));
    set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
    wsClient.connect(data.accessToken);
  },

  register: async (email, password, firstName, lastName) => {
    const data = await api.register(email, password, firstName, lastName);
    localStorage.setItem("access_token", data.accessToken);
    localStorage.setItem("refresh_token", data.refreshToken);
    localStorage.setItem("user", JSON.stringify(data.user));
    set({ accessToken: data.accessToken, refreshToken: data.refreshToken, user: data.user });
    wsClient.connect(data.accessToken);
  },

  logout: () => {
    const rt = localStorage.getItem("refresh_token");
    api.logout(rt || undefined).catch(() => {});
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    localStorage.removeItem("user");
    set({ accessToken: null, refreshToken: null, user: null });
    wsClient.connect();
    stopTokenRefresh();
  },

  restoreSession: async () => {
    const token = localStorage.getItem("access_token");
    if (!token) {
      wsClient.connect();
      return;
    }
    const rt = localStorage.getItem("refresh_token");
    if (rt && isTokenStale(token)) {
      try {
        const result = await api.refreshToken(rt);
        localStorage.setItem("access_token", result.accessToken);
        localStorage.setItem("refresh_token", result.refreshToken);
        set({ accessToken: result.accessToken, refreshToken: result.refreshToken });
        wsClient.connect(result.accessToken);
        startTokenRefresh();
      } catch {
        get().logout();
      }
      return;
    }
    wsClient.connect(token);
    if (rt) startTokenRefresh();
  },
}));

// Silent token refresh - refresh 60s before expiry
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function isTokenStale(token: string, thresholdMs = 5 * 60 * 1000): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!));
    return payload.exp * 1000 - Date.now() < thresholdMs;
  } catch {
    return true;
  }
}

// Calculate time-to-expiry from the JWT so the first refresh fires before the
// token actually expires, not on a blind interval. Floor is 60s.
function getTokenExpiresIn(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!));
    const exp = payload.exp;
    if (typeof exp !== "number") return 13 * 60 * 1000;
    const msRemaining = exp * 1000 - Date.now();
    return Math.max(msRemaining - 60_000, 60_000);
  } catch {
    return 13 * 60 * 1000;
  }
}

function startTokenRefresh() {
  stopTokenRefresh();

  let retries = 0;
  const MAX_RETRIES = 3;

  const doRefresh = async () => {
    const rt = localStorage.getItem("refresh_token");
    if (!rt) return;
    try {
      const result = await api.refreshToken(rt);
      retries = 0;
      localStorage.setItem("access_token", result.accessToken);
      localStorage.setItem("refresh_token", result.refreshToken);
      useAuthStore.setState({
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });
      wsClient.reauthenticate(result.accessToken);
      const nextDelay = getTokenExpiresIn(result.accessToken);
      refreshTimer = setTimeout(doRefresh, nextDelay);
    } catch {
      retries++;
      if (retries <= MAX_RETRIES) {
        const backoff = retries * 5_000;
        refreshTimer = setTimeout(doRefresh, backoff);
      } else {
        useAuthStore.getState().logout();
      }
    }
  };

  const currentToken = localStorage.getItem("access_token");
  const firstDelay = currentToken ? getTokenExpiresIn(currentToken) : 13 * 60 * 1000;
  refreshTimer = setTimeout(doRefresh, firstDelay);
}

function stopTokenRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

// ── Trading Store ───────────────────────────────────────────
interface CandleBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export type TickEntry = {
  bid: number;
  ask: number;
  timestamp: number;
  /** Pre-formatted with symbol-correct decimal places — avoids toFixed() during renders */
  bidFmt: string;
  askFmt: string;
};

// RAF tick buffers — batch all WS ticks arriving in one frame into a single set()
const _pendingTicks = new Map<string, TickEntry>();
let _tickRafId: number | null = null;
const _pendingLiveTicks = new Map<string, TickEntry>();
let _liveTickRafId: number | null = null;

/** Per-symbol decimal precision cache — populated on first tick, avoids O(n) symbol lookup per tick */
const _symbolDecimals = new Map<string, number>();
function _pipDecimals(tickSize?: number | null): number {
  if (!tickSize) return 5;
  const s = String(tickSize);
  const dot = s.indexOf(".");
  return dot >= 0 ? s.length - dot - 1 : 2;
}

interface TradingState {
  /** Which OKX environment (demo-trading vs live-trading) actions target. */
  mode: TradingMode;
  positions: Position[];
  orders: Order[];
  symbols: Symbol[];
  selectedSymbol: string;
  /** Delayed ticks — HFT lag applied; what the account "sees" */
  ticks: Record<string, TickEntry>;
  /** Live (undelayed) ticks — pushed as HftLiveTick by ws-handler for HFT clients.
   *  Empty for non-HFT users. Replaces the 500ms REST poll for gap detection. */
  liveTicks: Record<string, TickEntry>;
  /** Latest WS candle update keyed by "symbol:timeframe" */
  liveCandleUpdates: Record<string, CandleBar>;

  setMode: (mode: TradingMode) => void;
  loadPositions: () => Promise<void>;
  loadOrders: () => Promise<void>;
  loadSymbols: () => Promise<void>;
  updateTick: (symbolName: string, bid: number, ask: number, timestamp: number) => void;
  updateLiveTick: (symbolName: string, bid: number, ask: number, timestamp: number) => void;
  updateCandleFromWs: (symbol: string, timeframe: string, bar: CandleBar) => void;
  setSelectedSymbol: (symbol: string) => void;
  setPositions: (positions: Position[]) => void;
  setOrders: (orders: Order[]) => void;
}

export const useTradingStore = create<TradingState>((set, get) => ({
  mode: readLocalPreferences().tradingMode ?? "demo",
  positions: [],
  orders: [],
  symbols: [],
  selectedSymbol: readLocalPreferences().selectedSymbol ?? "BINANCE:BTCUSD",
  ticks: {},
  liveTicks: {},
  liveCandleUpdates: {},

  setMode: (mode) => {
    updateLocalPreferences({ tradingMode: mode });
    set({ mode, positions: [], orders: [] });
  },

  loadPositions: async () => {
    const positions = await api.getPositions(get().mode);
    set({ positions });
  },

  loadOrders: async () => {
    const orders = await api.getOrders(get().mode);
    set({ orders });
  },

  loadSymbols: async () => {
    const symbols = await api.getSymbols();
    set({ symbols });
  },

  updateTick: (symbolName, bid, ask, timestamp) => {
    // 1. Check pending buffer (same-frame dedup with timestamp awareness)
    const pending = _pendingTicks.get(symbolName);
    if (pending && pending.bid === bid && pending.ask === ask && pending.timestamp >= timestamp)
      return;
    // 2. When buffer is empty, also check committed state (cross-RAF dedup — prevents redundant flush)
    if (!pending) {
      const committed = get().ticks[symbolName];
      if (
        committed &&
        committed.bid === bid &&
        committed.ask === ask &&
        committed.timestamp >= timestamp
      )
        return;
    }
    // 3. Resolve symbol-correct decimal precision (cached after first hit)
    if (!_symbolDecimals.has(symbolName)) {
      const sym = get().symbols.find((s) => s.name === symbolName);
      if (sym) _symbolDecimals.set(symbolName, _pipDecimals(sym.tickSize));
    }
    const decimals = _symbolDecimals.get(symbolName) ?? 5;
    _pendingTicks.set(symbolName, {
      bid,
      ask,
      timestamp,
      bidFmt: bid.toFixed(decimals),
      askFmt: ask.toFixed(decimals),
    });
    if (_tickRafId === null) {
      _tickRafId = requestAnimationFrame(() => {
        const updates = Object.fromEntries(_pendingTicks);
        // Clear BEFORE set() so any tick that arrives synchronously inside a Zustand
        // subscriber during set() goes into a fresh buffer and gets its own RAF.
        _pendingTicks.clear();
        _tickRafId = null;
        set((s) => ({ ticks: { ...s.ticks, ...updates } }));
      });
    }
  },

  updateLiveTick: (symbolName, bid, ask, timestamp) => {
    const pending = _pendingLiveTicks.get(symbolName);
    if (pending && pending.bid === bid && pending.ask === ask && pending.timestamp >= timestamp)
      return;
    if (!pending) {
      const committed = get().liveTicks[symbolName];
      if (
        committed &&
        committed.bid === bid &&
        committed.ask === ask &&
        committed.timestamp >= timestamp
      )
        return;
    }
    if (!_symbolDecimals.has(symbolName)) {
      const sym = get().symbols.find((s) => s.name === symbolName);
      if (sym) _symbolDecimals.set(symbolName, _pipDecimals(sym.tickSize));
    }
    const decimals = _symbolDecimals.get(symbolName) ?? 5;
    _pendingLiveTicks.set(symbolName, {
      bid,
      ask,
      timestamp,
      bidFmt: bid.toFixed(decimals),
      askFmt: ask.toFixed(decimals),
    });
    if (_liveTickRafId === null) {
      _liveTickRafId = requestAnimationFrame(() => {
        const updates = Object.fromEntries(_pendingLiveTicks);
        _pendingLiveTicks.clear();
        _liveTickRafId = null;
        set((s) => ({ liveTicks: { ...s.liveTicks, ...updates } }));
      });
    }
  },

  updateCandleFromWs: (symbol, timeframe, bar) => {
    const key = `${symbol}:${timeframe}`;
    set((state) => ({
      liveCandleUpdates: { ...state.liveCandleUpdates, [key]: bar },
    }));
  },

  setSelectedSymbol: (symbol) => {
    updateLocalPreferences({ selectedSymbol: symbol });
    set((state) =>
      state.selectedSymbol === symbol
        ? { selectedSymbol: symbol }
        : { selectedSymbol: symbol, liveCandleUpdates: {} },
    );
  },
  setPositions: (positions) => set({ positions }),
  setOrders: (orders) => set({ orders }),
}));
