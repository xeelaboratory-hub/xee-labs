import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const getAccount = vi.fn().mockResolvedValue({ balance: 1, equity: 1, margin: 0, freeMargin: 1 });

vi.mock("@/services/api", () => ({
  api: { getAccount: (...args: unknown[]) => getAccount(...args) },
}));

import { useAccount } from "@/services/queries";
import { useAuthStore } from "@/services/store";

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  getAccount.mockClear();
  useAuthStore.setState({ accessToken: "test-token", user: { id: "u1" } as never });
});

afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({ accessToken: null, user: null });
});

describe("useAccount polling", () => {
  it("polls the account balance every 15s instead of only on mount", async () => {
    renderHook(() => useAccount("demo"), { wrapper });

    await waitFor(() => expect(getAccount).toHaveBeenCalledTimes(1));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(getAccount).toHaveBeenCalledTimes(2));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(getAccount).toHaveBeenCalledTimes(3));
  });

  it("does not poll while disabled (no access token)", async () => {
    useAuthStore.setState({ accessToken: null, user: null });
    renderHook(() => useAccount("demo"), { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(getAccount).not.toHaveBeenCalled();
  });
});
