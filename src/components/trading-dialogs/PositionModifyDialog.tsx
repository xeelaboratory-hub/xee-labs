import { useState, useEffect } from "react";
import { api } from "../../services/api";
import { useTradingStore } from "../../services/store";
import { toast } from "../../services/toast";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useInstrumentLabels } from "../../hooks/useInstrumentLabels.ts";
import { X, TrendingUp, TrendingDown, SlidersHorizontal, ArrowLeftRight, WifiOff } from "lucide-react";

interface Position {
  id: string;
  symbolName: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice?: number | null;
  unrealizedPnl?: number;
  stopLoss?: number | null;
  takeProfit?: number | null;
  openedAt: string;
  /** Units per contract/lot. Defaults to 100000 (forex) when not provided. */
  contractSize?: number;
}

interface PositionModifyDialogProps {
  position: Position | null;
  onClose: () => void;
  onSaved: () => void;
  tick?: { bid: number; ask: number };
  isFeedConnected?: boolean;
}

export function PositionModifyDialog({
  position,
  onClose,
  onSaved,
  tick,
  isFeedConnected = true,
}: PositionModifyDialogProps) {
  const { formatQty, unitLabel, isFutures, instrumentType } = useInstrumentLabels();
  const mode = useTradingStore((s) => s.mode);
  const [partialQty, setPartialQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"modify" | "partial">("modify");

  useEffect(() => {
    if (position) setPartialQty("");
  }, [position]);

  if (!position) return null;

  const currentPrice = tick
    ? position.side === "LONG"
      ? tick.bid
      : tick.ask
    : position.currentPrice || position.entryPrice;

  const pnlPerUnit =
    position.side === "LONG"
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

  const handlePartialClose = async () => {
    if (!isFeedConnected) {
      toast.error("No Data Feed", "Cannot close positions while disconnected from the data feed");
      return;
    }
    const qty = parseFloat(partialQty);
    if (isNaN(qty) || qty <= 0 || qty > position.quantity) {
      toast.warning("Invalid Quantity", `Enter a value between 0.01 and ${position.quantity}`);
      return;
    }
    setSaving(true);
    try {
      const result = await api.closePosition(position.id, mode, qty);
      toast.success(
        "Partial Close",
        result?.duplicate
          ? "This close had already reached the exchange — nothing new was sent."
          : `Closed ${formatQty(qty)} of ${formatQty(position.quantity)}`,
      );
      onSaved();
      onClose();
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      // Resolved against the exchange by the facade before it gets here, so
      // neither branch is a guess about whether the close went through.
      if (e?.code === "ORDER_STATUS_UNKNOWN") {
        toast.warning("Close Status Unknown", e.message || "Could not confirm the close");
      } else if (e?.code === "ORDER_NOT_PLACED") {
        toast.error("Close Not Sent", e.message || "The close never reached the exchange");
      } else {
        toast.error("Close Failed", e.message || "Could not partially close position");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-card border border-border rounded-lg shadow-2xl shadow-black/40 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 bg-secondary/50">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "p-1.5 rounded-lg",
                  position.side === "LONG" ? "bg-buy/15 text-buy" : "bg-sell/15 text-sell",
                )}
              >
                {position.side === "LONG" ? (
                  <TrendingUp className="h-8 w-8" />
                ) : (
                  <TrendingDown className="h-8 w-8" />
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold">Modify {position.symbolName}</h3>
                <p className="text-xs text-muted-foreground">
                  {position.side} {position.quantity} @ {formatNumber(position.entryPrice, 5)}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <X className="h-8 w-8" />
            </Button>
          </div>

          {/* Current Status */}
          <div className="px-5 py-3 grid grid-cols-3 gap-3 border-b border-border/40 text-center">
            <div>
              <div className="text-xs text-muted-foreground">Current</div>
              <div className="text-sm font-mono font-semibold">{formatNumber(currentPrice, 5)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">P&L</div>
              <div
                className={cn(
                  "text-sm font-mono font-semibold",
                  (position.unrealizedPnl || 0) >= 0 ? "text-buy" : "text-sell",
                )}
              >
                {(position.unrealizedPnl || 0) >= 0 ? "+" : ""}
                {formatCurrency(position.unrealizedPnl || 0)}
              </div>
            </div>
            {instrumentType === "FOREX" && (
              <div>
                <div className="text-xs text-muted-foreground">Pips</div>
                <div
                  className={cn(
                    "text-sm font-mono font-semibold",
                    pnlPerUnit >= 0 ? "text-buy" : "text-sell",
                  )}
                >
                  {(pnlPerUnit * 10000).toFixed(1)}
                </div>
              </div>
            )}
          </div>

          {/* Disconnected warning */}
          {!isFeedConnected && (
            <div className="mx-5 mt-3 bg-destructive/10 border border-destructive/30 rounded px-3 py-2 text-center">
              <div className="flex items-center justify-center gap-1.5 text-destructive text-xs font-semibold">
                <WifiOff className="h-7 w-7" />
                Data Feed Disconnected
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Modifications disabled until connection is restored
              </p>
            </div>
          )}

          {/* Tabs */}
          <div className="flex border-b border-border/40">
            <button
              className={cn(
                "flex-1 py-2 text-xs font-medium",
                activeTab === "modify"
                  ? "text-accent border-b-2 border-accent"
                  : "text-muted-foreground",
              )}
              onClick={() => setActiveTab("modify")}
            >
              <SlidersHorizontal className="h-3 w-3 inline mr-1" /> Modify TP/SL
            </button>
            <button
              className={cn(
                "flex-1 py-2 text-xs font-medium",
                activeTab === "partial"
                  ? "text-accent border-b-2 border-accent"
                  : "text-muted-foreground",
              )}
              onClick={() => setActiveTab("partial")}
            >
              <ArrowLeftRight className="h-3 w-3 inline mr-1" /> Partial Close
            </button>
          </div>

          {/* Content */}
          <div className="px-5 py-4 space-y-3">
            {activeTab === "modify" && (
              <div className="text-center text-xs text-muted-foreground py-4">
                Editing take-profit/stop-loss on an open position isn't supported yet — OKX
                conditional orders aren't wired up.
              </div>
            )}

            {activeTab === "partial" && (
              <>
                <div>
                  <label className="text-xs text-muted-foreground uppercase tracking-wider">
                    Close Volume ({unitLabel})
                  </label>
                  <input
                    type="number"
                    value={partialQty}
                    onChange={(e) => setPartialQty(e.target.value)}
                    placeholder={`Max: ${position.quantity}`}
                    className="w-full mt-1 text-sm font-mono"
                    step={isFutures ? "1" : "0.01"}
                    min={isFutures ? "1" : "0.01"}
                    max={position.quantity}
                  />
                </div>

                {/* Quick partial close buttons */}
                <div className="grid grid-cols-4 gap-1">
                  {[25, 50, 75, 100].map((pct) => {
                    const rawAmt = (position.quantity * pct) / 100;
                    // For futures: snap to nearest integer, at least 1, at most position.quantity.
                    const amt = isFutures
                      ? Math.min(position.quantity, Math.max(1, Math.round(rawAmt)))
                      : rawAmt;
                    return (
                      <button
                        key={pct}
                        onClick={() => setPartialQty(isFutures ? String(amt) : amt.toFixed(2))}
                        className={cn(
                          "text-xs py-1.5 rounded border border-border transition-colors",
                          parseFloat(partialQty) === amt
                            ? "bg-accent/15 text-accent border-accent/30"
                            : "hover:bg-secondary",
                        )}
                      >
                        {pct}%
                        <div className="text-[11px] text-muted-foreground">
                          {isFutures ? amt : amt.toFixed(2)}
                        </div>
                      </button>
                    );
                  })}
                </div>

                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={handlePartialClose}
                  disabled={saving || !partialQty || !isFeedConnected}
                  loading={saving}
                >
                  {saving
                    ? "Closing..."
                    : !isFeedConnected
                      ? "Disconnected"
                      : `Close ${partialQty || "?"} ${unitLabel}`}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ── Order Confirmation Dialog (#7) ──────────────────────────
