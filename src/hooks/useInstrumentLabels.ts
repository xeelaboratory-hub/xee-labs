type InstrumentType = "FOREX" | "FUTURES" | "CRYPTO" | "EQUITIES";

/**
 * Returns display labels and formatters for the current instrument type.
 * Xee.Labs only trades OKX/Binance perpetual futures (crypto swaps), so this
 * is fixed rather than derived per-account.
 */
export function useInstrumentLabels(): {
  instrumentType: InstrumentType;
  isFutures: boolean;
  unitLabel: string;
  unitLabelCap: string;
  formatQty: (qty: number) => string;
} {
  const instrumentType: InstrumentType = "FUTURES";

  return {
    instrumentType,
    isFutures: true,
    unitLabel: "contracts",
    unitLabelCap: "Contracts",
    formatQty: (qty: number) => `${Math.round(qty)} contracts`,
  };
}
