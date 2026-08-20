import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
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
