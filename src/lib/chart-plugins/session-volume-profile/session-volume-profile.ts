import type { CanvasRenderingTarget2D } from "fancy-canvas";
import type {
  ISeriesPrimitiveAxisView,
  ISeriesPrimitivePaneRenderer,
  ISeriesPrimitivePaneView,
  SeriesPrimitivePaneViewZOrder,
  Time,
} from "lightweight-charts";
import type { SessionVolumeProfile, VolumeProfileRow } from "../../session-volume-profile.ts";
import { PluginBase } from "../plugin-base.ts";

export interface SessionVolumeProfileHover {
  market: string;
  date: string;
  low: number;
  high: number;
  up: number;
  down: number;
  total: number;
  percent: number;
}

type RenderRow = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  upWidth: number;
  isValueArea: boolean;
  hover: SessionVolumeProfileHover;
};

type RenderProfile = {
  startX: number;
  endX: number;
  rows: RenderRow[];
  pocY: number | null;
  vahY: number | null;
  valY: number | null;
  label: string;
};

class SessionVolumeProfileRenderer implements ISeriesPrimitivePaneRenderer {
  constructor(private readonly profiles: readonly RenderProfile[]) {}

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const hpr = scope.horizontalPixelRatio;
      const vpr = scope.verticalPixelRatio;
      ctx.save();
      for (const profile of this.profiles) {
        for (const row of profile.rows) {
          const x = Math.round(row.x * hpr);
          const y = Math.round(row.y * vpr);
          const width = Math.max(1, Math.round(row.width * hpr));
          const height = Math.max(1, Math.round(row.height * vpr));
          const upWidth = Math.round(row.upWidth * hpr);
          const alpha = row.isValueArea ? 0.58 : 0.22;
          ctx.fillStyle = `rgba(246, 70, 93, ${alpha})`;
          ctx.fillRect(x, y, width - upWidth, height);
          ctx.fillStyle = `rgba(14, 203, 129, ${alpha})`;
          ctx.fillRect(x + width - upWidth, y, upWidth, height);
        }
        ctx.lineWidth = Math.max(1, hpr);
        ctx.strokeStyle = "rgba(240, 185, 11, 0.95)";
        this.line(ctx, profile.startX, profile.endX, profile.pocY, hpr, vpr, []);
        ctx.strokeStyle = "rgba(146, 158, 181, 0.72)";
        this.line(ctx, profile.startX, profile.endX, profile.vahY, hpr, vpr, [4, 3]);
        this.line(ctx, profile.startX, profile.endX, profile.valY, hpr, vpr, [4, 3]);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(146, 158, 181, 0.8)";
        ctx.font = `${Math.max(9, 10 * hpr)}px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif`;
        ctx.fillText(profile.label, Math.round((profile.startX + 3) * hpr), Math.round(13 * vpr));
      }
      ctx.restore();
    });
  }

  private line(
    ctx: CanvasRenderingContext2D,
    startX: number,
    endX: number,
    y: number | null,
    hpr: number,
    vpr: number,
    dash: number[],
  ): void {
    if (y === null) return;
    ctx.setLineDash(dash.map((value) => value * hpr));
    ctx.beginPath();
    ctx.moveTo(Math.round(startX * hpr), Math.round(y * vpr));
    ctx.lineTo(Math.round(endX * hpr), Math.round(y * vpr));
    ctx.stroke();
  }
}

class SessionVolumeProfilePaneView implements ISeriesPrimitivePaneView {
  private renderedProfiles: RenderProfile[] = [];

  constructor(private readonly source: SessionVolumeProfilePrimitive) {}

  update(): void {
    this.renderedProfiles = this.source.renderProfiles();
  }

  renderer(): ISeriesPrimitivePaneRenderer {
    return new SessionVolumeProfileRenderer(this.renderedProfiles);
  }

  zOrder(): SeriesPrimitivePaneViewZOrder {
    return "bottom";
  }
}

class LevelAxisView implements ISeriesPrimitiveAxisView {
  constructor(
    private readonly source: SessionVolumeProfilePrimitive,
    private readonly kind: "POC" | "VAH" | "VAL",
    private readonly color: string,
  ) {}

  coordinate(): number {
    return this.source.latestLevelCoordinate(this.kind) ?? -10_000;
  }

  text(): string {
    const value = this.source.latestLevel(this.kind);
    return value === null ? this.kind : `${this.kind} ${this.source.formatPrice(value)}`;
  }

  textColor(): string {
    return "#ffffff";
  }

  backColor(): string {
    return this.color;
  }

  visible(): boolean {
    return this.source.latestLevel(this.kind) !== null;
  }

  tickVisible(): boolean {
    return true;
  }
}

/** Canvas primitive based on Lightweight Charts' official Volume Profile example. */
export class SessionVolumeProfilePrimitive extends PluginBase {
  private profiles: SessionVolumeProfile[] = [];
  private readonly paneViewList = [new SessionVolumeProfilePaneView(this)];
  private readonly axisViews: readonly ISeriesPrimitiveAxisView[] = [
    new LevelAxisView(this, "POC", "#b58105"),
    new LevelAxisView(this, "VAH", "#4b5c7a"),
    new LevelAxisView(this, "VAL", "#4b5c7a"),
  ];
  private readonly hovers = new Map<string, SessionVolumeProfileHover>();
  private readonly hoverRects = new Map<string, Pick<RenderRow, "x" | "y" | "width" | "height">>();

  setProfiles(profiles: readonly SessionVolumeProfile[]): void {
    this.profiles = [...profiles];
    this.requestUpdate();
  }

  hoverData(id: string): SessionVolumeProfileHover | undefined {
    return this.hovers.get(id);
  }

  updateAllViews(): void {
    for (const view of this.paneViewList) view.update();
  }

  paneViews(): readonly ISeriesPrimitivePaneView[] {
    return this.paneViewList;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  hitTest(x: number, y: number) {
    for (const id of this.hovers.keys()) {
      const rect = this.hoverRects.get(id);
      if (rect && x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
        return { externalId: id, cursorStyle: "crosshair", zOrder: "bottom" as const };
      }
    }
    return null;
  }

  latestLevel(kind: "POC" | "VAH" | "VAL"): number | null {
    const latest = this.profiles[this.profiles.length - 1];
    if (!latest) return null;
    return kind === "POC" ? latest.poc : kind === "VAH" ? latest.vah : latest.val;
  }

  latestLevelCoordinate(kind: "POC" | "VAH" | "VAL"): number | null {
    const value = this.latestLevel(kind);
    return value === null ? null : this.series.priceToCoordinate(value);
  }

  formatPrice(value: number): string {
    return this.series.priceFormatter().format(value);
  }

  renderProfiles(): RenderProfile[] {
    this.hovers.clear();
    this.hoverRects.clear();
    const result: RenderProfile[] = [];
    for (const profile of this.profiles) {
      const startX = this.coordinateForTime(profile.start);
      const endX = this.coordinateForTime(profile.end);
      if (startX === null || endX === null || endX <= startX) continue;
      const maxWidth = (endX - startX) * 0.3;
      const maxVolume = Math.max(...profile.rows.map((row) => row.total), 0);
      if (maxVolume <= 0) continue;
      const rows: RenderRow[] = [];
      for (let index = 0; index < profile.rows.length; index++) {
        const row = profile.rows[index]!;
        const top = this.series.priceToCoordinate(row.high);
        const bottom = this.series.priceToCoordinate(row.low);
        if (top === null || bottom === null || row.total <= 0) continue;
        const width = (maxWidth * row.total) / maxVolume;
        const upWidth = width * (row.up / row.total);
        const id = `session-volume-profile:${profile.market}:${profile.date}:${index}`;
        const hover = this.hoverFor(profile, row);
        const renderRow: RenderRow = {
          id,
          x: endX - width,
          y: Math.min(top, bottom),
          width,
          height: Math.max(1, Math.abs(bottom - top)),
          upWidth,
          isValueArea: row.isValueArea,
          hover,
        };
        rows.push(renderRow);
        this.hovers.set(id, hover);
        this.hoverRects.set(id, renderRow);
      }
      result.push({
        startX,
        endX,
        rows,
        pocY: this.series.priceToCoordinate(profile.poc),
        vahY: this.series.priceToCoordinate(profile.vah),
        valY: this.series.priceToCoordinate(profile.val),
        label: `${profile.market} · ${profile.date}`,
      });
    }
    return result;
  }

  private coordinateForTime(time: number): number | null {
    const direct = this.chart.timeScale().timeToCoordinate(time as Time);
    if (direct !== null) return direct;
    const data = this.series.data();
    if (!data.length) return null;
    let before = data[0]!;
    let after = data[data.length - 1]!;
    for (const item of data) {
      const itemTime = item.time as number;
      if (itemTime <= time) before = item;
      if (itemTime >= time) {
        after = item;
        break;
      }
    }
    const beforeTime = before.time as number;
    const afterTime = after.time as number;
    const beforeX = this.chart.timeScale().timeToCoordinate(before.time);
    const afterX = this.chart.timeScale().timeToCoordinate(after.time);
    if (beforeX === null || afterX === null) return null;
    if (beforeTime === afterTime) return beforeX;
    return beforeX + ((time - beforeTime) / (afterTime - beforeTime)) * (afterX - beforeX);
  }

  private hoverFor(profile: SessionVolumeProfile, row: VolumeProfileRow): SessionVolumeProfileHover {
    return {
      market: profile.market,
      date: profile.date,
      low: row.low,
      high: row.high,
      up: row.up,
      down: row.down,
      total: row.total,
      percent: profile.totalVolume ? (row.total / profile.totalVolume) * 100 : 0,
    };
  }
}
