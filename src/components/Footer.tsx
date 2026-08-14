import pkg from "../../package.json";

export function Footer() {
  return (
    <footer className="flex items-center justify-between px-4 py-3 border-t border-border bg-secondary/40 text-xs text-muted-foreground">
      <div className="flex items-center gap-3">
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
      <div className="flex items-center gap-2">
        <span className="inline-block px-2 py-1 rounded bg-primary/10 text-primary font-mono font-semibold">
          v{pkg.version}
        </span>
      </div>
    </footer>
  );
}
