"""In-memory sliding-window rate limiting for the login/register routes.

The backend runs as a single uvicorn worker (see `docker-entrypoint.sh`), so a
plain in-process dict is safe — no shared/distributed store is needed. Login
is limited two ways at once — by client IP and by the attempted account — so
neither a single IP hammering many accounts nor a botnet spread across many
IPs hammering one account gets an effectively unlimited attempt budget. The
429 response is identical in both cases and regardless of whether the
attempted email exists — it never reveals account existence, and neither
limiter's key set ever stores anything beyond a timestamp log per IP/email
(no password, no other request data).
"""

import ipaddress
import logging
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

from app.auth.schemas import LoginRequest

LOG = logging.getLogger("auth")


# docker-compose.yml binds the backend's port to the host's loopback only
# (`127.0.0.1:3000:3000`) — not exposed to the public internet — but it's
# still reachable two ways within that trust boundary: proxied through nginx
# (which sets X-Forwarded-For, see nginx.conf and its `8080:80` mapping), or
# hit directly on 127.0.0.1:3000 from the host itself, or by any other
# container on the same Docker network addressing `backend:3000` directly,
# bypassing nginx entirely in both cases. Either path lets the caller set
# X-Forwarded-For to anything, which would otherwise let it dodge the IP
# limiter with a single real connection. Only trust the header when the TCP
# peer itself is a private-network address — i.e. the request came from
# inside the Docker network or the host itself, not the public internet.
# This doesn't distinguish nginx from another local/in-network process
# hitting :3000 directly; the real backstop against that is that :3000 is no
# longer internet-reachable at all, which is the actual boundary that
# matters for this rate limiter's intended purpose (external brute-force).
def _is_trusted_proxy_peer(peer: str) -> bool:
    try:
        return ipaddress.ip_address(peer).is_private
    except ValueError:
        return False


def client_ip(request: Request) -> str:
    peer = request.client.host if request.client else None
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and peer is not None and _is_trusted_proxy_peer(peer):
        return forwarded.split(",")[0].strip()
    return peer or "unknown"


def normalize_email(email: str) -> str:
    return email.strip().lower()


class SlidingWindowRateLimiter:
    """Tracks hit timestamps per key and rejects once too many land inside the window."""

    def __init__(self, *, name: str, limit: int, window_seconds: float) -> None:
        self._name = name
        self._limit = limit
        self._window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        hits = self._hits[key]
        while hits and now - hits[0] > self._window:
            hits.popleft()
        if len(hits) >= self._limit:
            retry_after = int(self._window - (now - hits[0])) + 1
            # `key` is an IP or a normalized email — never a password/token —
            # so it's safe to log as-is.
            LOG.warning("rate_limited limiter=%s key=%s retry_after=%s", self._name, key, retry_after)
            raise HTTPException(
                status_code=429,
                detail="too many attempts — try again later",
                headers={"Retry-After": str(retry_after)},
            )
        hits.append(now)

    def reset(self) -> None:
        """Test-only: clear all tracked state."""
        self._hits.clear()


# Single-developer/small-product thresholds, not enterprise-scale tuning:
# - login (IP): 5 attempts/IP/60s — enough headroom for a genuine typo'd
#   password retry, low enough to make credential-stuffing/brute-force from
#   one source impractical.
# - login (account): 8 attempts/account/60s — deliberately wider than the IP
#   limit. It exists to cap a distributed attack against one account (many
#   IPs, one email) rather than to be the primary brake on a single user —
#   that's the IP limiter's job — so it shouldn't be the one that locks out a
#   real user retyping their password from two or three of their own devices.
# - register: 3 attempts/IP/60s — registration is a rare, deliberate action,
#   so a tighter cap slows down automated account creation without affecting
#   real users.
LOGIN_LIMITER = SlidingWindowRateLimiter(name="login_ip", limit=5, window_seconds=60)
ACCOUNT_LOGIN_LIMITER = SlidingWindowRateLimiter(name="login_account", limit=8, window_seconds=60)
REGISTER_LIMITER = SlidingWindowRateLimiter(name="register_ip", limit=3, window_seconds=60)


def enforce_login_rate_limit(request: Request, body: LoginRequest) -> None:
    LOGIN_LIMITER.check(client_ip(request))
    ACCOUNT_LOGIN_LIMITER.check(normalize_email(body.email))


def enforce_register_rate_limit(request: Request) -> None:
    REGISTER_LIMITER.check(client_ip(request))
