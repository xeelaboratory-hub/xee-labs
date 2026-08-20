import { useCallback, useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Zap, Volume2, VolumeX } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { PanelHeader } from "../../components/PanelHeader.tsx";
import { DisconnectedTradingBanner } from "../../components/ConnectionIndicator.tsx";
import { formatCurrency, formatNumber, cn } from "../../lib/utils.ts";
import { useInstrument, usePlaceOrder } from "../../services/queries.ts";
import type { PlaceOrderInput, Symbol, TradingMode } from "../../services/schemas.ts";
import { toast } from "../../services/toast.ts";
import {
  calcStopFromMargin,
  calcTakeProfitFromRr,
  type InstrumentSpec,
  type Side,
} from "./positionBuilder.ts";

export interface PositionBuilderPreview {
  entry: number;
  stop: number;
  takeProfit: number;
  liquidation: number;
  side: Side;
}

type ConfirmableOrder = PlaceOrderInput & { _submit: () => Promise<unknown> };

export interface PositionBuilderPanelProps {
  symbol: string;
  symbolInfo?: Symbol;
  tick?: { bid: number; ask: number; timestamp: number };
  mode: TradingMode;
  accountEquity?: number;
  onPreviewChange: (preview: PositionBuilderPreview | null) => void;
  oneClick?: boolean;
  onToggleOneClick?: () => void;
  onConfirmOrder?: (order: ConfirmableOrder) => void;
  isFeedConnected?: boolean;
  soundMuted?: boolean;
  onToggleMute?: () => void;
  onOrderSuccess?: () => void;
}

interface OrderValidationInput {
  isFeedConnected: boolean;
  quantity: string;
  orderType: "MARKET" | "LIMIT";
  price: string;
}

type OrderValidationResult =
  | { ok: true; quantity: number; price?: number }
  | { ok: false; title: string; message: string };

/** Validates the final quantity/price before an order actually goes out —
 * same rules the standalone Order Panel enforced before Position Builder
 * absorbed order placement. */
export function validateOrderInput({
  isFeedConnected,
  quantity,
  orderType,
  price,
}: OrderValidationInput): OrderValidationResult {
  if (!isFeedConnected) {
    return {
      ok: false,
      title: "No Data Feed",
      message: "Cannot place orders while disconnected from the data feed",
    };
  }
  const qty = Number.parseFloat(quantity);
  if (isNaN(qty) || qty <= 0) {
    return { ok: false, title: "Invalid Quantity", message: "Quantity must be a positive number" };
  }
  if (qty > 1000) {
    return { ok: false, title: "Invalid Quantity", message: "Maximum quantity is 1000 lots" };
  }
  if (orderType === "LIMIT" && (!price || isNaN(Number.parseFloat(price)) || Number.parseFloat(price) <= 0)) {
    return { ok: false, title: "Missing Price", message: "Limit orders require a valid price" };
  }
  const parsedPrice = orderType === "LIMIT" && price ? Number.parseFloat(price) : undefined;
  return parsedPrice === undefined ? { ok: true, quantity: qty } : { ok: true, quantity: qty, price: parsedPrice };
}

/** Builds a synthetic InstrumentSpec from this app's static Symbol metadata,
 * for non-OKX symbols (or while the real OKX spec hasn't loaded yet) — lets
 * the panel still render a preview, clearly labeled approximate. */
function fallbackInstrumentFromSymbol(symbolInfo: Symbol | undefined): InstrumentSpec {
  return {
    instId: symbolInfo?.name ?? "",
    instType: "SWAP",
    ctVal: symbolInfo?.contractSize ?? 1,
    ctValCcy: "",
    lotSz: 0.001,
    minSz: 0.001,
    tickSz: symbolInfo?.tickSize ?? 0.01,
    settleCcy: "",
    quoteCcy: "",
    baseCcy: "",
    maxLever: symbolInfo?.maxLeverage ?? 1,
  };
}

export function PositionBuilderPanel({
  symbol,
  symbolInfo,
  tick,
  mode,
  accountEquity = 0,
  onPreviewChange,
  oneClick,
  onToggleOneClick,
  onConfirmOrder,
  isFeedConnected = true,
  soundMuted,
  onToggleMute,
  onOrderSuccess,
}: PositionBuilderPanelProps) {
  const isOkx = symbolInfo?.exchange === "okx";

  const [side, setSide] = useState<Side>("long");
  const [riskPercent, setRiskPercent] = useState("2");
  const [leverage, setLeverage] = useState("10");
  // Margin is no longer a manual input — it's sized directly off the risk
  // amount (Total Equity × Risk %), so the amount at stake at the stop is
  // always exactly the margin committed.
  const margin = accountEquity * ((Number(riskPercent) || 0) / 100);
  const [entryMode, setEntryMode] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [rr, setRr] = useState("2");

  // Reset the chart preview whenever the symbol changes — a stale preview
  // from the previous symbol must never linger on the new chart.
  useEffect(() => {
    onPreviewChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const { data: realInstrument, isLoading: isLoadingInstrument } = useInstrument(
    isOkx ? symbol : undefined,
  );
  const instrument = isOkx && realInstrument ? realInstrument : fallbackInstrumentFromSymbol(symbolInfo);
  const isApproximateInstrument = !(isOkx && realInstrument);

  const entry =
    entryMode === "market"
      ? side === "long"
        ? (tick?.ask ?? 0)
        : (tick?.bid ?? 0)
      : Number(limitPrice) || 0;

  const plan = calcStopFromMargin({
    side,
    entry,
    riskPercent: Number(riskPercent) || 0,
    totalEquity: accountEquity,
    margin,
    leverage: Number(leverage) || 0,
    instrument,
  });

  const tpPlan =
    plan.ok
      ? calcTakeProfitFromRr({
          side,
          entry,
          stop: plan.stop,
          rr: Number(rr) || 0,
          tickSz: instrument.tickSz,
        })
      : null;

  useEffect(() => {
    if (plan.ok && tpPlan) {
      onPreviewChange({ entry, stop: plan.stop, takeProfit: tpPlan.takeProfit, liquidation: plan.approxLiq, side });
    } else {
      onPreviewChange(null);
    }
    // onPreviewChange is a stable callback from the parent; including it
    // would re-run this effect every render since TradingPage recreates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.ok, plan.ok ? plan.stop : null, plan.ok ? plan.approxLiq : null, tpPlan?.takeProfit, entry, side]);

  const canApply = isOkx && plan.ok;
  const placeOrder = usePlaceOrder();
  const handleToggleMute = useCallback(() => onToggleMute?.(), [onToggleMute]);
  const handleToggleOneClick = useCallback(() => onToggleOneClick?.(), [onToggleOneClick]);

  const handleApply = () => {
    if (!plan.ok) return;
    const orderSide = side === "long" ? "BUY" : "SELL";
    const validation = validateOrderInput({
      isFeedConnected,
      quantity: String(plan.contracts),
      orderType: entryMode === "limit" ? "LIMIT" : "MARKET",
      price: entryMode === "limit" ? String(entry) : "",
    });
    if (!validation.ok) {
      toast.warning(validation.title, validation.message);
      return;
    }

    const input: PlaceOrderInput = {
      mode,
      symbol,
      side: orderSide,
      type: entryMode === "limit" ? "LIMIT" : "MARKET",
      quantity: validation.quantity,
    };
    if (validation.price !== undefined) input.price = validation.price;

    const doSubmit = () =>
      placeOrder.mutateAsync(input, {
        onSuccess: () => {
          toast.success("Order Sent", `${orderSide} ${formatNumber(validation.quantity, 2)} ${symbol} (${input.type})`);
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

    if (oneClick && input.type === "MARKET") {
      doSubmit().catch(() => {});
      return;
    }
    if (onConfirmOrder) {
      onConfirmOrder({ ...input, _submit: doSubmit });
      return;
    }
    doSubmit();
  };

  return (
    <div className="flex flex-col h-full" data-testid="position-builder">
      <PanelHeader
        title="TRADE SETUP"
        titleClassName="text-[13px] font-extrabold tracking-wide normal-case text-foreground"
        right={
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleToggleMute}
              className={cn(
                "flex items-center gap-1 px-1.5 py-1 rounded text-meta font-medium border transition-colors",
                !soundMuted
                  ? "bg-accent/15 text-accent border-accent/30"
                  : "text-muted-foreground border-border hover:bg-secondary",
              )}
              title={soundMuted ? "Unmute trade sounds" : "Mute trade sounds"}
            >
              {soundMuted ? <VolumeX className="h-7 w-7" /> : <Volume2 className="h-7 w-7" />}
            </button>
            <button
              onClick={handleToggleOneClick}
              className={cn(
                "flex items-center gap-1 px-1.5 py-1 rounded text-meta font-medium border transition-colors",
                oneClick
                  ? "bg-buy/15 text-buy border-buy/30"
                  : "text-muted-foreground border-border hover:bg-secondary",
              )}
              title="One-click trading: skip confirmation for market orders"
            >
              <Zap className="h-7 w-7" />
              1-Click
            </button>
          </div>
        }
      >
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-label uppercase text-muted-foreground">Balance</span>
            <span className="text-[18px] font-extrabold leading-none text-foreground font-mono">
              {formatCurrency(accountEquity)}
            </span>
          </div>
          <span className="text-xs font-semibold text-muted-foreground truncate">{symbol}</span>
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="grid grid-cols-2 gap-1">
          <Button
            variant={side === "long" ? "buy" : "outline"}
            size="sm"
            onClick={() => setSide("long")}
            className="text-xs"
          >
            <TrendingUp className="h-3 w-3 mr-1" />
            Long
          </Button>
          <Button
            variant={side === "short" ? "sell" : "outline"}
            size="sm"
            onClick={() => setSide("short")}
            className="text-xs"
          >
            <TrendingDown className="h-3 w-3 mr-1" />
            Short
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground uppercase tracking-wider">
            Risk %
            <input
              type="number"
              inputMode="decimal"
              value={riskPercent}
              onChange={(e) => setRiskPercent(e.target.value)}
              className="w-full mt-1 text-sm font-mono"
              step="0.1"
              min="0"
            />
          </label>
          <label className="text-xs text-muted-foreground uppercase tracking-wider">
            Leverage
            <input
              type="number"
              inputMode="decimal"
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
              className="w-full mt-1 text-sm font-mono"
              step="1"
              min="0"
            />
            {instrument.maxLever > 0 && (
              <i className="block text-[11px] not-italic text-muted-foreground mt-0.5">
                max {instrument.maxLever}x
              </i>
            )}
          </label>
        </div>

        <div>
          <label className="text-xs text-muted-foreground uppercase tracking-wider">Entry</label>
          <div className="grid grid-cols-2 gap-1 mt-1">
            <button
              onClick={() => setEntryMode("market")}
              className={cn(
                "px-1 py-1.5 text-xs rounded border border-border",
                entryMode === "market"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-secondary",
              )}
            >
              Market
            </button>
            <button
              onClick={() => setEntryMode("limit")}
              className={cn(
                "px-1 py-1.5 text-xs rounded border border-border",
                entryMode === "limit"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-secondary",
              )}
            >
              Limit
            </button>
          </div>
          {entryMode === "limit" ? (
            <input
              type="number"
              inputMode="decimal"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={tick ? formatNumber(side === "long" ? tick.ask : tick.bid, 5) : ""}
              className="w-full mt-1 text-sm font-mono"
              step="any"
            />
          ) : (
            <div className="mt-1 text-sm font-mono">{entry > 0 ? formatNumber(entry, 5) : "—"}</div>
          )}
        </div>

        <label className="block text-xs text-muted-foreground uppercase tracking-wider">
          RR (risk:reward)
          <input
            type="number"
            inputMode="decimal"
            value={rr}
            onChange={(e) => setRr(e.target.value)}
            className="w-full mt-1 text-sm font-mono"
            step="0.1"
            min="0"
          />
        </label>

        <div className="bg-secondary rounded p-2.5 text-[13px] space-y-1.5">
          {!plan.ok ? (
            <p className="text-muted-foreground">{plan.error}</p>
          ) : (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Stop Loss</span>
                <span className="text-sell font-mono">{formatNumber(plan.stop, 2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Take Profit</span>
                <span className="text-buy font-mono">
                  {tpPlan ? formatNumber(tpPlan.takeProfit, 2) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Loss at SL</span>
                <span className="font-mono">{formatCurrency(plan.riskAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Reward at TP{tpPlan ? ` (1:${formatNumber(Number(rr) || 0, 1)})` : ""}
                </span>
                <span className="text-buy font-mono">
                  {tpPlan ? formatCurrency(plan.riskAmount * (Number(rr) || 0)) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Liquidation ≈</span>
                <span className="font-mono text-orange-500">{formatNumber(plan.approxLiq, 2)}</span>
              </div>
              <p className="text-muted-foreground text-xs pt-1">
                Liquidation is a rough isolated-margin estimate — it ignores fees and
                maintenance margin.
              </p>
              {isApproximateInstrument && (
                <p className="text-muted-foreground text-xs">
                  {isOkx && isLoadingInstrument
                    ? "Loading real OKX instrument specs…"
                    : "Using approximate instrument data — not exchange-accurate."}
                </p>
              )}
              {plan.warnings.map((w) => (
                <p key={w} className="text-destructive text-xs">
                  {w}
                </p>
              ))}
            </>
          )}
        </div>

        {!isFeedConnected && <DisconnectedTradingBanner />}
        <Button
          variant={side === "long" ? "buy" : "sell"}
          className="w-full"
          onClick={handleApply}
          loading={placeOrder.isPending}
          disabled={!canApply || !isFeedConnected || placeOrder.isPending}
          title={
            !isOkx
              ? "Apply to Order is only available for OKX symbols"
              : !isFeedConnected
                ? "Cannot place orders while disconnected from the data feed"
                : undefined
          }
        >
          {placeOrder.isPending ? "Placing…" : "Apply to Order"}
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
