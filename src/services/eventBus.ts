/**
 * Tiny in-process channel event bus.
 *
 * The real market-data WebSocket client (services/ws.ts) publishes frames
 * here; MarketDataBridge subscribes through wsClient.subscribe(), which is
 * backed by this bus.
 */
export type ChannelHandler = (event: unknown) => void;

const channels = new Map<string, Set<ChannelHandler>>();

export function subscribeChannel(channel: string, handler: ChannelHandler): () => void {
  let set = channels.get(channel);
  if (!set) {
    set = new Set();
    channels.set(channel, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

export function publish(channel: string, event: unknown): void {
  const set = channels.get(channel);
  if (!set) return;
  for (const handler of set) handler(event);
}
