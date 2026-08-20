FROM python:3.12-slim AS builder

WORKDIR /app

# cryptofeed pulls in yapic.json, which compiles a C++ extension at install
# time — python:3.12-slim has no compiler by default.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml requirements-lock.txt ./
COPY app ./app

# --constraint pins every resolved version to requirements-lock.txt (see that
# file) without adding packages beyond what pyproject.toml already declares —
# so the build is reproducible instead of silently resolving a fresh
# dependency set each time.
RUN pip install --no-cache-dir --prefix=/install --constraint requirements-lock.txt .

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /install /usr/local
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
