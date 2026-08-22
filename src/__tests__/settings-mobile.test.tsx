import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsPage } from "@/pages/SettingsPage";

vi.mock("@/hooks/useIsDesktop.ts", () => ({
  useIsDesktop: () => false,
}));

function renderSettings(onBack = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsPage onBack={onBack} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsPage on mobile", () => {
  it("shows a full-width category list on the home screen", () => {
    renderSettings();
    expect(screen.getByRole("navigation", { name: "Settings categories" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Account\s+Sign in and manage your identity/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Trading\s+Trading mode and exchange connections/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Appearance\s+Theme and display preferences/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Trading" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to Settings" })).not.toBeInTheDocument();
  });

  it("opens a full-width detail view with back navigation", async () => {
    renderSettings();
    await userEvent.click(
      screen.getByRole("button", { name: /Account\s+Sign in and manage your identity/i }),
    );

    expect(screen.getByRole("button", { name: "Back to Settings" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Settings categories" })).not.toBeInTheDocument();
  });

  it("returns to the category list from detail", async () => {
    renderSettings();
    await userEvent.click(
      screen.getByRole("button", { name: /Trading\s+Trading mode and exchange connections/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Back to Settings" }));

    expect(screen.getByRole("navigation", { name: "Settings categories" })).toBeInTheDocument();
  });

  it("exits to trading from the home screen", async () => {
    const onBack = vi.fn();
    renderSettings(onBack);
    await userEvent.click(screen.getByRole("button", { name: "Back to Trading" }));

    expect(onBack).toHaveBeenCalledOnce();
  });
});
