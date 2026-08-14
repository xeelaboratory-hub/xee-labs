FROM python:3.12-slim AS builder

WORKDIR /app

# cryptofeed pulls in yapic.json, which compiles a C++ extension at install
# time — python:3.12-slim has no compiler by default.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app

RUN pip install --no-cache-dir --prefix=/install .

FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /install /usr/local
COPY app ./app

EXPOSE 3000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]
