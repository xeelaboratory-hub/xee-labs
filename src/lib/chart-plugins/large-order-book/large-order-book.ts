import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type { CandlestickData, ISeriesPrimitivePaneRenderer, ISeriesPrimitivePaneView, SeriesPrimitivePaneViewZOrder, Time } from "lightweight-charts";
import type { LargeOrderLevel } from "../../../services/api/market-data.ts";
import { PluginBase } from "../plugin-base.ts";

type RenderLine = { id: string; x1: number; x2: number; y: number; width: number; color: string; dashed: boolean };

export function findTimeBounds(time: number, data: readonly { time: Time }[]): readonly [{ time: Time }, { time: Time }] | null {
  if (data.length < 2) return null;
  let low = 0;
  let high = data.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((data[middle]!.time as number) < time) low = middle + 1;
    else high = middle;
  }
  const afterIndex = Math.min(data.length - 1, Math.max(1, low));
  return [data[afterIndex - 1]!, data[afterIndex]!];
}

export function findLatestCandleAtPrice(
  price: number,
  data: readonly CandlestickData<Time>[],
  from = 0,
  to = data.length - 1,
): CandlestickData<Time> | undefined {
  for (let index = Math.min(to, data.length - 1); index >= Math.max(0, from); index -= 1) {
    const candle = data[index]!;
    if (candle.low <= price && candle.high >= price) return candle;
  }
  return undefined;
}

class Renderer implements ISeriesPrimitivePaneRenderer {
  constructor(private readonly lines: readonly RenderLine[]) {}
  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
      ctx.save();
      for (const line of this.lines) {
        ctx.beginPath();
        ctx.strokeStyle = line.color;
        ctx.lineWidth = Math.max(1, line.width * vpr);
        ctx.setLineDash(line.dashed ? [6 * hpr, 4 * hpr] : []);
        ctx.moveTo(Math.round(line.x1 * hpr), Math.round(line.y * vpr));
        ctx.lineTo(Math.round(line.x2 * hpr), Math.round(line.y * vpr));
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

class PaneView implements ISeriesPrimitivePaneView {
  private lines: RenderLine[] = [];
  constructor(private readonly source: LargeOrderBookPrimitive) {}
  update(): void { this.lines = this.source.renderLines(); }
  renderer(): ISeriesPrimitivePaneRenderer { return new Renderer(this.lines); }
  zOrder(): SeriesPrimitivePaneViewZOrder { return "bottom"; }
}

/** Line width tier for a level, thicker when hovered. */
function widthForLevel(value: number, highlighted: boolean): number {
  const baseWidth = value >= 10_000_000 ? 7 : value >= 5_000_000 ? 4 : value >= 3_000_000 ? 2 : 1;
  return highlighted ? baseWidth + 3 : baseWidth;
}

/** Bid/ask color, dimmed for ended (historical) levels unless hovered. */
function colorForLevel(level: LargeOrderLevel, highlighted: boolean): string {
  const alpha = highlighted ? 1 : level.endedAt ? 0.25 : 0.78;
  return level.side === "bid" ? `rgba(14, 203, 129, ${alpha})` : `rgba(246, 70, 93, ${alpha})`;
}

export class LargeOrderBookPrimitive extends PluginBase {
  private levels: LargeOrderLevel[] = [];
  private hoveredId: string | null = null;
  private readonly view = new PaneView(this);
  private readonly hovers = new Map<string, LargeOrderLevel>();
  private readonly hitLines = new Map<string, RenderLine>();

  setLevels(levels: readonly LargeOrderLevel[]): void {
    this.levels = [...levels];
    this.requestUpdate();
  }
  setHoveredId(id: string | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.requestUpdate();
  }
  updateAllViews(): void { this.view.update(); }
  paneViews(): readonly ISeriesPrimitivePaneView[] { return [this.view]; }
  hoverData(id: string): LargeOrderLevel | undefined { return this.hovers.get(id); }
  hitTest(x: number, y: number) {
    for (const [id, line] of this.hitLines) {
      if (x >= line.x1 && x <= line.x2 && Math.abs(y - line.y) <= Math.max(4, line.width)) {
        return { externalId: id, cursorStyle: "crosshair", zOrder: "bottom" as const };
      }
    }
    return null;
  }

  renderLines(): RenderLine[] {
    this.hovers.clear();
    this.hitLines.clear();
    const ctx = this.renderContext();
    const lines: RenderLine[] = [];
    for (const level of this.levels) {
      const line = this.lineForLevel(level, ctx);
      if (!line) continue;
      lines.push(line);
      this.hovers.set(level.id, level);
      this.hitLines.set(level.id, line);
    }
    return lines;
  }

  private renderContext() {
    const right = this.chart.timeScale().width();
    const height = this.chart.paneSize().height;
    const data = this.series.data() as readonly CandlestickData<Time>[];
    const visibleRange = this.chart.timeScale().getVisibleLogicalRange();
    const firstVisible = visibleRange ? Math.max(0, Math.ceil(visibleRange.from)) : 0;
    const lastVisible = visibleRange ? Math.min(data.length - 1, Math.floor(visibleRange.to)) : data.length - 1;
    return { right, height, data, firstVisible, lastVisible };
  }

  /** The x-coordinate where a level's line should start: where price was last touched, or where it began/ended. */
  private startXForLevel(
    level: LargeOrderLevel,
    ctx: ReturnType<LargeOrderBookPrimitive["renderContext"]>,
  ): number | null {
    if (level.endedAt) return this.coordinateForTime(Date.parse(level.firstSeen) / 1000, ctx.data);
    const encounter = findLatestCandleAtPrice(level.price, ctx.data, ctx.firstVisible, ctx.lastVisible);
    if (encounter) return this.chart.timeScale().timeToCoordinate(encounter.time);
    return null;
  }

  private lineForLevel(
    level: LargeOrderLevel,
    ctx: ReturnType<LargeOrderBookPrimitive["renderContext"]>,
  ): RenderLine | null {
    const y = this.series.priceToCoordinate(level.price);
    if (y === null || y < 0 || y > ctx.height) return null;

    const x1 = this.startXForLevel(level, ctx);
    const x2 = level.endedAt ? this.coordinateForTime(Date.parse(level.endedAt) / 1000, ctx.data) : ctx.right;
    if (x1 === null || x2 === null || x2 < 0 || x1 > ctx.right) return null;

    const value = level.endedAt ? level.peakNotional : level.currentNotional;
    const highlighted = level.id === this.hoveredId;
    return {
      id: level.id,
      x1: Math.max(0, x1),
      x2: Math.min(ctx.right, x2),
      y,
      width: widthForLevel(value, highlighted),
      color: colorForLevel(level, highlighted),
      dashed: level.source === "okx",
    };
  }

  private coordinateForTime(time: number, data: readonly { time: Time }[]): number | null {
    const direct = this.chart.timeScale().timeToCoordinate(time as Time);
    if (direct !== null) return direct;
    const bounds = findTimeBounds(time, data);
    if (!bounds) return null;
    const [before, after] = bounds;
    const beforeX = this.chart.timeScale().timeToCoordinate(before.time);
    const afterX = this.chart.timeScale().timeToCoordinate(after.time);
    if (beforeX === null || afterX === null) return null;
    return beforeX + ((time - (before.time as number)) / ((after.time as number) - (before.time as number))) * (afterX - beforeX);
  }
}
