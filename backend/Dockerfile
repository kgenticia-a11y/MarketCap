# Backend Dockerfile — FastAPI + uvicorn
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    # Worker count — override via WEB_CONCURRENCY env var at deploy time.
    # 1 is safe for SQLite (file lock contention); bump to 2-4 on Postgres.
    WEB_CONCURRENCY=1

# System deps needed for yfinance, lxml, and bcrypt builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libxml2-dev \
    libxslt1-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Create a non-root user and chown the app dir
RUN useradd --create-home --uid 1001 appuser
COPY --chown=appuser:appuser app/ ./app/
USER appuser

EXPOSE 8000

# Container-level healthcheck — re-uses our /health endpoint which pings the DB.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health > /dev/null || exit 1

# uvicorn picks up WEB_CONCURRENCY automatically; shell form so $WEB_CONCURRENCY expands.
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers ${WEB_CONCURRENCY:-1} --proxy-headers --forwarded-allow-ips='*'
