import logging
from pydantic import field_validator
from pydantic_settings import BaseSettings

_log = logging.getLogger(__name__)


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60

    # ── Process / resource limits ─────────────────────────────────────────
    # Number of uvicorn worker processes. Default 1 for SQLite (file lock
    # contention); raise to 2-4 once on Postgres.
    web_concurrency: int = 1
    # Max request body size (bytes). Default 1 MB — anything larger gets 413.
    max_body_bytes: int = 1_048_576
    # Thread pool size for blocking yfinance calls. Yahoo silently
    # rate-limits (NaN columns / fake "delisted" errors) past ~10 concurrent
    # connections per replica — see INFRASTRUCTURE.md. This was bumped to 16
    # alongside the 599-stock universe widening, which made every batch
    # download self-throttle harder, not faster.
    yf_pool_size: int = 10
    # Dedicated pool for per-ticker fast_info backfill (the safety net that
    # recovers tickers Yahoo's batch endpoint silently NaN-ed). Sized so
    # `yf_pool_size + yf_backfill_size` stays at or under the ~10-connection
    # ceiling above — backfill exists to mitigate throttle, not deepen it.
    yf_backfill_size: int = 4

    # ── Database pool (Postgres / MySQL only — SQLite ignores) ────────────
    db_pool_size:    int = 10
    db_max_overflow: int = 20

    # Comma-separated list of allowed CORS origins.
    # Example: "https://app.example.com,https://www.example.com"
    # Defaults cover local dev + the production custom domain.
    # Override via ALLOWED_ORIGINS env var / Fly secret in production.
    allowed_origins: str = (
        "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
        "http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,"
        "https://marketcap.ksystems.live,"
        "https://market-cap-tau.vercel.app,"
        "https://market-cap-tau.com"
    )

    # Regex matching allowed origins, in addition to the explicit list above.
    # Vercel mints a fresh URL on every deploy (e.g.
    # market-<hash>-<team>.vercel.app), so we match the whole project family
    # rather than pinning exact URLs that break on the next push. Empty string
    # disables regex matching.
    allowed_origin_regex: str = (
        r"https://market-[a-z0-9-]+\.vercel\.app"
    )

    # Seconds between autonomous market-overview cache refreshes. Kept below the
    # in-process cache TTL so the cached payload is always fresh and every
    # request hits the fast path. Validated/coerced by pydantic; values below
    # the 15s floor are clamped at use time.
    overview_refresh_seconds: int = 60

    # Admin endpoints (auto-fixer trigger, log) require this token in the
    # X-Admin-Token header. If unset, the admin router returns 503.
    admin_token: str = ""

    # Auto-fixer scheduler — disabled by default so production servers don't
    # rewrite their own source code at runtime.
    auto_fixer_enabled: bool = False
    auto_fixer_interval_hours: int = 5

    # Set IS_PRODUCTION=true in production (Fly secrets / Vercel env).
    # Disables /docs, /redoc, /openapi.json so the full API schema is never
    # publicly exposed on the live server.
    is_production: bool = False

    # Groq API key (free tier) — powers all AI co-pilot features: portfolio
    # analysis, daily brief, chart analysis, earnings briefs, and the
    # app-wide chat assistant. Get a free key at https://console.groq.com.
    # Endpoints return 503 until this is set.
    groq_api_key: str = ""

    # Preferred Groq model ID. Empty = use the built-in fallback chain in
    # services/claude.py. Setting this lets ops migrate off a deprecated
    # model with a config change instead of a code deploy; if the provider
    # reports the configured model as decommissioned, the client still
    # falls back to the built-in chain automatically.
    groq_model: str = ""

    # Preferred Groq model ID for DEEP analysis work (standard / deep-dive
    # analyst reports). Empty = use the built-in deep-tier chain in
    # services/claude.py, which prefers the largest reasoning-capable model.
    # Same fallback semantics as groq_model.
    groq_deep_model: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"   # silently ignore leftover keys

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @field_validator("jwt_algorithm")
    @classmethod
    def _jwt_algorithm_allowlist(cls, v: str) -> str:
        """Reject dangerous JWT algorithm values (none, RS256 misuse, etc.)."""
        allowed = {"HS256", "HS384", "HS512"}
        if v not in allowed:
            raise ValueError(
                f"JWT_ALGORITHM must be one of {sorted(allowed)}. "
                "The 'none' algorithm and asymmetric algorithms are not permitted."
            )
        return v

    @field_validator("jwt_secret")
    @classmethod
    def _jwt_secret_strong(cls, v: str) -> str:
        """Refuse to boot with a weak / placeholder JWT secret."""
        if not v or len(v) < 32:
            raise ValueError(
                "JWT_SECRET must be at least 32 characters. "
                "Generate one with: python3 -c 'import secrets; print(secrets.token_urlsafe(48))'"
            )
        _blocklist = {
            "change-me-to-a-random-secret", "secret", "changeme",
            "marketcap-super-secret-change-me-in-production",
        }
        if v in _blocklist or "change-me" in v.lower():
            raise ValueError("JWT_SECRET is set to a placeholder value — change it.")
        return v


settings = Settings()

if not settings.admin_token:
    _log.warning(
        "ADMIN_TOKEN is not set — /admin/* endpoints are disabled. "
        "Set ADMIN_TOKEN in .env to enable them."
    )
