import logging
from pydantic import field_validator
from pydantic_settings import BaseSettings

_log = logging.getLogger(__name__)


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440

    # ── Process / resource limits ─────────────────────────────────────────
    # Number of uvicorn worker processes. Default 1 for SQLite (file lock
    # contention); raise to 2-4 once on Postgres.
    web_concurrency: int = 1
    # Max request body size (bytes). Default 1 MB — anything larger gets 413.
    max_body_bytes: int = 1_048_576
    # Thread pool size for blocking yfinance calls.
    yf_pool_size: int = 6

    # ── Database pool (Postgres / MySQL only — SQLite ignores) ────────────
    db_pool_size:    int = 10
    db_max_overflow: int = 20

    # Comma-separated list of allowed CORS origins.
    # Example: "https://app.example.com,https://www.example.com"
    # Defaults cover local dev only.
    allowed_origins: str = (
        "http://localhost:5173,http://localhost:5174,http://localhost:5175,"
        "http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175"
    )

    # Admin endpoints (auto-fixer trigger, log) require this token in the
    # X-Admin-Token header. If unset, the admin router returns 503.
    admin_token: str = ""

    # Auto-fixer scheduler — disabled by default so production servers don't
    # rewrite their own source code at runtime.
    auto_fixer_enabled: bool = False
    auto_fixer_interval_hours: int = 5

    class Config:
        env_file = ".env"
        extra = "ignore"   # silently ignore leftover keys

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

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
