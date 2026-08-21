/**
 * Answering "did that order actually go through?" without re-sending it.
 *
 * `request()` gives up on a call after 20 s and reports a timeout, but a
 * client-side abort does not reach the backend, let alone OKX: the order may
 * already be live. The same is true of a connection that drops mid-flight.
 * Telling the user to try again — which is what the UI used to do — is asking
 * them to place a second order on top of a first one they can't see.
 *
 * Every mutating order now carries a caller-minted id (OKX's `clOrdId`), so an
 * interrupted submission has a question that can be asked afterwards. Three
 * answers are possible and the UI needs all three kept apart:
 *
 * - the order is at OKX  → the submission succeeded, report success
 * - OKX has no such order → nothing was placed, retrying is safe
 * - the lookup itself failed → the outcome is still unknown; say so rather
 *   than guess in either direction
 */
import { ApiError, request } from "./request.ts";
import type { Order, TradingMode } from "../schemas.ts";

export interface OrderIntent {
  /** Our symbol id, e.g. "OKX:BTCUSD" — the lookup is scoped per instrument. */
  symbol: string;
  mode: TradingMode;
  clientOrderId: string;
}

/**
 * Mints an id in the only charset OKX accepts for `clOrdId`: case-sensitive
 * alphanumerics, at most 32 characters.
 *
 * The timestamp prefix makes ids sort and read chronologically in OKX's own
 * order history; the random tail is what keeps two orders placed in the same
 * millisecond apart. That matters more than it looks — a collision would make
 * OKX reject the second order as a duplicate, and the duplicate path reports
 * "already placed", so two genuinely different orders must never collide.
 */
export function newClientOrderId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
  return `xl${Date.now().toString(36)}${random}`.slice(0, 32);
}

/**
 * True for the failures that leave the outcome genuinely unknown: our own
 * 20 s abort, and a fetch that never got a response at all (fetch rejects with
 * a TypeError there). An `ApiError` with any other code is the backend
 * answering — including a 502, which by then has already resolved its own
 * ambiguity against OKX.
 */
function isInterrupted(err: unknown): boolean {
  if (err instanceof ApiError) return err.code === "REQUEST_TIMEOUT";
  return err instanceof TypeError;
}

/** Returns the order OKX holds under this id, or null if it has never seen it. */
export async function findOrderByClientId({
  symbol,
  mode,
  clientOrderId,
}: OrderIntent): Promise<Order | null> {
  try {
    return await request<Order>(
      `/orders/by-client-id?mode=${mode}&symbol=${encodeURIComponent(symbol)}` +
        `&clientOrderId=${encodeURIComponent(clientOrderId)}`,
      // Shorter than the 20 s default: this runs after the user has already
      // waited out one timeout, and a slow answer here is itself an answer.
      { timeoutMs: 10_000 },
    );
  } catch (err) {
    // 404 is a real answer — OKX has no such order — not a failed lookup.
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

const LOOKUP_ATTEMPTS = 2;
const LOOKUP_DELAY_MS = 1_500;

export interface RecoveryOptions {
  attempts?: number;
  delayMs?: number;
}

/**
 * Runs a submission and, if it is interrupted rather than answered, resolves
 * what happened to it.
 *
 * The lookup is tried twice: the first attempt can lose a race against an
 * order that reached OKX moments before our own deadline expired, and a false
 * "nothing was placed" is the one wrong answer here that costs money.
 */
export async function withInterruptionRecovery<T>(
  intent: OrderIntent,
  submit: () => Promise<T>,
  onFound: (order: Order) => T,
  { attempts = LOOKUP_ATTEMPTS, delayMs = LOOKUP_DELAY_MS }: RecoveryOptions = {},
): Promise<T> {
  try {
    return await submit();
  } catch (err) {
    if (!isInterrupted(err)) throw err;

    let lookupFailure: unknown = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        const found = await findOrderByClientId(intent);
        if (found) return onFound(found);
        lookupFailure = null; // a definitive "no such order" clears an earlier failure
      } catch (lookupErr) {
        lookupFailure = lookupErr;
      }
    }

    if (lookupFailure) {
      throw new ApiError(
        504,
        "ORDER_STATUS_UNKNOWN",
        "Couldn't confirm whether this reached the exchange. Check your open orders and positions before trying again.",
      );
    }
    throw new ApiError(
      408,
      "ORDER_NOT_PLACED",
      "This never reached the exchange — nothing was placed. It's safe to try again.",
    );
  }
}
