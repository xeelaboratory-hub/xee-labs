/**
 * Switching to live asks first.
 *
 * The switch places no order by itself — it decides which credentials the
 * *next* order uses. On a phone that control sits in the footer, in the
 * thumb's path, one tap from a Trade tab whose submit button is deliberately
 * large. A mis-tap there is silent until an order fills against a real
 * account.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountPanel } from "@/pages/trading/AccountPanel";
import { useTradingStore } from "@/services/store";

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AccountPanel onOpenSettings={() => {}} />
    </QueryClientProvider>,
  );
}

const mode = () => useTradingStore.getState().mode;

beforeEach(() => {
  useTradingStore.setState({ mode: "demo" });
});

describe("switching to live", () => {
  it("does not switch on the tap alone", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "live" }));

    expect(mode()).toBe("demo");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("names what changes, in money terms", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "live" }));

    expect(screen.getByRole("alertdialog")).toHaveTextContent(/real funds/i);
  });

  it("switches once confirmed", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "live" }));
    await user.click(screen.getByRole("button", { name: /go live/i }));

    expect(mode()).toBe("live");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("stays in demo when declined", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "live" }));
    await user.click(screen.getByRole("button", { name: /stay in demo/i }));

    expect(mode()).toBe("demo");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("lets you back to demo without a prompt", async () => {
    // Deliberately asymmetric: one direction can cost money, the other costs
    // a tap. Guarding both would train people to dismiss the guard.
    useTradingStore.setState({ mode: "live" });
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "demo" }));

    expect(mode()).toBe("demo");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("does not prompt for the mode already in force", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole("button", { name: "demo" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("colours live differently from demo", () => {
    // The two modes shared one green, so at a glance the only thing telling
    // real money from paper was a four-letter word.
    useTradingStore.setState({ mode: "live" });
    renderPanel();

    expect(screen.getByRole("button", { name: "live" }).className).toContain("bg-destructive");
  });
});

vi.mock("@/services/api.ts", () => ({
  api: { getAccount: () => Promise.resolve({ balance: 0, equity: 0, margin: 0, freeMargin: 0 }) },
}));
