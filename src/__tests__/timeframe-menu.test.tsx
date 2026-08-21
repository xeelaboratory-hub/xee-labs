import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimeframeMenu } from "@/pages/trading/TimeframeMenu";
import { TIMEFRAMES, type Timeframe } from "@/pages/trading/constants";

function MenuHarness({ onChange }: { onChange?: (tf: Timeframe) => void } = {}) {
  const [tf, setTf] = useState<Timeframe>("15m");
  return (
    <TimeframeMenu
      timeframe={tf}
      onTimeframeChange={(next) => {
        setTf(next);
        onChange?.(next);
      }}
    />
  );
}

describe("TimeframeMenu", () => {
  it("shows the current timeframe without opening anything", () => {
    render(<MenuHarness />);
    expect(screen.getByRole("button", { name: /timeframe: 15m/i })).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers every timeframe once opened", async () => {
    // The defect this replaces: the chip strip put five of the eight past the
    // right edge of a 375px screen, reachable only by a horizontal scroll that
    // shares its axis with the chart's pan gesture.
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.click(screen.getByRole("button", { name: /timeframe: 15m/i }));

    const menu = screen.getByRole("menu", { name: /timeframe/i });
    for (const tf of TIMEFRAMES) {
      expect(screen.getByRole("menuitemradio", { name: tf })).toBeInTheDocument();
    }
    expect(menu).toBeInTheDocument();
  });

  it("marks the active timeframe so the sheet says where you are", async () => {
    const user = userEvent.setup();
    render(<MenuHarness />);
    await user.click(screen.getByRole("button", { name: /timeframe: 15m/i }));

    expect(screen.getByRole("menuitemradio", { name: "15m" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: "1h" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("selects a timeframe and closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MenuHarness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /timeframe: 15m/i }));
    await user.click(screen.getByRole("menuitemradio", { name: "4h" }));

    expect(onChange).toHaveBeenCalledWith("4h");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    // The trigger has to follow the selection — it is the only place the
    // active timeframe is visible once the sheet is gone.
    expect(screen.getByRole("button", { name: /timeframe: 4h/i })).toBeInTheDocument();
  });

  it("closes on the backdrop without changing anything", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<MenuHarness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /timeframe: 15m/i }));
    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("gives every option a finger-sized target", () => {
    // 44px is the documented floor, and the reason the strip could not simply
    // be wrapped onto two rows at this size.
    const { container } = render(<MenuHarness />);
    const trigger = container.querySelector("button");
    expect(trigger?.className).toContain("min-h-[44px]");
  });
});
