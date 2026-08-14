"""Tiny in-process pub/sub so feeds/* can publish normalized events without
importing the WS gateway (which subscribes) — avoids a circular import
between feeds and api/ws_gateway.
"""
import asyncio

from app.schemas import MarketDataEvent


class EventBus:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: MarketDataEvent) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A slow WS consumer must never block a feed callback — drop for them.
                pass


bus = EventBus()
