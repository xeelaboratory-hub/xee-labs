import { TrendingUp, Clock, History, Globe, Bot, ChevronDown } from "lucide-react";
import { useCancelOrder, useClosePosition, useCloseAllPositions, useTradeHistory } from "../../services/queries.ts";
import type { Order, Position, TradingMode } from "../../services/schemas.ts";
import { Button } from "../../components/ui/button.tsx";
import { AiTraderPanel } from "../AiTraderPage.tsx";
import { TradingViewEconomicCalendar } from "../../components/TradingViewWidgets.tsx";
import { toast } from "../../services/toast.ts";
import { formatCurrency, formatNumber, formatDate, cn, pnlClass } from "../../lib/utils.ts";
import { PositionsTable } from "./PositionsTable.tsx";
import { OrdersTable } from "./OrdersTable.tsx";
import { computeLivePnl, computeLivePrice } from "../../lib/livePnl.ts";
import { useTradingStore } from "../../services/store.tsx";
import { useThemeStore } from "../../services/themeStore.ts";

type TradingActionError = {
  error?: { message?: string };
  message?: string;
};

function getErrorMessage(error: unknown): string {
  const actionError = error as TradingActionError;
  return actionError.error?.message || actionError.message || "Request failed";
}

export interface BottomPanelProps {
  tab: "positions" | "orders" | "history" | "calendar" | "ai-trader";
  onTabChange: (t: "positions" | "orders" | "history" | "calendar" | "ai-trader") => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  positions: Position[];
  orders: Order[];
  mode: TradingMode;
  onModifyPosition?: (position: Position) => void;
  onModifyOrder?: (order: Order) => void;
  onSelectPositionSymbol?: (symbolName: string) => void;
  onSelectOrderSymbol?: (symbolName: string) => void;
  aiTraderEnabled?: boolean;
  height?: number;
  isFeedConnected?: boolean;
}

export function BottomPanel({
  tab,
  onTabChange,
  collapsed = false,
  onToggleCollapsed,
  positions,
  orders,
  mode,
  onModifyPosition,
  onModifyOrder,
  onSelectPositionSymbol,
  onSelectOrderSymbol,
  aiTraderEnabled,
  height = 220,
  isFeedConnected = true,
}: BottomPanelProps) {
  const cancelOrder = useCancelOrder();
  const closePosition = useClosePosition();
  const closeAllPositions = useCloseAllPositions();

  const handleCancel = (orderId: string) => {
    if (!isFeedConnected) {
      toast.warning("No Data Feed", "Cannot cancel orders while disconnected");
      return;
    }
    if (cancelOrder.isPending) return;
    const symbol = orders.find((o) => o.id === orderId)?.symbolName;
    if (!symbol) return;
    cancelOrder.mutate(
      { orderId, mode, symbol },
      {
        onSuccess: () => toast.info("Order Cancelled", "Pending order has been cancelled"),
        onError: (err: unknown) => toast.error("Cancel Failed", getErrorMessage(err)),
      },
    );
  };

  const handleClosePosition = (positionId: string) => {
    if (!isFeedConnected) {
      toast.warning("No Data Feed", "Cannot close positions while disconnected");
      return;
    }
    if (closePosition.isPending) return;
    closePosition.mutate(
      { positionId, mode },
      {
        onSuccess: () => toast.success("Position Closed", "Position has been closed"),
        onError: (err: unknown) => toast.error("Close Failed", getErrorMessage(err)),
      },
    );
  };

  const handlePartialClose = (positionId: string, quantity: number) => {
    if (!isFeedConnected) {
      toast.warning("No Data Feed", "Cannot close positions while disconnected");
      return;
    }
    if (closePosition.isPending) return;
    closePosition.mutate(
      { positionId, mode, quantity },
      {
        onSuccess: () =>
          toast.success("Partial Close", `Closed ${quantity} lot(s) of the position`),
        onError: (err: unknown) => toast.error("Partial Close Failed", getErrorMessage(err)),
      },
    );
  };

  const handleCloseAll = () => {
    if (!isFeedConnected) {
      toast.warning("No Data Feed", "Cannot close positions while disconnected");
      return;
    }
    closeAllPositions.mutate(
      { mode, positionIds: positions.filter((p) => p.quantity > 0).map((p) => p.id) },
      {
        onSuccess: () => toast.success("All Closed", "All positions have been closed"),
        onError: (err: unknown) => toast.error("Close All Failed", getErrorMessage(err)),
      },
    );
  };

  const ticks = useTradingStore((s) => s.ticks);
  const openPositions = positions
    .filter((position) => position.quantity > 0)
    .map((p) => {
      const tick = ticks[p.symbolName];
      if (!tick) return p;
      return {
        ...p,
        currentPrice: computeLivePrice(p, tick),
        unrealizedPnl: computeLivePnl(p, tick),
      };
    });
  const pendingOrders = orders.filter(
    (order) => order.status === "PENDING" || order.status === "NEW",
  );
  const totalPnl = openPositions.reduce((sum, position) => sum + (position.unrealizedPnl || 0), 0);

  const tabs: {
    key: typeof tab;
    label: string;
    icon: typeof Clock;
    count?: number;
  }[] = [
    { key: "positions", label: "Positions", icon: TrendingUp, count: openPositions.length },
    { key: "orders", label: "Orders", icon: Clock, count: pendingOrders.length },
    { key: "history", label: "Trade History", icon: History },
    { key: "calendar", label: "Calendar", icon: Globe },
    ...(aiTraderEnabled ? [{ key: "ai-trader" as const, label: "AI Trader", icon: Bot }] : []),
  ];

  return (
    <div
      className="relative border-t border-border flex flex-col shrink-0 bg-card max-h-[150px] md:max-h-none"
      style={{ height: collapsed ? 31 : height }}
    >
      {/* Tab bar */}
      <div className="relative flex items-center gap-0.5 px-2 py-1 border-b border-border bg-secondary text-xs overflow-x-auto no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => t.key !== tab && onTabChange(t.key)}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1 rounded shrink-0 whitespace-nowrap",
              tab === t.key
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-3 w-3" />
            <span className="hidden md:inline">{t.label}</span>
            {t.count !== undefined && t.count > 0 && (
              <span className="bg-primary text-primary-foreground rounded-full px-1.5 text-[11px]">
                {t.count}
              </span>
            )}
          </button>
        ))}

        {onToggleCollapsed && (
          <button
            type="button"
            title={collapsed ? "Expand bottom panel" : "Collapse bottom panel"}
            aria-expanded={!collapsed}
            onClick={onToggleCollapsed}
            className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-md border border-border bg-card px-1.5 py-0.5 text-muted-foreground shadow-sm hover:text-foreground"
          >
            <ChevronDown
              className={cn("h-7 w-7 transition-transform", collapsed && "rotate-180")}
            />
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {tab === "positions" && openPositions.length > 0 && (
            <>
              <span className={cn("font-mono text-xs font-semibold", pnlClass(totalPnl))}>
                P&L: {totalPnl >= 0 ? "+" : ""}
                {formatCurrency(totalPnl)}
              </span>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleCloseAll}
                className="text-xs h-5"
                disabled={closeAllPositions.isPending || !isFeedConnected}
              >
                Close All
              </Button>
            </>
          )}
          {(tab === "positions" || tab === "orders" || tab === "history") &&
            !(tab === "positions" && openPositions.length > 0) && (
              <span className="text-xs text-muted-foreground font-mono px-2 uppercase">
                {mode}
              </span>
            )}
        </div>
      </div>

      {/* Content */}
      <div className={cn("flex-1 overflow-auto", collapsed && "hidden")}>
        {tab === "positions" && (
          <PositionsTable
            positions={openPositions}
            onClose={handleClosePosition}
            onModify={onModifyPosition as unknown as ((p: { id: string }) => void) | undefined}
            onPartialClose={handlePartialClose}
            onSelectSymbol={onSelectPositionSymbol}
          />
        )}
        {tab === "orders" && (
          <OrdersTable
            orders={pendingOrders}
            onCancel={handleCancel}
            onModify={onModifyOrder as unknown as ((order: { id: string }) => void) | undefined}
            onSelectSymbol={onSelectOrderSymbol}
          />
        )}
        {tab === "history" && <TradeHistoryTable mode={mode} />}
        {tab === "calendar" && <EconomicCalendar />}
        {tab === "ai-trader" && <AiTraderPanel mode={mode} />}
      </div>
    </div>
  );
}

// ── Trade History Table ──────────────────────────────────────
function TradeHistoryTable({ mode }: { mode: TradingMode }) {
  const { data: trades = [], isLoading } = useTradeHistory(mode);

  if (isLoading)
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        Loading...
      </div>
    );
  if (trades.length === 0)
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        No trade history yet for {mode}
      </div>
    );

  return (
    <div className="flex flex-col h-full">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-card z-10">
          <tr>
            <th>Time</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Volume</th>
            <th>Price</th>
            <th>Fee</th>
            <th>P&L</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="hover:bg-secondary/30">
              <td className="text-muted-foreground font-mono">{formatDate(t.timestamp)}</td>
              <td className="font-semibold">{t.symbolName}</td>
              <td className={t.side === "BUY" ? "text-buy" : "text-sell"}>{t.side}</td>
              <td className="font-mono">{t.quantity}</td>
              <td className="font-mono">{formatNumber(t.price, 5)}</td>
              <td className="font-mono text-muted-foreground">{t.fee.toFixed(2)}</td>
              <td className={cn("font-mono font-semibold", pnlClass(t.realizedPnl))}>
                {`${t.realizedPnl >= 0 ? "+" : ""}${t.realizedPnl.toFixed(2)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Economic Calendar ────────────────────────────────────────
function EconomicCalendar() {
  const isDark = useThemeStore((s) => s.mode === "dark");

  return (
    <TradingViewEconomicCalendar
      theme={isDark ? "dark" : "light"}
      width="100%"
      height="100%"
    />
  );
}
