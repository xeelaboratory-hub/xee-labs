# Data Flow and Backend Contract Map

This document maps how data moves through Xee.Labs today and defines the
frontend-facing contract a future backend should preserve. It complements
[OVERVIEW.md](OVERVIEW.md): that file explains the architecture; this file
traces the data paths and integration boundary in detail.

> Implementation details can drift. Verify exact method/event shapes against
> live code before implementing a backend.

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
       +------+------+
              |
        CURRENT: demo layer
        demo/api.ts
        demo/bus.ts
        demo/feed.ts
        demo/engine.ts
        demo/candles.ts

              || swap boundary ||

        FUTURE: real backend
        HTTP API + WebSocket gateway
```

The key architectural rule is: **UI consumers should not depend directly on
`services/demo/*`.** The stable integration seam is `services/api.ts`,
`services/ws.ts`, and the shared data shapes in `services/schemas.ts`.

Today `api.ts` is a `Proxy` over `demoApi`; missing methods resolve to a benign
`null` promise. `ws.ts` exposes a WebSocket-like public surface but is backed
by the synchronous in-process bus in `services/demo/bus.ts`.

## 2. Sources of truth

| Data | Primary frontend home | Current source | Notes |
|---|---|---|---|
| Historical candles | TanStack Query | `demo/candles.ts` via `demoApi` | REST-shaped snapshot/history path |
| Positions | TanStack Query | demo engine + WS cache patches | 30s query refetch is a safety net |
| Orders | TanStack Query | demo engine + WS cache patches | 30s query refetch is a safety net |
| Fills / closed positions | TanStack Query | demo engine | refreshed after relevant mutations/events |
| Accounts snapshot | Query + Zustand account list | demo engine | equity updates patch Zustand directly |
| Live ticks | Zustand `ticks` | `market-data` events | RAF-batched before committing to state |
| HFT live ticks | Zustand `liveTicks` | `HftLiveTick` events | consumer exists; demo feed does not currently emit these |
| Live candle update | Zustand `liveCandleUpdates` | `CandleUpdate` events | consumer exists; demo feed currently emits only `MarketTick` |
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
getSymbols()
getCandles(symbol, timeframe, limit?)
getCandlesWithMeta(symbol, timeframe, limit?)
getTick(symbol)
getMarketDataHealth()
getEconomicCalendar(...)
```

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

In demo mode `subscribeAccounts()` and `setSymbolInterest()` are no-ops because
the local feed broadcasts everything. They are deliberate extension points for
a real backend.

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

Current demo reality: `demo/feed.ts` publishes `MarketTick` only. The other
handlers are retained contract surface for richer/future transports.

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
    -> CURRENT: demoApi -> demo/candles.ts -> bundled JSON
    -> TanStack Query cache
    -> chart
```

The demo shifts candle timestamps so the newest real historical bar aligns to
the current period. OHLC values remain historical values.

### Realtime tick

```text
CURRENT demo/feed.ts
    -> publish("market-data", MarketTick)
    -> demo/bus.ts
    -> wsClient.subscribe("market-data")
    -> MarketDataBridge
    -> useTradingStore.updateTick()
    -> RAF-batched Zustand tick state
    -> watchlist/chart/UI consumers
```

The same demo tick calls `engine.mark(symbol, price)`, which can update
positions/equity and trigger SL/TP closes.

### Future live candles

The bridge already supports:

```text
backend CandleUpdate
    -> market-data channel
    -> MarketDataBridge
    -> updateCandleFromWs()
    -> Zustand liveCandleUpdates
    -> chart

backend CandleClosed
    -> MarketDataBridge
    -> invalidate [candles, symbol, timeframe]
    -> REST history reconciliation
```

This gives the intended production pattern: **REST for snapshots/history, WS
for incremental realtime changes, REST again for reconciliation.**

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

On every demo mark for a symbol with open positions:

```text
market tick
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

`MarketDataBridge` watches `wsClient` connection state. When state transitions
back to `connected` after being disconnected, it invalidates:

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
Memory only:
  demo account / orders / positions / fills / last prices

localStorage:
  auth tokens + user
  active account selection
  chart drawings
  chart templates
  chart preferences

Bundled at build time:
  demo OHLC JSON
```

A future backend does not automatically imply moving chart-local preferences to
the server. That should be a separate product decision.

## 13. Future backend replacement plan

The desired replacement is narrow:

```text
TODAY
UI -> api.ts -> demoApi -> demo engine/data
UI -> ws.ts  -> demo bus/feed/engine events

FUTURE
UI -> api.ts -> HTTP adapter -> backend services/database
UI -> ws.ts  -> real WebSocket -> backend realtime gateway
```

Backend responsibilities will likely separate into:

```text
Auth/session
Market data + candle history/aggregation
Trading/order execution
Positions/fills
Accounts/equity/margin
WebSocket gateway
Persistence
```

Do not couple UI components directly to exchange/provider-specific payloads.
Normalize provider data behind the backend/API boundary into the existing
Xee.Labs contracts.

## 14. Contract checklist before connecting a real backend

Before replacing the demo transport, verify explicitly:

1. REST response shapes match `services/schemas.ts` and active Query consumers.
2. Candle metadata semantics (`isPartial`, `backfillQueued`, coverage start)
   are defined.
3. WS channel names and event payloads match `MarketDataBridge`.
4. Ordering/idempotency rules for duplicate WS events are defined.
5. Reconnect + resubscription behavior for accounts/symbol interest is defined.
6. REST snapshots can reconcile state after missed WS events.
7. Auth token refresh and WS reauthentication semantics are defined.
8. Production order types are reconciled with the current `OrderSchema` /
   `PlaceOrderInputSchema` mismatch.
9. Demo mode remains available as an offline/local-development adapter unless
   a later decision explicitly removes it.
10. Backend-specific DTOs are normalized at the adapter boundary, not leaked
    into UI components.

## See also

- [OVERVIEW.md](OVERVIEW.md) — architecture overview.
- [../PROJECT-CONTEXT.md](../PROJECT-CONTEXT.md) — durable project context.
- [../decisions/0003-protected-backend-integration-seams.md](../decisions/0003-protected-backend-integration-seams.md) — protected integration seams.
- [`src/components/MarketDataBridge.tsx`](../../src/components/MarketDataBridge.tsx) — live event consumer.
- [`src/services/schemas.ts`](../../src/services/schemas.ts) — shared entity contract.
