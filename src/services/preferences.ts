import type { SessionMarket } from "../lib/session-volume-profile.ts";
import type { LargeOrderSource, LargeOrderThreshold } from "./api/market-data.ts";

export interface UserPreferences {
  chart: Record<string, string>;
  bottomPanelCollapsed?: boolean;
  rightPanelCollapsed?: boolean;
  rightPanel?: "dom" | "watchlist" | "ai-trader" | "position-builder";
  rightPanelWidth?: number;
  bottomPanelHeight?: number;
  oneClickTrading?: boolean;
  timeframes: Record<string, string>;
  activeIndicators: Array<"ETF_FLOW" | "SESSION_VOLUME_PROFILE" | "LARGE_ORDER_BOOK">;
  largeOrderBookThreshold?: LargeOrderThreshold;
  largeOrderBookSources?: LargeOrderSource[];
  largeOrderBookShowInactive?: boolean;
  sessionVolumeProfileMarkets?: SessionMarket[];
  /** Legacy single-select preference, kept for migration. */
  sessionVolumeProfileMarket?: SessionMarket;
  sessionVolumeProfileRows?: number;
  watchlistFavorites: string[];
  tradeSoundMuted?: boolean;
  tradingMode?: "demo" | "live";
  selectedSymbol?: string;
}

export const PREFERENCES_UPDATED_EVENT = "user-preferences-updated";

const STORAGE_PREFIX = "xee_user_preferences";
const SESSION_MARKETS: readonly SessionMarket[] = ["ASX", "TOKYO", "LONDON", "NEW_YORK"];
const INDICATORS = ["ETF_FLOW", "SESSION_VOLUME_PROFILE", "LARGE_ORDER_BOOK"] as const;

export const DEFAULT_SESSION_VOLUME_PROFILE_MARKET: SessionMarket = "NEW_YORK";
export const DEFAULT_SESSION_VOLUME_PROFILE_MARKETS: SessionMarket[] = [DEFAULT_SESSION_VOLUME_PROFILE_MARKET];
export const DEFAULT_SESSION_VOLUME_PROFILE_ROWS = 30;

export function normalizeSessionVolumeProfileRows(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SESSION_VOLUME_PROFILE_ROWS;
  return Math.min(100, Math.max(10, Math.round(numeric)));
}

function normalizeSessionVolumeProfileMarket(value: unknown): SessionMarket {
  return SESSION_MARKETS.includes(value as SessionMarket)
    ? (value as SessionMarket)
    : DEFAULT_SESSION_VOLUME_PROFILE_MARKET;
}

function normalizeSessionVolumeProfileMarkets(value: unknown): SessionMarket[] {
  const values = Array.isArray(value) ? value : [value];
  const markets = SESSION_MARKETS.filter((market) => values.includes(market));
  return markets.length ? markets : [...DEFAULT_SESSION_VOLUME_PROFILE_MARKETS];
}

function currentUserId(): string | null {
  try {
    return JSON.parse(localStorage.getItem("user") ?? "null")?.id ?? null;
  } catch {
    return null;
  }
}

function storageKey(userId?: string | null): string {
  return `${STORAGE_PREFIX}:${userId ?? currentUserId() ?? "guest"}`;
}

function parseObject<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function migrateLegacy(userId?: string | null): UserPreferences {
  if (userId) {
    const guest = parseObject<UserPreferences | null>(
      localStorage.getItem(`${STORAGE_PREFIX}:guest`),
      null,
    );
    if (guest) {
      return {
        ...guest,
        chart: guest.chart ?? {},
        timeframes: guest.timeframes ?? {},
        activeIndicators:
          guest.activeIndicators?.filter((id) => INDICATORS.includes(id)) ?? [],
        largeOrderBookThreshold: guest.largeOrderBookThreshold ?? 1_000_000,
        largeOrderBookSources: guest.largeOrderBookSources?.length
          ? guest.largeOrderBookSources.filter((source) => source === "binance" || source === "okx")
          : ["binance", "okx"],
        largeOrderBookShowInactive: guest.largeOrderBookShowInactive ?? false,
        sessionVolumeProfileMarkets: normalizeSessionVolumeProfileMarkets(
          guest.sessionVolumeProfileMarkets ?? guest.sessionVolumeProfileMarket,
        ),
        sessionVolumeProfileMarket: normalizeSessionVolumeProfileMarket(guest.sessionVolumeProfileMarket),
        sessionVolumeProfileRows: normalizeSessionVolumeProfileRows(guest.sessionVolumeProfileRows),
        watchlistFavorites: guest.watchlistFavorites ?? [],
      };
    }
  }
  const chartKey = userId ? `trader_prefs:${userId}` : "trader_prefs";
  const hasLegacyPreferences = [
    chartKey,
    "trader_prefs",
    "rightPanelCollapsed",
    "rightPanelWidth",
    "bottomPanelCollapsed",
  ].some((key) => localStorage.getItem(key) !== null);
  const chart = parseObject<Record<string, string>>(
    localStorage.getItem(chartKey) ?? localStorage.getItem("trader_prefs"),
    {},
  );
  const timeframes: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("tf_")) timeframes[key.slice(3)] = localStorage.getItem(key) ?? "";
  }
  return {
    chart,
    bottomPanelCollapsed: localStorage.getItem("bottomPanelCollapsed") === "true",
    rightPanelCollapsed: localStorage.getItem("rightPanelCollapsed") === "true",
    rightPanelWidth: Number(localStorage.getItem("rightPanelWidth")) || undefined,
    bottomPanelHeight: Number(localStorage.getItem("bottomPanelHeight")) || undefined,
    oneClickTrading: localStorage.getItem("oneClickTrading") === "true",
    timeframes,
    rightPanel: hasLegacyPreferences ? "position-builder" : "dom",
    activeIndicators: hasLegacyPreferences ? [] : ["LARGE_ORDER_BOOK"],
    largeOrderBookThreshold: 1_000_000,
    largeOrderBookSources: ["binance", "okx"],
    largeOrderBookShowInactive: false,
    sessionVolumeProfileMarkets: [...DEFAULT_SESSION_VOLUME_PROFILE_MARKETS],
    sessionVolumeProfileMarket: DEFAULT_SESSION_VOLUME_PROFILE_MARKET,
    sessionVolumeProfileRows: DEFAULT_SESSION_VOLUME_PROFILE_ROWS,
    watchlistFavorites: parseObject<string[]>(localStorage.getItem("watchlist_favorites"), []),
    tradeSoundMuted: localStorage.getItem("tradeSoundMuted") === "true",
    tradingMode:
      localStorage.getItem("trading_mode") === "live" ? "live" : "demo",
  };
}

export function readLocalPreferences(userId?: string | null): UserPreferences {
  const key = storageKey(userId);
  const existing = parseObject<UserPreferences | null>(localStorage.getItem(key), null);
  if (existing) {
    return {
      ...existing,
      // "order" was the Order Panel, removed in favor of Position Builder.
      rightPanel:
        (existing.rightPanel as string) === "order" ? "position-builder" : existing.rightPanel,
      chart: existing.chart ?? {},
      timeframes: existing.timeframes ?? {},
      activeIndicators:
        existing.activeIndicators?.filter((id) => INDICATORS.includes(id)) ?? [],
      largeOrderBookThreshold: existing.largeOrderBookThreshold ?? 1_000_000,
      largeOrderBookSources: existing.largeOrderBookSources?.length
        ? existing.largeOrderBookSources.filter((source) => source === "binance" || source === "okx")
        : ["binance", "okx"],
      largeOrderBookShowInactive: existing.largeOrderBookShowInactive ?? false,
      sessionVolumeProfileMarkets: normalizeSessionVolumeProfileMarkets(
        existing.sessionVolumeProfileMarkets ?? existing.sessionVolumeProfileMarket,
      ),
      sessionVolumeProfileMarket: normalizeSessionVolumeProfileMarket(existing.sessionVolumeProfileMarket),
      sessionVolumeProfileRows: normalizeSessionVolumeProfileRows(existing.sessionVolumeProfileRows),
      watchlistFavorites: existing.watchlistFavorites ?? [],
    };
  }
  const migrated = migrateLegacy(userId ?? currentUserId());
  localStorage.setItem(key, JSON.stringify(migrated));
  return migrated;
}

export function writeLocalPreferences(
  preferences: UserPreferences,
  userId?: string | null,
  notify = true,
): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(preferences));
  if (notify) {
    window.dispatchEvent(
      new CustomEvent(PREFERENCES_UPDATED_EVENT, { detail: { userId: userId ?? currentUserId() } }),
    );
  }
}

export function updateLocalPreferences(
  patch: Partial<UserPreferences>,
  userId?: string | null,
): UserPreferences {
  const next = { ...readLocalPreferences(userId), ...patch };
  writeLocalPreferences(next, userId);
  return next;
}
