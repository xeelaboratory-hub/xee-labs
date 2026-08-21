/**
 * The client half of order idempotency.
 *
 * `request()` aborting after 20 s does not cancel anything at the exchange —
 * the order may be filling while the UI reports a timeout. These tests pin the
 * three outcomes the facade is now required to distinguish (placed / not
 * placed / unknown), because collapsing them back into "try again" is what
 * turns one order into two.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/api/request.ts", async () => {
  const actual = await vi.importActual<typeof import("../services/api/request.ts")>(
    "../services/api/request.ts",
  );
  return { ...actual, request: vi.fn() };
});

const { request } = await import("../services/api/request.ts");
const { ApiError } = await import("../services/api/request.ts");
const { newClientOrderId, withInterruptionRecovery, findOrderByClientId } = await import(
  "../services/api/order-recovery.ts"
);

const mockRequest = vi.mocked(request);

const ORDER = {
  id: "777",
  symbolName: "OKX:BTCUSD",
  side: "BUY" as const,
  type: "MARKET" as const,
  quantity: 1,
  price: null,
  status: "filled",
  filledQuantity: 1,
  avgFillPrice: 50000,
  createdAt: "2026-08-21T00:00:00Z",
  updatedAt: "2026-08-21T00:00:00Z",
};

const INTENT = { symbol: "OKX:BTCUSD", mode: "demo" as const, clientOrderId: "xlabc123" };
const NOW = () => ({ attempts: 2, delayMs: 0 });

const timeout = () => new ApiError(408, "REQUEST_TIMEOUT", "Request timed out — please try again");

beforeEach(() => {
  mockRequest.mockReset();
});

describe("newClientOrderId", () => {
  it("only uses characters OKX accepts in a clOrdId", () => {
    for (let i = 0; i < 50; i++) {
      expect(newClientOrderId()).toMatch(/^[A-Za-z0-9]{1,32}$/);
    }
  });

  it("never repeats within a burst", () => {
    // A repeat would be read as a duplicate by OKX and reported back as
    // "already placed" — silently swallowing a second, genuine order.
    const ids = Array.from({ length: 500 }, () => newClientOrderId());
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("findOrderByClientId", () => {
  it("asks for the order under our own id", async () => {
    mockRequest.mockResolvedValueOnce(ORDER);
    await expect(findOrderByClientId(INTENT)).resolves.toEqual(ORDER);
    const path = mockRequest.mock.calls[0]?.[0] as string;
    expect(path).toContain("/orders/by-client-id");
    expect(path).toContain("clientOrderId=xlabc123");
    expect(path).toContain("mode=demo");
  });

  it("reads a 404 as 'no such order', not as a failed lookup", async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "no order with that id"));
    await expect(findOrderByClientId(INTENT)).resolves.toBeNull();
  });

  it("propagates any other failure", async () => {
    mockRequest.mockRejectedValueOnce(new ApiError(502, "BAD_GATEWAY", "OKX unreachable"));
    await expect(findOrderByClientId(INTENT)).rejects.toThrow("OKX unreachable");
  });
});

describe("withInterruptionRecovery", () => {
  const found = (order: { id: string }) => ({ orderId: order.id, duplicate: true });

  it("passes a normal submission straight through without asking anything", async () => {
    const submit = vi.fn().mockResolvedValue({ orderId: "1" });
    await expect(withInterruptionRecovery(INTENT, submit, found, NOW())).resolves.toEqual({
      orderId: "1",
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("leaves a rejection from the exchange alone", async () => {
    // A 502 is the backend answering — it has already resolved its own
    // ambiguity against OKX. Re-asking here would only add latency.
    const submit = vi.fn().mockRejectedValue(new ApiError(502, "BAD_GATEWAY", "Insufficient balance"));
    await expect(withInterruptionRecovery(INTENT, submit, found, NOW())).rejects.toThrow(
      "Insufficient balance",
    );
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("reports success when the order turns out to be at the exchange", async () => {
    const submit = vi.fn().mockRejectedValue(timeout());
    mockRequest.mockResolvedValueOnce(ORDER);
    await expect(withInterruptionRecovery(INTENT, submit, found, NOW())).resolves.toEqual({
      orderId: "777",
      duplicate: true,
    });
  });

  it("says nothing was placed when the exchange has never seen the order", async () => {
    const submit = vi.fn().mockRejectedValue(timeout());
    mockRequest.mockRejectedValue(new ApiError(404, "NOT_FOUND", "no order"));
    await expect(withInterruptionRecovery(INTENT, submit, found, NOW())).rejects.toMatchObject({
      code: "ORDER_NOT_PLACED",
    });
  });

  it("retries the lookup before concluding nothing was placed", async () => {
    // An order that reached OKX moments before our deadline can miss the first
    // lookup. A false "nothing was placed" is the expensive wrong answer here.
    const submit = vi.fn().mockRejectedValue(timeout());
    mockRequest
      .mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "no order"))
      .mockResolvedValueOnce(ORDER);
    await expect(withInterruptionRecovery(INTENT, submit, found, NOW())).resolves.toEqual({
      orderId: "777",
      duplicate: true,
    });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it("admits the outcome is unknown when the lookup itself fails", async () => {
    const submit = vi.fn().mockRejectedValue(timeout());
    mockRequest.mockRejectedValue(new ApiError(502, "BAD_GATEWAY", "OKX unreachable"));
    await expect(withInterruptionRecovery(INTENT, submit, found, NOW())).rejects.toMatchObject({
      code: "ORDER_STATUS_UNKNOWN",
    });
  });

  it("still concludes 'not placed' when a failed lookup is followed by a definite answer", async () => {
    const submit = vi.fn().mockRejectedValue(timeout());
    mockRequest
      .mockRejectedValueOnce(new ApiError(502, "BAD_GATEWAY", "OKX unreachable"))
      .mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "no order"));
    await expect(withInterruptionRecovery(INTENT, submit, found, NOW())).rejects.toMatchObject({
      code: "ORDER_NOT_PLACED",
    });
  });

  it("treats a dropped connection the same as a timeout", async () => {
    // fetch rejects with a TypeError when the request never completes; the
    // outcome is exactly as unknown as an abort.
    const submit = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    mockRequest.mockResolvedValueOnce(ORDER);
    await expect(withInterruptionRecovery(INTENT, submit, found, NOW())).resolves.toEqual({
      orderId: "777",
      duplicate: true,
    });
  });
});

/** The JSON body of the first request the facade sent. */
function sentBody(): Record<string, unknown> {
  const opts = mockRequest.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse((opts?.body as string) ?? "{}");
}

describe("api.placeOrder", () => {
  const INPUT = {
    mode: "demo" as const,
    symbol: "OKX:BTCUSD",
    side: "BUY" as const,
    type: "MARKET" as const,
    quantity: 1,
  };

  it("sends an idempotency key with every order", async () => {
    const { api } = await import("../services/api.ts");
    mockRequest.mockResolvedValueOnce({ orderId: "1" });
    await api.placeOrder(INPUT);
    const body = sentBody();
    expect(body.clientOrderId).toMatch(/^[A-Za-z0-9]{1,32}$/);
  });

  it("uses the caller's key when one is supplied, so a retried intent stays one order", async () => {
    const { api } = await import("../services/api.ts");
    mockRequest.mockResolvedValueOnce({ orderId: "1" });
    await api.placeOrder({ ...INPUT, clientOrderId: "xlfixed1" });
    const body = sentBody();
    expect(body.clientOrderId).toBe("xlfixed1");
  });

  it("sends one on a close too", async () => {
    const { api } = await import("../services/api.ts");
    mockRequest.mockResolvedValueOnce({ success: true });
    await api.closePosition("OKX:BTCUSD:long:LONG", "demo", 0.5);
    const body = sentBody();
    expect(body.clientOrderId).toMatch(/^[A-Za-z0-9]{1,32}$/);
    expect(body.quantity).toBe(0.5);
  });
});
