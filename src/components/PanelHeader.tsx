import { cn } from "../lib/utils.ts";

interface PanelHeaderProps {
  title: string;
  /** Trailing content in the title row — badges, symbol, mute/settings icons, close button. */
  right?: React.ReactNode;
  /** Extra content below the title row (search input, filter dropdowns). */
  children?: React.ReactNode;
  className?: string;
}

/**
 * Shared panel-header chrome — one implementation instead of the five
 * near-identical ones each panel used to hand-roll (see design-system audit).
 */
export function PanelHeader({ title, right, children, className }: PanelHeaderProps) {
  return (
    <div className={cn("border-b border-border bg-secondary px-3 py-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-label uppercase text-muted-foreground truncate">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}
