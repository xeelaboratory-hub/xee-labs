import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IndicatorList } from "@/pages/trading/IndicatorList";
import { INDICATOR_REGISTRY, type IndicatorType } from "@/lib/indicators";
import type { SessionMarket } from "@/lib/session-volume-profile";

function ListHarness({
  compact = false,
  initialActive = [],
  onRows,
}: {
  compact?: boolean;
  initialActive?: IndicatorType[];
  onRows?: (rows: number) => void;
} = {}) {
  const [active, setActive] = useState<IndicatorType[]>(initialActive);
  const [markets, setMarkets] = useState<SessionMarket[]>([]);
  const [rows, setRows] = useState(24);
  return (
    <IndicatorList
      compact={compact}
      activeIndicators={active}
      onToggleIndicator={(t) =>
        setActive((prev) => (prev.includes(t) ? prev.filter((p) => p !== t) : [...prev, t]))
      }
      sessionVolumeProfileMarkets={markets}
      sessionVolumeProfileRows={rows}
      onSessionVolumeProfileMarket={(m) =>
        setMarkets((prev) => (prev.includes(m) ? prev.filter((p) => p !== m) : [...prev, m]))
      }
      onSessionVolumeProfileRows={(r) => {
        setRows(r);
        onRows?.(r);
      }}
    />
  );
}

/** Indicator labels contain regex metacharacters — "ETF Flow (BTC)" would
 *  otherwise match as a group and find nothing. */
const byLabel = (label: string) => new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

describe("IndicatorList", () => {
  it("offers every registered indicator", () => {
    render(<ListHarness />);
    for (const ind of INDICATOR_REGISTRY) {
      expect(screen.getByRole("switch", { name: byLabel(ind.label) })).toBeInTheDocument();
    }
  });

  it("reports on/off state rather than only looking different", () => {
    const first = INDICATOR_REGISTRY[0]!;
    render(<ListHarness initialActive={[first.type]} />);
    expect(screen.getByRole("switch", { name: byLabel(first.label) })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("toggles an indicator", async () => {
    const user = userEvent.setup();
    const first = INDICATOR_REGISTRY[0]!;
    render(<ListHarness />);
    const toggle = screen.getByRole("switch", { name: byLabel(first.label) });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);
    expect(screen.getByRole("switch", { name: byLabel(first.label) })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("keeps the session profile's own controls hidden until it is on", async () => {
    const user = userEvent.setup();
    render(<ListHarness />);
    expect(screen.queryByLabelText(/session volume profile rows/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: /session volume profile/i }));
    expect(screen.getByLabelText(/session volume profile rows/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "NY" })).toBeInTheDocument();
  });

  it("carries the session controls into the touch layout too", async () => {
    // The whole point of sharing one list: sub-controls that exist on the
    // desktop dropdown must exist on the phone, without being written twice.
    const user = userEvent.setup();
    render(<ListHarness compact={false} initialActive={["SESSION_VOLUME_PROFILE"]} />);

    await user.click(screen.getByRole("button", { name: "LONDON" }));
    expect(screen.getByRole("button", { name: "LONDON" })).toHaveAttribute("aria-pressed", "true");
  });

  it("gives touch rows a finger-sized target, and compact rows a tighter one", () => {
    const first = INDICATOR_REGISTRY[0]!;
    const touch = render(<ListHarness />);
    expect(
      touch.container.querySelector('[role="switch"]')?.className,
    ).toContain("min-h-[44px]");
    touch.unmount();

    const compact = render(<ListHarness compact />);
    expect(compact.container.querySelector('[role="switch"]')?.className).not.toContain(
      "min-h-[44px]",
    );
    expect(first).toBeTruthy();
  });

  it("passes a new row count up as a number, not a string", async () => {
    const user = userEvent.setup();
    const onRows = vi.fn();
    render(<ListHarness initialActive={["SESSION_VOLUME_PROFILE"]} onRows={onRows} />);

    const input = screen.getByLabelText(/session volume profile rows/i);
    await user.clear(input);
    await user.type(input, "40");

    expect(onRows).toHaveBeenCalled();
    for (const call of onRows.mock.calls) {
      expect(typeof call[0]).toBe("number");
    }
  });
});
