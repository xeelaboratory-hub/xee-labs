import pkg from "../../package.json";
import { AccountPanel } from "../pages/trading/AccountPanel.tsx";

export function Footer({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <footer className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border bg-secondary/40 text-xs text-muted-foreground overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-3 shrink-0">
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
      <div className="shrink-0">
        <AccountPanel onOpenSettings={onOpenSettings} />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="inline-block px-2 py-1 rounded bg-primary/10 text-primary font-mono font-semibold">
          v{pkg.version}
        </span>
      </div>
    </footer>
  );
}
