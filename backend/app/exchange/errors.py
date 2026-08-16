class ExchangeError(Exception):
    """Raised on any non-success response from an exchange — REST failure, non-'0' OKX
    code, or a network/timeout error. Callers must let this surface as a real error
    (e.g. HTTP 502) rather than falling back to stale/mock data."""

    def __init__(self, message: str, *, code: str | None = None):
        super().__init__(message)
        self.code = code
