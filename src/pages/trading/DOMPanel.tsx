import { useEffect, useMemo, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useLargeOrderBook } from "../../hooks/useLargeOrderBook.ts";
import { cn } from "../../lib/utils.ts";
import type { LargeOrderSource, LargeOrderThreshold } from "../../services/api/market-data.ts";
import { useTradingStore } from "../../services/store.tsx";

const THRESHOLDS: LargeOrderThreshold[] = [0, 500_000, 1_000_000, 3_000_000, 5_000_000, 10_000_000];
const SOURCES: LargeOrderSource[] = ["binance", "okx"];

function thresholdLabel(value: LargeOrderThreshold): string {
  return value === 0 ? "All" : `$${value / 1_000_000}M`;
}

function money(value: number): string {
  return value >= 1_000_000_000
    ? `$${(value / 1_000_000_000).toFixed(2)}B`
    : `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
}

function age(from: string, to?: string | null): string {
  const seconds = Math.max(0, Math.floor((Date.parse(to ?? new Date().toISOString()) - Date.parse(from)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function DOMPanel({ symbol }: { symbol: string; tick?: { bid: number; ask: number } }) {
  const { levels, settings, updateSettings, historyUnavailable } = useLargeOrderBook(symbol, true, undefined, 250);
  const hoveredId = useTradingStore((state) => state.hoveredLargeOrderId);
  const setHoveredId = useTradingStore((state) => state.setHoveredLargeOrderId);
  const [, refreshAge] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refreshAge((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const sorted = useMemo(() => [...levels].sort((a, b) => b.price - a.price || a.source.localeCompare(b.source)), [levels]);
  const maxValue = useMemo(() => Math.max(1, ...sorted.map((level) => level.endedAt ? level.peakNotional : level.currentNotional)), [sorted]);

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-card" aria-label="Large Order Book">
      <header className="border-b border-border px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.13em]">Large Order Book</h3>
          </div>
          <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-bold uppercase text-primary">Live</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px]">
          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="flex h-7 min-w-[88px] items-center justify-between gap-2 rounded border border-border bg-secondary px-2 font-semibold text-foreground outline-none hover:border-primary/50 data-[state=open]:border-primary/50">
              <span>{thresholdLabel(settings.threshold)}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className="z-50 min-w-[96px] rounded-md border border-border bg-card p-1 text-[10px] shadow-xl">
                {THRESHOLDS.map((threshold) => (
                  <DropdownMenu.Item key={threshold} onSelect={() => updateSettings({ threshold })} className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-foreground outline-none hover:bg-secondary focus:bg-secondary">
                    {thresholdLabel(threshold)}
                    {settings.threshold === threshold && <Check className="h-3 w-3 text-primary" />}
                  </DropdownMenu.Item>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="flex h-7 min-w-[88px] items-center justify-between gap-2 rounded border border-border bg-secondary px-2 font-semibold uppercase text-foreground outline-none hover:border-primary/50 data-[state=open]:border-primary/50">
              <span>{settings.sources.length === 2 ? "Exchange" : settings.sources[0]}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className="z-50 min-w-[112px] rounded-md border border-border bg-card p-1 text-[10px] uppercase shadow-xl">
                {[{ label: "Exchange", sources: SOURCES }, ...SOURCES.map((source) => ({ label: source, sources: [source] }))].map((option) => {
                  const selected = option.sources.length === settings.sources.length && option.sources.every((source) => settings.sources.includes(source));
                  return (
                    <DropdownMenu.Item key={option.label} onSelect={() => updateSettings({ sources: option.sources })} className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-foreground outline-none hover:bg-secondary focus:bg-secondary">
                      {option.label}
                      {selected && <Check className="h-3 w-3 text-primary" />}
                    </DropdownMenu.Item>
                  );
                })}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <div className="ml-auto flex items-center gap-1 text-muted-foreground">
            <button
              type="button"
              role="switch"
              aria-checked={settings.showInactive}
              aria-label="Show inactive orders"
              onClick={() => updateSettings({ showInactive: !settings.showInactive })}
              className={cn("relative h-4 w-7 rounded-full transition-colors", settings.showInactive ? "bg-primary" : "bg-secondary")}
            >
              <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all", settings.showInactive ? "left-3.5" : "left-0.5")} />
            </button>
            <span>Inactive</span>
          </div>
        </div>
      </header>

      {historyUnavailable && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-400">
          Live only · 30-day history unavailable
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_34px] gap-2 border-b border-border px-3 py-1.5 text-[9px] uppercase tracking-wider text-muted-foreground">
        <span>Price</span><span className="text-center">Value</span><span className="text-center">Age</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="flex h-32 items-center justify-center px-6 text-center text-xs text-muted-foreground">No levels above {money(settings.threshold)}</div>
        ) : sorted.map((level) => {
          const active = !level.endedAt;
          const value = active ? level.currentNotional : level.peakNotional;
          return (
            <div
              key={level.id}
              onMouseEnter={() => setHoveredId(level.id)}
              onMouseLeave={() => setHoveredId(null)}
              title={`${level.source.toUpperCase()} · ${level.side.toUpperCase()}\nFirst seen ${new Date(level.firstSeen).toLocaleString()}\nCurrent ${money(level.currentNotional)} · Peak ${money(level.peakNotional)}\n${active ? "Active" : "Inactive"}`}
              className={cn("relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_34px] items-center gap-2 overflow-hidden border-b border-border/50 px-3 py-1 font-mono text-[10px] leading-none [contain-intrinsic-size:auto_18px] [content-visibility:auto] hover:bg-secondary/60", hoveredId === level.id && "bg-secondary ring-1 ring-inset ring-primary/60", !active && "opacity-45")}
            >
              <span className={cn("absolute inset-y-0 left-0", level.side === "bid" ? "bg-buy/10" : "bg-sell/10")} style={{ width: `${(value / maxValue) * 100}%` }} />
              <span className={cn("relative", level.side === "bid" ? "text-buy" : "text-sell")}>{level.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              <span className={cn("relative text-center", level.side === "bid" ? "text-buy" : "text-sell")}>{money(value)}</span>
              <span className="relative text-center text-muted-foreground">{age(level.firstSeen, level.endedAt)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
