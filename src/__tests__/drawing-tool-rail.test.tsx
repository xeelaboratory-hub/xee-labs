import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DrawingToolRail,
  MOBILE_MEDIA_QUERY,
} from "@/pages/trading/DrawingToolRail";
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

  it("renders expanded as a fixed toolbar on a phone — no collapse step", () => {
    setViewport(true);
    render(<RailHarness />);

    expect(screen.getByRole("button", { name: "Cursor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show drawing tools/i })).not.toBeInTheDocument();
  });

  it("stays expanded above it, leaving desktop untouched", () => {
    setViewport(false);
    render(<RailHarness />);

    expect(screen.getByRole("button", { name: "Cursor" })).toBeInTheDocument();
  });

  it("asks about height too, so landscape does not open it over the chart", () => {
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
    expect(queries.some((q) => q === MOBILE_MEDIA_QUERY)).toBe(true);
  });

  it("renders as an in-flow horizontal toolbar, scrollable if it overflows", () => {
    setViewport(true);
    const { container } = render(<RailHarness />);

    const toolbar = container.querySelector('[data-mobile-toolbar="true"]');
    expect(toolbar).toBeInTheDocument();
    expect(toolbar?.className).toContain("overflow-x-auto");
    expect(toolbar?.className).not.toContain("absolute");
    expect(toolbar?.className).not.toContain("pointer-events-none");
  });

  it("keeps submenu group item shell clipped inside the rail", async () => {
    setViewport(true);
    render(<RailHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Lines: Trend Line" }));

    const groupShell = screen.getByRole("button", { name: "Lines: Trend Line" }).parentElement;
    expect(groupShell?.className).toContain("overflow-hidden");
    expect(groupShell?.className).toContain("h-9");
  });

  it("opens the tool picker via a body portal on mobile", async () => {
    setViewport(true);
    render(<RailHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Lines: Trend Line" }));

    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).toBeInTheDocument();
    expect(menu?.parentElement).toBe(document.body);
    expect(getComputedStyle(menu!).position).toBe("fixed");
    expect(screen.getByRole("menuitem", { name: "Ray" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "Ray" }));
    expect(screen.getByRole("button", { name: "Lines: Ray" }).parentElement?.className).toContain(
      "text-primary",
    );
  });
});
