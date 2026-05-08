"""
FastAPI application entry point.

Creates tables on startup via Base.metadata.create_all (see database.init_db).
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import text

from database.database import SessionLocal, init_db
from routers import auth_router, coach_router, garmin_router, profile_router, strava_router, users_router

logger = logging.getLogger(__name__)

limiter = Limiter(key_func=get_remote_address)

_DEFAULT_CORS = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:3001,http://127.0.0.1:3001"
)


def _normalize_origin(value: str) -> str:
    s = value.strip()
    if not s:
        return ""
    return s.rstrip("/")


def _parse_cors_origins(raw: str | None) -> list[str]:
    """Parse CORS_ORIGINS: comma-separated and/or JSON array; strip; strip trailing slash."""
    if raw is None:
        return [_normalize_origin(o) for o in _DEFAULT_CORS.split(",") if _normalize_origin(o)]

    text = raw.strip()
    if not text:
        return []

    if text.startswith("["):
        try:
            data = json.loads(text)
            if isinstance(data, list):
                out = [_normalize_origin(str(x)) for x in data]
                return list(dict.fromkeys(o for o in out if o))
        except json.JSONDecodeError:
            pass

    out: list[str] = []
    for part in text.split(","):
        part = part.strip().strip('"').strip("'")
        if not part or part in ("[", "]"):
            continue
        n = _normalize_origin(part)
        if n:
            out.append(n)
    return list(dict.fromkeys(out))


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    app.state.garmin_session_active = False
    yield


app = FastAPI(title="AI Coach API", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_cors_env = os.environ.get("CORS_ORIGINS")
_is_production = os.environ.get("ENVIRONMENT", "").lower() in ("production", "prod")
if _cors_env is None:
    if _is_production:
        logger.warning(
            "CORS_ORIGINS is not set in production — only localhost origins will be allowed. "
            "Set CORS_ORIGINS to your frontend URL, e.g. https://your-app.vercel.app"
        )
    _cors_origins = _parse_cors_origins(None)
else:
    _cors_origins = _parse_cors_origins(_cors_env)
    if not _cors_origins:
        logger.warning(
            "CORS_ORIGINS is set but empty or unparsable; falling back to localhost defaults. "
            "Set CORS_ORIGINS to a comma-separated list, e.g. "
            "https://your-app.vercel.app (no trailing slash)."
        )
        _cors_origins = _parse_cors_origins(None)

logger.info("CORS allow_origins: %s", _cors_origins)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users_router.router, prefix="/api")
app.include_router(auth_router.router, prefix="/api")
app.include_router(strava_router.router, prefix="/api")
app.include_router(garmin_router.router, prefix="/api")
app.include_router(profile_router.router, prefix="/api")
app.include_router(coach_router.router, prefix="/api")


@app.get("/health")
def health() -> dict[str, str]:
    db_status = "ok"
    try:
        with SessionLocal() as session:
            session.execute(text("SELECT 1"))
    except Exception:
        db_status = "unavailable"
    return {"status": "ok", "database": db_status}
