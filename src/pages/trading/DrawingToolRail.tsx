import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Circle,
  Equal,
  Layers,
  Layers3,
  Magnet,
  type LucideIcon,
  Minus,
  MousePointer2,
  MoveUpRight,
  MoveVertical,
  Repeat,
  Ruler,
  Spline,
  Square,
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
    id: "trade",
    icon: ArrowUpRight,
    label: "Trade",
    tools: [
      { tool: "long-position", icon: ArrowUpRight, label: "Long Position" },
      { tool: "short-position", icon: ArrowDownRight, label: "Short Position" },
      { tool: "measure", icon: Ruler, label: "Measure" },
    ],
  },
  { id: "text", icon: Type, label: "Text", tools: [{ tool: "text", icon: Type, label: "Text" }] },
];

function RailButton({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "p-1.5 rounded hover:bg-secondary",
        active ? "bg-primary/20 text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="h-8 w-8" />
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
  return (
    <div className="relative">
      {group.tools.length === 1 ? (
        <RailButton icon={Icon} title={group.label} active={active} onClick={onActivate} />
      ) : (
        <div
          className={cn(
            "flex items-center rounded hover:bg-secondary",
            active ? "bg-primary/20 text-primary" : "text-muted-foreground",
          )}
        >
          <button
            type="button"
            title={`${group.label}: ${lastMeta.label}`}
            onClick={onActivate}
            className="py-1.5 pl-1.5 pr-0.5"
          >
            <Icon className="h-8 w-8" />
          </button>
          <button
            type="button"
            title={`Choose ${group.label.toLowerCase()} tool`}
            onClick={onToggle}
            className="py-1.5 pl-0.5 pr-0.5"
          >
            <ChevronRight className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>
      )}
      {open && (
        <div className="absolute left-full top-0 ml-1 z-30 min-w-[180px] rounded-md bg-card border border-border shadow-xl py-1">
          {group.tools.map((t) => (
            <button
              key={t.tool}
              type="button"
              onClick={() => onSelect(t.tool)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-secondary text-left",
                activeTool === t.tool && "bg-secondary text-primary",
              )}
            >
              <t.icon className="h-7 w-7 shrink-0" />
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function DrawingToolRail({
  drawingTool,
  onDrawingTool,
  magnetMode,
  onCycleMagnet,
  stayInDrawingMode,
  onToggleStayInDrawingMode,
}: {
  drawingTool: DrawingTool;
  onDrawingTool: (t: DrawingTool) => void;
  magnetMode: MagnetMode;
  onCycleMagnet?: () => void;
  stayInDrawingMode: boolean;
  onToggleStayInDrawingMode?: () => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [lastUsed, setLastUsed] = useState<Record<string, DrawingTool>>({
    lines: "trendline",
    fib: "fibonacci",
    shapes: "rectangle",
    trade: "long-position",
    text: "text",
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

  const hide = () => {
    setOpenGroup(null);
    setHidden(true);
  };

  return (
    <div
      ref={ref}
      className="absolute left-0 top-8 z-20"
    >
      <div
        className={cn(
          "ml-1 flex flex-col items-center gap-0.5 rounded-md bg-card/90 border border-border p-0.5 backdrop-blur-sm",
          hidden && "invisible pointer-events-none",
        )}
      >
        <RailButton
          icon={MousePointer2}
          title="Cursor"
          active={drawingTool === "none"}
          onClick={() => {
            onDrawingTool("none");
            setOpenGroup(null);
          }}
        />
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
        <div className="my-0.5 w-full border-t border-border/50" />
        {onCycleMagnet && (
          <RailButton
            icon={Magnet}
            title={`Magnet: ${magnetMode}`}
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
      </div>
      <button
        type="button"
        title={hidden ? "Show drawing tools" : "Collapse drawing tools"}
        aria-expanded={!hidden}
        onClick={hidden ? () => setHidden(false) : hide}
        className={cn(
          "absolute top-1/2 z-30 -translate-y-1/2 border border-border bg-card px-1 py-2 text-muted-foreground shadow-md hover:text-foreground",
          hidden
            ? "left-0 rounded-r-md border-l-0"
            : "left-full rounded-r-md border-l-0",
        )}
      >
        {hidden ? (
          <ChevronRight className="h-7 w-7" />
        ) : (
          <ChevronLeft className="h-7 w-7" />
        )}
      </button>
    </div>
  );
}
