export type SessionMarket = "ASX" | "TOKYO" | "LONDON" | "NEW_YORK";

export interface OhlcvBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SessionWindow {
  market: SessionMarket;
  date: string;
  start: number;
  end: number;
}

export interface VolumeProfileRow {
  low: number;
  high: number;
  up: number;
  down: number;
  total: number;
  isValueArea: boolean;
}

export interface SessionVolumeProfile {
  market: SessionMarket;
  date: string;
  start: number;
  end: number;
  rows: VolumeProfileRow[];
  totalVolume: number;
  poc: number;
  vah: number;
  val: number;
  isDeveloping: boolean;
}

type MarketDefinition = {
  timeZone: string;
  ranges: ReadonlyArray<readonly [number, number]>;
};

const DAY = 86_400;
const VALUE_AREA_PERCENT = 0.7;

const MARKETS: Record<SessionMarket, MarketDefinition> = {
  ASX: { timeZone: "Australia/Sydney", ranges: [[10 * 60, 16 * 60]] },
  TOKYO: { timeZone: "Asia/Tokyo", ranges: [[9 * 60, 11 * 60 + 30], [12 * 60 + 30, 15 * 60 + 30]] },
  LONDON: { timeZone: "Europe/London", ranges: [[8 * 60, 16 * 60 + 30]] },
  NEW_YORK: { timeZone: "America/New_York", ranges: [[9 * 60 + 30, 16 * 60]] },
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, value);
  }
  return value;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function localParts(time: number, timeZone: string): LocalParts {
  const fields: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(new Date(time * 1_000))) {
    if (part.type !== "literal") fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year ?? 1970,
    month: fields.month ?? 1,
    day: fields.day ?? 1,
    hour: fields.hour ?? 0,
    minute: fields.minute ?? 0,
  };
}

function dateKey(parts: Pick<LocalParts, "year" | "month" | "day">): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day
    .toString()
    .padStart(2, "0")}`;
}

function parseDateKey(date: string): Pick<LocalParts, "year" | "month" | "day"> {
  const [year, month, day] = date.split("-").map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

function offsetAt(utcMs: number, timeZone: string): number {
  const parts = localParts(Math.floor(utcMs / 1_000), timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - utcMs;
}

function zonedTimeToUnix(
  date: Pick<LocalParts, "year" | "month" | "day">,
  minuteOfDay: number,
  timeZone: string,
): number {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let utcMs = guess - offsetAt(guess, timeZone);
  utcMs = guess - offsetAt(utcMs, timeZone);
  return Math.floor(utcMs / 1_000);
}

export function marketTimeZone(market: SessionMarket): string {
  return MARKETS[market].timeZone;
}

export function sessionDateAt(time: number, market: SessionMarket): string {
  return dateKey(localParts(time, MARKETS[market].timeZone));
}

export function sessionWindowForDate(date: string, market: SessionMarket): SessionWindow {
  const definition = MARKETS[market];
  const localDate = parseDateKey(date);
  const first = definition.ranges[0]!;
  const last = definition.ranges[definition.ranges.length - 1]!;
  return {
    market,
    date,
    start: zonedTimeToUnix(localDate, first[0], definition.timeZone),
    end: zonedTimeToUnix(localDate, last[1], definition.timeZone),
  };
}

export function isInSession(time: number, window: SessionWindow): boolean {
  if (sessionDateAt(time, window.market) !== window.date) return false;
  const definition = MARKETS[window.market];
  const parts = localParts(time, definition.timeZone);
  const minute = parts.hour * 60 + parts.minute;
  return definition.ranges.some(([start, end]) => minute >= start && minute < end);
}

/** The newest matching sessions in a visible chart range, including weekends. */
export function sessionWindowsInRange(
  from: number,
  to: number,
  market: SessionMarket,
  max = 10,
): SessionWindow[] {
  const candidates = new Set<string>();
  for (let time = from - 2 * DAY; time <= to + 2 * DAY; time += DAY) {
    candidates.add(sessionDateAt(time, market));
  }
  return [...candidates]
    .map((date) => sessionWindowForDate(date, market))
    .filter((window) => window.end > from && window.start < to)
    .sort((a, b) => b.start - a.start)
    .slice(0, max)
    .sort((a, b) => a.start - b.start);
}

function priceForRow(row: VolumeProfileRow): number {
  return (row.low + row.high) / 2;
}

function filterSessionBars(bars: readonly OhlcvBar[], window: SessionWindow): OhlcvBar[] {
  return bars.filter(
    (bar) =>
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.volume) &&
      bar.volume > 0 &&
      isInSession(bar.time, window),
  );
}

function buildEmptyRows(low: number, rowHeight: number, count: number): VolumeProfileRow[] {
  return Array.from({ length: count }, (_, index) => ({
    low: low + (rowHeight * index) / count,
    high: low + (rowHeight * (index + 1)) / count,
    up: 0,
    down: 0,
    total: 0,
    isValueArea: false,
  }));
}

/** Spreads one bar's volume evenly across the price rows it overlaps. */
function distributeBarVolume(
  rows: VolumeProfileRow[],
  bar: OhlcvBar,
  low: number,
  span: number,
  count: number,
): void {
  const start = span === 0 ? 0 : Math.min(count - 1, Math.max(0, Math.floor(((bar.low - low) / span) * count)));
  const end = span === 0 ? 0 : Math.min(count - 1, Math.floor(((bar.high - low) / span) * count));
  const volume = bar.volume / (end - start + 1);
  for (let index = start; index <= end; index++) {
    const row = rows[index]!;
    if (bar.close >= bar.open) row.up += volume;
    else row.down += volume;
    row.total += volume;
  }
}

function findPointOfControlIndex(rows: readonly VolumeProfileRow[]): number {
  let pocIndex = 0;
  for (let index = 1; index < rows.length; index++) {
    if (rows[index]!.total > rows[pocIndex]!.total) pocIndex = index;
  }
  return pocIndex;
}

/** The next row to add to the value area: the pricier neighbor on a tie. */
function pickNextRowToExpand(
  rows: readonly VolumeProfileRow[],
  valueLow: number,
  valueHigh: number,
): number | null {
  const above = valueHigh + 1 < rows.length ? valueHigh + 1 : null;
  const below = valueLow - 1 >= 0 ? valueLow - 1 : null;
  if (above === null && below === null) return null;
  const aboveVolume = above === null ? -1 : rows[above]!.total;
  const belowVolume = below === null ? -1 : rows[below]!.total;
  // Equal volumes intentionally choose the higher price row.
  return aboveVolume >= belowVolume ? above : below;
}

/** Grows the value area outward from the POC until ~70% of volume is captured. */
function expandValueArea(
  rows: VolumeProfileRow[],
  pocIndex: number,
  totalVolume: number,
): { valueLow: number; valueHigh: number } {
  let valueLow = pocIndex;
  let valueHigh = pocIndex;
  let valueVolume = rows[pocIndex]!.total;
  const target = totalVolume * VALUE_AREA_PERCENT;
  while (valueVolume < target) {
    const next = pickNextRowToExpand(rows, valueLow, valueHigh);
    if (next === null || valueVolume + rows[next]!.total > target) break;
    rows[next]!.isValueArea = true;
    valueVolume += rows[next]!.total;
    if (next > valueHigh) valueHigh = next;
    else valueLow = next;
  }
  return { valueLow, valueHigh };
}

export function calculateSessionVolumeProfile(
  window: SessionWindow,
  bars: readonly OhlcvBar[],
  requestedRows: number,
  now = Math.floor(Date.now() / 1_000),
): SessionVolumeProfile | null {
  const count = Math.min(100, Math.max(10, Math.round(requestedRows)));
  const sessionBars = filterSessionBars(bars, window);
  if (!sessionBars.length) return null;

  const low = Math.min(...sessionBars.map((bar) => bar.low));
  const high = Math.max(...sessionBars.map((bar) => bar.high));
  const span = high - low;
  const rowHeight = span || Math.max(Math.abs(low) * 1e-8, 1e-8);
  const rows = buildEmptyRows(low, rowHeight, count);

  for (const bar of sessionBars) {
    distributeBarVolume(rows, bar, low, span, count);
  }

  const totalVolume = rows.reduce((total, row) => total + row.total, 0);
  const pocIndex = findPointOfControlIndex(rows);
  const { valueLow, valueHigh } = expandValueArea(rows, pocIndex, totalVolume);
  rows[pocIndex]!.isValueArea = true;

  return {
    market: window.market,
    date: window.date,
    start: window.start,
    end: window.end,
    rows,
    totalVolume,
    poc: priceForRow(rows[pocIndex]!),
    vah: rows[valueHigh]!.high,
    val: rows[valueLow]!.low,
    isDeveloping: now >= window.start && now < window.end,
  };
}
