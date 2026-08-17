export interface UserPreferences {
  chart: Record<string, string>;
  bottomPanelCollapsed?: boolean;
  rightPanelCollapsed?: boolean;
  rightPanelWidth?: number;
  bottomPanelHeight?: number;
  oneClickTrading?: boolean;
  timeframes: Record<string, string>;
  activeIndicators: Array<"ETF_FLOW">;
  watchlistFavorites: string[];
  tradeSoundMuted?: boolean;
  tradingMode?: "demo" | "live";
  selectedSymbol?: string;
}

export const PREFERENCES_UPDATED_EVENT = "user-preferences-updated";

const STORAGE_PREFIX = "xee_user_preferences";

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
    if (guest) return guest;
  }
  const chartKey = userId ? `trader_prefs:${userId}` : "trader_prefs";
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
    activeIndicators: [],
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
      chart: existing.chart ?? {},
      timeframes: existing.timeframes ?? {},
      activeIndicators: existing.activeIndicators?.filter((id) => id === "ETF_FLOW") ?? [],
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
