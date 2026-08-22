import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Calculator,
  ChevronRight,
  ChevronUp,
  TrendingDown,
  TrendingUp,
  Volume2,
  VolumeX,
  Zap,
} from "lucide-react";
import { Button } from "../../components/ui/button.tsx";
import { PanelHeader } from "../../components/PanelHeader.tsx";
import { DisconnectedTradingBanner } from "../../components/ConnectionIndicator.tsx";
import { useIsDesktop } from "../../hooks/useIsDesktop.ts";
import { decimalsFromTick, formatCurrency, formatNumber, cn } from "../../lib/utils.ts";
import { mobileForm, mobileIcon, mobilePage, mobileText, mobileTouch } from "../../lib/mobile-ui.ts";
import { useAuthStore } from "../../services/store.tsx";
import { useInstrument, usePlaceOrder } from "../../services/queries.ts";
import type { PlaceOrderInput, Symbol, TradingMode } from "../../services/schemas.ts";
import { toast } from "../../services/toast.ts";
import {
  calcStopFromMargin,
  calcTakeProfitFromRr,
  type InstrumentSpec,
  type ProfileEntryLevel,
  resolveProfileEntry,
  type Side,
} from "./positionBuilder.ts";
import { validateOrderInput } from "./order-validation.ts";
import type { SessionVolumeProfileSummary } from "./useSessionVolumeProfile.ts";

// Same abbreviations the indicator's own session picker uses in ChartToolbar,
// so one session never carries two different names across the screen.
const MARKET_LABELS: Record<string, string> = {
  ASX: "ASX",
  TOKYO: "TKY",
  LONDON: "LONDON",
  NEW_YORK: "NY",
};

function formatSignedPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${formatNumber(Math.abs(value), decimals)}%`;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className={cn(mobileText.ui, "font-semibold text-foreground")}>{children}</h3>;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className={cn(mobileText.meta, "text-muted-foreground")}>{children}</span>;
}

function MobileSegmentGroup({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex rounded-md border border-border bg-background p-0.5", className)} role="group">
      {children}
    </div>
  );
}

function MobileSegmentButton({
  active,
  onClick,
  variant = "neutral",
  children,
}: {
  active: boolean;
  onClick: () => void;
  variant?: "long" | "short" | "neutral";
  children: ReactNode;
}) {
  const activeClass =
    variant === "long"
      ? "bg-buy text-white"
      : variant === "short"
        ? "bg-sell text-white"
        : "bg-secondary text-foreground font-semibold";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        mobileForm.control,
        mobileText.ui,
        "flex flex-1 items-center justify-center gap-0.5 rounded-sm leading-none transition-colors",
        active ? activeClass : "text-muted-foreground hover:bg-secondary/60",
      )}
    >
      {children}
    </button>
  );
}

function PriceFieldBox({
  children,
  suffix,
}: {
  children: ReactNode;
  suffix?: ReactNode;
}) {
  return (
    <div
      className={cn(
        mobileForm.control,
        "flex items-center justify-between gap-2 rounded border border-border bg-background px-2",
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {suffix && (
        <span className={cn(mobileText.meta, "shrink-0 rounded bg-secondary px-1.5 py-0.5 text-muted-foreground")}>
          {suffix}
        </span>
      )}
    </div>
  );
}

function CalculatedFieldRow({
  label,
  price,
  percent,
  percentClassName,
  meta,
  metaClassName,
  testId,
}: {
  label: string;
  price: string;
  percent?: string;
  percentClassName?: string;
  meta?: string;
  metaClassName?: string;
  testId?: string;
}) {
  return (
    <div className={cn("flex flex-col", mobileForm.labelGap)} data-testid={testId}>
      <FieldLabel>{label}</FieldLabel>
      <div className={cn("flex", mobileForm.rowGap)}>
        <div
          className={cn(
            mobileForm.control,
            "flex min-w-0 flex-1 items-center justify-between gap-2 rounded border border-border bg-background px-2",
          )}
        >
          <span className={cn(mobileText.primaryMono, "truncate text-foreground")}>{price}</span>
          {percent && <span className={cn(mobileText.primaryMono, "shrink-0", percentClassName)}>{percent}</span>}
        </div>
        <div
          className={cn(
            mobileForm.control,
            "flex w-11 shrink-0 items-center justify-center rounded border border-border bg-background text-muted-foreground",
          )}
          aria-hidden="true"
        >
          <Calculator className={mobileIcon.ui} />
        </div>
      </div>
      {meta && <span className={cn(mobileText.meta, metaClassName)}>{meta}</span>}
    </div>
  );
}

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
  testId,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="border-t border-border pt-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid={testId}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <SectionTitle>{title}</SectionTitle>
        <ChevronUp
          className={cn(mobileIcon.ui, "shrink-0 text-muted-foreground transition-transform", !expanded && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {expanded && <div className="mt-2 space-y-2">{children}</div>}
    </section>
  );
}

function SummaryRow({
  label,
  value,
  valueClassName,
  emphasized,
}: {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  emphasized?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className={cn(mobileText.meta, emphasized && "font-medium", "shrink-0 text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          emphasized ? mobileText.value : mobileText.primaryMono,
          "truncate text-right",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MobileVolumeProfileSection({
  volumeProfile,
  expanded,
  onToggle,
}: {
  volumeProfile: SessionVolumeProfileSummary;
  expanded: boolean;
  onToggle: () => void;
}) {
  const marketLabel = MARKET_LABELS[volumeProfile.market] ?? volumeProfile.market;
  return (
    <div className="border-t border-border pt-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid="volume-profile-toggle"
        className={cn(
          "flex w-full min-h-[40px] items-center justify-between gap-2 rounded-md py-0.5 text-left",
          mobileText.ui,
        )}
      >
        <span className={cn(mobileText.ui, "text-foreground")}>
          Volume Profile · {marketLabel}
          {volumeProfile.isDeveloping && (
            <span className={cn(mobileText.meta, "text-muted-foreground")}> · developing</span>
          )}
        </span>
        <ChevronRight
          className={cn(mobileIcon.ui, "shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")}
          aria-hidden="true"
        />
      </button>
      {expanded && (
        <div className="mt-1 space-y-0.5 border-l border-border/60 pl-2" data-testid="volume-profile-details">
          <SummaryRow label="Value Area High" value={formatNumber(volumeProfile.vah, 2)} />
          <SummaryRow
            label="Point of Control"
            value={formatNumber(volumeProfile.poc, 2)}
            valueClassName="text-warning"
          />
          <SummaryRow label="Value Area Low" value={formatNumber(volumeProfile.val, 2)} />
        </div>
      )}
    </div>
  );
}

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
  /** Opens Settings, where signing in happens. */
  onRequestSignIn?: () => void;
  onPreviewChange: (preview: PositionBuilderPreview | null) => void;
  /** Session volume profile levels, computed in ChartPanel. Read-only here —
   *  reference levels next to the plan, not inputs to it. */
  volumeProfile?: SessionVolumeProfileSummary | null;
  oneClick?: boolean;
  onToggleOneClick?: () => void;
  onConfirmOrder?: (order: ConfirmableOrder) => void;
  isFeedConnected?: boolean;
  soundMuted?: boolean;
  onToggleMute?: () => void;
  onOrderSuccess?: () => void;
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
  onRequestSignIn,
  onPreviewChange,
  volumeProfile,
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
  // Which profile level the button will apply next. Applying is a one-shot
  // snapshot, not a subscription: the developing session's POC drifts, and a
  // limit price that moves under the trader while they read the plan is worse
  // than one that is a few points old. Clicking again takes a fresh value.
  const [nextProfileLevel, setNextProfileLevel] = useState<ProfileEntryLevel>("poc");
  const [rr, setRr] = useState("2");
  const isDesktop = useIsDesktop();
  const [volumeProfileExpanded, setVolumeProfileExpanded] = useState(false);
  const [riskManagementExpanded, setRiskManagementExpanded] = useState(true);

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
  // The instrument's own tick decides how many decimals a price has. A
  // constant here rendered BTC as 77,280.30000 — four digits past anything
  // the exchange can quote, on the number the order is built from.
  const priceDigits = decimalsFromTick(instrument.tickSz);
  const isSignedIn = useAuthStore((s) => !!s.accessToken);
  const isApproximateInstrument = !(isOkx && realInstrument);

  const applyProfileLevel = () => {
    if (!volumeProfile) return;
    const { price, next } = resolveProfileEntry(nextProfileLevel, volumeProfile, instrument.tickSz);
    // Entry only reads limitPrice in limit mode — in market mode it tracks the
    // live tick, so setting a level without switching would silently do nothing.
    setEntryMode("limit");
    setLimitPrice(String(price));
    setNextProfileLevel(next);
  };

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
    // The stop this panel sized the position from — and the take-profit it
    // derived from the R:R — go out attached to the entry order rather than
    // being displayed and discarded. Without this the panel promises a
    // bracketed trade on screen and opens a naked position at OKX.
    const validation = validateOrderInput({
      isFeedConnected,
      quantity: String(plan.contracts),
      orderType: entryMode === "limit" ? "LIMIT" : "MARKET",
      price: entryMode === "limit" ? String(entry) : "",
      side: orderSide,
      stopLoss: plan.stop,
      ...(tpPlan ? { takeProfit: tpPlan.takeProfit } : {}),
      referencePrice: entry,
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
    if (validation.stopLoss !== undefined) input.stopLoss = validation.stopLoss;
    if (validation.takeProfit !== undefined) input.takeProfit = validation.takeProfit;

    const doSubmit = () =>
      placeOrder.mutateAsync(input, {
        onSuccess: (result) => {
          const bracket = [
            input.stopLoss !== undefined ? `SL ${formatNumber(input.stopLoss, 2)}` : null,
            input.takeProfit !== undefined ? `TP ${formatNumber(input.takeProfit, 2)}` : null,
          ]
            .filter(Boolean)
            .join(" / ");
          if (result?.duplicate) {
            // The submission was interrupted and the order turned out to be
            // live already. "Order Sent" here reads as a fresh order and is
            // exactly what would prompt someone to place a second one.
            toast.success(
              "Order Already Live",
              `This ${orderSide} order had already reached the exchange — nothing new was placed.`,
            );
          } else {
            toast.success(
              "Order Sent",
              `${orderSide} ${formatNumber(validation.quantity, 2)} ${symbol} (${input.type})` +
                (bracket ? ` — ${bracket}` : ""),
            );
          }
          onOrderSuccess?.();
        },
        onError: (err: unknown) => {
          const e = err as { message?: string; code?: string };
          const msg = e?.message || "Failed to place order";
          // An interrupted submission no longer surfaces as a bare timeout:
          // the facade resolves it against the exchange first, so these two
          // codes are definite answers and each carries its own instruction.
          if (e?.code === "ORDER_STATUS_UNKNOWN") {
            toast.warning("Order Status Unknown", msg);
          } else if (e?.code === "ORDER_NOT_PLACED") {
            toast.error("Order Not Placed", msg);
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

  const mobileInputClass = cn(
    "w-full rounded border border-border bg-background font-mono tabular-nums leading-none",
    mobileForm.control,
    mobileText.ui,
  );

  const exchangeLabel = (symbolInfo?.exchange ?? "OKX").toUpperCase();
  const slPct =
    plan.ok && entry > 0
      ? side === "long"
        ? -((entry - plan.stop) / entry) * 100
        : -((plan.stop - entry) / entry) * 100
      : null;
  const tpPct =
    plan.ok && tpPlan && entry > 0
      ? side === "long"
        ? ((tpPlan.takeProfit - entry) / entry) * 100
        : ((entry - tpPlan.takeProfit) / entry) * 100
      : null;
  const lev = Number(leverage) || 0;
  const rrNum = Number(rr) || 0;

  const headerControls = (
    <div className="flex items-center gap-1 shrink-0">
      <button
        onClick={handleToggleMute}
        className={cn(
          "flex items-center justify-center rounded border transition-colors",
          isDesktop
            ? "gap-1 px-1.5 py-1 text-meta font-medium"
            : cn(mobileTouch.headerIcon, "rounded-md border border-border p-0"),
          !soundMuted
            ? "bg-accent/15 text-accent border-accent/30"
            : "text-muted-foreground hover:bg-secondary",
        )}
        title={soundMuted ? "Unmute trade sounds" : "Mute trade sounds"}
        aria-label={soundMuted ? "Unmute trade sounds" : "Mute trade sounds"}
      >
        {soundMuted ? (
          <VolumeX className={isDesktop ? "h-7 w-7" : mobileIcon.ui} />
        ) : (
          <Volume2 className={isDesktop ? "h-7 w-7" : mobileIcon.ui} />
        )}
      </button>
      <button
        onClick={handleToggleOneClick}
        className={cn(
          "flex items-center justify-center rounded border transition-colors",
          isDesktop
            ? "gap-1 px-1.5 py-1 text-meta font-medium"
            : cn(mobileTouch.headerIcon, "rounded-md border border-border p-0"),
          oneClick
            ? "bg-buy/15 text-buy border-buy/30"
            : "text-muted-foreground hover:bg-secondary",
        )}
        title="One-click trading: skip confirmation for market orders"
        aria-label="One-click trading"
      >
        <Zap className={isDesktop ? "h-7 w-7" : mobileIcon.ui} />
        {isDesktop && "1-Click"}
      </button>
    </div>
  );

  const orderStatusMessages = (
    <>
      {placeOrder.isError && (
        <p className="text-destructive text-xs mt-1 p-1.5 bg-destructive/10 rounded">
          {(placeOrder.error as { message?: string } | null)?.message || "Order failed"}
        </p>
      )}
      {placeOrder.isSuccess && (
        <p className="text-buy text-xs mt-1 p-1.5 bg-buy/10 rounded">Order placed successfully</p>
      )}
    </>
  );

  const applyButton = (
    <Button
      variant={side === "long" ? "buy" : "sell"}
      className={cn(
        "w-full",
        isDesktop ? "text-sm" : cn(mobileForm.cta, mobileText.ui, "font-semibold leading-none"),
      )}
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
  );

  if (!isDesktop) {
    const accountMeta = isSignedIn
      ? `Available ${formatCurrency(accountEquity)}`
      : "Sign in to trade";

    return (
      <div className="flex flex-col h-full" data-testid="position-builder">
        <PanelHeader
          title="Trade Setup"
          titleClassName={cn(mobileText.ui, "font-semibold normal-case text-foreground")}
          right={
            <div className="flex min-w-0 items-center gap-1">
              <span className={cn(mobileText.meta, "truncate text-muted-foreground")}>
                {exchangeLabel} · {accountMeta}
              </span>
              {headerControls}
            </div>
          }
          className="py-1"
        />

        <div className={cn("flex-1 overflow-y-auto overscroll-contain", mobilePage.paddingX, "py-1.5 space-y-3")}>
          {/* A. Trade Setup — trader-controlled inputs */}
          <section className="space-y-2" aria-label="Trade Setup">
            <MobileSegmentGroup>
              <MobileSegmentButton active={side === "long"} variant="long" onClick={() => setSide("long")}>
                <ArrowUpRight className={mobileIcon.ui} aria-hidden="true" />
                Long
              </MobileSegmentButton>
              <MobileSegmentButton active={side === "short"} variant="short" onClick={() => setSide("short")}>
                <ArrowDownRight className={mobileIcon.ui} aria-hidden="true" />
                Short
              </MobileSegmentButton>
            </MobileSegmentGroup>

            <MobileSegmentGroup>
              <MobileSegmentButton
                active={entryMode === "market"}
                variant="neutral"
                onClick={() => setEntryMode("market")}
              >
                Market
              </MobileSegmentButton>
              <MobileSegmentButton
                active={entryMode === "limit"}
                variant="neutral"
                onClick={() => setEntryMode("limit")}
              >
                Limit
              </MobileSegmentButton>
            </MobileSegmentGroup>

            <div className={cn("flex flex-col", mobileForm.labelGap)}>
              <FieldLabel>Entry Price</FieldLabel>
              {entryMode === "limit" ? (
                <div className={cn("flex", mobileForm.rowGap)}>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    placeholder={tick ? formatNumber(side === "long" ? tick.ask : tick.bid, priceDigits) : ""}
                    className={cn(mobileInputClass, "min-w-0 flex-1")}
                    step="any"
                  />
                  {volumeProfile && (
                    <button
                      type="button"
                      onClick={applyProfileLevel}
                      title="Set the entry to this session's volume profile level. Switches the order to Limit, since a market entry follows the live price."
                      className={cn(
                        mobileForm.control,
                        mobileText.meta,
                        "inline-flex shrink-0 items-center justify-center rounded border border-border px-2 hover:bg-secondary",
                      )}
                    >
                      Use {nextProfileLevel === "poc" ? "POC" : "VAH"}
                    </button>
                  )}
                </div>
              ) : (
                <PriceFieldBox suffix="Market">
                  <span className={cn(mobileText.primaryMono, "text-foreground")}>
                    {entry > 0 ? formatNumber(entry, priceDigits) : "—"}
                  </span>
                </PriceFieldBox>
              )}
            </div>
          </section>

          {/* B. Risk Management — collapsible sizing + calculated SL/TP */}
          <CollapsibleSection
            title="Risk Management"
            expanded={riskManagementExpanded}
            onToggle={() => setRiskManagementExpanded((v) => !v)}
            testId="risk-management-toggle"
          >
            <div className={cn("grid grid-cols-2", mobileForm.rowGap)}>
              <label className={cn("flex flex-col", mobileForm.labelGap)}>
                <FieldLabel>Risk %</FieldLabel>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={riskPercent}
                    onChange={(e) => setRiskPercent(e.target.value)}
                    className={cn(mobileInputClass, "pr-6")}
                    step="0.1"
                    min="0"
                  />
                  <span className={cn("pointer-events-none absolute right-2 top-1/2 -translate-y-1/2", mobileText.meta, "text-muted-foreground")}>
                    %
                  </span>
                </div>
              </label>
              <label className={cn("flex flex-col", mobileForm.labelGap)}>
                <FieldLabel>Leverage</FieldLabel>
                <div className="relative">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={leverage}
                    onChange={(e) => setLeverage(e.target.value)}
                    className={cn(mobileInputClass, "pr-6")}
                    step="1"
                    min="0"
                  />
                  <span className={cn("pointer-events-none absolute right-2 top-1/2 -translate-y-1/2", mobileText.meta, "text-muted-foreground")}>
                    ×
                  </span>
                </div>
                {instrument.maxLever > 0 && (
                  <span className={cn(mobileText.meta, "text-muted-foreground")}>max {instrument.maxLever}×</span>
                )}
              </label>
            </div>

            {!isSignedIn ? (
              <p className={cn(mobileText.meta, "text-muted-foreground")}>Sign in to size and place orders.</p>
            ) : !plan.ok ? (
              <p className={cn(mobileText.meta, "text-muted-foreground")}>{plan.error}</p>
            ) : (
              <>
                <CalculatedFieldRow
                  testId="stop-loss-field"
                  label="Stop Loss"
                  price={formatNumber(plan.stop, priceDigits)}
                  percent={slPct !== null ? formatSignedPercent(slPct) : undefined}
                  percentClassName="text-sell"
                  meta={slPct !== null && lev > 0 ? `${formatSignedPercent(slPct * lev)} @ ${lev}×` : undefined}
                  metaClassName="text-sell"
                />
                <CalculatedFieldRow
                  label="Take Profit (Optional)"
                  price={tpPlan ? formatNumber(tpPlan.takeProfit, priceDigits) : "—"}
                  percent={tpPct !== null ? formatSignedPercent(tpPct) : undefined}
                  percentClassName="text-buy"
                />
              </>
            )}

            {isSignedIn && plan.ok && plan.warnings.map((w) => (
              <p
                key={w}
                className="flex items-start gap-1 rounded border border-destructive/30 bg-destructive/10 px-1.5 py-1 text-destructive"
              >
                <AlertTriangle className={cn(mobileIcon.status, "mt-0.5 shrink-0")} aria-hidden="true" />
                <span className={mobileText.ui}>{w}</span>
              </p>
            ))}

            <div className="flex items-center justify-between gap-2 pt-0.5">
              <FieldLabel>Risk / Reward</FieldLabel>
              <div className="flex items-center gap-1">
                <span className={cn(mobileText.meta, "text-muted-foreground")}>1 :</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={rr}
                  onChange={(e) => setRr(e.target.value)}
                  className={cn(
                    mobileText.primaryMono,
                    "w-12 border-0 bg-transparent p-0 text-right text-buy outline-none focus:ring-0",
                  )}
                  step="0.1"
                  min="0"
                  aria-label="Risk reward ratio"
                />
              </div>
            </div>
          </CollapsibleSection>

          {/* C. Trade Summary — calculated outputs only */}
          <section
            className="space-y-1 border-t border-border pt-2"
            data-testid="trade-summary"
            aria-label="Trade Summary"
          >
            <SectionTitle>Trade Summary</SectionTitle>

            {!isSignedIn ? (
              <div className="space-y-2 py-1">
                {onRequestSignIn && (
                  <Button variant="outline" size="sm" className={mobileForm.control} onClick={onRequestSignIn}>
                    Sign In
                  </Button>
                )}
              </div>
            ) : !plan.ok ? null : (
              <div className="space-y-0.5">
                <SummaryRow
                  label="Risk (USDT)"
                  value={formatCurrency(plan.riskAmount)}
                  valueClassName="text-sell"
                  emphasized
                />
                <SummaryRow
                  label="Position Size"
                  value={formatCurrency(plan.notional)}
                  emphasized
                />
                <SummaryRow
                  label="Stop Loss"
                  value={
                    slPct !== null
                      ? `${formatNumber(plan.stop, priceDigits)} · ${formatSignedPercent(slPct)}`
                      : formatNumber(plan.stop, priceDigits)
                  }
                  valueClassName="text-sell"
                />
                <SummaryRow
                  label="Take Profit"
                  value={
                    tpPlan && tpPct !== null
                      ? `${formatNumber(tpPlan.takeProfit, priceDigits)} · ${formatSignedPercent(tpPct)}`
                      : "—"
                  }
                  valueClassName="text-buy"
                />
                <SummaryRow
                  label="Risk / Reward"
                  value={rrNum > 0 ? `1 : ${formatNumber(rrNum, 1)}` : "—"}
                  valueClassName="text-buy"
                />
                <details className="pt-0.5">
                  <summary className={cn(mobileText.meta, "cursor-pointer text-muted-foreground")}>
                    Estimate notes
                  </summary>
                  <div className={cn(mobileText.meta, "mt-1 space-y-1 text-muted-foreground")}>
                    <p>
                      Liquidation ≈ {formatNumber(plan.approxLiq, priceDigits)} — rough isolated-margin estimate;
                      ignores fees and maintenance margin.
                    </p>
                    {isApproximateInstrument && (
                      <p>
                        {isOkx && isLoadingInstrument
                          ? "Loading real OKX instrument specs…"
                          : "Using approximate instrument data — not exchange-accurate."}
                      </p>
                    )}
                  </div>
                </details>
              </div>
            )}
          </section>

          {volumeProfile && plan.ok && isSignedIn && (
            <MobileVolumeProfileSection
              volumeProfile={volumeProfile}
              expanded={volumeProfileExpanded}
              onToggle={() => setVolumeProfileExpanded((v) => !v)}
            />
          )}

          {orderStatusMessages}
        </div>

        <div
          className={cn(
            "shrink-0 border-t border-border bg-card",
            mobilePage.paddingX,
            "pt-1.5 pb-1.5 safe-area-bottom",
          )}
          data-testid="trade-apply-footer"
        >
          {!isFeedConnected && <DisconnectedTradingBanner />}
          {applyButton}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" data-testid="position-builder">
      <PanelHeader
        title="TRADE SETUP"
        titleClassName="max-md:text-data max-md:font-bold md:text-[13px] font-extrabold tracking-wide normal-case text-foreground"
        right={headerControls}
      >
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-label uppercase text-muted-foreground">Balance</span>
            <span
              className={cn(
                "leading-none font-mono max-md:text-data max-md:font-bold md:text-[18px] md:font-extrabold",
                isSignedIn ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {isSignedIn ? formatCurrency(accountEquity) : "—"}
            </span>
          </div>
          <span className={cn(mobileText.primary, "text-muted-foreground truncate md:font-semibold")}>
            {symbol}
          </span>
        </div>
      </PanelHeader>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="grid grid-cols-2 gap-1">
          <Button
            variant={side === "long" ? "buy" : "outline"}
            size="sm"
            onClick={() => setSide("long")}
            className="text-xs max-md:min-h-[48px]"
          >
            <TrendingUp className={cn(mobileIcon.ui, "mr-1 md:h-3 md:w-3")} />
            Long
          </Button>
          <Button
            variant={side === "short" ? "sell" : "outline"}
            size="sm"
            onClick={() => setSide("short")}
            className="text-xs max-md:min-h-[48px]"
          >
            <TrendingDown className={cn(mobileIcon.ui, "mr-1 md:h-3 md:w-3")} />
            Short
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className={cn(mobileText.ui, "text-muted-foreground uppercase tracking-wider")}>
            Risk %
            <input
              type="number"
              inputMode="decimal"
              value={riskPercent}
              onChange={(e) => setRiskPercent(e.target.value)}
              className="w-full mt-1 text-sm font-mono max-md:min-h-[44px]"
              step="0.1"
              min="0"
            />
          </label>
          <label className={cn(mobileText.ui, "text-muted-foreground uppercase tracking-wider")}>
            Leverage
            <input
              type="number"
              inputMode="decimal"
              value={leverage}
              onChange={(e) => setLeverage(e.target.value)}
              className="w-full mt-1 text-sm font-mono max-md:min-h-[44px]"
              step="1"
              min="0"
            />
            {instrument.maxLever > 0 && (
              <i className={cn("block not-italic text-muted-foreground mt-0.5", mobileText.meta)}>
                max {instrument.maxLever}x
              </i>
            )}
          </label>
        </div>

        <div>
          <label className={cn(mobileText.ui, "text-muted-foreground uppercase tracking-wider")}>Entry</label>
          <div className="grid grid-cols-2 gap-1 mt-1">
            <button
              onClick={() => setEntryMode("market")}
              className={cn(
                "px-1 py-1.5 text-xs rounded border border-border max-md:min-h-[44px]",
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
                "px-1 py-1.5 text-xs rounded border border-border max-md:min-h-[44px]",
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
              placeholder={tick ? formatNumber(side === "long" ? tick.ask : tick.bid, priceDigits) : ""}
              className="w-full mt-1 text-sm font-mono max-md:min-h-[44px]"
              step="any"
            />
          ) : (
            <div className="mt-1 text-sm font-mono">
              {entry > 0 ? formatNumber(entry, priceDigits) : "—"}
            </div>
          )}
          {volumeProfile && (
            <button
              type="button"
              onClick={applyProfileLevel}
              title="Set the entry to this session's volume profile level. Switches the order to Limit, since a market entry follows the live price."
              className="w-full mt-1 px-2 py-1 text-xs rounded border border-border hover:bg-secondary flex items-center justify-between"
            >
              <span className="text-muted-foreground">
                Use {nextProfileLevel === "poc" ? "POC" : "VAH"}
              </span>
              <span className="font-mono">
                {formatNumber(nextProfileLevel === "poc" ? volumeProfile.poc : volumeProfile.vah, 2)}
              </span>
            </button>
          )}
        </div>

        <label className={cn("block text-muted-foreground uppercase tracking-wider", mobileText.ui)}>
          RR (risk:reward)
          <input
            type="number"
            inputMode="decimal"
            value={rr}
            onChange={(e) => setRr(e.target.value)}
            className="w-full mt-1 text-sm font-mono max-md:min-h-[44px]"
            step="0.1"
            min="0"
          />
        </label>

        <div className={cn("bg-secondary rounded p-2.5 space-y-1.5 max-md:text-xs md:text-data")}>
          {!isSignedIn ? (
            // Signed out, every number here is a placeholder, and the reason
            // the planner reports ("No Total Equity available") describes the
            // symptom rather than the cause.
            <div className="space-y-2">
              <p className="text-muted-foreground">Sign in to size and place orders.</p>
              {onRequestSignIn && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full max-md:min-h-[44px]"
                  onClick={onRequestSignIn}
                >
                  Sign In
                </Button>
              )}
            </div>
          ) : !plan.ok ? (
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
              {volumeProfile && (
                <div className="border-t border-border/60 mt-1.5 pt-1.5 space-y-1.5">
                  <div className="flex justify-between items-baseline">
                    <span className="text-muted-foreground uppercase text-label">
                      Volume Profile
                    </span>
                    <span className={cn("text-muted-foreground", mobileText.ui)}>
                      {MARKET_LABELS[volumeProfile.market] ?? volumeProfile.market}
                      {volumeProfile.isDeveloping && " · developing"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Value Area High</span>
                    <span className="font-mono">{formatNumber(volumeProfile.vah, 2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Point of Control</span>
                    <span className="font-mono text-warning">
                      {formatNumber(volumeProfile.poc, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Value Area Low</span>
                    <span className="font-mono">{formatNumber(volumeProfile.val, 2)}</span>
                  </div>
                </div>
              )}
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

        <div className="space-y-2">
          {!isFeedConnected && <DisconnectedTradingBanner />}
          {applyButton}
        </div>

        {orderStatusMessages}
      </div>
    </div>
  );
}
