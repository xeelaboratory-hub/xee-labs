/**
 * AI trader was a PropSim-specific feature and is not part of Xee.Labs.
 * The panel is gated off (api.isAiTraderEnabled resolves false), so these stubs
 * exist only to satisfy the import in TradingPage and never render.
 */
export function AiTraderPanel(_props: { mode: string }) {
  return null;
}

export function AiTraderPage() {
  return null;
}
