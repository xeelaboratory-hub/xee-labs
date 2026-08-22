import { CandlestickChart, ArrowUpDown, Wallet, Layers3 } from "lucide-react";
import { mobileIcon, mobileText, mobileTouch } from "../../lib/mobile-ui.ts";
import { cn } from "../../lib/utils.ts";

/** The four mobile destinations. Ordered by how often a trader reaches for
 * them, not by the desktop panel order — the chart is the app, the trade
 * ticket is what you came to do, and the other two are review surfaces. */
export type MobileTab = "chart" | "trade" | "positions" | "book";

const TABS = [
  { id: "chart", label: "Chart", icon: CandlestickChart },
  { id: "trade", label: "Trade", icon: ArrowUpDown },
  { id: "positions", label: "Positions", icon: Wallet },
  { id: "book", label: "Book", icon: Layers3 },
] as const satisfies ReadonlyArray<{ id: MobileTab; label: string; icon: typeof CandlestickChart }>;

/**
 * Bottom tab bar — the mobile navigation, replacing the drag-up sheet that
 * used to cover 57% of the screen from first paint and could only be dismissed
 * by hitting a 40x6px handle.
 *
 * Icon size matches the chart header (16px); touch targets stay at 48px min
 * height so tabs remain easy to hit without the oversized visual weight of
 * the previous 20px icons / 56px bar.
 */
export function MobileTabBar({
  tab,
  onTabChange,
}: {
  tab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
}) {
  return (
    <nav
      aria-label="Main"
      className="flex items-stretch border-t border-border bg-card safe-area-bottom"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = id === tab;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 py-1 transition-colors",
              mobileTouch.navTab,
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className={mobileIcon.nav} aria-hidden="true" />
            <span className={cn(mobileText.label, active && "text-primary")}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
