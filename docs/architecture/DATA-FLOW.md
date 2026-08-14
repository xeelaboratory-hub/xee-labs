# Data Flow and Backend Contract Map

This document maps how data moves through Xee.Labs today and defines the
frontend-facing contract a future (trading/accounts/auth) backend should
preserve. It complements [OVERVIEW.md](OVERVIEW.md): that file explains the
architecture; this file traces the data paths and integration boundary in
detail.

> Implementation details can drift. Verify exact method/event shapes against
> live code before implementing a backend.

**Status: market data is real; trading/accounts/auth are still demo.** A real
backend (`backend/`, FastAPI + CryptoFeed) now serves symbols, historical
candles, and live ticks/candle-updates for Binance and OKX perpetual futures.
Everything else the terminal needs — accounts, orders/positions, auth, chart
drawings, preferences — is still served by the in-browser demo layer
described below. This doc's "future backend" framing (§13, §14) now applies
to that remaining surface, not to market data.

## 1. System boundary

```text
UI components
    |
    +--> TanStack Query ---- REST-shaped/server state
    |
    +--> Zustand ----------- realtime/client state
              |
              v
       MarketDataBridge
              |
       +------+------+
       |             |
    api.ts          ws.ts
    facade          realtime facade
       |             |
       +------+---------------------------+------+
       |                                          |
  market data                            everything else
       |                                          |
       v                                          v
  REAL: backend/                         DEMO: demo layer
  FastAPI + CryptoFeed                   demo/api.ts, engine.ts,
  REST (/api/market-data/*)              bus.ts, candles.ts
  WebSocket (/ws)                        (accounts/orders/auth/
  live Binance + OKX data                 drawings; still local)
```

In production/Docker, nginx reverse-proxies `/api` and `/ws` from the
frontend origin to the `backend` container — see
[`nginx.conf`](../../nginx.conf) and
[OVERVIEW.md](OVERVIEW.md#the-real-backend-backend).

The key architectural rule is: **UI consumers should not depend directly on
`services/demo/*` or `backend/`.** The stable integration seam is
`services/api.ts`, `services/ws.ts`, and the shared data shapes in
`services/schemas.ts`.

`api.ts` is a `Proxy` over `demoApi` with four market-data methods
(`getSymbols`, `getTick`, `getCandles`, `getCandlesWithMeta`) overridden
ahead of it to call the real backend via `marketdataApi`
(`services/api/market-data.ts`); everything else, and any method neither
implements, falls through to `demoApi` or a benign no-op. `ws.ts` is a real
reconnecting WebSocket client to `backend/`'s `/ws` gateway that republishes
events onto the same synchronous in-process bus (`services/demo/bus.ts`) the
demo layer's `account`/`positions`/`orders` events still use.

## 2. Sources of truth

| Data | Primary frontend home | Current source | Notes |
|---|---|---|---|
| Symbols | Query + Zustand | **REAL**: `backend/` via `marketdataApi.getSymbols` | exchange-qualified ids, e.g. `BINANCE:BTCUSD` |
| Historical candles | TanStack Query | **REAL**: `backend/` via `marketdataApi.getCandlesWithMeta`/`getCandles` | REST-shaped snapshot/history + scroll-back pagination path |
| Positions | TanStack Query | demo engine + WS cache patches | 30s query refetch is a safety net |
| Orders | TanStack Query | demo engine + WS cache patches | 30s query refetch is a safety net |
| Fills / closed positions | TanStack Query | demo engine | refreshed after relevant mutations/events |
| Accounts snapshot | Query + Zustand account list | demo engine | equity updates patch Zustand directly |
| Live ticks | Zustand `ticks` | **REAL**: `backend/` `MarketTick` events via `ws.ts` | RAF-batched before committing to state; also drives `engine.mark()` |
| HFT live ticks | Zustand `liveTicks` | `HftLiveTick` events | consumer exists; neither the real backend nor demo mode currently emits these |
| Live candle update | Zustand `liveCandleUpdates` | **REAL**: `backend/` `CandleUpdate` events via `ws.ts` | 1-minute timeframe only — higher timeframes are built client-side from ticks |
| Replay state | Zustand | `ReplayStateChanged` | replay feature currently gated off |
| Auth/session | Zustand + localStorage | demo auth facade | real-auth-compatible shape retained |
| Drawings/templates/preferences | localStorage | browser | not server state today |

`useTradingStore` still contains `positions` and `orders` fields/loaders, but
the active terminal query path also keeps these as TanStack Query server-shaped
state. For future backend work, prefer **TanStack Query as the canonical home
for server state** and Zustand for realtime/ephemeral client state unless a
specific flow requires otherwise.

## 3. REST-shaped API contract used by the terminal

The current terminal-facing facade is `services/api.ts`. In demo mode the
implemented methods live in `services/demo/api.ts`.

### Auth/session

```text
login(...)
demoLogin()
register(...)
completeMfaLogin(...)
logout(...)
refreshToken(...)
getMyProfile()
getMe()
```

The auth store persists `access_token`, `refresh_token`, and `user` in
`localStorage`, connects `wsClient` after authentication, refreshes tokens
before expiry, and calls `wsClient.reauthenticate()` after refresh.

### Accounts

```text
getMyAccounts()
getAccount(accountId)
getEquityHistory(accountId)
getLedger(accountId, ...)
getAccountStats(accountId)
getAccountMetrics(accountId)
setAccountLabel(...)
```

### Market data

```text
getSymbols()                                          REAL — backend/
getCandles(symbol, timeframe, limit?, range?)         REAL — backend/
getCandlesWithMeta(symbol, timeframe, limit?, range?) REAL — backend/
getTick(symbol)                                       REAL — backend/
getMarketDataHealth()                                 demo stub, unchanged
getEconomicCalendar(...)                               demo stub, unchanged
```

The real methods are implemented in `services/api/market-data.ts`
(`marketdataApi`), overridden into `services/api.ts` ahead of `demoApi`. The
optional `range` param (`{ fromMs, toMs }`) is how `ChartPanel.tsx`'s
scroll-back pagination requests older history — the real backend's
`POST /api/market-data/candles/{symbol}` accepts `from`/`to` (unix ms) in the
request body for exactly this.

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
placeOrder(input)
cancelOrder(orderId)
modifyOrder(orderId, ...)
cancelAllOrders(...)
getOrders(accountId, status?)
getPositions(accountId)
getOpenPositionCount()
closePosition(positionId, quantity?)
closeAllPositions(accountId)
modifyPosition(positionId, modifications)
getFills(accountId, ...)
getClosedPositions(accountId, ...)
getClosedPositionsSummary(...)
getFillQuality(...)
```

The demo implementation is intentionally simpler than a future backend:
orders fill immediately, including LIMIT/STOP-shaped inputs. Do not treat demo
execution behavior as the required production trading model.

## 4. Shared schemas

`services/schemas.ts` is the current shared frontend contract. Core entities:

```text
User
Account
Order
Position
Fill
ClosedPosition
Symbol
Candle
PlaceOrderInput
```

Important compatibility notes:

- `Order.side`: `BUY | SELL`
- `Position.side`: `LONG | SHORT`
- `Order.type`: currently `MARKET | LIMIT | STOP`
- `PlaceOrderInput.type`: additionally accepts `STOP_LIMIT`; this is a current
  schema mismatch to resolve deliberately before production backend work.
- `Position.margin` defaults to `0`; comments in the schema explicitly allow a
  WS-sourced position to be corrected by a later REST sync.
- `Candle.time` is numeric; optional `timestamp` may be number or string.
- `SymbolSchema` and `CandleSchema` both carry an optional `exchange` field
  (added for the real backend, e.g. `"binance"` / `"okx"`) — optional because
  the demo layer's `Symbol`/`Candle` objects don't set it, and these schemas
  are never `.parse()`d at runtime (inferred types only), so this stays a
  loose, non-breaking addition rather than a validated contract.

A future backend should conform to these shapes or change the shared contract
explicitly rather than forcing UI components to learn backend-specific DTOs.

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

`subscribeAccounts()` is a no-op — accounts are still local/demo, unrelated to
the market-data WebSocket. `setSymbolInterest()` is also a no-op today, but
for a different reason than before: `ws.ts` now connects to the real
backend and always subscribes to its full 4-symbol universe on connect,
because the backend's `/ws` gateway has no per-symbol resubscribe — changing
symbol interest would require closing and reopening the connection. At the
backend's current small symbol count this is an accepted tradeoff, not a
bug; see `backend/app/api/ws_gateway.py` and
[OVERVIEW.md](OVERVIEW.md#the-real-backend-backend).

## 6. Channels and consumed events

`MarketDataBridge` is the global realtime consumer and is mounted above the
route `ErrorBoundary`, so route failures do not tear down the live-data
subscriptions.

### `market-data`

Consumed event shapes:

```ts
{ eventType: "MarketTick", symbol, bid, ask, occurredAt? }

{ eventType: "CandleUpdate", symbol, timeframe,
  open, high, low, close, volume, timestamp }

{ eventType: "CandleClosed", symbol, timeframe }

{ eventType: "ReplayStateChanged", action?, speed?, userId?, cursorTimestamp? }

{ eventType: "HftLiveTick", symbol, bid, ask, occurredAt? }
```

Current reality: the real backend's `/ws` gateway emits `MarketTick`,
`CandleUpdate`, and `CandleClosed` (all three) via `services/ws.ts`.
`ReplayStateChanged` and `HftLiveTick` are not emitted by anything today —
retained contract surface for the still-gated-off replay feature and a
future higher-frequency feed, respectively.

### `positions`

```ts
{
  eventType: "PositionOpened" | "PositionUpdated" | "PositionClosed";
  accountId: string;
  positionId: string;
  unrealizedPnl?: number;
  quantity?: number;
  averagePrice?: number;
  _entity?: Position;
}
```

`_entity` lets `PositionOpened` update the Query cache without a REST lookup.
If it is absent, the bridge falls back to a coalesced query invalidation.

### `orders`

```ts
{
  eventType: "OrderPlaced" | "OrderFilled" | "OrderCanceled" | "OrderAccepted" | string;
  accountId: string;
  orderId?: string;
  _entity?: Order;
}
```

Entity-enriched placed/filled/canceled events upsert the Query cache directly;
unknown or unenriched events fall back to coalesced invalidation.

### `account`

The important live event is:

```ts
{
  eventType: "EquityUpdated";
  accountId: string;
  equity?: number;
  balance?: number;
  freeMargin?: number;
  marginUsed?: number;
}
```

`AccountFailed`, `AccountPassed`, and `AccountFrozen` are also recognized and
trigger an account reload.

## 7. Market-data lifecycle

### Historical snapshot

```text
Chart / consumer
    -> useCandles(symbol, timeframe)
    -> api.getCandlesWithMeta(...)
    -> REAL: marketdataApi -> backend/ POST /api/market-data/candles/{symbol}
    -> TanStack Query cache
    -> chart
```

(Falls back to `demoApi -> demo/candles.ts -> bundled JSON`, timestamp-shifted
to "now," for any caller that bypasses the real-backend override — none do
today.) Real backend timestamps are genuine, never shifted.

### Realtime tick

```text
REAL backend/ MarketTick event
    -> services/ws.ts (WebSocket from backend/'s /ws gateway)
    -> publish("market-data", event) on demo/bus.ts
    -> wsClient.subscribe("market-data")
    -> MarketDataBridge
    -> useTradingStore.updateTick()
    -> RAF-batched Zustand tick state
    -> watchlist/chart/UI consumers
```

The same tick handler in `services/ws.ts` calls `engine.mark(symbol, price)`
directly (not via the bus), which can update positions/equity and trigger
SL/TP closes — this is how the paper-trading engine gets marked-to-market
against real prices.

### Live candles

The bridge's `CandleUpdate`/`CandleClosed` handling — previously retained
contract surface for a future transport — is now exercised for real:

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

This is the intended production pattern in practice: **REST for
snapshots/history, WS for incremental realtime changes, REST again for
reconciliation.**

## 8. Order -> position lifecycle

Current demo path:

```text
Order UI
    -> usePlaceOrder()
    -> api.placeOrder(input)
    -> demo/engine.placeOrder()
       -> create filled Order
       -> publish OrderPlaced
       -> publish OrderFilled
       -> create Position
       -> publish PositionOpened (_entity attached)
       -> recompute account
       -> publish EquityUpdated
    -> MarketDataBridge patches caches/store
    -> mutation onSuccess also invalidates order/position/account queries
```

The mutation invalidations are a consistency safety net. Realtime entity events
are the low-latency update path.

## 9. Position update / close lifecycle

On every real market tick for a symbol with open positions:

```text
market tick (from services/ws.ts, see §7)
    -> engine.mark()
    -> recalculate unrealized P&L
    -> PositionUpdated
    -> MarketDataBridge patches cached Position in place
    -> EquityUpdated
    -> Zustand account update
```

If TP/SL is hit:

```text
engine.mark()
    -> closePosition()
    -> PositionClosed
    -> bridge removes position from cache
    -> closedPositions query invalidated (coalesced)
    -> EquityUpdated
```

Partial closes emit `PositionUpdated` with the remaining quantity instead of a
`PositionClosed` tombstone.

## 10. Reconnect and consistency model

`MarketDataBridge` watches `wsClient` connection state. `ws.ts`'s reconnect
(capped/jittered backoff against the real backend's `/ws` gateway) drives
real `connecting`/`reconnecting`/`connected`/`disconnected` transitions today,
not just a theoretical state machine. When state transitions back to
`connected` after being disconnected, the bridge invalidates:

```text
[candles]
[positions]
[orders]
[accounts]
```

This is the gap-fill strategy for a real WebSocket: realtime events provide
speed; REST/query refetch provides eventual reconciliation after a connection
gap.

Positions and orders also have 30-second Query refetch intervals as a safety
net. Equity events deliberately do **not** cause an HTTP refetch per tick;
they patch the Zustand account state directly to avoid request floods.

## 11. Auth / transport lifecycle

```text
login / demoLogin / MFA completion
    -> access + refresh token stored
    -> Zustand auth state updated
    -> wsClient.connect(accessToken)

session restore
    -> read localStorage token
    -> refresh first if stale
    -> wsClient.connect(validToken)

token refresh
    -> update stored tokens
    -> wsClient.reauthenticate(newAccessToken)

logout
    -> revoke/logout API best-effort
    -> clear local auth/account selection
    -> wsClient.disconnect()
```

The retained real HTTP helper `services/api/request.ts` already provides bearer
auth, single-flight refresh on 401, timeout handling, and normalized API errors.
It is the preferred base HTTP transport when the real backend is connected.

## 12. Persistence boundary

Current persistence is intentionally split:

```text
Memory only (frontend):
  demo account / orders / positions / fills / last prices

Memory only (backend/, no DB):
  latest tick per symbol, latest candle per (symbol, timeframe), feed health
  — lost on backend restart; candles simply re-fetch from the exchange

localStorage:
  auth tokens + user
  active account selection
  chart drawings
  chart templates
  chart preferences

Bundled at build time:
  demo OHLC JSON (fallback only)
```

A future backend does not automatically imply moving chart-local preferences to
the server. That should be a separate product decision. Persistence for the
real market-data backend (raw per-exchange data stored separately, with
aggregation derived from raw rather than the other way around) is a stated
future requirement, not yet built.

## 13. Backend replacement plan — market data done, trading/accounts/auth remain

```text
MARKET DATA — DONE
UI -> api.ts -> marketdataApi (services/api/market-data.ts) -> backend/ REST
UI -> ws.ts  -> real WebSocket -> backend/'s /ws gateway

TRADING / ACCOUNTS / AUTH — STILL DEMO, NOT YET REPLACED
UI -> api.ts -> demoApi -> demo engine (in-browser, ephemeral, no persistence)
UI -> ws.ts  -> local bus (services/demo/bus.ts) -> demo engine events
```

Backend responsibilities, by status:

```text
DONE
  Market data + candle history            (backend/, REST + WS)
  A WebSocket gateway                     (backend/app/api/ws_gateway.py — market data only)

STILL TODO
  Auth/session
  Trading/order execution
  Positions/fills
  Accounts/equity/margin
  Persistence (both for market data — raw-per-exchange storage — and for
    trading/accounts state)
  A WebSocket gateway covering positions/orders/account events, not just
    market data
```

Do not couple UI components directly to exchange/provider-specific payloads.
Normalize provider data behind the backend/API boundary into the existing
Xee.Labs contracts — `backend/app/symbols.py`, `historical/`, and `schemas.py`
already do this for market data (Binance/OKX-specific shapes never reach the
frontend).

## 14. Contract checklist before connecting a real backend

A reusable checklist for replacing a demo-served surface with a real backend.
Annotated below with how it played out for **market data** (done) — the same
list applies again, unanswered, for the **trading/accounts/auth** surface
that's still demo-served.

1. ✅ REST response shapes match `services/schemas.ts` and active Query
   consumers — `backend/app/schemas.py`'s `Symbol`/`Candle` were extended
   (trading metadata fields, `exchange`) to match.
2. ✅ Candle metadata semantics (`isPartial`, `backfillQueued`, coverage
   start) are defined — see `backend/app/historical/service.py`.
3. ✅ WS channel names and event payloads match `MarketDataBridge`.
4. ⚠️ Ordering/idempotency rules for duplicate WS events are **not** defined
   — `backend/app/bus.py`'s per-connection queue silently drops events on
   overflow, with no sequence number or gap marker for the client to detect
   loss by. Acceptable at today's small symbol/tick volume; revisit before
   scaling up.
5. ⚠️ Reconnect is defined (capped/jittered backoff); **resubscription is
   not supported** — the backend's `/ws` gateway has no per-symbol
   resubscribe, so `ws.ts` always subscribes to the full symbol universe on
   connect instead (see §5).
6. ✅ REST snapshots reconcile state after missed WS events — reconnect
   triggers a `[candles]` invalidation (§10).
7. N/A for market data (no auth on `backend/`'s routes). Still applies,
   unanswered, when a trading/accounts backend is built.
8. Still open — unrelated to market data; the `OrderSchema` /
   `PlaceOrderInputSchema` mismatch is in the trading domain.
9. ✅ Demo mode remains available as an offline/local-development adapter —
   `services/demo/*` is untouched and still used for everything market data
   doesn't cover. Planned removal (Phase 4) is unscheduled — see
   [PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md).
10. ✅ Backend-specific DTOs are normalized at the adapter boundary —
    `services/api/market-data.ts` + `backend/app/symbols.py`/`historical/`
    keep Binance/OKX-specific shapes out of UI components.

## See also

- [OVERVIEW.md](OVERVIEW.md) — architecture overview.
- [../PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md) — durable project context.
- [../decisions/0003-protected-backend-integration-seams.md](../decisions/0003-protected-backend-integration-seams.md) — protected integration seams.
- [`src/components/MarketDataBridge.tsx`](../../src/components/MarketDataBridge.tsx) — live event consumer.
- [`src/services/schemas.ts`](../../src/services/schemas.ts) — shared entity contract.
