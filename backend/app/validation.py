"""Shared request-validation error handling.

Pydantic validation errors echo the offending raw value back in `input`
(e.g. a too-short password fails RegisterRequest's Field(min_length=8) and
FastAPI's default handler would return the plaintext password in the 422
body). This redacts `input`/`ctx` for any field whose name suggests it's a
credential; everything else about the error (message, location) is kept.

It also strips a non-finite float (NaN/+Inf/-Inf) `input` regardless of
field name: standard `json.loads` (what Starlette parses request bodies
with) accepts bare NaN/Infinity tokens even though they aren't valid JSON,
but Starlette's JSONResponse serializes with `allow_nan=False` — echoing one
of those back verbatim would crash the error response itself with a 500
instead of returning a clean 422.
"""

import math

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

SENSITIVE_FIELD_NAMES = {"password", "passphrase", "secret", "token"}


def _is_non_finite_float(value: object) -> bool:
    return isinstance(value, float) and not math.isfinite(value)


def redact_sensitive_validation_errors(request: Request, exc: RequestValidationError) -> JSONResponse:
    errors = []
    for error in exc.errors():
        error = dict(error)
        sensitive = any(str(part).lower() in SENSITIVE_FIELD_NAMES for part in error.get("loc", ()))
        if sensitive or _is_non_finite_float(error.get("input")):
            error.pop("input", None)
            error.pop("ctx", None)
        errors.append(error)
    return JSONResponse(status_code=422, content=jsonable_encoder({"detail": errors}))


def install_validation_error_redaction(app: FastAPI) -> None:
    app.exception_handler(RequestValidationError)(redact_sensitive_validation_errors)
