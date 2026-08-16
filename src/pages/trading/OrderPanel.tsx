import { useState } from "react";
import { Minus, Plus, TrendingUp, TrendingDown, Zap, Volume2, VolumeX } from "lucide-react";
import { usePlaceOrder } from "../../services/queries.ts";
import { readTraderPrefs } from "../../hooks/useTraderPreferences.ts";
import { Button } from "../../components/ui/button.tsx";
import { DisconnectedTradingBanner } from "../../components/ConnectionIndicator.tsx";
import type { PlaceOrderInput, TradingMode } from "../../services/schemas.ts";
import { toast } from "../../services/toast.ts";
import { formatCurrency, formatNumber, cn } from "../../lib/utils.ts";

type ConfirmableOrder = PlaceOrderInput & { _submit: () => Promise<unknown> };

export interface OrderPanelProps {
  symbol: string;
  symbolInfo?: {
    name?: string;
    description?: string;
    pipSize?: number;
    pricescale?: number;
    contractSize?: number;
    marginPercent?: number;
    commission?: number;
    [k: string]: unknown;
  };
  tick?: { bid: number; ask: number; timestamp: number };
  mode: TradingMode;
  oneClick?: boolean;
  onToggleOneClick?: () => void;
  onConfirmOrder?: (order: ConfirmableOrder) => void;
  accountBalance?: number;
  isFeedConnected?: boolean;
  soundMuted?: boolean;
  onToggleMute?: () => void;
  onOrderSuccess?: () => void;
}

export function OrderPanel({
  symbol,
  symbolInfo,
  tick,
  mode,
  oneClick,
  onToggleOneClick,
  onConfirmOrder,
  isFeedConnected = true,
  soundMuted,
  onToggleMute,
  onOrderSuccess,
}: OrderPanelProps) {
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [quantity, setQuantity] = useState(() => {
    const prefs = readTraderPrefs();
    const raw = prefs.defaultQty;
    if (raw) {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) return String(Math.round(n * 100) / 100);
    }
    return "0.1";
  });
  const [price, setPrice] = useState("");

  const placeOrder = usePlaceOrder();

  const handleSubmit = () => {
    if (!isFeedConnected) {
      toast.warning("No Data Feed", "Cannot place orders while disconnected from the data feed");
      return;
    }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      toast.warning("Invalid Quantity", "Quantity must be a positive number");
      return;
    }
    if (qty > 1000) {
      toast.warning("Invalid Quantity", "Maximum quantity is 1000 lots");
      return;
    }
    if (orderType === "LIMIT" && (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0)) {
      toast.warning("Missing Price", "Limit orders require a valid price");
      return;
    }

    const input: PlaceOrderInput = {
      mode,
      symbol,
      side,
      type: orderType,
      quantity: qty,
    };

    if (orderType === "LIMIT" && price) input.price = parseFloat(price);

    const doSubmit = () =>
      placeOrder.mutateAsync(input, {
        onSuccess: () => {
          toast.success("Order Sent", `${side} ${qty} ${symbol} (${orderType})`);
          onOrderSuccess?.();
        },
        onError: (err: unknown) => {
          const e = err as { message?: string; code?: string };
          const msg = e?.message || "Failed to place order";
          if (e?.code === "REQUEST_TIMEOUT") {
            toast.error(
              "Order Timed Out",
              "The server didn't respond in time. Check your connection and try again.",
            );
          } else {
            toast.error("Order Failed", msg);
          }
        },
      });

    if (oneClick && orderType === "MARKET") {
      doSubmit().catch(() => {});
      return;
    }

    if (onConfirmOrder) {
      onConfirmOrder({ ...input, _submit: doSubmit });
      return;
    }

    doSubmit();
  };

  const quickQty = [0.01, 0.05, 0.1, 0.5, 1.0];

  return (
    <div className="flex flex-col h-full" data-testid="order-form">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-secondary">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          New Order
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleMute}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors",
              !soundMuted
                ? "bg-accent/15 text-accent border-accent/30"
                : "text-muted-foreground border-border hover:bg-secondary",
            )}
            title={soundMuted ? "Unmute trade sounds" : "Mute trade sounds"}
          >
            {soundMuted ? <VolumeX className="h-2.5 w-2.5" /> : <Volume2 className="h-2.5 w-2.5" />}
          </button>
          <button
            onClick={onToggleOneClick}
            className={cn(
              "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors",
              oneClick
                ? "bg-buy/15 text-buy border-buy/30"
                : "text-muted-foreground border-border hover:bg-secondary",
            )}
            title="One-click trading: skip confirmation for market orders"
          >
            <Zap className="h-2.5 w-2.5" />
            1-Click
          </button>
          <span className="text-xs font-semibold">{symbol}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Side */}
        <div className="grid grid-cols-2 gap-1">
          <Button
            variant={side === "BUY" ? "buy" : "outline"}
            size="sm"
            onClick={() => setSide("BUY")}
            className="text-xs"
          >
            <TrendingUp className="h-3 w-3 mr-1" />
            BUY {tick ? formatNumber(tick.ask, 5) : ""}
          </Button>
          <Button
            variant={side === "SELL" ? "sell" : "outline"}
            size="sm"
            onClick={() => setSide("SELL")}
            className="text-xs"
          >
            <TrendingDown className="h-3 w-3 mr-1" />
            SELL {tick ? formatNumber(tick.bid, 5) : ""}
          </Button>
        </div>

        {/* Order Type */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Order Type
          </label>
          <div className="grid grid-cols-3 gap-1 mt-1">
            {(["MARKET", "LIMIT"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={cn(
                  "px-1 py-1 text-[10px] rounded border border-border",
                  t === orderType
                    ? "bg-primary text-primary-foreground border-primary"
                    : "hover:bg-secondary",
                )}
              >
                {t}
              </button>
            ))}
            <button
              disabled
              title="OKX conditional orders aren't wired up yet"
              className="px-1 py-1 text-[10px] rounded border border-border opacity-40 cursor-not-allowed"
            >
              STOP
            </button>
          </div>
        </div>

        {/* Quantity */}
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Volume (lots)
          </label>
          <div className="flex items-center gap-1 mt-1">
            <button
              onClick={() =>
                setQuantity((v) => String(Math.max(0.01, parseFloat(v) - 0.01).toFixed(2)))
              }
              className="px-2 py-1 rounded bg-secondary hover:bg-border"
            >
              <Minus className="h-3 w-3" />
            </button>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="flex-1 text-center text-sm font-mono"
              step="0.01"
              min="0.01"
            />
            <button
              onClick={() => setQuantity((v) => String((parseFloat(v) + 0.01).toFixed(2)))}
              className="px-2 py-1 rounded bg-secondary hover:bg-border"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <div className="flex gap-1 mt-1">
            {quickQty.map((q) => (
              <button
                key={q}
                onClick={() => setQuantity(String(q))}
                className={cn(
                  "flex-1 text-[10px] py-0.5 rounded border border-border",
                  parseFloat(quantity) === q ? "bg-secondary" : "hover:bg-secondary/50",
                )}
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {orderType === "LIMIT" && (
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Price
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={tick ? formatNumber(side === "BUY" ? tick.ask : tick.bid, 5) : ""}
              className="w-full mt-1 text-sm font-mono"
              step="0.00001"
            />
          </div>
        )}

        <p className="text-[9px] text-muted-foreground text-center">
          Take-profit/stop-loss aren't supported yet — OKX conditional orders aren't wired up.
        </p>

        {/* Margin info */}
        {symbolInfo && tick && (
          <div className="bg-secondary rounded p-2 text-[10px] space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Contract Size</span>
              <span>{symbolInfo.contractSize?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Margin Required</span>
              <span>
                {formatCurrency(
                  (parseFloat(quantity) || 0) *
                    (symbolInfo.contractSize ?? 0) *
                    (side === "BUY" ? tick.ask : tick.bid) *
                    ((symbolInfo.marginPercent ?? 0) / 100),
                )}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Commission</span>
              <span>
                {formatCurrency((symbolInfo.commission ?? 0) * (parseFloat(quantity) || 0))}
              </span>
            </div>
          </div>
        )}

        {!isFeedConnected && <DisconnectedTradingBanner />}
        <Button
          variant={side === "BUY" ? "buy" : "sell"}
          className="w-full"
          onClick={handleSubmit}
          loading={placeOrder.isPending}
          disabled={placeOrder.isPending || !isFeedConnected}
        >
          {!isFeedConnected
            ? "Disconnected — Trading Disabled"
            : placeOrder.isPending
              ? "Placing…"
              : `${side === "BUY" ? "Buy" : "Sell"} ${quantity} ${symbol} (${mode})`}
        </Button>

        {placeOrder.isError && (
          <p className="text-destructive text-xs mt-1 p-1.5 bg-destructive/10 rounded">
            {(placeOrder.error as { message?: string } | null)?.message || "Order failed"}
          </p>
        )}
        {placeOrder.isSuccess && (
          <p className="text-buy text-xs mt-1 p-1.5 bg-buy/10 rounded">Order placed successfully</p>
        )}
      </div>
    </div>
  );
}
