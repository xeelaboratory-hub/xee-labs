import type { DrawingLine } from "../pages/trading/constants.ts";

/**
 * Chart drawings — always local-only (no backend involved even in concept,
 * per docs/PROJECT-CONTEXT.md). Previously lived in services/demo/api.ts;
 * extracted so it survives the demo-layer removal unchanged.
 */
const DRAW_KEY = (symbol: string) => `oc_drawings_${symbol}`;

function readDrawings(symbol: string): DrawingLine[] {
  try {
    return JSON.parse(localStorage.getItem(DRAW_KEY(symbol)) ?? "[]");
  } catch {
    return [];
  }
}
function writeDrawings(symbol: string, list: DrawingLine[]): void {
  localStorage.setItem(DRAW_KEY(symbol), JSON.stringify(list));
}

export const localDrawings = {
  list: (symbol: string) => Promise.resolve(readDrawings(symbol)),
  save: (symbol: string, _tf: string, drawing: DrawingLine) => {
    const list = readDrawings(symbol).filter((d) => d.id !== drawing.id);
    list.push(drawing);
    writeDrawings(symbol, list);
    return Promise.resolve({ saved: true });
  },
  remove: (symbol: string, drawingId: string) => {
    writeDrawings(symbol, readDrawings(symbol).filter((d) => d.id !== drawingId));
    return Promise.resolve({ deleted: true });
  },
  clear: (symbol: string) => {
    writeDrawings(symbol, []);
    return Promise.resolve({ cleared: true });
  },
};
