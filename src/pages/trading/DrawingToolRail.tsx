import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Equal,
  Eye,
  EyeOff,
  Layers,
  Layers3,
  Lock,
  LockOpen,
  type LucideIcon,
  Magnet,
  Minus,
  MousePointer2,
  MoveUpRight,
  MoveVertical,
  Repeat,
  Ruler,
  Spline,
  Square,
  Trash2,
  TrendingUp,
  Triangle,
  Type,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils.ts";
import type { DrawingTool, MagnetMode } from "./constants.ts";

interface ToolMeta {
  tool: DrawingTool;
  icon: LucideIcon;
  label: string;
}

interface ToolGroup {
  id: string;
  icon: LucideIcon;
  label: string;
  tools: ToolMeta[];
}

// TradingView-style left rail: tools grouped behind a flyout per category.
const GROUPS: ToolGroup[] = [
  {
    id: "lines",
    icon: TrendingUp,
    label: "Lines",
    tools: [
      { tool: "trendline", icon: TrendingUp, label: "Trend Line" },
      { tool: "ray", icon: MoveUpRight, label: "Ray" },
      { tool: "extended", icon: Spline, label: "Extended Line" },
      { tool: "horizontal", icon: Minus, label: "Horizontal Line" },
      { tool: "vertical", icon: MoveVertical, label: "Vertical Line" },
      { tool: "channel", icon: Equal, label: "Parallel Channel" },
    ],
  },
  {
    id: "fib",
    icon: Layers,
    label: "Fibonacci",
    tools: [
      { tool: "fibonacci", icon: Layers, label: "Fib Retracement" },
      { tool: "fibextension", icon: Layers3, label: "Fib Extension" },
    ],
  },
  {
    id: "shapes",
    icon: Square,
    label: "Shapes",
    tools: [
      { tool: "rectangle", icon: Square, label: "Rectangle" },
      { tool: "ellipse", icon: Circle, label: "Ellipse" },
      { tool: "triangle", icon: Triangle, label: "Triangle" },
      { tool: "arrow", icon: ArrowRight, label: "Arrow" },
    ],
  },
  {
    id: "text",
    icon: Type,
    label: "Text",
    tools: [{ tool: "text", icon: Type, label: "Text" }],
  },
  {
    id: "measure",
    icon: Ruler,
    label: "Measure",
    tools: [
      { tool: "long-position", icon: ArrowUpRight, label: "Long Position" },
      { tool: "short-position", icon: ArrowDownRight, label: "Short Position" },
      { tool: "measure", icon: Ruler, label: "Measure" },
    ],
  },
];

const ICON_SIZE = "h-4 w-4";

function RailButton({
  icon: Icon,
  title,
  active,
  disabled,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-sm transition-colors",
        "hover:bg-secondary disabled:pointer-events-none disabled:opacity-35",
        active && "bg-primary/15 text-primary",
        !active && !danger && "text-muted-foreground hover:text-foreground",
        danger && "text-muted-foreground hover:bg-destructive/15 hover:text-destructive",
      )}
    >
      <Icon className={ICON_SIZE} strokeWidth={1.75} />
    </button>
  );
}

function RailGroup({
  group,
  activeTool,
  lastTool,
  open,
  onToggle,
  onActivate,
  onSelect,
}: {
  group: ToolGroup;
  activeTool: DrawingTool;
  lastTool: DrawingTool;
  open: boolean;
  onToggle: () => void;
  onActivate: () => void;
  onSelect: (t: DrawingTool) => void;
}) {
  const activeMeta = group.tools.find((t) => t.tool === activeTool);
  const lastMeta = group.tools.find((t) => t.tool === lastTool) ?? group.tools[0]!;
  const Icon = activeMeta?.icon ?? lastMeta.icon;
  const active = Boolean(activeMeta);
  const title = `${group.label}: ${lastMeta.label}`;

  if (group.tools.length === 1) {
    return (
      <RailButton icon={Icon} title={lastMeta.label} active={active} onClick={onActivate} />
    );
  }

  return (
    <div className="relative">
      <div
        className={cn(
          "flex h-8 w-8 flex-col items-center justify-center rounded-sm transition-colors",
          "hover:bg-secondary",
          active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <button
          type="button"
          title={title}
          aria-label={title}
          onClick={onActivate}
          className="flex flex-1 items-center justify-center pt-0.5"
        >
          <Icon className={ICON_SIZE} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          title={`Choose ${group.label.toLowerCase()} tool`}
          aria-label={`Choose ${group.label.toLowerCase()} tool`}
          aria-expanded={open}
          onClick={onToggle}
          className="flex h-2.5 w-full items-center justify-center pb-0.5"
        >
          <ChevronRight
            className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-90")}
            strokeWidth={2.5}
          />
        </button>
      </div>

      {open && (
        <div
          role="menu"
          className="absolute left-full top-0 z-40 ml-1.5 min-w-[200px] rounded-md border border-border bg-card py-1 shadow-lg"
        >
          <div className="px-2.5 pb-1 pt-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {group.label}
          </div>
          {group.tools.map((t) => {
            const selected = activeTool === t.tool;
            return (
              <button
                key={t.tool}
                type="button"
                role="menuitem"
                aria-label={t.label}
                onClick={() => onSelect(t.tool)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-sm transition-colors",
                  "hover:bg-secondary",
                  selected ? "bg-secondary/80 text-primary" : "text-foreground",
                )}
              >
                <t.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span className="flex-1">{t.label}</span>
                {selected && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function magnetTitle(mode: MagnetMode): string {
  switch (mode) {
    case "none":
      return "Magnet: Off";
    case "weak":
      return "Magnet: Weak";
    case "strong":
      return "Magnet: Strong";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function DrawingToolRail({
  drawingTool,
  onDrawingTool,
  magnetMode,
  onCycleMagnet,
  stayInDrawingMode,
  onToggleStayInDrawingMode,
  allLocked = false,
  onToggleLockAll,
  drawingsHidden = false,
  onToggleHideAll,
  onClearDrawings,
  hasDrawings = false,
}: {
  drawingTool: DrawingTool;
  onDrawingTool: (t: DrawingTool) => void;
  magnetMode: MagnetMode;
  onCycleMagnet?: () => void;
  stayInDrawingMode: boolean;
  onToggleStayInDrawingMode?: () => void;
  allLocked?: boolean;
  onToggleLockAll?: () => void;
  drawingsHidden?: boolean;
  onToggleHideAll?: () => void;
  onClearDrawings?: () => void;
  hasDrawings?: boolean;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [lastUsed, setLastUsed] = useState<Record<string, DrawingTool>>({
    lines: "trendline",
    fib: "fibonacci",
    shapes: "rectangle",
    text: "text",
    measure: "long-position",
  });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openGroup) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenGroup(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openGroup]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onDrawingTool("none");
      setOpenGroup(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onDrawingTool]);

  const activate = (t: DrawingTool) => {
    onDrawingTool(drawingTool === t ? "none" : t);
    setOpenGroup(null);
  };

  const select = (groupId: string, t: DrawingTool) => {
    setLastUsed((current) => ({ ...current, [groupId]: t }));
    activate(t);
  };

  if (collapsed) {
    return (
      <div className="absolute left-0 top-1/2 z-20 -translate-y-1/2">
        <button
          type="button"
          title="Show drawing tools"
          aria-label="Show drawing tools"
          aria-expanded={false}
          onClick={() => setCollapsed(false)}
          className="flex h-10 w-4 items-center justify-center rounded-r-md border border-l-0 border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="absolute left-0 top-0 z-20 flex h-full items-stretch">
      <div className="flex w-9 flex-col items-center border-r border-border bg-card/95 py-1 backdrop-blur-[2px]">
        <div className="flex flex-col items-center gap-0.5 px-0.5">
          <RailButton
            icon={MousePointer2}
            title="Cursor"
            active={drawingTool === "none"}
            onClick={() => {
              onDrawingTool("none");
              setOpenGroup(null);
            }}
          />

          <div className="my-1 h-px w-5 bg-border" />

          {GROUPS.map((g) => (
            <RailGroup
              key={g.id}
              group={g}
              activeTool={drawingTool}
              lastTool={lastUsed[g.id] ?? g.tools[0]!.tool}
              open={openGroup === g.id}
              onToggle={() => setOpenGroup((o) => (o === g.id ? null : g.id))}
              onActivate={() => activate(lastUsed[g.id] ?? g.tools[0]!.tool)}
              onSelect={(t) => select(g.id, t)}
            />
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-0.5 px-0.5 pb-0.5">
          <div className="mb-1 h-px w-5 bg-border" />

          {onCycleMagnet && (
            <RailButton
              icon={Magnet}
              title={magnetTitle(magnetMode)}
              active={magnetMode !== "none"}
              onClick={onCycleMagnet}
            />
          )}
          {onToggleStayInDrawingMode && (
            <RailButton
              icon={Repeat}
              title="Stay in drawing mode"
              active={stayInDrawingMode}
              onClick={onToggleStayInDrawingMode}
            />
          )}
          {onToggleLockAll && (
            <RailButton
              icon={allLocked ? Lock : LockOpen}
              title={allLocked ? "Unlock all drawings" : "Lock all drawings"}
              active={allLocked}
              disabled={!hasDrawings}
              onClick={onToggleLockAll}
            />
          )}
          {onToggleHideAll && (
            <RailButton
              icon={drawingsHidden ? EyeOff : Eye}
              title={drawingsHidden ? "Show drawings" : "Hide drawings"}
              active={drawingsHidden}
              onClick={onToggleHideAll}
            />
          )}
          {onClearDrawings && (
            <RailButton
              icon={Trash2}
              title="Remove all drawings"
              disabled={!hasDrawings}
              danger
              onClick={onClearDrawings}
            />
          )}
        </div>
      </div>

      <button
        type="button"
        title="Collapse drawing tools"
        aria-label="Collapse drawing tools"
        aria-expanded={true}
        onClick={() => {
          setOpenGroup(null);
          setCollapsed(true);
        }}
        className="absolute top-1/2 left-full z-30 flex h-10 w-3.5 -translate-y-1/2 items-center justify-center rounded-r-md border border-l-0 border-border bg-card text-muted-foreground shadow-sm hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}
