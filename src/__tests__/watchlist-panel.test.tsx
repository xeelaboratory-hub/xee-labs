import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WatchlistPanel } from "@/pages/trading/WatchlistPanel";

function renderPanel(symbols: Array<{ name: string; category?: string }>) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <WatchlistPanel
        symbols={symbols}
        ticks={{}}
        selectedSymbol=""
        onSelect={() => {}}
        mode="demo"
      />
    </QueryClientProvider>,
  );
}

describe("WatchlistPanel category sort", () => {
  it("sorts category filter buttons alphabetically regardless of case", () => {
    // Plain Array.sort() (UTF-16 code unit order) would put "Zebra" before "apple"
    // since uppercase letters sort before lowercase ones — localeCompare fixes this.
    renderPanel([
      { name: "ZEB", category: "Zebra" },
      { name: "APL", category: "apple" },
      { name: "MNG", category: "Mango" },
    ]);
    expect(["apple", "Mango", "Zebra"].map((name) => screen.getByRole("button", { name }))).toBeTruthy();
    const categoryBar = screen.getByRole("button", { name: "All" }).parentElement!;
    const categoryButtons = Array.from(categoryBar.querySelectorAll("button"))
      .map((b) => b.textContent)
      .slice(2); // skip "All" and the favorites-star button
    expect(categoryButtons).toEqual(["apple", "Mango", "Zebra"]);
  });
});
