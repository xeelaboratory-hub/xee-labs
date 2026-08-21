import pkg from "../../package.json";
import { AccountPanel } from "../pages/trading/AccountPanel.tsx";

export function Footer({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <footer className="flex items-center justify-between gap-3 px-4 py-3 max-md:py-0.5 border-t border-border bg-secondary/40 text-xs text-muted-foreground overflow-x-auto no-scrollbar">
      {/* Branding and the version badge are desktop-only: on a phone this row
          is competing with the tab bar for the last strip of screen, and only
          the account controls in the middle are worth that space. */}
      <div className="hidden md:flex items-center gap-3 shrink-0">
        <span>Xee.Labs</span>
        <a
          href="https://www.tradingview.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground transition-colors"
        >
          Charts by TradingView
        </a>
      </div>
      <div className="shrink-0 max-md:w-full max-md:flex max-md:justify-center">
        <AccountPanel onOpenSettings={onOpenSettings} />
      </div>
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <span className="inline-block px-2 py-1 rounded bg-primary/10 text-primary font-mono font-semibold">
          v{pkg.version}
        </span>
      </div>
    </footer>
  );
}
