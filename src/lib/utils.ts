import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function formatDateFull(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(date));
}

export function pnlClass(value: number): string {
  if (value > 0) return "text-success";
  if (value < 0) return "text-destructive";
  return "text-muted-foreground";
}

/**
 * How many decimals a price on this instrument can actually have.
 *
 * Derived from the exchange's own tick size rather than assumed: a constant
 * rendered BTC as `77,280.30000` — four digits past anything OKX will quote —
 * on the number an order is built from. Falls back to 2 for a missing or
 * nonsensical tick, which is the safer direction: too few decimals hides
 * information, too many invent it.
 */
export function decimalsFromTick(tickSize: number | undefined): number {
  if (!tickSize || !Number.isFinite(tickSize) || tickSize <= 0) return 2;
  // A tick of 1 or coarser needs none; 0.1 needs one, 0.01 two, and so on.
  // toFixed(10) rather than String() so 1e-7 doesn't arrive in exponent form.
  const decimals = tickSize.toFixed(10).replace(/0+$/, "").split(".")[1]?.length ?? 0;
  return Math.min(decimals, 8);
}
