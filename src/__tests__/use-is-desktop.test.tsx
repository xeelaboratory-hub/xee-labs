import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { useIsDesktop } from "@/hooks/useIsDesktop";

/** Captures the listeners the hook registers so a test can fire a real
 * breakpoint change, the way a rotation or a window resize would. */
function mockViewport(initial: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let matches = initial;
  vi.spyOn(window, "matchMedia").mockImplementation(
    (media: string) =>
      ({
        get matches() {
          return matches;
        },
        media,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) =>
          listeners.delete(fn),
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
  return {
    set(next: boolean) {
      matches = next;
      act(() => listeners.forEach((fn) => fn({ matches: next } as MediaQueryListEvent)));
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

function Probe() {
  return <span data-testid="probe">{useIsDesktop() ? "desktop" : "mobile"}</span>;
}

const read = () => screen.getByTestId("probe").textContent;

describe("useIsDesktop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports mobile below the md breakpoint", () => {
    mockViewport(false);
    render(<Probe />);
    expect(read()).toBe("mobile");
  });

  it("reports desktop at or above it", () => {
    mockViewport(true);
    render(<Probe />);
    expect(read()).toBe("desktop");
  });

  it("follows the viewport across the breakpoint", () => {
    // The point of the hook: this decides what gets MOUNTED, so a phone
    // rotated into landscape has to stop rendering the mobile-only copy.
    const viewport = mockViewport(false);
    render(<Probe />);
    expect(read()).toBe("mobile");

    viewport.set(true);
    expect(read()).toBe("desktop");

    viewport.set(false);
    expect(read()).toBe("mobile");
  });

  it("stops listening when the component goes away", () => {
    const viewport = mockViewport(true);
    const { unmount } = render(<Probe />);
    expect(viewport.listenerCount).toBe(1);

    unmount();

    expect(viewport.listenerCount).toBe(0);
  });

  it("falls back to mobile where matchMedia does not exist", () => {
    // Not hypothetical: this is plain jsdom, which ships no matchMedia at all
    // (src/__tests__/setup.ts stubs one, and this removes it again).
    const original = window.matchMedia;
    // @ts-expect-error deliberately removing the API to exercise the guard
    delete window.matchMedia;
    try {
      render(<Probe />);
      expect(read()).toBe("mobile");
    } finally {
      window.matchMedia = original;
    }
  });
});
