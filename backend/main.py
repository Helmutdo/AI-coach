"""
FastAPI application entry point.

Creates tables on startup via Base.metadata.create_all (see database.init_db).
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.database import init_db
from routers import auth_router, coach_router, garmin_router
from services.garmin_service import GarminService
from services.sync_service import tokens_on_disk

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    app.state.garmin_session_active = False

    if tokens_on_disk():
        try:
            gs = GarminService()
            gs.login()
            app.state.garmin_session_active = True
            logger.info("Garmin session restored from stored OAuth tokens")
        except Exception as e:
            logger.warning("Garmin login required: %s", e)
    else:
        logger.info("Garmin login required (no OAuth tokens in ~/.garminconnect)")

    yield


app = FastAPI(title="Garmin AI Coach API", lifespan=lifespan)

_default_cors = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:3001,http://127.0.0.1:3001"
)
_cors_raw = os.environ.get("CORS_ORIGINS", _default_cors)
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router, prefix="/api")
app.include_router(garmin_router.router, prefix="/api")
app.include_router(coach_router.router, prefix="/api")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
