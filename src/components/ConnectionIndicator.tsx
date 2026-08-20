/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useSyncExternalStore } from "react";
import { wsClient, type ConnectionState } from "@/services/ws";
import { useMarketDataHealth } from "@/services/queries";
import type { MarketDataExchangeHealth, MarketDataHealth } from "@/services/api/market-data";
import { cn } from "@/lib/utils";
import { Wifi, WifiOff, Loader2 } from "lucide-react";

function isMarketDataHealth(health: unknown): health is MarketDataHealth {
  if (typeof health !== "object" || health === null) return false;
  return Object.values(health as Record<string, unknown>).every(
    (v) => typeof v === "object" && v !== null && typeof (v as MarketDataExchangeHealth).connected === "boolean",
  );
}

const EXCHANGE_LABELS: Record<string, string> = { binance: "Binance", okx: "OKX" };

// An exchange feed counts as stale once it's gone this long without a live
// event — well past normal per-tick cadence, short enough to surface a real
// outage quickly.
const STALE_EVENT_AGE_MS = 30_000;

interface HealthSummary {
  disconnected: string[];
  stale: string[];
  total: number;
}

function summarizeHealth(health: MarketDataHealth): HealthSummary {
  const now = Date.now();
  const entries = Object.entries(health);
  const disconnected: string[] = [];
  const stale: string[] = [];
  for (const [exchange, status] of entries) {
    if (!status.connected) {
      disconnected.push(exchange);
      continue;
    }
    if (status.lastEventAt === null || now - status.lastEventAt > STALE_EVENT_AGE_MS) {
      stale.push(exchange);
    }
  }
  return { disconnected, stale, total: entries.length };
}

// ── React Hook ──────────────────────────────────────────
function subscribeToWsState(callback: () => void) {
  return wsClient.onStateChange(() => callback());
}

function getWsSnapshot() {
  return wsClient.state;
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribeToWsState, getWsSnapshot);
}

/** True only when the WebSocket is fully authenticated and streaming data */
export function useIsFeedConnected(): boolean {
  const state = useConnectionState();
  return state === "connected";
}

// ── Stale data banner (>10s disconnected) ───────────────
export function useStaleData(): boolean {
  const state = useConnectionState();
  const { data: health } = useMarketDataHealth();
  const [stale, setStale] = useState(false);

  const marketDataInterrupted = (() => {
    if (!isMarketDataHealth(health)) return false;
    const { disconnected, stale: staleExchanges } = summarizeHealth(health);
    return disconnected.length > 0 || staleExchanges.length > 0;
  })();

  useEffect(() => {
    if (state === "connected" && !marketDataInterrupted) {
      setStale(false);
      return;
    }
    const timer = setTimeout(() => setStale(true), 10_000);
    return () => clearTimeout(timer);
  }, [marketDataInterrupted, state]);

  return stale;
}

// ── Connection Indicator Component ──────────────────────
const stateConfig = {
  connected: {
    label: "Connected",
    icon: Wifi,
    color: "text-success",
    dot: "bg-success",
  },
  connecting: {
    label: "Connecting…",
    icon: Loader2,
    color: "text-warning",
    dot: "bg-warning",
  },
  reconnecting: {
    label: "Reconnecting…",
    icon: Loader2,
    color: "text-warning",
    dot: "bg-warning",
  },
  disconnected: {
    label: "Offline",
    icon: WifiOff,
    color: "text-destructive",
    dot: "bg-destructive",
  },
} as const;

export function ConnectionIndicator({ className }: { className?: string }) {
  const state = useConnectionState();
  const { label, icon: Icon, color, dot } = stateConfig[state];
  const isSpinning = state === "connecting" || state === "reconnecting";

  return (
    <div className={cn("flex items-center gap-1.5 text-[11px]", className)} title={label}>
      <span
        className={cn("h-1.5 w-1.5 rounded-full", dot, state !== "connected" && "animate-pulse")}
      />
      <Icon className={cn("h-3 w-3", color, isSpinning && "animate-spin")} />
      <span className={cn("hidden sm:inline", color)}>{label}</span>
    </div>
  );
}

// ── Stale Data Banner ───────────────────────────────────
export function StaleDataBanner() {
  const stale = useStaleData();
  const state = useConnectionState();
  const { data: health } = useMarketDataHealth();
  if (!stale) return null;

  const message = (() => {
    if (isMarketDataHealth(health)) {
      const { disconnected, stale: staleExchanges, total } = summarizeHealth(health);
      const label = (names: string[]) => names.map((n) => EXCHANGE_LABELS[n] ?? n).join(", ");

      if (disconnected.length >= total && total > 0) {
        return "Live Feed Outage — exchange connections are down. Historical charts may still render from stored candles.";
      }
      if (disconnected.length > 0) {
        return `Feed Degraded — ${label(disconnected)} disconnected. Trading may be impacted for affected symbols.`;
      }
      if (staleExchanges.length >= total && total > 0) {
        return "Live Feed Degraded — no recent updates from any exchange. Historical charts remain available.";
      }
      if (staleExchanges.length > 0) {
        return `Feed Degraded — ${label(staleExchanges)} hasn't reported a recent update. Trading may be impacted for affected symbols.`;
      }
    }

    if (state !== "connected") {
      return "Connection Lost — live updates are paused. Historical charts remain available.";
    }

    return "Data Interruption — live market data is unavailable";
  })();

  return (
    <div className="bg-warning/10 border-b border-warning/30 px-4 py-1.5 text-center text-xs text-warning">
      {message}
    </div>
  );
}

// ── Disconnected Trading Banner (inline for order panel / bottom panel) ──
export function DisconnectedTradingBanner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center",
        className,
      )}
    >
      <div className="flex items-center justify-center gap-1.5 text-destructive text-xs font-semibold">
        <WifiOff className="h-3.5 w-3.5" />
        Data Feed Disconnected
      </div>
      <p className="text-[10px] text-muted-foreground mt-0.5">
        Trading is disabled until the connection is restored
      </p>
    </div>
  );
}
