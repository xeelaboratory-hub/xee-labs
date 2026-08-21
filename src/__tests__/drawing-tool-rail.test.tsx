import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DrawingToolRail } from "@/pages/trading/DrawingToolRail";
import type { DrawingTool } from "@/pages/trading/constants";

function RailHarness({
  hasDrawings = false,
  allLocked = false,
  drawingsHidden = false,
  onToggleLockAll,
  onToggleHideAll,
  onClearDrawings,
}: {
  hasDrawings?: boolean;
  allLocked?: boolean;
  drawingsHidden?: boolean;
  onToggleLockAll?: () => void;
  onToggleHideAll?: () => void;
  onClearDrawings?: () => void;
} = {}) {
  const [tool, setTool] = useState<DrawingTool>("none");
  return (
    <DrawingToolRail
      drawingTool={tool}
      onDrawingTool={setTool}
      magnetMode="none"
      stayInDrawingMode={false}
      hasDrawings={hasDrawings}
      allLocked={allLocked}
      drawingsHidden={drawingsHidden}
      onToggleLockAll={onToggleLockAll}
      onToggleHideAll={onToggleHideAll}
      onClearDrawings={onClearDrawings}
    />
  );
}

describe("DrawingToolRail", () => {
  it("reuses the last group tool and Escape returns to cursor", async () => {
    const user = userEvent.setup();
    render(<RailHarness />);

    await user.click(screen.getByRole("button", { name: "Choose lines tool" }));
    await user.click(screen.getByRole("menuitem", { name: "Ray" }));
    expect(screen.getByRole("button", { name: "Lines: Ray" }).parentElement?.className).toContain(
      "text-primary",
    );

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Cursor" }).className).toContain("text-primary");

    await user.click(screen.getByRole("button", { name: "Lines: Ray" }));
    expect(screen.getByRole("button", { name: "Lines: Ray" }).parentElement?.className).toContain(
      "text-primary",
    );

    await user.click(screen.getByRole("button", { name: "Collapse drawing tools" }));
    expect(screen.getByRole("button", { name: "Show drawing tools" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Show drawing tools" }));
    expect(screen.getByRole("button", { name: "Cursor" })).toBeInTheDocument();
  });

  it("exposes lock, hide, and clear utilities when wired", async () => {
    const user = userEvent.setup();
    const onToggleLockAll = vi.fn();
    const onToggleHideAll = vi.fn();
    const onClearDrawings = vi.fn();

    render(
      <RailHarness
        hasDrawings
        onToggleLockAll={onToggleLockAll}
        onToggleHideAll={onToggleHideAll}
        onClearDrawings={onClearDrawings}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Lock all drawings" }));
    expect(onToggleLockAll).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Hide drawings" }));
    expect(onToggleHideAll).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Remove all drawings" }));
    expect(onClearDrawings).toHaveBeenCalledOnce();
  });

  it("shows unlock / show labels when lock and hide are active", () => {
    render(
      <RailHarness
        hasDrawings
        allLocked
        drawingsHidden
        onToggleLockAll={() => {}}
        onToggleHideAll={() => {}}
        onClearDrawings={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Unlock all drawings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show drawings" })).toBeInTheDocument();
  });
});

describe("DrawingToolRail on a phone", () => {
  function setViewport(matches: boolean) {
    // The rail reads the breakpoint once at mount, so this has to be in place
    // before render — see the collapsed initialiser in DrawingToolRail.
    // `matches` means phone: the query is a comma-separated OR over a narrow
    // width and a short height, so landscape counts too.
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches,
          media: query,
          onchange: null,
          addListener: () => {},
          removeListener: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as MediaQueryList,
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts collapsed on a phone, in either orientation", () => {
    setViewport(true);
    render(<RailHarness />);

    // Expanded, the rail is a full-height column of tools over the chart. On a
    // phone that column costs the chart 36 of its 390 pixels, permanently.
    expect(screen.getByRole("button", { name: /show drawing tools/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cursor" })).not.toBeInTheDocument();
  });

  it("stays expanded above it, leaving desktop untouched", () => {
    setViewport(false);
    render(<RailHarness />);

    expect(screen.getByRole("button", { name: "Cursor" })).toBeInTheDocument();
  });

  it("asks about height too, so landscape does not open it over the chart", () => {
    // The whole reason this changed: a phone in landscape is 844px across,
    // which cleared a width-only query and unfurled a full-height tool column
    // across the chart the rotation was for.
    const queries: string[] = [];
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
      queries.push(query);
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      } as MediaQueryList;
    });
    render(<RailHarness />);
    expect(queries.some((q) => q.includes("max-height"))).toBe(true);
  });

  it("opens on demand when collapsed", async () => {
    setViewport(true);
    render(<RailHarness />);

    await userEvent.click(screen.getByRole("button", { name: /show drawing tools/i }));

    expect(screen.getByRole("button", { name: "Cursor" })).toBeInTheDocument();
  });
});
