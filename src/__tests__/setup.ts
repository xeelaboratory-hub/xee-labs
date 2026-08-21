import "@testing-library/jest-dom/vitest";

// jsdom ships no `matchMedia` at all, so any component that asks the browser
// about the viewport throws rather than returning a sensible default. Stub it
// as "no media query matches", which puts every component on its desktop
// branch — the same thing jsdom's fixed 1024x768 window already implies.
//
// A test that cares about the mobile branch should override this per-test
// rather than lean on the default.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
