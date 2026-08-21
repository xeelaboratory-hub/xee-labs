// Order input validation, extracted from PositionBuilderPanel so that panel
// exports only its component — a non-component export there degrades Vite's
// Fast Refresh for the whole module to a full reload.

export interface OrderValidationInput {
  isFeedConnected: boolean;
  quantity: string;
  orderType: "MARKET" | "LIMIT";
  price: string;
  /** Direction of the entry — decides which side of the entry each bracket
   * leg has to sit on. Only consulted when a bracket is supplied. */
  side?: "BUY" | "SELL";
  /** Protective bracket, attached to the entry order (OKX `attachAlgoOrds`).
   * Omit either leg to place without it. */
  takeProfit?: number;
  stopLoss?: number;
  /** What the bracket is measured against for a MARKET order: the live tick
   * the order will fill near. Ignored for LIMIT orders, which are measured
   * against their own limit price. Without it a MARKET bracket goes unchecked
   * here and is left to OKX. */
  referencePrice?: number;
}

export interface OrderValidationSuccess {
  ok: true;
  quantity: number;
  price?: number;
  takeProfit?: number;
  stopLoss?: number;
}

export interface OrderValidationFailure {
  ok: false;
  title: string;
  message: string;
}

export type OrderValidationResult = OrderValidationSuccess | OrderValidationFailure;

/** Validates the final quantity/price before an order actually goes out —
 * same rules the standalone Order Panel enforced before Position Builder
 * absorbed order placement. */
export function validateOrderInput({
  isFeedConnected,
  quantity,
  orderType,
  price,
  side,
  takeProfit,
  stopLoss,
  referencePrice,
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

  const bracketError = validateBracket({
    side,
    takeProfit,
    stopLoss,
    entry: parsedPrice ?? referencePrice,
  });
  if (bracketError) return bracketError;

  const result: OrderValidationSuccess = { ok: true, quantity: qty };
  if (parsedPrice !== undefined) result.price = parsedPrice;
  if (takeProfit !== undefined) result.takeProfit = takeProfit;
  if (stopLoss !== undefined) result.stopLoss = stopLoss;
  return result;
}

/** Returns the failure a bracket leg would cause, or null when the bracket is
 * fine (including when there is no bracket at all).
 *
 * Checks each leg sits on the side of the entry that makes it do its
 * job. A stop-loss above a long's entry triggers the moment the order fills,
 * closing the position it was meant to protect — the backend rejects that for
 * LIMIT orders, but a MARKET order has no server-side entry price, so this is
 * the only place it gets checked before OKX sees it.
 *
 * With no entry to measure against (a MARKET order placed while no tick has
 * arrived), the bracket passes: guessing a reference here would be worse than
 * letting OKX apply its own rules. */
function validateBracket({
  side,
  takeProfit,
  stopLoss,
  entry,
}: {
  side?: "BUY" | "SELL";
  takeProfit?: number;
  stopLoss?: number;
  entry?: number;
}): OrderValidationFailure | null {
  if (takeProfit === undefined && stopLoss === undefined) return null;

  for (const [label, value] of [
    ["Take Profit", takeProfit],
    ["Stop Loss", stopLoss],
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, title: `Invalid ${label}`, message: `${label} must be a positive number` };
    }
  }

  if (side === undefined || entry === undefined || !Number.isFinite(entry) || entry <= 0) return null;

  const isBuy = side === "BUY";
  if (stopLoss !== undefined && (isBuy ? stopLoss >= entry : stopLoss <= entry)) {
    return {
      ok: false,
      title: "Invalid Stop Loss",
      message: `Stop loss must be ${isBuy ? "below" : "above"} the entry price (${entry})`,
    };
  }
  if (takeProfit !== undefined && (isBuy ? takeProfit <= entry : takeProfit >= entry)) {
    return {
      ok: false,
      title: "Invalid Take Profit",
      message: `Take profit must be ${isBuy ? "above" : "below"} the entry price (${entry})`,
    };
  }
  return null;
}
