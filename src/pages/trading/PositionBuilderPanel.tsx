import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { PanelHeader } from "../../components/PanelHeader.tsx";
import { formatCurrency, formatNumber, cn } from "../../lib/utils.ts";
import { useInstrument } from "../../services/queries.ts";
import type { Symbol, TradingMode } from "../../services/schemas.ts";
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
  side: Side;
}

export interface PositionBuilderApplyDraft {
  side: "BUY" | "SELL";
  quantity: number;
  price?: number;
}

export interface PositionBuilderPanelProps {
  symbol: string;
  symbolInfo?: Symbol;
  tick?: { bid: number; ask: number; timestamp: number };
  mode: TradingMode;
  accountEquity?: number;
  onApplyToOrder: (draft: PositionBuilderApplyDraft) => void;
  onPreviewChange: (preview: PositionBuilderPreview | null) => void;
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
  accountEquity = 0,
  onApplyToOrder,
  onPreviewChange,
}: PositionBuilderPanelProps) {
  const isOkx = symbolInfo?.exchange === "okx";

  const [side, setSide] = useState<Side>("long");
  const [riskPercent, setRiskPercent] = useState("2");
  const [leverage, setLeverage] = useState("10");
  const [margin, setMargin] = useState("100");
  const [entryMode, setEntryMode] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [rr, setRr] = useState("2");

  // Reset the chart preview whenever the symbol changes — a stale preview
  // from the previous symbol must never linger on the new chart.
  useEffect(() => {
    onPreviewChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);
  useEffect(() => onPreviewChange(null), [onPreviewChange]);

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
    margin: Number(margin) || 0,
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
      onPreviewChange({ entry, stop: plan.stop, takeProfit: tpPlan.takeProfit, side });
    } else {
      onPreviewChange(null);
    }
    // onPreviewChange is a stable callback from the parent; including it
    // would re-run this effect every render since TradingPage recreates it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.ok, plan.ok ? plan.stop : null, tpPlan?.takeProfit, entry, side]);

  const canApply = isOkx && plan.ok;

  const handleApply = () => {
    if (!plan.ok) return;
    onApplyToOrder({
      side: side === "long" ? "BUY" : "SELL",
      quantity: plan.contracts,
      price: entryMode === "limit" ? entry : undefined,
    });
  };

  return (
    <div className="flex flex-col h-full" data-testid="position-builder">
      <PanelHeader title="Position Builder" right={<span className="text-xs font-semibold">{symbol}</span>} />

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

        <label className="block text-xs text-muted-foreground uppercase tracking-wider">
          Margin ($)
          <input
            type="number"
            inputMode="decimal"
            value={margin}
            onChange={(e) => setMargin(e.target.value)}
            className="w-full mt-1 text-sm font-mono"
            step="1"
            min="0"
          />
        </label>

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
                <span className="text-sell font-mono">{formatNumber(plan.stop, 4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Take Profit</span>
                <span className="text-buy font-mono">
                  {tpPlan ? formatNumber(tpPlan.takeProfit, 4) : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Size (contracts)</span>
                <span className="font-mono">{formatNumber(plan.contracts, 4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Base size</span>
                <span className="font-mono">{formatNumber(plan.baseSize, 6)}</span>
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
                <span className="font-mono">{formatNumber(plan.approxLiq, 4)}</span>
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

        <Button
          variant={side === "long" ? "buy" : "sell"}
          className="w-full"
          onClick={handleApply}
          disabled={!canApply}
          title={!isOkx ? "Apply to Order is only available for OKX symbols" : undefined}
        >
          Apply to Order
        </Button>
      </div>
    </div>
  );
}
