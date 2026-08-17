import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DrawingToolRail } from "@/pages/trading/DrawingToolRail";
import type { DrawingTool } from "@/pages/trading/constants";

function RailHarness() {
  const [tool, setTool] = useState<DrawingTool>("none");
  return (
    <DrawingToolRail
      drawingTool={tool}
      onDrawingTool={setTool}
      magnetMode="none"
      stayInDrawingMode={false}
    />
  );
}

describe("DrawingToolRail", () => {
  it("reuses the last group tool and Escape returns to cursor", async () => {
    const user = userEvent.setup();
    render(<RailHarness />);

    await user.click(screen.getByRole("button", { name: "Choose lines tool" }));
    await user.click(screen.getByRole("button", { name: "Ray" }));
    expect(screen.getByRole("button", { name: "Lines: Ray" }).parentElement?.className).toContain(
      "text-primary",
    );

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Cursor" }).className).toContain("text-primary");

    await user.click(screen.getByRole("button", { name: "Lines: Ray" }));
    expect(screen.getByRole("button", { name: "Lines: Ray" }).parentElement?.className).toContain(
      "text-primary",
    );
  });
});
