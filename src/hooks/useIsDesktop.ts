import { useEffect, useState } from "react";

/** Tailwind's `md` breakpoint, so this hook and the `md:` / `max-md:` classes
 * can never disagree about where the mobile layout starts. */
const DESKTOP_QUERY = "(min-width: 768px)";

/**
 * True when the viewport is at or above Tailwind's `md` breakpoint.
 *
 * This exists for the cases CSS cannot cover: deciding whether to *mount* a
 * component, not just whether to show it. `hidden md:flex` still mounts its
 * children on a phone, so a panel that also has a mobile home would run twice
 * and both copies would push into the same shared state.
 *
 * Unlike DrawingToolRail — which reads the breakpoint once, so a rotation
 * cannot yank the rail open mid-drawing — this tracks changes, because a
 * layout that stays mobile after rotating into landscape is a broken layout.
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
