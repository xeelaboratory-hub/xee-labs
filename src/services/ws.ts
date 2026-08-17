/**
 * Real-time market-data WebSocket client.
 *
 * Connects to the backend's `/ws` gateway (see backend/app/api/ws_gateway.py)
 * and republishes every frame onto a local event bus (services/eventBus.ts)
 * that MarketDataBridge/ConnectionIndicator/store subscribe through.
 *
 * The backend always replies with the full 4-symbol universe and has no
 * dynamic resubscribe, so this client subscribes to all symbols once per
 * connection rather than narrowing per selected symbol.
 */
import { publish, subscribeChannel, type ChannelHandler } from "./eventBus.ts";

export type ConnectionState = "connected" | "connecting" | "reconnecting" | "disconnected";
export type WsHandler = ChannelHandler;

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

const ALL_SYMBOLS = ["BINANCE:BTCUSD", "BINANCE:ETHUSD", "OKX:BTCUSD", "OKX:ETHUSD"];

function wsUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
  if (apiUrl) {
    return `${apiUrl.replace(/\/$/, "").replace(/^http/, "ws")}/ws`;
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

interface MarketDataFrame {
  eventType?: string;
  symbol: string;
  bid?: number;
  ask?: number;
  [key: string]: unknown;
}

class RealWsClient {
  private _state: ConnectionState = "disconnected";
  private stateListeners = new Set<(s: ConnectionState) => void>();
  private socket: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;

  get state(): ConnectionState {
    return this._state;
  }

  private setState(next: ConnectionState): void {
    this._state = next;
    for (const cb of this.stateListeners) cb(next);
  }

  connect(_token?: string): void {
    if (this.socket || this._state === "connecting" || this._state === "connected") return;
    this.shouldReconnect = true;
    this.open();
  }

  private open(): void {
    if (this.reconnectAttempt === 0) this.setState("connecting");
    const socket = new WebSocket(wsUrl());
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      socket.send(JSON.stringify({ action: "subscribe", symbols: ALL_SYMBOLS }));
      this.setState("connected");
    };

    socket.onmessage = (event) => {
      let data: MarketDataFrame;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data.eventType) return; // subscribe ack — nothing to route
      publish("market-data", data);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return; // stale handler from an already-superseded socket
      this.socket = null;
      if (this.shouldReconnect) this.scheduleReconnect();
      else this.setState("disconnected");
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    const jittered = delay * (0.5 + Math.random() * 0.5);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) this.open();
    }, jittered);
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setState("disconnected");
  }

  reauthenticate(_token: string): void {
    // No auth on the market-data WS — nothing to refresh.
  }

  subscribe(channel: string, handler: WsHandler): () => void {
    return subscribeChannel(channel, handler);
  }

  subscribeAccounts(_accountIds: string[]): void {
    // Account events flow through the local paper-trading engine, not this socket.
  }

  setSymbolInterest(_symbols: string[]): void {
    // The backend has no dynamic resubscribe, and the full 4-symbol universe
    // is always subscribed on connect — nothing to narrow.
  }

  onStateChange(cb: (s: ConnectionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this._state);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  /** Allow the engine/other local producers to push events onto the same bus. */
  emit(channel: string, event: unknown): void {
    publish(channel, event);
  }
}

export const wsClient = new RealWsClient();
