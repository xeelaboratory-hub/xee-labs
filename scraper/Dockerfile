FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml requirements-lock.txt ./
COPY app ./app

# --constraint pins every resolved version to requirements-lock.txt (see that
# file) without adding packages beyond what pyproject.toml already declares —
# so the build is reproducible instead of silently resolving a fresh
# dependency set each time.
RUN pip install --no-cache-dir --constraint requirements-lock.txt .

CMD ["python", "-m", "app.main"]
