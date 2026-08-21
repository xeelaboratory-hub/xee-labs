import { useEffect, useState } from "react";

/**
 * Both axes, not just width — and deliberately wider than Tailwind's `md:`.
 *
 * Width alone was the question until a phone in landscape answered it wrong.
 * An iPhone 13 rotated is 844px across, which clears `md` and loaded the full
 * desktop terminal — right panel, bottom panel, footer — into 390px of
 * height. The chart came out around 145px tall, *smaller than it is in
 * portrait*, in the one orientation people rotate to for the chart. The tab
 * bar went with it, since it was hidden by the same breakpoint.
 *
 * The desktop layout needs vertical room as much as horizontal, so it now has
 * to clear both. 500px separates every phone in landscape (390-430) from
 * every tablet (768+) with room to spare.
 */
const DESKTOP_QUERY = "(min-width: 768px) and (min-height: 500px)";

/**
 * True when the viewport is at or above Tailwind's `md` breakpoint.
 *
 * This exists for the cases CSS cannot cover: deciding whether to *mount* a
 * component, not just whether to show it. `hidden md:flex` still mounts its
 * children on a phone, so a panel that also has a mobile home would run twice
 * and both copies would push into the same shared state.
 *
 * It also decides *which* layout, which is why it no longer matches `md:`
 * exactly. Page-level structure — what mounts, what the tab bar navigates —
 * follows this hook. Leaf-level `md:` styling (padding, type scale, the
 * `max-md:` 44px targets) still keys on width alone; in landscape that means
 * a touch device picking up desktop sizing, which is a smaller problem than
 * the layout one and is not worth 64 class rewrites to fix.
 *
 * Unlike DrawingToolRail — which reads the breakpoint once, so a rotation
 * cannot yank the rail open mid-drawing — this tracks changes, because the
 * layout has to follow a rotation in both directions.
 *
 * Returns false until the first effect runs, so the mobile branch is what
 * renders on the server and in the first client paint.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setIsDesktop(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  return isDesktop;
}
