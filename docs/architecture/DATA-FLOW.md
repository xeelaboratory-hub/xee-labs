# Data Flow and Backend Contract Map

This document maps how data moves through Xee.Labs. It complements
[OVERVIEW.md](OVERVIEW.md): that file explains the architecture; this file
traces the data paths and integration boundary in detail.

> Implementation details can drift. Verify exact method/event shapes against
> live code before relying on this document at face value.

**Status: everything is real.** Auth, accounts, trading, and market data are
all served by `backend/` — there is no demo/mock layer left anywhere in this
codebase (removed in Phase 4, 2026-08-16).

## 1. System boundary

```text
UI components
    |
    +--> TanStack Query ---- REST-shaped/server state (account, positions,
    |                        orders, trade history, symbols, candles)
    +--> Zustand ----------- realtime/client state (auth tokens, selected
              |              symbol, trading mode, tick cache)
              v
       MarketDataBridge
              |
       +------+------+
       |             |
    api.ts          ws.ts
    (REST facade)   (market-data WS facade)
       |             |
       v             v
              backend/
   FastAPI — auth (Postgres) + OKX trading + CryptoFeed market data
   REST (/api/auth/*, /api/credentials, /api/account, /api/positions,
         /api/orders, /api/positions/close, /api/trades/history,
         /api/market-data/*)
   WebSocket (/ws — market data only)
```

In production/Docker, nginx reverse-proxies `/api` and `/ws` from the
frontend origin to the `backend` container — see
[`nginx.conf`](../../nginx.conf) and
[OVERVIEW.md](OVERVIEW.md#the-real-backend-backend).

The key architectural rule is unchanged from before Phase 4: **UI consumers
should not depend directly on `backend/`.** The stable integration seam is
`services/api.ts`, `services/ws.ts`, and the shared data shapes in
`services/schemas.ts`.

`api.ts` is a plain object of real backend calls wrapped in a `Proxy` — any
method it doesn't implement throws a clear "not implemented" error rather
than silently succeeding. `ws.ts` is a real reconnecting WebSocket client to
`backend/`'s `/ws` gateway; it only carries market data (see §5, §10 for why
positions/orders/account don't have a WS path).

## 2. Sources of truth

| Data | Primary frontend home | Source | Notes |
|---|---|---|---|
| Symbols | Query + Zustand | `backend/` via `marketdataApi.getSymbols` | exchange-qualified ids, e.g. `BINANCE:BTCUSD` |
| Historical candles | TanStack Query | `backend/` via `marketdataApi.getCandlesWithMeta`/`getCandles` | REST-shaped snapshot/history + scroll-back pagination path |
| Live ticks | Zustand `ticks` | `backend/` `MarketTick` events via `ws.ts` | RAF-batched before committing to state |
| Live candle update | Zustand `liveCandleUpdates` | `backend/` `CandleUpdate` events via `ws.ts` | 1-minute timeframe only — higher timeframes are built client-side from ticks |
| HFT live ticks | Zustand `liveTicks` | `HftLiveTick` events | consumer exists; nothing currently emits these |
| Account (balance/equity/margin) | TanStack Query | **OKX**, via `backend/`'s `/api/account?mode=` | 15s refetch; no WS push |
| Positions | TanStack Query | **OKX**, via `backend/`'s `/api/positions?mode=` | 30s refetch + refetch after any trading mutation; no WS push |
| Orders (open) | TanStack Query | **OKX**, via `backend/`'s `/api/orders?mode=` | 30s refetch + refetch after any trading mutation; no WS push |
| Trade history | TanStack Query | **OKX**, via `backend/`'s `/api/trades/history?mode=` | flat fills log, not paired open/close records |
| Auth/session | Zustand + localStorage | `backend/`'s `/api/auth/*` | JWT access token + rotating/revocable refresh token |
| Exchange credentials | Query (on demand) | `backend/`'s `/api/credentials` | encrypted server-side; never returned in plaintext |
| Drawings/templates/preferences | localStorage | browser | not server state; unaffected by Phase 4 |

`useTradingStore` (Zustand) holds `mode: "demo" | "live"` — which OKX
environment (Demo Trading vs Live Trading) every trading call targets — plus
the selected chart symbol and the realtime tick/candle caches. It does
**not** hold positions/orders/account anymore; those are TanStack Query
state exclusively (`usePositions`, `useOrders`, `useAccount` in
`services/queries.ts`).

## 3. REST-shaped API contract used by the terminal

The terminal-facing facade is `services/api.ts`; every method it exposes
calls a real `backend/` endpoint (via `services/api/request.ts`, a typed
HTTP client with bearer auth, single-flight token refresh on 401, and
timeout handling).

### Auth/session

```text
login(email, password)
register(email, password, firstName, lastName)
refreshToken(refreshToken)
logout(refreshToken?)
getMe()
```

The auth store persists `access_token`, `refresh_token`, and `user` in
`localStorage`, connects `wsClient` after authentication, refreshes tokens
before expiry (`services/store.tsx`'s self-rescheduling refresh loop, backed
off with retries), and calls `wsClient.reauthenticate()` after refresh. Every
refresh call rotates the refresh token server-side — see
[OVERVIEW.md](OVERVIEW.md#the-real-backend-backend).

### Exchange credentials

```text
listCredentials()
createCredential({ exchange: "okx", isDemo, apiKey, apiSecret, passphrase, label? })
deleteCredential(id)
```

`listCredentials`/`createCredential` never return the plaintext
secret/passphrase — only id, exchange, `isDemo`, label, `createdAt`.

### Market data

```text
getSymbols()
getCandles(symbol, timeframe, limit?, range?)
getCandlesWithMeta(symbol, timeframe, limit?, range?)
getTick(symbol)
getMarketDataHealth()
getEconomicCalendar(...)
```

Implemented in `services/api/market-data.ts` (`marketdataApi`), re-exported
by `services/api.ts`. The optional `range` param (`{ fromMs, toMs }`) is how
`ChartPanel.tsx`'s scroll-back pagination requests older history — the
backend's `POST /api/market-data/candles/{symbol}` accepts `from`/`to`
(unix ms) in the request body for exactly this.

`useCandles()` expects `getCandlesWithMeta()` to return:

```ts
{
  candles: Candle[];
  metadata: {
    historicalCoverageStart: number | null;
    isPartial: boolean;
    backfillQueued: boolean;
  };
}
```

If `metadata.isPartial` is true, the query polls every 3 seconds until the
history is complete; otherwise its safety-net refresh interval is 5 minutes.

### Trading

```text
getAccount(mode)
getPositions(mode)
getOrders(mode)
placeOrder({ mode, symbol, side, type, quantity, price? })
cancelOrder(orderId, mode, symbol)
closePosition(positionId, mode, quantity?)
getTradeHistory(mode)
```

`mode` is `"demo" | "live"` throughout — which OKX credential (and which OKX
environment) the call targets. `symbol` is always our internal symbol id
(`"OKX:BTCUSD"`), never OKX's native instId — the backend translates at the
boundary (`app/api/trading.py`'s `_okx_native_symbol()`), and rejects an
unknown or non-OKX symbol with a 400 before ever calling OKX.

`positionId` is a composite string —
`"{symbolId}:{okxPosSide}:{ourDerivedSide}"` (e.g.
`"OKX:BTCUSD:net:long"`) — parsed from the end in `api.ts`'s
`closePosition()` since the symbol id itself contains a colon. `okxPosSide`
(OKX's raw `long`/`short`/`net`) is required verbatim for a full
close-position call; `ourDerivedSide` (`LONG`/`SHORT`) picks the reduce-only
order direction for a partial close.

**Not implemented** (intentionally — see
[PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md)): STOP orders, take-profit/
stop-loss on placement or on an existing position, amending a pending order.
`api.ts`'s `modifyPosition`/`modifyOrder` always reject.

## 4. Shared schemas

`services/schemas.ts` is the current shared frontend contract. Core
entities, reshaped in Phase 4 to match what OKX actually returns (dropped
every PropSim-era field with no real-exchange equivalent — `accountId`,
`templateId`, `phase`, `comment`, challenge-account fields, …):

```text
User
Account            — { balance, equity, margin, freeMargin } only
Order              — id, symbolName, side, type (MARKET|LIMIT), quantity,
                      price, status, filledQuantity, avgFillPrice, timestamps
Position           — id, symbolName, side, quantity, entryPrice,
                      currentPrice, unrealizedPnl, margin, openedAt,
                      takeProfit/stopLoss (always null — not wired up)
TradeHistoryEntry   — id, symbolName, side, quantity, price, fee,
                      realizedPnl, timestamp (flat fills log, not a
                      paired open/close record — OKX doesn't expose
                      position-lifecycle pairing)
Symbol
Candle
PlaceOrderInput     — { mode, symbol, side, type: MARKET|LIMIT, quantity, price? }
```

- `Order.side` / `PlaceOrderInput.side`: `BUY | SELL`
- `Position.side`: `LONG | SHORT`
- `Order.type` / `PlaceOrderInput.type`: `MARKET | LIMIT` only (no `STOP`,
  no `STOP_LIMIT` — see §3).
- `Candle.time` is numeric; optional `timestamp` may be number or string.
- `SymbolSchema` and `CandleSchema` both carry an optional `exchange` field
  (`"binance"` / `"okx"`) — optional because these schemas are never
  `.parse()`d at runtime (inferred types only), so this stays a loose,
  non-breaking addition rather than a validated contract.

## 5. WebSocket public surface

The frontend expects `wsClient` to provide:

```text
connect(token?)
disconnect()
reauthenticate(token)
subscribe(channel, handler) -> unsubscribe
subscribeAccounts(accountIds)
setSymbolInterest(symbols)
onStateChange(callback) -> unsubscribe
state: connected | connecting | reconnecting | disconnected
```

`subscribeAccounts()` and `setSymbolInterest()` are both no-ops today.
`subscribeAccounts()` because there's no account/position/order WS channel
at all (see §10 for why, and how positions/orders/account stay fresh
without one). `setSymbolInterest()` because `ws.ts` connects to the real
backend and always subscribes to its full 4-symbol universe on connect — the
backend's `/ws` gateway has no per-symbol resubscribe, so changing symbol
interest would require closing and reopening the connection. At the
backend's current small symbol count this is an accepted tradeoff; see
`backend/app/api/ws_gateway.py` and
[OVERVIEW.md](OVERVIEW.md#the-real-backend-backend).

## 6. Channels and consumed events

`MarketDataBridge` is the global realtime consumer and is mounted above the
route `ErrorBoundary`, so route failures do not tear down the live-data
subscription.

### `market-data`

Consumed event shapes:

```ts
{ eventType: "MarketTick", symbol, bid, ask, occurredAt? }

{ eventType: "CandleUpdate", symbol, timeframe,
  open, high, low, close, volume, timestamp }

{ eventType: "CandleClosed", symbol, timeframe }

{ eventType: "HftLiveTick", symbol, bid, ask, occurredAt? }
```

The backend's `/ws` gateway emits `MarketTick`, `CandleUpdate`, and
`CandleClosed`. `HftLiveTick` is not emitted by anything today — retained
contract surface for a possible future higher-frequency feed.

There is no `positions` / `orders` / `account` channel — removed in Phase 4
along with the in-browser paper-trading engine that used to publish them
locally. See §10 for the REST-polling replacement.

## 7. Market-data lifecycle

### Historical snapshot

```text
Chart / consumer
    -> useCandles(symbol, timeframe)
    -> api.getCandlesWithMeta(...)
    -> marketdataApi -> backend/ POST /api/market-data/candles/{symbol}
    -> TanStack Query cache
    -> chart
```

Timestamps are always genuine — nothing shifts or synthesizes candle data.

### Realtime tick

```text
backend/ MarketTick event
    -> services/ws.ts (WebSocket from backend/'s /ws gateway)
    -> publish("market-data", event) on services/eventBus.ts
    -> wsClient.subscribe("market-data")
    -> MarketDataBridge
    -> useTradingStore.updateTick()
    -> RAF-batched Zustand tick state
    -> watchlist/chart/UI consumers
```

### Live candles

```text
backend/ CandleUpdate (1m only)
    -> services/ws.ts -> market-data channel
    -> MarketDataBridge
    -> updateCandleFromWs()
    -> Zustand liveCandleUpdates
    -> chart (1m timeframe; higher timeframes build the live bar from ticks
       client-side instead, since the backend only streams 1m candles)

backend/ CandleClosed
    -> services/ws.ts -> market-data channel
    -> MarketDataBridge
    -> invalidate [candles, symbol, timeframe]
    -> REST history reconciliation
```

This is the intended pattern: **REST for snapshots/history, WS for
incremental realtime changes, REST again for reconciliation.**

## 8. Order -> position lifecycle

```text
Order UI
    -> usePlaceOrder()
    -> api.placeOrder({ mode, symbol, side, type, quantity, price? })
    -> backend/ resolves the caller's encrypted OKX credential for (user, mode)
    -> backend/ translates symbol -> OKX native instId
    -> backend/ signs + sends POST /api/v5/trade/order to OKX
    -> OKX accepts (sCode "0") or rejects (real error message forwarded as 502)
    -> onSuccess: invalidateQueries(["orders", mode]), (["positions", mode]),
       (["account", mode])
    -> next poll (or the invalidated refetch, which fires immediately)
       picks up the new order/position/balance from OKX
```

There is no local order/position creation and no synthetic fill — every
order placement is a real signed request to OKX, and every position/order
the UI shows afterward is re-derived from OKX's own state on the next fetch,
not predicted client-side.

## 9. Position update / close lifecycle

Positions are **not** updated by marking against local ticks anymore —
`unrealizedPnl`/`currentPrice` come directly from OKX's own
`GET /api/v5/account/positions` response on each poll. There is no
client-side P&L simulation.

```text
usePositions(mode) — 30s refetchInterval
    -> backend/ GET /api/positions?mode=
    -> OKX GET /api/v5/account/positions
    -> mapped to Position[] (see OVERVIEW.md's app/exchange/mapping.py)
    -> TanStack Query cache
    -> PositionsTable / chart position lines
```

Closing (full or partial):

```text
useClosePosition()
    -> api.closePosition(positionId, mode, quantity?)
    -> backend/ POST /api/positions/close?mode=
         quantity omitted -> OKX POST /api/v5/trade/close-position (posSide verbatim)
         quantity given   -> OKX POST /api/v5/trade/order (reduce-only, opposite side)
    -> onSuccess: invalidateQueries positions/account/tradeHistory for mode
```

## 10. Reconnect and consistency model

`MarketDataBridge` watches `wsClient` connection state. `ws.ts`'s reconnect
(capped/jittered backoff against the real backend's `/ws` gateway) drives
real `connecting`/`reconnecting`/`connected`/`disconnected` transitions.
When state transitions back to `connected` after being disconnected, the
bridge invalidates:

```text
[candles]
[positions]
[orders]
["accounts"]  (query-key prefix used by useAccount)
```

**Why positions/orders/account are REST-polled, not WS-pushed:** the
backend's `/ws` gateway only streams market data — wiring OKX's private WS
channels (which need their own login handshake per connection) into the
backend is a distinct, not-yet-scoped piece of work. Until then, the
30s (positions/orders) / 15s (account) `refetchInterval`s are the *primary*
update path, not a safety net on top of a WS push — this is the inverse of
the pre-Phase-4 design, where WS-pushed cache patches were primary and
mutation-triggered invalidation was the safety net.

## 11. Auth / transport lifecycle

```text
login / register
    -> access + refresh token stored (localStorage)
    -> Zustand auth state updated
    -> wsClient.connect(accessToken)

session restore
    -> read localStorage token
    -> refresh first if stale (within 5 min of expiry)
    -> wsClient.connect(validToken)

token refresh
    -> POST /api/auth/refresh — server rotates the refresh token
    -> update stored tokens
    -> wsClient.reauthenticate(newAccessToken)

logout
    -> POST /api/auth/logout (best-effort, revokes the refresh token server-side)
    -> clear local auth state
    -> wsClient.disconnect()
```

`services/api/request.ts` provides bearer auth, single-flight refresh on
401, timeout handling, and normalized API errors — including reading
FastAPI's default `{detail: "..."}` error shape (most `backend/` errors use
this, not a custom `{error: {message}}` envelope) so a real OKX rejection
message reaches the user instead of a generic `res.statusText` fallback.

## 12. Persistence boundary

```text
Postgres (backend/, via Alembic migrations):
  users, refresh_tokens (hashed, revocable), exchange_credentials (Fernet-
  encrypted API keys/secrets/passphrases)

Memory only (backend/, no DB):
  latest tick per symbol, latest candle per (symbol, timeframe), feed health
  — lost on backend restart; candles simply re-fetch from the exchange

OKX (source of truth, not cached in our DB):
  account balance/equity/margin, open positions, open orders, fills/trade
  history — every read is a live call to OKX, never served from a local copy

localStorage (frontend):
  auth tokens + user
  trading mode (demo | live)
  chart drawings
  chart templates
  chart preferences
```

Raw per-exchange market-data persistence (so history isn't bounded by each
exchange's own REST retention) remains a stated future requirement, not yet
built — unrelated to the auth/trading Postgres tables added in Phase 4.

## See also

- [OVERVIEW.md](OVERVIEW.md) — architecture overview.
- [../PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md) — durable project context.
- [`src/components/MarketDataBridge.tsx`](../../src/components/MarketDataBridge.tsx) — live event consumer.
- [`src/services/schemas.ts`](../../src/services/schemas.ts) — shared entity contract.
- [`backend/app/api/trading.py`](../../backend/app/api/trading.py) — the OKX trading endpoints.
