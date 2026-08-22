import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileTabBar, type MobileTab } from "@/pages/trading/MobileTabBar";

function TabHarness({ onTabChange }: { onTabChange?: (t: MobileTab) => void } = {}) {
  const [tab, setTab] = useState<MobileTab>("chart");
  return (
    <MobileTabBar
      tab={tab}
      onTabChange={(t) => {
        setTab(t);
        onTabChange?.(t);
      }}
    />
  );
}

describe("MobileTabBar", () => {
  it("offers all four destinations", () => {
    render(<TabHarness />);
    for (const label of ["Chart", "Trade", "Positions", "Book"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("marks only the active tab as the current page", () => {
    render(<TabHarness />);
    // aria-current is what carries "you are here" to assistive tech — the
    // colour change alone says nothing to a screen reader.
    expect(screen.getByRole("button", { name: "Chart" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Trade" })).not.toHaveAttribute("aria-current");
  });

  it("reports the tab that was tapped and moves the current marker", async () => {
    const onTabChange = vi.fn();
    render(<TabHarness onTabChange={onTabChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Positions" }));

    expect(onTabChange).toHaveBeenCalledWith("positions");
    expect(screen.getByRole("button", { name: "Positions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "Chart" })).not.toHaveAttribute("aria-current");
  });

  it("is a labelled navigation landmark", () => {
    render(<TabHarness />);
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("gives every tab a target a finger can hit", () => {
    render(<TabHarness />);
    for (const label of ["Chart", "Trade", "Positions", "Book"]) {
      const tab = screen.getByRole("button", { name: label });
      expect(tab.className).toContain("min-h-[48px]");
      expect(tab.querySelector("svg")?.getAttribute("class")).toContain("h-4");
    }
  });
});
