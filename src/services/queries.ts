import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./api";
import type { EtfFlow, MarketDataCandlesPayload } from "./api/market-data";
import { useAuthStore } from "./store";

// Types for dead PropSim-era hooks below (payouts, journal — no real backend,
// see services/api.ts's "not implemented" Proxy fallback). Kept loose since
// nothing actually consumes these hooks.
type AllPayoutsResponse = unknown;
type JournalEntriesResponse = unknown;
import type { PnlCalendarResponse } from "@propsim/types";
import type {
  Account,
  Order,
  Position,
  Symbol,
  Candle,
  PlaceOrderInput,
  TradeHistoryEntry,
  TradingMode,
} from "./schemas";

// ── Query Key Factories ─────────────────────────────────
export const queryKeys = {
  accounts: {
    all: ["accounts"] as const,
    detail: (mode: string) => [...queryKeys.accounts.all, mode] as const,
  },
  trading: {
    positions: (mode: string) => ["positions", mode] as const,
    orders: (mode: string) => ["orders", mode] as const,
  },
  market: {
    symbols: ["symbols"] as const,
    candles: (symbol: string, tf: string) => ["candles", symbol, tf] as const,
    economicCalendar: (currencies: string[]) => ["economicCalendar", ...currencies] as const,
    etfFlows: ["etf-flows"] as const,
  },
} as const;

export function useAccount(mode: TradingMode | null, opts?: Partial<UseQueryOptions<Account>>) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const authScope = useAuthStore((s) => s.user?.id ?? "guest");
  return useQuery<Account>({
    queryKey: [...queryKeys.accounts.detail(mode!), authScope],
    queryFn: () => api.getAccount(mode!),
    enabled: !!accessToken && !!mode,
    staleTime: 15_000,
    ...opts,
  });
}

// ── Trading Queries ────────────────────────────────────
export function usePositions(mode: TradingMode | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const authScope = useAuthStore((s) => s.user?.id ?? "guest");
  return useQuery<Position[]>({
    queryKey: [...queryKeys.trading.positions(mode!), authScope],
    queryFn: () => api.getPositions(mode!),
    enabled: !!accessToken && !!mode,
    // 10s staleTime avoids refetch storms; 30s refetchInterval is the primary
    // update path (no WS push for positions/orders — see MarketDataBridge.tsx).
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useOrders(mode: TradingMode | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const authScope = useAuthStore((s) => s.user?.id ?? "guest");
  return useQuery<Order[]>({
    queryKey: [...queryKeys.trading.orders(mode!), authScope],
    queryFn: () => api.getOrders(mode!),
    enabled: !!accessToken && !!mode,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useTradeHistory(mode: TradingMode | null) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const authScope = useAuthStore((s) => s.user?.id ?? "guest");
  return useQuery<TradeHistoryEntry[]>({
    queryKey: ["tradeHistory", mode, authScope] as const,
    queryFn: () => api.getTradeHistory(mode!),
    enabled: !!accessToken && !!mode,
    staleTime: 30_000,
  });
}

// ── Payout Queries ─────────────────────────────────────
export function useAllPayouts() {
  return useQuery<AllPayoutsResponse>({
    queryKey: ["allPayouts"],
    queryFn: () => api.getAllPayouts(),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

// ── Market Data Queries ────────────────────────────────
export function useSymbols() {
  return useQuery<Symbol[]>({
    queryKey: queryKeys.market.symbols,
    queryFn: () => api.getSymbols(),
    staleTime: 5 * 60_000, // 5min
  });
}

export interface EconomicCalendarEvent {
  id: string;
  time: string;
  currency: string;
  impact: "low" | "medium" | "high";
  event: string;
  forecast?: string;
  previous?: string;
  actual?: string;
  country: string;
}

export function useEconomicCalendar(currencies: string[]) {
  return useQuery<EconomicCalendarEvent[]>({
    queryKey: queryKeys.market.economicCalendar(currencies),
    queryFn: async () => {
      const now = new Date();
      const from = new Date(now);
      from.setDate(from.getDate() - 14);
      const to = new Date(now);
      to.setDate(to.getDate() + 14);
      const res = await api.getEconomicCalendar(
        currencies,
        from.toISOString().split("T")[0],
        to.toISOString().split("T")[0],
      );
      return res as EconomicCalendarEvent[];
    },
    enabled: currencies.length > 0,
    staleTime: 10 * 60_000, // refresh every 10min
  });
}

export function useCandles(
  symbol: string,
  timeframe: string,
  limit?: number,
  replayVersion?: number,
) {
  return useQuery<MarketDataCandlesPayload, Error, Candle[]>({
    // Include replayVersion in the query key so each replay session forces a
    // completely fresh query — React Query won't reuse structural sharing or
    // stale cache from a previous replay / normal session.
    queryKey: [...queryKeys.market.candles(symbol, timeframe), limit ?? "auto", replayVersion ?? 0],
    queryFn: () => api.getCandlesWithMeta(symbol, timeframe, limit),
    // Extract just the candles array for consumers — raw payload (with isPartial)
    // is still accessible via query.state.data inside refetchInterval below.
    select: (data) => data.candles,
    staleTime: 30_000,
    // Keep previously-fetched candles visible while a new depth query (different
    // limit in the key) is in-flight. Without this, switching from firstPaint
    // → deep limit causes a momentary empty array, which lets a live WS candle
    // paint as the only bar before history arrives.
    placeholderData: (prev) => prev,
    // When the server signals the response is partial (backfill queued), poll
    // at 3 s until data fills in. Otherwise use the 5-min safety-net cadence.
    refetchInterval: (query) => (query.state.data?.metadata?.isPartial ? 3_000 : 5 * 60_000),
  });
}

// ── Account Metrics (comprehensive single-source-of-truth) ──
export function useAccountMetrics(accountId: string | null) {
  return useQuery({
    queryKey: ["account-metrics", accountId] as const,
    queryFn: () => api.getAccountMetrics(accountId!),
    enabled: !!accountId,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

// ── Market Data Health ──
export function useMarketDataHealth() {
  return useQuery({
    queryKey: ["market-data-health"] as const,
    queryFn: () => api.getMarketDataHealth(),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
}

// ── ETF Flow (BTC, context indicator only) ──
export function useEtfFlows() {
  return useQuery<EtfFlow[]>({
    queryKey: queryKeys.market.etfFlows,
    queryFn: () => api.getEtfFlows(),
    staleTime: Infinity, // WS pushes updates directly into this cache; no polling
  });
}

// ── Change Password Mutation ──
export function useChangePassword() {
  return useMutation({
    mutationFn: ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string;
      newPassword: string;
    }) => api.changePassword(currentPassword, newPassword),
  });
}

// ── Mutations ──────────────────────────────────────────
export function usePlaceOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlaceOrderInput) => api.placeOrder(input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.trading.orders(vars.mode) });
      qc.invalidateQueries({ queryKey: queryKeys.trading.positions(vars.mode) });
      qc.invalidateQueries({ queryKey: queryKeys.accounts.detail(vars.mode) });
    },
  });
}

export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, mode, symbol }: { orderId: string; mode: TradingMode; symbol: string }) =>
      api.cancelOrder(orderId, mode, symbol),
    onMutate: async ({ orderId, mode }) => {
      // Optimistic update: remove order from list
      await qc.cancelQueries({ queryKey: queryKeys.trading.orders(mode) });
      const prev = qc.getQueryData<Order[]>(queryKeys.trading.orders(mode));
      if (prev) {
        qc.setQueryData(
          queryKeys.trading.orders(mode),
          prev.map((o) => (o.id === orderId ? { ...o, status: "CANCELLED" } : o)),
        );
      }
      return { prev };
    },
    onError: (_err, { mode }, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.trading.orders(mode), ctx.prev);
    },
    onSettled: (_data, _err, { mode }) => {
      qc.invalidateQueries({ queryKey: queryKeys.trading.orders(mode) });
    },
  });
}

export function useClosePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      positionId,
      mode,
      quantity,
    }: {
      positionId: string;
      mode: TradingMode;
      quantity?: number;
    }) => api.closePosition(positionId, mode, quantity),
    onSuccess: (_data, { mode }) => {
      qc.invalidateQueries({ queryKey: queryKeys.trading.positions(mode) });
      qc.invalidateQueries({ queryKey: queryKeys.accounts.detail(mode) });
      qc.invalidateQueries({ queryKey: ["tradeHistory", mode] });
    },
  });
}

/** TP/SL editing on an open position isn't wired to OKX yet (needs conditional/algo
 * orders) — this mutation always rejects so callers surface a clear error. */
export function useModifyPosition() {
  return useMutation({
    mutationFn: (_vars: {
      positionId: string;
      mode: TradingMode;
      modifications: { takeProfit?: number | null; stopLoss?: number | null };
    }) => Promise.reject(new Error("Modifying take-profit/stop-loss isn't supported yet")),
  });
}

export function useCloseAllPositions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mode, positionIds }: { mode: TradingMode; positionIds: string[] }) =>
      Promise.all(positionIds.map((id) => api.closePosition(id, mode))),
    onSuccess: (_data, { mode }) => {
      qc.invalidateQueries({ queryKey: queryKeys.trading.positions(mode) });
      qc.invalidateQueries({ queryKey: queryKeys.accounts.detail(mode) });
    },
  });
}

// ── Leaderboard & Competitions ──
export function useLeaderboard(period?: string) {
  return useQuery({
    queryKey: ["leaderboard", period],
    queryFn: () => api.getLeaderboard(period),
    staleTime: 30_000,
  });
}

export function useFirmLeaderboard(period?: string) {
  return useQuery({
    queryKey: ["firm-leaderboard", period],
    queryFn: () => api.getFirmLeaderboard(period),
    staleTime: 30_000,
  });
}

export function useLeaderboardStats(period?: string) {
  return useQuery({
    queryKey: ["leaderboard-stats", period],
    queryFn: () => api.getLeaderboardStats(period),
    staleTime: 30_000,
  });
}

export function useLeaderboardPrizes() {
  return useQuery({
    queryKey: ["leaderboard-prizes"],
    queryFn: () => api.getLeaderboardPrizes(),
    staleTime: 60_000,
  });
}

export function useMyLeaderboardRank(period?: string) {
  return useQuery({
    queryKey: ["my-leaderboard-rank", period],
    queryFn: () => api.getMyLeaderboardRank(period),
    staleTime: 15_000,
  });
}

export function useMyAwards() {
  return useQuery({
    queryKey: ["my-awards"],
    queryFn: () => api.getMyAwards(),
    staleTime: 30_000,
  });
}

// ── Competition Enrollment ──
export function useActiveCompetitions() {
  return useQuery({
    queryKey: ["active-competitions"],
    queryFn: () => api.getActiveCompetitions(),
    staleTime: 30_000,
  });
}

export function useMyCompetitionEntries() {
  return useQuery({
    queryKey: ["my-competition-entries"],
    queryFn: () => api.getMyCompetitionEntries(),
    staleTime: 30_000,
  });
}

export function useCompetitionRankings(competitionId: string | undefined, limit?: number) {
  return useQuery({
    queryKey: ["competition-rankings", competitionId, limit],
    queryFn: () => api.getCompetitionRankings(competitionId!, limit),
    enabled: !!competitionId,
    staleTime: 30_000,
  });
}

export function useEnrollInCompetition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (competitionId: string) => api.enrollInCompetition(competitionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["active-competitions"] });
      qc.invalidateQueries({ queryKey: ["my-competition-entries"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

// ── Certificates ──
export function useMyCertificates() {
  return useQuery({
    queryKey: ["my-certificates"],
    queryFn: () => api.getMyCertificates(),
    staleTime: 60_000,
  });
}

// ── Support Tickets ──
export function useMyTickets() {
  return useQuery({
    queryKey: ["my-tickets"],
    queryFn: () => api.getMyTickets(),
    staleTime: 10_000,
  });
}

export function useTicketDetail(id: string | null) {
  return useQuery({
    queryKey: ["ticket", id],
    queryFn: () => api.getTicket(id!),
    enabled: !!id,
    staleTime: 5_000,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      subject: string;
      message: string;
      category?: string;
      priority?: string;
      accountId?: string | null;
    }) => api.createTicket(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-tickets"] }),
  });
}

export function useReplyToTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      message,
      attachments,
    }: {
      id: string;
      message: string;
      attachments?: string[];
    }) => api.replyToTicket(id, message, attachments),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ["ticket", v.id] }),
  });
}

export function useCloseTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.closeTicket(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-tickets"] }),
  });
}

// ── Coupon ──
export function useValidateCoupon() {
  return useMutation({
    mutationFn: (code: string) => api.validateCoupon(code),
  });
}

// ── Trade Journal (#26) ──
export function useJournalEntries(accountId: string | null, opts?: { symbol?: string }) {
  return useQuery<JournalEntriesResponse>({
    queryKey: ["journal", accountId, opts?.symbol] as const,
    queryFn: () => api.getJournalEntries(accountId!, { limit: 100, symbol: opts?.symbol }),
    enabled: !!accountId,
    staleTime: 10_000,
  });
}

export function useCreateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof api.createJournalEntry>[0]) =>
      api.createJournalEntry(data),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["journal", vars.accountId] }),
  });
}

export function useUpdateJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      accountId: string;
      emotion?: string;
      rating?: number;
      tags?: string[];
      notes?: string;
    }) => api.updateJournalEntry(id, data),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["journal", vars.accountId] }),
  });
}

export function useDeleteJournalEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; accountId: string }) => api.deleteJournalEntry(id),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["journal", vars.accountId] }),
  });
}

// ── Analytics ──
export function useAnalyticsSnapshots(
  accountId: string | null,
  opts?: { startDate?: string; endDate?: string; page?: number; limit?: number },
) {
  return useQuery({
    queryKey: ["analytics", "snapshots", accountId, opts] as const,
    queryFn: () =>
      api.getAnalyticsSnapshots({
        accountId: accountId || undefined,
        ...opts,
      }),
    enabled: !!accountId,
    staleTime: 30_000,
  });
}

export function useAnalyticsAggregate(accountId: string | null) {
  return useQuery({
    queryKey: ["analytics", "aggregate", accountId] as const,
    queryFn: () => api.getAnalyticsAggregate(accountId || undefined),
    enabled: !!accountId,
    staleTime: 30_000,
  });
}

// ── Pattern Detection ──
export function usePatternDetection(accountId: string | null, lookbackDays?: number) {
  return useQuery({
    queryKey: ["patterns", accountId, lookbackDays] as const,
    queryFn: () => api.getPatterns(accountId!, lookbackDays),
    enabled: !!accountId,
    staleTime: 60_000,
  });
}

/** Amending a pending order isn't wired to OKX yet — cancel and re-place instead. */
export function useModifyOrder() {
  return useMutation({
    mutationFn: (_vars: {
      orderId: string;
      mode: TradingMode;
      modifications: { price?: number; quantity?: number };
    }) => Promise.reject(new Error("Modifying orders isn't supported yet — cancel and re-place instead")),
  });
}

// ── Firm Branding ──
// Hostname-scoped so visiting the demo site or another firm never contaminates
// a real firm's cached branding.
const FIRM_CACHE_KEY = `propsim:firm-cache:v2:${typeof window !== "undefined" ? window.location.hostname : "ssr"}`;

type CachedFirm = { data: unknown; cachedAt: number };

function readCachedFirm(): unknown | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(FIRM_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CachedFirm;
    return parsed?.data;
  } catch {
    return undefined;
  }
}

function writeCachedFirm(data: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FIRM_CACHE_KEY,
      JSON.stringify({ data, cachedAt: Date.now() } satisfies CachedFirm),
    );
  } catch {
    // ignore quota / privacy-mode errors
  }
}

export function useMyFirm() {
  return useQuery({
    queryKey: ["my-firm"],
    queryFn: async () => {
      const fresh = await api.getMyFirm();
      writeCachedFirm(fresh);
      return fresh;
    },
    staleTime: 300_000,
    gcTime: Infinity,
    // Lazy: only read localStorage once per QueryClient cache miss, not every render.
    initialData: () => readCachedFirm() as Awaited<ReturnType<typeof api.getMyFirm>> | undefined,
    // Treat hydrated cache as stale so we refetch in the background on mount.
    initialDataUpdatedAt: 0,
  });
}

// ── Feature Flags (trader-accessible) ──
export function useFeatureFlags() {
  return useQuery<Record<string, boolean>>({
    queryKey: ["feature-flags"],
    queryFn: () => api.getFeatureFlags(),
    staleTime: 300_000, // cache 5 min — flags rarely change
    retry: 1,
  });
}

// ── AI Trader ──
export function useAiTraderEnabled() {
  return useQuery({
    queryKey: ["ai-trader", "enabled"] as const,
    queryFn: () => api.isAiTraderEnabled(),
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });
}

export function useAiTraderHistory(accountId: string | null) {
  return useQuery({
    queryKey: ["ai-trader", "history", accountId] as const,
    queryFn: () => api.getAiTraderHistory(accountId!),
    enabled: !!accountId,
    staleTime: 30_000,
  });
}

export function useCreateAiTraderPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      accountId: string;
      message: string;
      context?: {
        selectedSymbol?: string;
        timezone?: string;
        deterministicMode?: boolean;
        readOnlyMode?: boolean;
      };
    }) => api.createAiTraderPlan(data),
    onSuccess: (result, vars) => {
      qc.invalidateQueries({
        queryKey: ["ai-trader", "history", vars.accountId],
      });
      // If auto-executed, also refresh trading data
      if (result?.autoExecuted) {
        qc.invalidateQueries({
          queryKey: queryKeys.trading.positions(vars.accountId),
        });
        qc.invalidateQueries({
          queryKey: queryKeys.trading.orders(vars.accountId),
        });
        qc.invalidateQueries({
          queryKey: queryKeys.accounts.detail(vars.accountId),
        });
      }
    },
  });
}

export function useExecuteAiTraderPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { planId: string; accountId: string; confirm: true }) =>
      api.executeAiTraderPlan(data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({
        queryKey: ["ai-trader", "history", vars.accountId],
      });
      qc.invalidateQueries({
        queryKey: queryKeys.trading.positions(vars.accountId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.trading.orders(vars.accountId),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.accounts.detail(vars.accountId),
      });
    },
  });
}

export function useClearAiTraderHistory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => api.clearAiTraderHistory(accountId),
    onSuccess: (_d, accountId) =>
      qc.invalidateQueries({ queryKey: ["ai-trader", "history", accountId] }),
  });
}

// ─── Bot Activity ────────────────────────────────────────────────

export function useBotActivityLogs(limit = 50) {
  return useQuery({
    queryKey: ["bot-activity", "logs"],
    queryFn: () => api.getBotActivityLogs(limit),
    refetchInterval: 10_000, // Auto-refresh every 10s
    staleTime: 5_000,
  });
}

export function useBotStatus() {
  return useQuery({
    queryKey: ["bot-activity", "status"],
    queryFn: () => api.getBotStatus(),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useConnectBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.connectBot(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-activity"] });
    },
  });
}

export function useDisconnectBot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.disconnectBot(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bot-activity"] });
    },
  });
}

// ─── Push Notifications ──────────────────────────────────────────

export function useVapidPublicKey() {
  return useQuery({
    queryKey: ["push", "vapid-key"],
    queryFn: () => api.getVapidPublicKey(),
    staleTime: Infinity,
  });
}

export function usePushSubscriptions() {
  return useQuery({
    queryKey: ["push", "subscriptions"],
    queryFn: () => api.getPushSubscriptions(),
  });
}

export function useSubscribePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
      api.subscribePush(sub),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push", "subscriptions"] }),
  });
}

export function useUnsubscribePush() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (endpoint: string) => api.unsubscribePush(endpoint),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["push", "subscriptions"] }),
  });
}

export function useSendTestNotification() {
  return useMutation({
    mutationFn: () => api.sendTestNotification(),
  });
}

// ─── Bot Integrations (Discord/Telegram) ─────────────────────────

export function useBotIntegrations() {
  return useQuery({
    queryKey: ["features", "bot-integrations"],
    queryFn: () => api.getBotIntegrations(),
  });
}

export function useCreateBotIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      platform: "discord" | "telegram";
      webhookUrl: string;
      chatId?: string;
      events: string[];
    }) => api.createBotIntegration(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", "bot-integrations"] }),
  });
}

export function useUpdateBotIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: { id: string } & Partial<{
      webhookUrl: string;
      chatId: string;
      events: string[];
      isActive: boolean;
    }>) => api.updateBotIntegration(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", "bot-integrations"] }),
  });
}

export function useDeleteBotIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteBotIntegration(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", "bot-integrations"] }),
  });
}

export function useTestBotIntegration() {
  return useMutation({
    mutationFn: (platform: string) => api.testBotIntegration(platform),
  });
}

// ─── Public Trader Profiles ──────────────────────────────────────

export function useMyProfile() {
  return useQuery({
    queryKey: ["features", "my-profile"],
    queryFn: () => api.getMyProfile(),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      displayName: string;
      bio?: string;
      avatarUrl?: string;
      isVisible?: boolean;
      showStats?: boolean;
      showEquityCurve?: boolean;
      socialLinks?: Record<string, string>;
    }) => api.updateProfile(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", "my-profile"] }),
  });
}

export function usePublicProfiles(page?: number) {
  return useQuery({
    queryKey: ["features", "public-profiles", page],
    queryFn: () => api.getPublicProfiles(page),
  });
}

export function usePublicProfile(userId: string) {
  return useQuery({
    queryKey: ["features", "public-profile", userId],
    queryFn: () => api.getPublicProfile(userId),
    enabled: !!userId,
  });
}

// ─── Scaling Plans ───────────────────────────────────────────────

export function useScalingPlans() {
  return useQuery({
    queryKey: ["features", "scaling-plans"],
    queryFn: () => api.getScalingPlans(),
  });
}

export function useCreateScalingPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      milestones: Array<{
        targetPnl: number;
        scalePercent: number;
        minDays: number;
        label: string;
      }>;
      isDefault?: boolean;
    }) => api.createScalingPlan(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", "scaling-plans"] }),
  });
}

export function useScalingProgress(accountId: string) {
  return useQuery({
    queryKey: ["features", "scaling-progress", accountId],
    queryFn: () => api.getScalingProgress(accountId),
    enabled: !!accountId,
  });
}

export function useEnrollScaling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { accountId: string; scalingPlanId: string }) =>
      api.enrollScaling(data.accountId, data.scalingPlanId),
    onSuccess: (_d, vars) =>
      qc.invalidateQueries({ queryKey: ["features", "scaling-progress", vars.accountId] }),
  });
}

// ─── Profit Split Escalation ─────────────────────────────────────

export function useProfitSplitConfig() {
  return useQuery({
    queryKey: ["features", "profit-split-config"],
    queryFn: () => api.getProfitSplitConfig(),
  });
}

export function useUpdateProfitSplitConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tiers: Array<{ minPayouts: number; splitPercent: number; label: string }>) =>
      api.updateProfitSplitConfig(tiers),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", "profit-split-config"] }),
  });
}

export function useMyProfitSplit() {
  return useQuery({
    queryKey: ["features", "my-profit-split"],
    queryFn: () => api.getMyProfitSplit(),
  });
}

// ─── Account Merge ───────────────────────────────────────────────

export function useRequestAccountMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { sourceAccountId: string; targetAccountId: string; reason?: string }) =>
      api.requestAccountMerge(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", "merge-requests"] }),
  });
}

export function useMergeRequests() {
  return useQuery({
    queryKey: ["features", "merge-requests"],
    queryFn: () => api.getMergeRequests(),
  });
}

export function useProcessMergeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { id: string; status: "APPROVED" | "REJECTED"; adminNotes?: string }) =>
      api.processMergeRequest(data.id, data.status, data.adminNotes),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["features", "merge-requests"] }),
  });
}

// ── Daily PNL Calendar ─────────────────────────────────
export function useDailyPnl(
  accountIds: string[],
  from: string,
  to: string,
): ReturnType<typeof useQuery<PnlCalendarResponse>> {
  return useQuery<PnlCalendarResponse>({
    queryKey: ["daily-pnl", accountIds.slice().sort().join(","), from, to],
    queryFn: () => api.getDailyPnl(accountIds, from, to),
    enabled: accountIds.length > 0 && !!from && !!to,
    staleTime: 60_000,
  });
}

// ── Firm Announcements ──────────────────────────────────

export function useAnnouncements(page = 1) {
  return useQuery({
    queryKey: ["announcements", page] as const,
    queryFn: () => api.getAnnouncements(page),
    staleTime: 30_000,
  });
}

export function useAnnouncementsUnreadCount() {
  return useQuery({
    queryKey: ["announcements", "unread-count"] as const,
    queryFn: () => api.getAnnouncementsUnreadCount(),
    staleTime: 30_000,
    refetchInterval: 60_000, // poll every minute for badge updates
  });
}

export function useMarkAnnouncementRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markAnnouncementRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
  });
}

export function useMarkAllAnnouncementsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllAnnouncementsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
  });
}
