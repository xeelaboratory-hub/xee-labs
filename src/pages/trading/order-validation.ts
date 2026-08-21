// Order input validation, extracted from PositionBuilderPanel so that panel
// exports only its component — a non-component export there degrades Vite's
// Fast Refresh for the whole module to a full reload.

export interface OrderValidationInput {
  isFeedConnected: boolean;
  quantity: string;
  orderType: "MARKET" | "LIMIT";
  price: string;
}

export type OrderValidationResult =
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
