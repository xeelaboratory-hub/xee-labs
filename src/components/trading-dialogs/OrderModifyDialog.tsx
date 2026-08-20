import { cn, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { X, SlidersHorizontal } from "lucide-react";

interface OrderModifyDialogProps {
  order: {
    id: string;
    symbolName: string;
    side: string;
    type: string;
    quantity: number;
    price?: number | null;
  } | null;
  onClose: () => void;
  onSaved: () => void;
  tick?: { bid: number; ask: number };
}

/** Amending a pending order isn't wired to OKX yet — cancel and re-place instead. */
export function OrderModifyDialog({ order, onClose, tick }: OrderModifyDialogProps) {
  if (!order) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-card border border-border rounded-lg shadow-2xl overflow-hidden">
          <div
            className={cn(
              "px-5 py-3 border-b flex items-center justify-between",
              order.side === "BUY" ? "bg-buy/10 border-buy/20" : "bg-sell/10 border-sell/20",
            )}
          >
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Modify {order.side} {order.type} — {order.symbolName}
            </h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-3">
            <p className="text-center text-xs text-muted-foreground py-2">
              Amending a pending order isn't supported yet — cancel it and place a new one instead.
            </p>
            {tick && (
              <div className="text-xs text-muted-foreground flex gap-3 justify-center">
                <span>
                  Bid: <span className="font-mono text-sell">{formatNumber(tick.bid, 5)}</span>
                </span>
                <span>
                  Ask: <span className="font-mono text-buy">{formatNumber(tick.ask, 5)}</span>
                </span>
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-border/40">
            <Button variant="outline" className="w-full" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
