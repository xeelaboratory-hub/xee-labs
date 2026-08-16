import { z } from "zod";

// ── Auth ──────────────────────────────────────────────────
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  roles: z.array(z.string()),
  status: z.string(),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: UserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ── Trading mode: which OKX environment an action targets ──
export const TradingModeSchema = z.enum(["demo", "live"]);
export type TradingMode = z.infer<typeof TradingModeSchema>;

// ── Accounts ──────────────────────────────────────────────
// Backed by OKX's account/balance endpoint (backend/app/exchange/mapping.py
// okx_balance_to_account) — no PropSim multi-account/challenge concept here,
// just the live balance for whichever mode (demo|live) is selected.
export const AccountSchema = z.object({
  balance: z.number(),
  equity: z.number(),
  margin: z.number(),
  freeMargin: z.number(),
});
export type Account = z.infer<typeof AccountSchema>;

// ── Trading ───────────────────────────────────────────────
export const OrderSchema = z.object({
  id: z.string(),
  symbolName: z.string(),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]),
  quantity: z.number(),
  price: z.number().nullable(),
  status: z.string(),
  filledQuantity: z.number(),
  avgFillPrice: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Order = z.infer<typeof OrderSchema>;

export const PositionSchema = z.object({
  id: z.string(),
  symbolName: z.string(),
  side: z.enum(["LONG", "SHORT"]),
  quantity: z.number(),
  entryPrice: z.number(),
  currentPrice: z.number().nullable().optional(),
  unrealizedPnl: z.number(),
  margin: z.number().default(0),
  contractSize: z.number().optional(),
  openedAt: z.string(),
  takeProfit: z.number().nullable(),
  stopLoss: z.number().nullable(),
});
export type Position = z.infer<typeof PositionSchema>;

// Single trade execution (OKX fills-history) — not a paired open/close
// position lifecycle, just a log row: symbol, side, price, fee, pnl, time.
export const TradeHistoryEntrySchema = z.object({
  id: z.string(),
  symbolName: z.string(),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number(),
  price: z.number(),
  fee: z.number(),
  realizedPnl: z.number(),
  timestamp: z.string(),
});
export type TradeHistoryEntry = z.infer<typeof TradeHistoryEntrySchema>;

export const SymbolSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().nullable(),
  exchange: z.string().optional(),
  category: z.string(),
  contractSize: z.number(),
  tickSize: z.number(),
  tickValue: z.number(),
  marginPercent: z.number(),
  maxLeverage: z.number(),
  commission: z.number(),
  swapLong: z.number(),
  swapShort: z.number(),
  tradingHoursStart: z.string().nullable(),
  tradingHoursEnd: z.string().nullable(),
  isActive: z.boolean(),
});
export type Symbol = z.infer<typeof SymbolSchema>;

export const CandleSchema = z.object({
  time: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  timestamp: z.union([z.number(), z.string()]).optional(),
  exchange: z.string().optional(),
});
export type Candle = z.infer<typeof CandleSchema>;

// ── Paginated responses ───────────────────────────────────
export const PaginatedSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    totalPages: z.number(),
  });

// ── Input schemas (for validation) ────────────────────────
// STOP orders and take-profit/stop-loss are not sent to the backend yet —
// OKX conditional/algo orders aren't wired up (see OrderPanel.tsx). Kept as
// optional fields so the UI can still round-trip them locally without the
// backend silently dropping them.
export const PlaceOrderInputSchema = z.object({
  mode: TradingModeSchema,
  symbol: z.string().min(1).max(20),
  side: z.enum(["BUY", "SELL"]),
  type: z.enum(["MARKET", "LIMIT"]),
  quantity: z.number().positive().max(1000),
  price: z.number().positive().optional(),
});
export type PlaceOrderInput = z.infer<typeof PlaceOrderInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const RegisterInputSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
});
export type RegisterInput = z.infer<typeof RegisterInputSchema>;
