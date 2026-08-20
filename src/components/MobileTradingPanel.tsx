/**
 * ─── Mobile Trading Panel ────────────────────────────────────────
 * Touch-optimized quick-order entry panel for mobile devices.
 * Provides large tap targets, swipeable panels, and quick preset
 * lot sizes for one-tap order placement.
 */
import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useInstrumentLabels } from "../hooks/useInstrumentLabels.ts";

interface MobilePosition {
  id: string;
  symbol?: string;
  symbolName?: string;
  side?: "LONG" | "SHORT" | "BUY" | "SELL";
  pnl?: number;
  unrealizedPnl?: number;
  quantity?: number;
  entryPrice?: number;
  [key: string]: unknown;
}

interface MobileTradingPanelProps {
  symbol: string;
  bid?: number;
  ask?: number;
  spread?: number;
  accountBalance?: number;
  onPlaceOrder: (order: {
    side: "BUY" | "SELL";
    quantity: number;
    type: "MARKET" | "LIMIT";
    price?: number;
    symbol: string;
  }) => void;
  positions: MobilePosition[];
  onClosePosition?: (positionId: string) => void;
  onCloseAllPositions?: () => void;
  /** ID of the position currently being closed — disables that row's Close button */
  closingPositionId?: string | null;
  /** True while close-all is in flight — disables the Close All button */
  closingAll?: boolean;
}

type Tab = "order" | "positions" | "alerts";

const LOT_PRESETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1.0];
const TABS: Tab[] = ["order", "positions", "alerts"];

export function MobileTradingPanel({
  symbol,
  bid = 0,
  ask = 0,
  spread: spreadProp,
  accountBalance = 0,
  onPlaceOrder,
  positions,
  onClosePosition,
  onCloseAllPositions,
  closingPositionId = null,
  closingAll = false,
}: MobileTradingPanelProps) {
  const { formatQty } = useInstrumentLabels();
  const spread = spreadProp ?? ask - bid;
  const [activeTab, setActiveTab] = useState<Tab>("order");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [quantity, setQuantity] = useState(0.1);
  const [limitPrice, setLimitPrice] = useState<string>("");

  // Swipe tracking
  const touchStartX = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]!.clientX;
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      const dx = e.changedTouches[0]!.clientX - touchStartX.current;
      if (Math.abs(dx) > 60) {
        const currentIdx = TABS.indexOf(activeTab);
        if (dx > 0 && currentIdx > 0) {
          setActiveTab(TABS[currentIdx - 1]!);
        } else if (dx < 0 && currentIdx < TABS.length - 1) {
          setActiveTab(TABS[currentIdx + 1]!);
        }
      }
    },
    [activeTab],
  );

  const handleOrder = (side: "BUY" | "SELL") => {
    onPlaceOrder({
      side,
      quantity,
      type: orderType,
      symbol,
      price: orderType === "LIMIT" && limitPrice ? Number(limitPrice) : undefined,
    });
  };

  const totalPnl = positions.reduce((sum: number, p) => sum + (p.pnl ?? p.unrealizedPnl ?? 0), 0);
  const openPositionCount = positions.filter((p) => (p.symbol ?? p.symbolName) === symbol).length;

  return (
    <div
      className="md:hidden flex flex-col bg-card border-t border-border safe-area-bottom"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {[
          { key: "order" as const, label: "Order" },
          { key: "positions" as const, label: `Positions (${positions.length})` },
          { key: "alerts" as const, label: "Alerts" },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition",
              activeTab === tab.key
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ORDER TAB */}
      {activeTab === "order" && (
        <div className="p-3 space-y-3">
          {/* Symbol + Spread */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-foreground">{symbol}</span>
            <span className="text-xs text-muted-foreground">
              Spread: <span className="text-warning">{spread.toFixed(1)} pts</span>
            </span>
          </div>

          {/* Order type selector */}
          <div className="flex gap-1.5">
            {(["MARKET", "LIMIT"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-xs font-medium transition",
                  orderType === t ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                )}
              >
                {t}
              </button>
            ))}
            <button
              disabled
              title="OKX conditional orders aren't wired up yet"
              className="flex-1 py-2 rounded-lg text-xs font-medium bg-secondary text-muted-foreground opacity-50"
            >
              STOP
            </button>
          </div>

          {/* Limit price input */}
          {orderType === "LIMIT" && (
            <div>
              <label htmlFor="mobile-limit-price" className="text-xs text-muted-foreground mb-1 block">
                Limit Price
              </label>
              <input
                id="mobile-limit-price"
                type="number"
                step="any"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={bid.toFixed(5)}
                className="w-full px-3 py-2.5 bg-input border border-border rounded-lg text-foreground text-sm font-mono text-center focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          {/* Lot size presets */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Lot Size: <span className="text-foreground font-mono">{quantity}</span>
            </label>
            <div className="grid grid-cols-3 min-[400px]:grid-cols-6 gap-1.5">
              {LOT_PRESETS.map((lot) => (
                <button
                  key={lot}
                  onClick={() => setQuantity(lot)}
                  className={cn(
                    "py-2.5 rounded-lg text-xs font-mono font-medium transition active:scale-95",
                    quantity === lot
                      ? "bg-primary text-primary-foreground ring-1 ring-primary/60"
                      : "bg-secondary text-foreground",
                  )}
                >
                  {lot}
                </button>
              ))}
            </div>
            {/* Custom input */}
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 0.01)}
              className="w-full mt-2 px-3 py-2 bg-input border border-border rounded-lg text-foreground text-sm font-mono text-center focus:ring-2 focus:ring-primary"
            />
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Stop-loss/take-profit aren't supported yet — OKX conditional orders aren't wired up.
          </p>

          {/* BUY / SELL buttons — large touch targets */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleOrder("SELL")}
              className="py-4 rounded-lg bg-sell hover:bg-sell/90 active:bg-sell/80 active:scale-[0.98] text-white font-bold transition-all"
            >
              <div className="text-lg">SELL</div>
              <div className="text-xs font-mono opacity-80">{bid.toFixed(5)}</div>
            </button>
            <button
              onClick={() => handleOrder("BUY")}
              className="py-4 rounded-lg bg-buy hover:bg-buy/90 active:bg-buy/80 active:scale-[0.98] text-white font-bold transition-all"
            >
              <div className="text-lg">BUY</div>
              <div className="text-xs font-mono opacity-80">{ask.toFixed(5)}</div>
            </button>
          </div>

          {/* Account info */}
          <div className="flex justify-between text-xs text-muted-foreground pt-1">
            <span>
              Balance: ${accountBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span>Open: {openPositionCount} pos</span>
          </div>
        </div>
      )}

      {/* POSITIONS TAB */}
      {activeTab === "positions" && (
        <div className="p-3 space-y-2 max-h-[50vh] overflow-y-auto">
          {positions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No open positions</div>
          ) : (
            <>
              {/* Total P&L bar */}
              <div className="flex items-center justify-between bg-secondary/60 rounded-lg p-2.5">
                <span className="text-xs text-muted-foreground">
                  Total P&L ({positions.length} positions)
                </span>
                <span
                  className={cn(
                    "font-mono font-bold text-sm",
                    totalPnl >= 0 ? "text-buy" : "text-sell",
                  )}
                >
                  {totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)}
                </span>
              </div>

              {/* Position cards */}
              {positions.map((pos) => {
                const posSymbol = pos.symbol ?? pos.symbolName ?? "";
                const posSide =
                  pos.side === "LONG" ? "BUY" : pos.side === "SHORT" ? "SELL" : pos.side;
                const posPnl = pos.pnl ?? pos.unrealizedPnl ?? 0;
                return (
                  <div
                    key={pos.id}
                    className="bg-secondary/40 border border-border rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "px-1.5 py-0.5 rounded text-xs font-bold",
                            posSide === "BUY"
                              ? "bg-buy/20 text-buy"
                              : "bg-sell/20 text-sell",
                          )}
                        >
                          {posSide}
                        </span>
                        <span className="text-sm font-medium text-foreground">{posSymbol}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatQty(pos.quantity ?? 0)}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "font-mono text-sm font-bold",
                          posPnl >= 0 ? "text-buy" : "text-sell",
                        )}
                      >
                        {posPnl >= 0 ? "+" : ""}${posPnl.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-mono">
                        Entry: {pos.entryPrice?.toFixed(5) ?? "—"}
                      </span>
                      {onClosePosition && (
                        <button
                          onClick={() => onClosePosition(pos.id)}
                          disabled={closingPositionId === pos.id || closingAll}
                          className={cn(
                            "px-3 py-1.5 rounded-lg text-xs font-medium transition active:scale-95",
                            closingPositionId === pos.id
                              ? "bg-secondary/50 text-muted-foreground cursor-not-allowed"
                              : "bg-secondary hover:bg-destructive/40 active:bg-destructive/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {closingPositionId === pos.id ? "Closing…" : "Close"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Close all button */}
              {positions.length > 1 && onCloseAllPositions && (
                <button
                  onClick={onCloseAllPositions}
                  disabled={closingAll}
                  className={cn(
                    "w-full py-3 rounded-lg text-sm font-semibold transition active:scale-[0.98]",
                    closingAll
                      ? "bg-secondary/30 text-muted-foreground cursor-not-allowed"
                      : "bg-destructive/20 hover:bg-destructive/30 active:bg-destructive/40 text-destructive",
                  )}
                >
                  {closingAll ? "Closing All…" : "Close All Positions"}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* ALERTS TAB */}
      {activeTab === "alerts" && (
        <div className="p-3 space-y-3">
          <div className="text-center py-8">
            <p className="text-muted-foreground text-sm">Price alerts coming soon</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Set alerts for price levels and get push notifications
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mobile-optimized account summary strip shown at top of trading page.
 */
export function MobileAccountBar({
  balance,
  equity,
  margin,
  pnl,
}: {
  balance: number;
  equity: number;
  margin: number;
  pnl: number;
}) {
  return (
    <div className="md:hidden flex items-center gap-2 px-2 py-1 bg-secondary/80 border-b border-border overflow-x-auto no-scrollbar">
      <div className="shrink-0">
        <div className="text-[11px] text-muted-foreground uppercase">Bal</div>
        <div className="text-[13px] font-mono font-bold text-foreground">
          ${balance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      </div>
      <div className="w-px h-5 bg-border shrink-0" />
      <div className="shrink-0">
        <div className="text-[11px] text-muted-foreground uppercase">Equity</div>
        <div className="text-[13px] font-mono font-bold text-foreground">
          ${equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      </div>
      <div className="w-px h-5 bg-border shrink-0" />
      <div className="shrink-0">
        <div className="text-[11px] text-muted-foreground uppercase">Margin</div>
        <div className="text-[13px] font-mono font-bold text-muted-foreground">
          ${margin.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
      </div>
      <div className="w-px h-5 bg-border shrink-0" />
      <div className="shrink-0">
        <div className="text-[11px] text-muted-foreground uppercase">P&L</div>
        <div
          className={cn(
            "text-[13px] font-mono font-bold",
            pnl >= 0 ? "text-buy" : "text-sell",
          )}
        >
          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

/**
 * Touch-friendly symbol selector with larger tap targets.
 */
export function MobileSymbolSelector({
  symbols,
  selected,
  onSelect,
}: {
  symbols: Array<{ symbol: string; bid?: number; ask?: number; change?: number }>;
  selected: string;
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="md:hidden overflow-x-auto no-scrollbar">
      <div className="flex gap-1.5 px-2 py-2">
        {symbols.map((s) => (
          <button
            key={s.symbol}
            onClick={() => onSelect(s.symbol)}
            className={cn(
              "shrink-0 px-3 py-2 rounded-lg text-xs transition active:scale-95",
              selected === s.symbol
                ? "bg-primary text-primary-foreground ring-1 ring-primary/60"
                : "bg-secondary text-foreground border border-border",
            )}
          >
            <div className="font-semibold">{s.symbol}</div>
            <div className="font-mono mt-0.5 text-xs opacity-75">
              {s.bid != null ? s.bid.toFixed(s.bid > 10 ? 2 : 5) : "—"}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
